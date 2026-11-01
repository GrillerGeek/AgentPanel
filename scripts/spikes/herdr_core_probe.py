#!/usr/bin/env python3
"""Bounded runtime probe, not application code. Uses only scratch hc sessions.

Usage: python3 scripts/spikes/herdr_core_probe.py /absolute/path/to/herdr-core
No agent accounts, installation, real projects, or default core session are used.
"""
import argparse
import collections
import json
import os
from pathlib import Path
import select
import shlex
import struct
import subprocess
import sys
import tempfile
import time


class Client:
    """Minimal implementation of hc generation 1 JSON-RPC + raw byte streams."""

    def __init__(self, binary, env):
        self.process = subprocess.Popen([binary, "connect"], env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, bufsize=0)
        self.buffer = bytearray()
        self.queued = collections.deque()
        self.seq = 0
        try:
            self.send_bytes(b'{"jsonrpc":"2.0","id":0,"method":"hello","params":{"framed":true,"generation":1}}\n')
            line = bytearray()
            while not line.endswith(b"\n"):
                line += self.exact(1)
                if len(line) > 64 * 1024:
                    raise ValueError("oversized handshake")
            hello = json.loads(line)
            if "error" in hello:
                raise RuntimeError(hello)
            self.hello = hello["result"]
        except BaseException:
            self.close()
            raise

    def send_bytes(self, data):
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def exact(self, length):
        deadline = time.monotonic() + 10
        while len(self.buffer) < length:
            if not select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                raise TimeoutError("hc stream deadline")
            chunk = os.read(self.process.stdout.fileno(), max(8192, length - len(self.buffer)))
            if not chunk:
                raise EOFError("hc connection ended")
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:length])
        del self.buffer[:length]
        return data

    def frame(self, channel, kind, payload=b""):
        self.send_bytes(struct.pack("<IBI", channel, kind, len(payload)) + payload)

    def receive(self):
        channel, kind, length = struct.unpack("<IBI", self.exact(9))
        if length > 16 * 1024 * 1024:
            raise ValueError("oversized frame")
        payload = self.exact(length)
        if channel and kind == 0:
            self.frame(channel, 1, struct.pack("<I", len(payload)))
        return channel, kind, payload

    def rpc(self, method, params=None):
        self.seq += 1
        self.frame(0, 0, json.dumps({"jsonrpc": "2.0", "id": self.seq,
                                   "method": method, "params": params or {}}).encode())
        while True:
            channel, kind, payload = self.receive()
            if channel == 0 and kind == 0:
                reply = json.loads(payload)
                if reply.get("id") == self.seq:
                    if "error" in reply:
                        raise RuntimeError(reply["error"])
                    return reply["result"]
            self.queued.append((channel, kind, payload))

    def attach(self, terminal, **kwargs):
        return self.rpc("terminal.attach", {"terminal": terminal, "cols": 80, "rows": 24,
                                            "history": 100, **kwargs})["channel"]

    def until(self, channel, marker):
        output = bytearray()
        deadline = time.monotonic() + 10
        while marker not in output:
            if time.monotonic() > deadline:
                raise TimeoutError(f"missing {marker!r}: {output[-500:]!r}")
            packet = self.queued.popleft() if self.queued else self.receive()
            ch, kind, data = packet
            if ch == channel and kind == 0:
                output.extend(data)
            if len(output) > 1024 * 1024:
                raise ValueError("probe capture limit")
        return bytes(output)

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stdin.close()
        self.process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=lambda p: str(Path(p).resolve()))
    parser.add_argument("--output", type=Path, help="Write JSON evidence after successful checks and cleanup")
    args = parser.parse_args()
    checks = []
    clients = []
    # Short paths stay below the Unix-domain socket length limit.
    temp_root = "/private/tmp" if Path("/private/tmp").is_dir() else "/tmp"
    with tempfile.TemporaryDirectory(prefix="ap-hc-", dir=temp_root) as scratch:
        root = Path(scratch)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HC_", "HERDR_"))}
        env.update(HC_SESSION="probe", XDG_STATE_HOME=str(root / "state"),
                   XDG_CONFIG_HOME=str(root / "config"), XDG_RUNTIME_DIR=str(root / "run"))
        (root / "run").mkdir(mode=0o700)
        remote_env = dict(env, HC_SESSION="peer", XDG_STATE_HOME=str(root / "rs"),
                          XDG_CONFIG_HOME=str(root / "rc"), XDG_RUNTIME_DIR=str(root / "rr"))
        (root / "rr").mkdir(mode=0o700)
        (root / "bin").mkdir()
        (root / "bin" / "hc").symlink_to(args.binary)
        (root / "bin" / "herdr-core").symlink_to(args.binary)
        bridge = root / "bridge.py"
        remote_overrides = {k: remote_env[k] for k in ("HC_SESSION", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR")}
        bridge.write_text("import os,sys\n"
                          "env=os.environ.copy()\n"
                          f"env.update({remote_overrides!r})\n"
                          f"env['PATH']={str(root / 'bin')!r}+os.pathsep+env.get('PATH','')\n"
                          "os.execve('/bin/sh',['sh','-c',sys.argv[-1]],env)\n")

        def connect():
            client = Client(args.binary, env)
            clients.append(client)
            return client

        def record(name, detail):
            checks.append({"check": name, "result": "pass", "detail": detail})
            print(json.dumps(checks[-1]), flush=True)

        try:
            c = connect()
            version = subprocess.check_output([args.binary, "--version"], text=True).strip()
            record("handshake", {"binary": version, "hello": c.hello})
            result = c.rpc("terminal.run", {"argv": ["/bin/sh"], "cwd": scratch,
                           "env": {"TERM": "xterm-256color"}, "name": "probe", "no_parent": True})
            tid, pid = result["address"], result["pid"]
            channel = c.attach(tid)
            # Raw PTY input and colored UTF-8 output, beyond pane text snapshots.
            c.frame(channel, 0, "printf '\\033[31mSPIKE-λ\\033[0m\\n'\r".encode())
            output = c.until(channel, "\x1b[31mSPIKE-λ\x1b[0m".encode())
            record("raw_input_color_utf8", {"terminal": tid, "pid": pid, "bytes": len(output)})
            c.frame(channel, 3, struct.pack("<HH", 101, 37))
            c.frame(channel, 0, b"stty size; printf 'RESIZED-END\\n'\r")
            output = c.until(channel, b"37 101")
            record("resize", {"observed": "37 rows, 101 columns"})
            # A second client observes the same runtime-owned process.
            observer = connect()
            observed = observer.attach(tid, observe=True)
            c.frame(channel, 0, b"printf 'SECOND-VIEWER\\n'\r")
            observer.until(observed, b"\r\nSECOND-VIEWER\r\n")
            assert observer.rpc("terminal.get", {"terminal": tid})["pid"] == pid
            record("two_clients", {"same_pid": pid})
            # Arrange output after all viewer connections disappear.
            c.frame(channel, 0, b"sleep 0.3; printf 'WHILE-DETACHED\\n'\r")
            observer.close()
            c.close()
            time.sleep(0.5)
            c = connect()
            current = c.rpc("terminal.get", {"terminal": tid})
            assert current["pid"] == pid and current["state"] == "live"
            channel = c.attach(tid, resumed=True)
            c.until(channel, b"\r\nWHILE-DETACHED\r\n")
            record("zero_clients_reattach", {"same_pid": pid, "repaint_contains_detached_output": True})
            # More than the initial 256 KiB stream credit: the probe must return
            # credit while consuming, or this output never reaches its marker.
            c.frame(channel, 0, b"dd if=/dev/zero bs=1024 count=300 2>/dev/null | tr '\\000' x; printf '\\nFLOOD-END\\n'\r")
            flood = c.until(channel, b"\r\nFLOOD-END\r\n")
            assert len(flood) >= 300 * 1024
            record("stream_credit", {"consumed_bytes": len(flood), "initial_credit": 256 * 1024})
            # Let a cooperating script report its real state; no paid agent used.
            c.frame(channel, 0, b"printf '\\033]7501;state=blocked:app=spike\\033\\\\'\r")
            deadline = time.monotonic() + 5
            while True:
                status = c.rpc("terminal.get", {"terminal": tid}).get("status")
                if status and status.get("state") == "blocked":
                    break
                if time.monotonic() > deadline:
                    raise AssertionError(f"status not reported: {status!r}")
                time.sleep(0.05)
            record("program_reported_status", status)
            # Planned runtime restart should preserve holder-owned programs.
            old_core_pid = c.rpc("server.status")["pid"]
            c.rpc("server.restart")
            # Wait for the acknowledged restart to actually close this core's
            # connection; an immediate connect can still reach the old core.
            try:
                while True:
                    c.receive()
            except EOFError:
                pass
            c.close()
            c = connect()
            new_core_pid = c.rpc("server.status")["pid"]
            assert new_core_pid != old_core_pid
            current = c.rpc("terminal.get", {"terminal": tid})
            assert current["pid"] == pid and current["state"] == "live"
            channel = c.attach(tid, resumed=True)
            c.frame(channel, 0, b"printf 'AFTER-RESTART\\n'\r")
            c.until(channel, b"\r\nAFTER-RESTART\r\n")
            record("planned_core_restart", {"same_program_pid": pid, "old_core_pid": old_core_pid,
                                            "new_core_pid": new_core_pid})
            # Exercise machine-qualified routing over a local stdio bridge to a
            # second isolated core. This deliberately does NOT claim SSH proof.
            c.rpc("machine.add", {"name": "peer", "session": "peer",
                                  "via": f"{shlex.quote(sys.executable)} {shlex.quote(str(bridge))}"})
            c.rpc("machine.connect", {"machine": "peer"})
            peer = c.rpc("terminal.run", {"on": "peer", "argv": ["/bin/sh"],
                                         "cwd": scratch, "name": "peer-shell", "no_parent": True})
            peer_id = peer["address"]
            assert peer_id.startswith("peer/")
            peer_channel = c.attach(peer_id)
            c.frame(peer_channel, 0, b"printf 'ROUTED-PEER\\n'\r")
            c.until(peer_channel, b"\r\nROUTED-PEER\r\n")
            c.rpc("machine.rm", {"machine": "peer"})
            peer_client = Client(args.binary, remote_env)
            clients.append(peer_client)
            assert peer_client.rpc("terminal.get", {"terminal": peer_id.split("/", 1)[1]})["pid"] == peer["pid"]
            assert c.rpc("terminal.get", {"terminal": tid})["pid"] == pid
            record("machine_routing_and_disconnect", {"address": peer_id, "peer_process_survived_remove": True,
                                                       "transport": "local stdio bridge, not SSH"})
            c.rpc("terminal.kill", {"terminal": tid})
            current = c.rpc("terminal.get", {"terminal": tid})
            assert current["state"] == "finished"
            record("explicit_stop", {"state": current["state"], "reason": current.get("reason")})
        finally:
            for client in clients:
                client.close()
            # Only the scratch session is stopped, even on a failed assertion.
            errors = []
            for session_env in (env, remote_env):
                stopped = subprocess.run([args.binary, "server", "stop"], env=session_env,
                                         capture_output=True, timeout=10, check=False)
                if stopped.returncode:
                    errors.append(stopped.stderr.decode())
            if errors:
                raise RuntimeError(f"scratch core cleanup failed: {errors}")
    summary = {"summary": "pass", "checks": checks, "binary": version,
               "platform": sys.platform, "cleanup": "both scratch sessions stopped",
               "limits": ["local stdio routing only; no SSH network tested", "no Windows or Linux run",
                          "no xterm renderer or production app integration tested"]}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"summary": "pass", "checks": len(checks), "binary": version,
                      "cleanup": summary["cleanup"]}), flush=True)


if __name__ == "__main__":
    main()
