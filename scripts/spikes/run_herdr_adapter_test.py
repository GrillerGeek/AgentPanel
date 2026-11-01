#!/usr/bin/env python3
"""Run the actual Rust adapter test with disposable core state, never user state."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix="ap-rust-", dir="/private/tmp" if sys.platform == "darwin" else "/tmp") as scratch:
    root = Path(scratch)
    runtime = root / "run"
    runtime.mkdir(mode=0o700)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HC_", "HERDR_"))}
    env.update(XDG_STATE_HOME=str(root / "state"), XDG_CONFIG_HOME=str(root / "config"),
               XDG_RUNTIME_DIR=str(runtime), HC_SESSION="agentpanel-adapter-test",
               AGENTPANEL_HC_TEST_BINARY=binary, AGENTPANEL_HC_TEST_CWD=scratch)
    if sys.platform == "darwin":
        env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
    try:
        result = subprocess.run(["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--offline",
                                 "live_adapter_reconnects", "--", "--ignored", "--nocapture"], env=env)
    finally:
        stopped = subprocess.run([binary, "server", "stop"], env=env, capture_output=True, timeout=15)
        if stopped.returncode:
            raise RuntimeError("Could not stop the isolated test core: " + stopped.stderr.decode())
    sys.exit(result.returncode)
