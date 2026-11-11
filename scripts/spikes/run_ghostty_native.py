#!/usr/bin/env python3
"""Run the isolated Ghostty spike on macOS with disposable local/SSH programs.

Requires npm dependencies, Docker/OpenSSH, cached Rust dependencies, and an
already checksum-verified hc binary. Does not modify the normal app profile.
Candidate compatibility failures are findings, not a runner execution failure.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid

from herdr_core_probe import Client


def wait_for(test, seconds, process, description):
    deadline = time.monotonic() + seconds
    while True:
        value = test()
        if value:
            return value
        if process.poll() is not None:
            raise RuntimeError(f"{description}: process exited with {process.returncode}")
        if time.monotonic() > deadline:
            raise TimeoutError(description)
        time.sleep(0.25)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", help="Previously verified official hc executable")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("Native acceptance currently requires macOS; browser probes are separate")
    repo = Path(__file__).resolve().parents[2]
    binary = str(Path(args.binary).resolve())
    output = args.output.resolve()
    run_id = uuid.uuid4().hex
    result_path = Path(tempfile.gettempdir()) / "agentpanel_bench.json"
    previous = result_path.read_bytes() if result_path.exists() else None
    app = None
    fixture = None
    info = None
    native = None
    cleanup = []
    with tempfile.TemporaryDirectory(prefix="ap-ghostty-", dir="/private/tmp") as scratch:
        root = Path(scratch)
        checkout = root / "checkout"
        checkout.mkdir()
        info_path = root / "ui.json"
        ssh_result = root / "ssh-result.json"
        fixture_log = root / "fixture.log"
        native_log = root / "native.log"
        with fixture_log.open("w") as logs:
            fixture = subprocess.Popen([sys.executable, str(repo / "scripts/spikes/run_herdr_ssh_test.py"), binary,
                str(ssh_result), "--ui-info", str(info_path), "--ui-timeout", "1800"], cwd=repo, stdout=logs, stderr=subprocess.STDOUT)
            try:
                print("Preparing disposable SSH fixture", flush=True)
                wait_for(info_path.exists, 600, fixture, "SSH fixture readiness")
                info = json.loads(info_path.read_text())
                query = urllib.parse.urlencode({"auto": "1", "runId": run_id, "hc": info["executable"],
                    "session": info["session"], "cwd": str(checkout)})
                config = {"identifier": "com.jason.agentpanel.ghostty-spike", "productName": "AgentPanel Ghostty Spike",
                    "build": {"beforeBuildCommand": "npm run build:ghostty-spike", "frontendDist": "../dist-ghostty-spike"},
                    "app": {"windows": [{"title": "AgentPanel Ghostty Spike", "width": 1320, "height": 950,
                        "url": "ghostty-spike.html?" + query}]}, "bundle": {"createUpdaterArtifacts": False}}
                config_path = root / "tauri.json"
                config_path.write_text(json.dumps(config))
                env = dict(os.environ, DEVELOPER_DIR="/Library/Developer/CommandLineTools", CARGO_NET_OFFLINE="true", AGENTPANEL_BENCH="1")
                print("Building isolated native spike", flush=True)
                subprocess.run(["npm", "run", "tauri", "build", "--", "--debug", "--bundles", "app", "--config", str(config_path)],
                    cwd=repo, env=env, check=True, timeout=600)
                executable = repo / "src-tauri/target/debug/bundle/macos/AgentPanel Ghostty Spike.app/Contents/MacOS/agentpanel"
                with native_log.open("w") as log:
                    app = subprocess.Popen([str(executable)], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
                    print("Running native benchmark, transport, and compatibility probes", flush=True)

                    def read_result():
                        try:
                            data = json.loads(result_path.read_text())
                            return data if data.get("runId") == run_id else None
                        except (OSError, json.JSONDecodeError):
                            return None

                    native = wait_for(read_result, 300, app, "Native result deadline")
                    if native.get("error"):
                        raise RuntimeError(native["error"])
                    assert len(native["transport"]) == 9
                    assert all(row["result"] == "pass" for row in native["transport"]), native["transport"]
                    assert len(native["benchmark"]["results"]) == 12
                    assert all(row.get("retainedLastLine") for row in native["benchmark"]["results"]), native["benchmark"]
                    assert len(native["adapterTransport"]) == 6
                    assert all(row["result"] == "pass" for row in native["adapterTransport"]), native["adapterTransport"]
                    assert len(native["adapterBenchmark"]["results"]) == 8
                    assert all(row.get("retainedLastLine") for row in native["adapterBenchmark"]["results"]), native["adapterBenchmark"]
                    for kind, checks in native["adapterCompatibility"].items():
                        assert checks and all(row["status"] in {"pass", "fail", "unsupported"} for row in checks), (kind, checks)
                        # Compatibility findings (including baseline xterm limitations)
                        # are separate from transport execution and remain in evidence.
                    assert native["xtermUnicodeBaseline"]["adapterMatchesRaw"], native["xtermUnicodeBaseline"]
            except BaseException:
                print(fixture_log.read_text()[-5000:], file=sys.stderr)
                if native_log.exists():
                    print(native_log.read_text()[-3000:], file=sys.stderr)
                if native:
                    print(json.dumps(native)[:8000], file=sys.stderr)
                raise
            finally:
                if app and app.poll() is None:
                    app.terminate()
                    app.wait(timeout=10)
                try:
                    if info:
                        env = {key: value for key, value in os.environ.items() if not key.startswith(("HC_", "HERDR_"))}
                        env["HC_SESSION"] = info["session"]
                        client = Client(info["executable"], env)
                        try:
                            # Verify exact test bindings before cleanup. No captured terminal text is saved.
                            transport_rows = (native or {}).get("transport", []) + (native or {}).get("adapterTransport", [])
                            for row in transport_rows:
                                if row.get("binding"):
                                    assert client.hello["core"]["id"] == row["binding"]["coreId"]
                                    current = client.rpc("terminal.get", {"terminal": row["binding"]["address"]})
                                    assert current["pid"] == row["pid"] and current["state"] == "live"
                                    cleanup.append({"address": row["binding"]["address"], "pid": row["pid"], "liveAfterDetach": True})
                                elif row.get("pid"):
                                    try:
                                        os.kill(row["pid"], 0)
                                        raise AssertionError("Local PTY still alive after disposal")
                                    except ProcessLookupError:
                                        cleanup.append({"pid": row["pid"], "localPtyGoneAfterDispose": True})
                        finally:
                            try:
                                # This core and both guests are owned entirely by this fixture. Preserve
                                # its two original terminals until the parent runner completes its cleanup.
                                originals = set(info["addresses"])
                                for item in client.rpc("terminal.list", {"all": True})["terminals"]:
                                    if item["state"] == "live" and item["address"] not in originals:
                                        client.rpc("terminal.kill", {"terminal": item["address"]})
                            finally:
                                client.close()
                finally:
                    if info:
                        Path(info["stop_file"]).touch()
                    if fixture:
                        try:
                            fixture.wait(timeout=60)
                        except subprocess.TimeoutExpired:
                            fixture.terminate()
                            fixture.wait(timeout=10)
                            raise RuntimeError("SSH fixture cleanup timed out")
                    if previous is not None:
                        result_path.write_bytes(previous)
                    elif result_path.exists():
                        # Retain the latest report for inspection rather than deleting it.
                        pass
            if fixture.returncode != 0:
                raise RuntimeError("SSH fixture failed: " + fixture_log.read_text()[-5000:])
            result = {"execution": "pass", "native": native, "cleanup": cleanup,
                "sshFixture": json.loads(ssh_result.read_text()),
                "limits": ["single macOS host and two disposable Linux guests", "no manual native keyboard/IME or real-agent approval acceptance",
                    "synthetic emulator workload, not parser-only or SSH throughput", "candidate compatibility failures remain visible"]}
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, indent=2) + "\n")
            print("Completed native acceptance and fixture cleanup: " + str(output), flush=True)


if __name__ == "__main__":
    main()
