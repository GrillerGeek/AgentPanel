# Herdr core adapter implementation and acceptance

AgentPanel now has an opt-in local Herdr core runtime. The built-in PTY remains the default. Each new persistent pane records its executable, dedicated core session, random pane identity, core identity, and terminal address. Existing local panes stay local when Settings changes.

## Using the prototype

Install herdr-core separately. In Settings, select **Herdr core (experimental)** under **Runtime for new terminals**, enter the executable name or full path without arguments, and keep a dedicated session such as `agentpanel`. Save and create a new terminal.

Closing AgentPanel detaches the viewer and leaves its shell or agent running. Reopening restores the saved binding and attaches to the same terminal. The core provides its current screen and history; AgentPanel does not append its old local scrollback snapshot. The local scrollback preference does not govern history stored by core.

Closing a connected pane or tab explicitly terminates its program before forgetting the pane. A termination failure keeps the tab visible. A pane that never connected can be forgotten only after a warning that its runtime program might still exist. Worktree removal requires confirmed termination, including refusal when a persistent pane is still connecting.

Lost connections display a Reconnect action and disable terminal input. Reconnect revalidates the core, pane label, address, original working directory, and live state. A stale identity, ended program, missing executable, or incompatible protocol produces an error; none triggers fallback to a new local shell. Agent launch commands are sent only for newly created terminals, never replayed on reconnect.

Herdr status comes from program reports. An ordinary shell or an agent without OSC 7501 remains **status not reported**. Transport disconnection is distinct from process exit; silence does not imply success.

## Implementation

- [Rust transport](../../src-tauri/src/herdr.rs) uses `hc connect`, generation 1 capability negotiation, JSON-RPC, and framed raw terminal streams. It never installs core or exposes a TCP service.
- [Tauri commands](../../src-tauri/src/herdr_commands.rs) expose ephemeral viewer handles with separate detach and terminate operations. Runtime identity persists with the pane rather than a numeric handle.
- [Frontend transport](../../src/lib/terminalRuntime.ts) supplies a narrow terminal interface for both runtimes. Persistent output credits return only after xterm's write callback. Acknowledgements arriving before the open response are buffered.
- [Terminal integration](../../src/Terminal.tsx) preserves live local PTY behavior, isolates runtime selection to pane creation, and starts each reconnect with the core's repaint.
- [Session state](../../src/state/store.ts) retains bindings and runtime choices across restart. The existing worktree deletion safety fix remains active.

The prototype bounds frames to 1 MiB, pending output to 1 MiB per viewer, individual inputs to 64 KiB, event records to 64 KiB, frame queues to eight, and control queues to 32. Handshakes, setup RPCs, writes, and explicit termination have deadlines. Errors are visible instead of retrying potentially delivered input.

Core RPCs are not a sandbox or a permission boundary. The selected executable runs with the user's privileges. Inherited HC/HERDR endpoint variables are removed from the connection process; the selected session is explicit. Core is started through its own supported connection command. Only the `hc connect` viewer process is killed on detach.

## Verified behavior

**Native macOS acceptance with hc 0.1.16:** used a separate `com.jason.agentpanel.herdr-test` app profile, dedicated `ap-ui-20261101` core session, and `/private/tmp/agentpanel-ui-project`. The normal AgentPanel profile and real repositories were not used.

| Action | Observed result |
| --- | --- |
| Select runtime in Settings, then add a temporary project | A persistent terminal opened with the dedicated session shown above it. |
| Type commands through xterm | Rendered shell output and the expected project directory. Shell PID was **68569**. |
| Quit the app | An independent core query still reported terminal `t1`, PID **68569**, as live. |
| Reopen the rebuilt app | The screen and previous output returned; a fresh command printed `REOPENED-PID:68569`. No agent launch was replayed. |
| Explicitly close the terminal tab | The tab disappeared after termination; an independent query reported `finished` with reason `killed`. |
| Cleanup | Quit the isolated app and stopped only its dedicated core session. |

The native test bundle used a temporary identifier override and disabled updater-artifact generation only in that test configuration. No release signing keys were supplied or changed. The test application profile remains separate from the normal app profile.

**Automated validation:**

- 250 frontend tests passed, including runtime persistence, no fallback after connection failure, deferred output credit, no launch replay, explicit detach/terminate, and retaining tabs when termination fails.
- 66 Rust tests passed in the regular suite, with one live integration test intentionally ignored there.
- The ignored live test passed when explicitly run against the official temporary hc binary in scratch state. It exercised the actual Rust adapter, same-process reattachment, 37×101 resize, output exceeding initial credit, reported status events, stale-core refusal, termination, and refusal to replace an ended terminal.
- TypeScript and Vite production build passed. A native macOS debug app bundle was built and used for the acceptance above.

Reproduce ordinary checks:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Run the actual adapter against an already verified, separately obtained binary:

```sh
python3 scripts/spikes/run_herdr_adapter_test.py /absolute/path/to/herdr-core
```

The runner isolates XDG state/config/runtime directories and core session, uses shell-only fixtures, and stops the scratch core after the test. It does not run paid coding agents. `DEVELOPER_DIR` above selects this Mac's working Command Line Tools installation; the Node option avoids Node 25 Web Storage conflicting with jsdom.

## Remaining acceptance and scope

Windows is explicitly disabled pending ConPTY input encoding acceptance. Linux is unverified. This release slice connects to a local core; real SSH, multiple-machine navigation, remote worktree operations, automatic reconnect, mobile access, and provider-specific native conversation resume are not implemented.

Manual reconnect is required after transport loss or a runtime restart. Missing event continuity also requests a reconnect and fresh snapshot. Full-screen coding-agent behavior, real approval dialogs, slow-viewer repaint at the upstream backlog threshold, crash/power-loss recovery, and large-session performance remain unverified. The regular test suite does not install or launch a runtime automatically.

The [feasibility spike](2026-11-01-runtime-feasibility-spike.md) remains the historical decision record. These notes describe the implemented opt-in adapter and its current acceptance boundary. No third-party runtime binary is committed or bundled, and the original Pages comparison has not been rewritten.
