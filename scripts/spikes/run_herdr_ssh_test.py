#!/usr/bin/env python3
"""Actual network SSH acceptance against an ephemeral Linux container.

No existing SSH configuration, known_hosts, credentials, or core sessions used.
Requires Docker, OpenSSH, Rust, and an already verified local herdr-core binary.
"""
import base64
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time

from herdr_core_probe import Client

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary")
parser.add_argument("output", nargs="?")
parser.add_argument("--ui-info", type=Path, help="Keep isolated guests available up to 10 minutes; write a stop file at the reported path when finished")
args = parser.parse_args()
binary = str(Path(args.binary).resolve())
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
    containers = []
    client = None
    known = root / "known_hosts"

    def start_guest():
        container = subprocess.check_output(["docker", "run", "--rm", "-d", "-p", "127.0.0.1::22",
            "-v", f"{key}.pub:/test-key.pub:ro", "agentpanel-ssh-fixture:hc-0.1.16"], text=True).strip()
        containers.append(container)
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
        with known.open("a") as handle:
            handle.write(f"[127.0.0.1]:{port} " + hostkey.stdout)
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
        return ssh

    try:
        ssh = start_guest()
        other_ssh = start_guest()
        client = Client(binary, env)
        client.rpc("machine.add", {"name": "linux", "session": "adapter-peer-test", "via": shlex.join(ssh)})
        client.rpc("machine.connect", {"machine": "linux"})
        client.rpc("machine.add", {"name": "other", "session": "adapter-peer-test", "via": shlex.join(other_ssh)})
        client.rpc("machine.connect", {"machine": "other"})
        terminal = client.rpc("terminal.run", {"on": "linux", "argv": ["/bin/sh"],
            "cwd": "/home/agentpanel/project", "no_parent": True})
        other_terminal = client.rpc("terminal.run", {"on": "other", "argv": ["/bin/sh"],
            "cwd": "/home/agentpanel/project", "no_parent": True})
        machines = {m["name"]: m["id"] for m in client.rpc("machine.list")["machines"]}
        assert machines["linux"] != machines["other"]
        remote_address, pid = terminal["address"], terminal["pid"]
        test_env = dict(env, AGENTPANEL_HC_TEST_BINARY=binary,
            AGENTPANEL_HC_TEST_CWD="/home/agentpanel/project",
            AGENTPANEL_HC_REMOTE_ADDRESS=remote_address, AGENTPANEL_HC_REMOTE_CORE=client.hello["core"]["id"],
            AGENTPANEL_HC_REMOTE_MACHINE=machines["linux"],
            AGENTPANEL_HC_OTHER_MACHINE=machines["other"], AGENTPANEL_HC_OTHER_ADDRESS=other_terminal["address"])
        if sys.platform == "darwin":
            test_env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
        adapter_test = ["cargo", "test", "--manifest-path", str(repo / "src-tauri/Cargo.toml"), "--offline",
                        "live_adapter_attaches_to_ssh_terminal", "--", "--ignored", "--nocapture"]
        subprocess.run(adapter_test, env=test_env, check=True, timeout=300)
        # Kill SSH session processes, never the runtime/holder, to force a real
        # transport interruption. The remote shell must survive reconnection.
        # Pause the first listener and end its user SSH session while leaving
        # the remote runtime alive. The second guest must stay usable meanwhile.
        subprocess.run(["docker", "exec", containers[0], "pkill", "-STOP", "-u", "root", "-x", "sshd"], check=True)
        subprocess.run(["docker", "exec", containers[0], "pkill", "-u", "agentpanel", "-x", "sshd"], check=True)
        observed = client.rpc("machine.exec", {"on": "other", "argv": ["uname", "-s"], "timeout": 5})
        assert observed.get("code") == 0 and base64.b64decode(observed["stdout"]).strip() == b"Linux"
        assert client.rpc("terminal.get", {"terminal": other_terminal["address"]})["pid"] == other_terminal["pid"]
        subprocess.run(["docker", "exec", containers[0], "pkill", "-CONT", "-u", "root", "-x", "sshd"], check=True)
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
        if args.ui_info:
            wrapper = root / "hc-ui"
            wrapper.write_text("#!/bin/sh\n" + "\n".join(
                f"export {name}={shlex.quote(env[name])}" for name in
                ("XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR")) +
                f"\nexec {shlex.quote(binary)} \"$@\"\n")
            wrapper.chmod(0o700)
            stop = root / "stop"
            args.ui_info.write_text(json.dumps({"executable": str(wrapper), "session": env["HC_SESSION"],
                "stop_file": str(stop), "addresses": [remote_address, other_terminal["address"]]}))
            print("Disposable UI fixture ready: " + str(args.ui_info), flush=True)
            deadline = time.monotonic() + 600
            while not stop.exists():
                if time.monotonic() > deadline:
                    raise TimeoutError("UI fixture acceptance window expired")
                time.sleep(0.25)
        client.rpc("terminal.kill", {"terminal": remote_address})
        client.rpc("terminal.kill", {"terminal": other_terminal["address"]})
        result = {"result": "pass", "transport": "OpenSSH over localhost TCP to two Linux Docker guests",
                  "remote_address": remote_address, "same_remote_pid_after_interruption": pid,
                  "rust_adapter_remote_attach": True, "strict_host_key_checking": True,
                  "second_guest_usable_during_first_ssh_outage": True,
                  "limits": ["not two physical computers", "no WAN/sleep/MFA acceptance", "UI acceptance is manual and documented separately"]}
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
                failures = []
                for container in containers:
                    try:
                        subprocess.run(["docker", "stop", container], stdout=subprocess.DEVNULL, timeout=20, check=True)
                    except (subprocess.SubprocessError, OSError) as error:
                        failures.append(str(error))
                if failures:
                    raise RuntimeError("Could not clean up every SSH fixture: " + "; ".join(failures))
    # Publish successful evidence only after cleanup also succeeded.
    print(json.dumps(result), flush=True)
    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
