#!/usr/bin/env python3
"""Actual network SSH acceptance against an ephemeral Linux container.

No existing SSH configuration, known_hosts, credentials, or core sessions used.
Requires Docker, OpenSSH, Rust, and an already verified local herdr-core binary.
"""
import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time

from herdr_core_probe import Client

binary = str(Path(sys.argv[1]).resolve())
repo = Path(__file__).resolve().parents[2]
subprocess.run(["docker", "build", "-q", "-t", "agentpanel-ssh-fixture:hc-0.1.16",
                str(Path(__file__).parent / "ssh-fixture")], check=True, timeout=300)

with tempfile.TemporaryDirectory(prefix="ap-ssh-", dir="/private/tmp" if sys.platform == "darwin" else "/tmp") as scratch:
    root = Path(scratch)
    (root / "run").mkdir(mode=0o700)
    key = root / "id_ed25519"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HC_", "HERDR_"))}
    env.update(HC_SESSION="agentpanel-adapter-test", XDG_STATE_HOME=str(root / "state"),
               XDG_CONFIG_HOME=str(root / "config"), XDG_RUNTIME_DIR=str(root / "run"))
    container = None
    client = None
    try:
        container = subprocess.check_output(["docker", "run", "--rm", "-d", "-p", "127.0.0.1::22",
            "-v", f"{key}.pub:/test-key.pub:ro", "agentpanel-ssh-fixture:hc-0.1.16"], text=True).strip()
        address = subprocess.check_output(["docker", "port", container, "22/tcp"], text=True).strip()
        port = address.rsplit(":", 1)[1]
        # Pin a public host key read through Docker, not an unauthenticated scan.
        deadline = time.monotonic() + 30
        while True:
            hostkey = subprocess.run(["docker", "exec", container, "cat", "/etc/ssh/ssh_host_ed25519_key.pub"],
                                     text=True, capture_output=True)
            if hostkey.returncode == 0:
                break
            if time.monotonic() > deadline:
                raise TimeoutError("SSH fixture startup")
            time.sleep(0.1)
        known = root / "known_hosts"
        known.write_text(f"[127.0.0.1]:{port} " + hostkey.stdout)
        ssh = ["ssh", "-F", "/dev/null", "-p", port, "-i", str(key), "-o", "IdentitiesOnly=yes",
               "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={known}",
               "agentpanel@127.0.0.1"]
        # Confirm readiness and authentication before asking core to connect.
        for attempt in range(30):
            ready = subprocess.run(ssh + ["uname -s"], capture_output=True, text=True, timeout=5)
            if ready.returncode == 0 and ready.stdout.strip() == "Linux":
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("SSH fixture authentication failed: " + ready.stderr)
        client = Client(binary, env)
        client.rpc("machine.add", {"name": "linux", "session": "adapter-peer-test", "via": shlex.join(ssh)})
        client.rpc("machine.connect", {"machine": "linux"})
        terminal = client.rpc("terminal.run", {"on": "linux", "argv": ["/bin/sh"],
            "cwd": "/home/agentpanel/project", "labels": {"agentpanel.pane": "a" * 32}, "no_parent": True})
        remote_address, pid = terminal["address"], terminal["pid"]
        test_env = dict(env, AGENTPANEL_HC_TEST_BINARY=binary,
            AGENTPANEL_HC_TEST_CWD="/home/agentpanel/project",
            AGENTPANEL_HC_REMOTE_ADDRESS=remote_address, AGENTPANEL_HC_REMOTE_CORE=client.hello["core"]["id"])
        if sys.platform == "darwin":
            test_env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
        adapter_test = ["cargo", "test", "--manifest-path", str(repo / "src-tauri/Cargo.toml"), "--offline",
                        "live_adapter_attaches_to_ssh_terminal", "--", "--ignored", "--nocapture"]
        subprocess.run(adapter_test, env=test_env, check=True, timeout=300)
        # Kill SSH session processes, never the runtime/holder, to force a real
        # transport interruption. The remote shell must survive reconnection.
        subprocess.run(["docker", "exec", container, "pkill", "-u", "agentpanel", "sshd"], check=True)
        deadline = time.monotonic() + 60
        while True:
            try:
                current = client.rpc("terminal.get", {"terminal": remote_address})
                if current["pid"] == pid and current["state"] == "live":
                    # Require a remote command too: cached metadata isn't proof.
                    observed = client.rpc("machine.exec", {"on": "linux", "argv": ["uname", "-s"], "timeout": 5})
                    if observed.get("code") == 0 and base64.b64decode(observed["stdout"]).strip() == b"Linux":
                        break
            except (RuntimeError, EOFError, TimeoutError):
                pass
            if time.monotonic() > deadline:
                raise TimeoutError("real SSH reconnect")
            time.sleep(0.25)
        # Reopen the actual adapter after transport recovery, not just the probe.
        subprocess.run(adapter_test, env=test_env, check=True, timeout=60)
        current = client.rpc("terminal.get", {"terminal": remote_address})
        assert current["pid"] == pid and current["state"] == "live"
        client.rpc("terminal.kill", {"terminal": remote_address})
        result = {"result": "pass", "transport": "OpenSSH over localhost TCP to Linux Docker guest",
                  "remote_address": remote_address, "same_remote_pid_after_interruption": pid,
                  "rust_adapter_remote_attach": True, "strict_host_key_checking": True,
                  "limits": ["not two physical computers", "no WAN/sleep/MFA acceptance", "no machine UI"]}
    finally:
        try:
            if client:
                client.close()
        finally:
            try:
                stopped = subprocess.run([binary, "server", "stop"], env=env, capture_output=True, timeout=15)
                if stopped.returncode:
                    raise RuntimeError("Could not stop the isolated test core: " + stopped.stderr.decode())
            finally:
                if container:
                    subprocess.run(["docker", "stop", container], stdout=subprocess.DEVNULL, timeout=20, check=True)
    # Publish successful evidence only after cleanup also succeeded.
    print(json.dumps(result), flush=True)
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
