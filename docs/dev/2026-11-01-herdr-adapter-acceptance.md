# Herdr core adapter implementation and acceptance

AgentPanel now has an opt-in local Herdr core runtime. The built-in PTY remains the default. Each new persistent pane records its executable, dedicated core session, random pane identity, core identity, and terminal address. Existing local panes stay local when Settings changes.

## Using the prototype

Install herdr-core separately. In Settings, select **Herdr core (experimental)** under **Runtime for new terminals**, enter the executable name or full path without arguments, and keep a dedicated session such as `agentpanel`. Save and create a new terminal.

Closing AgentPanel detaches the viewer and leaves its shell or agent running. Reopening restores the saved binding and attaches to the same terminal. The core provides its current screen and history; AgentPanel does not append its old local scrollback snapshot. The local scrollback preference does not govern history stored by core.

Closing a connected pane or tab explicitly terminates its program before forgetting the pane. A termination failure keeps the tab visible. A pane that never connected can be forgotten only after a warning that its runtime program might still exist. Worktree removal requires confirmed termination, including refusal when a persistent pane is still connecting.

Lost connections display a Reconnect action and disable terminal input. Reconnect revalidates the core, pane label, address, original working directory, and live state. A stale identity, ended program, missing executable, or incompatible protocol produces an error; none triggers fallback to a new local shell. Agent launch commands are sent only for newly created terminals, never replayed on reconnect.

Herdr status comes from program reports. An ordinary shell or an agent without OSC 7501 remains **status not reported**. Transport disconnection is distinct from process exit; silence does not imply success.

## Machine and session browser

The **Machines & terminals** sidebar button opens an explicit inventory browser. Choose a separately installed Herdr executable and a local core session, then **Refresh terminals**. It shows the local core plus its configured remote machines, their remote sessions, connection/login state, terminal addresses, original paths, and reported activity. Failed refreshes keep the previous inventory visible as stale and disable attachment. The last successfully browsed endpoint is remembered independently of the default runtime for new worktree terminals.

SSH profiles and authentication stay with Herdr/OpenSSH. For example, configuring a machine for the local `agentpanel` session uses `HC_SESSION=agentpanel hc machine add user@host --name devbox`; the remote session can be selected with core's `--session` option. Follow [core's machine documentation](https://github.com/herdrdev/herdr-core/blob/de82c962fa6d2a7780d4e5058fda288c14bd0d8f/docs/machines.md) for installation and interactive authentication. AgentPanel's browser does not add profiles, install runtimes, store SSH credentials, or bypass host verification.

**Attach** opens the existing program interactively. Imported tabs show machine, remote session, and path. Their sidebar, tab, and command-palette close actions **detach**, leaving the program running. This differs from AgentPanel-created worktree terminals, whose explicit close still terminates their program. App quit detaches either kind.

An imported binding pins the selected endpoint, local core identity, remote core identity where applicable, and exact terminal address/path. Reconnect rejects a changed machine identity or ended program. It cannot create a replacement shell, replay an agent command, change terminal labels, or authorize worktree removal. An offline binding remains visible across restart. Attaching to identical paths/short terminal IDs on different machines produces distinct sessions.

Imported sessions are terminal-only records, separate from local repositories. New terminal, quick-launch, split, editor, file, and diff actions cannot run against their remote path. Local repository records require no migration for this slice. Native Windows clients remain disabled; remote Windows/ConPTY behavior is unverified.

**Native two-machine acceptance:** used the isolated test app and two disposable Linux SSH guests, each with terminal `t1` and path `/home/agentpanel/project`. The browser showed distinct `linux` and `other` machine groups and remote session `adapter-peer-test`. Input through the two attached tabs printed shell PIDs **70** and **75** respectively. Both tabs restored after app restart. Pausing the first guest's SSH listener and ending its SSH session left the second interactive at PID **75**. The first stayed visible as disconnected, with a Reconnect action; after SSH returned, manual reconnect printed PID **70**. Detaching both tabs left both original processes live with empty labels, independently confirmed through core. The runner then stopped the scratch core and both guests and removed ephemeral SSH credentials. This is two SSH endpoints on one physical Mac, not physical-machine/WAN acceptance.

Automated feature checks: 258 frontend tests and 70 regular Rust tests passed locally; the two live tests run explicitly through the supplied runners. The SSH runner now attaches two unlabelled existing terminals through the actual Rust adapter, checks inventory, rejects termination through imported viewers, and proves the second guest usable during interruption of the first. The native debug bundle was rebuilt for the browser walkthrough. Review also checked keyboard focus containment/restoration, labelled fields, stale responses after modal close, lazy loading, and the separation of local worktree and imported terminal actions.

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

- 251 frontend tests passed, including runtime persistence, no fallback after connection failure, deferred output credit, no launch replay, explicit detach/terminate, and retaining tabs when termination fails.
- 68 Rust tests passed in the regular suite, with two live integration tests intentionally ignored there. Follow-up regressions cover unknown-handle stop refusal and initial status from the subscription snapshot.
- The ignored live test passed when explicitly run against the official temporary hc binary in scratch state. It exercised the actual Rust adapter, same-process reattachment, 37×101 resize, output exceeding initial credit, reported status events, stale-core refusal, termination, and refusal to replace an ended terminal.
- TypeScript and Vite production build passed. A native macOS debug app bundle was built and used for the acceptance above.
- [Platform CI at `37aa9aa`](https://github.com/GrillerGeek/AgentPanel/actions/runs/41309836440) passed frontend build/tests and Rust check/tests on Linux, macOS, and Windows. Linux also passed the actual live adapter test against checksum-verified hc 0.1.16. Windows Herdr mode remains deliberately disabled; compiling the adapter does not verify ConPTY behavior.

**Real-agent macOS acceptance after hardening:** Codex CLI 0.164.0 ran inside the rebuilt test app in the same disposable project. It used `--no-daemon --sandbox read-only --ask-for-approval on-request --no-alt-screen`. One prompt requested exactly `AGENTPANEL-SMOKE-OK`, without tools or file access; the expected response rendered. AgentPanel showed running, then idle, from core's reported status. The permission selector rendered with Read Only current; it was cancelled without changes.

Quitting and reopening the app restored the Codex screen and response. Independent `terminal.get` queries confirmed shell PID **10276**, foreground Codex PID **10769**, terminal **t2**, and live state across the restart. This is attachment to the same running agent, not provider-native conversation recovery. Codex was then exited; explicit tab close was independently confirmed as `finished` / `killed`, and the dedicated core was stopped.

A second bounded check used Codex's default screen mode (omitting `--no-alt-screen`). It requested approval for `touch /private/tmp/agentpanel-ui-project/approval-smoke.txt` outside its read-only sandbox. The actual approval dialog rendered, AgentPanel showed **waiting for input**, and core independently reported `blocked`, kind `permission`. Quit/reopen restored that pending dialog with shell PID **19670** and foreground Codex PID **19969** unchanged. Escape declined the operation; the UI returned to idle, and an independent filesystem check confirmed that the target did not exist. Explicit tab close then reported terminal **t3** as `finished` / `killed`; an independent PID check confirmed that Codex had exited. The dedicated core and app were stopped. This covers one default-screen approval cancellation and repaint path, not every agent interaction or approval type.

Claude Code 2.1.316 rendered its project trust prompt with safe mode, tools disabled, and an empty strict MCP configuration. The default **No, exit** was selected. Its CLI auth status reported no login; authenticated Claude responses and approval flows remain unverified. No credentials, models, subscriptions, or agent installation were changed. Codex's update prompt was skipped.

**Real SSH transport acceptance:** [the disposable SSH runner](../../scripts/spikes/run_herdr_ssh_test.py) passed from macOS to a Linux Docker guest using OpenSSH over loopback TCP, a fresh key pair, and strict host-key checking against a public key read through Docker. The actual Rust adapter attached to `linux/t1`, sent shell input, and resized it to 33×99. Killing the guest's user SSH session forced a transport interruption. Core reconnected; a fresh remote command returned Linux; the Rust adapter reattached successfully; the original remote shell PID **57** was still live. The terminal, dedicated local core, container, and scratch credentials were cleaned up before success was reported.

This verifies machine-qualified binding attachment through core's SSH aggregation. The runner sets up that binding outside AgentPanel. It does not provide machine selection or remote project management in the app, and loopback-to-guest testing does not establish two-physical-computer, WAN, sleep/wake, MFA, or password-prompt acceptance. [CI at `a3e8d65`](https://github.com/GrillerGeek/AgentPanel/actions/runs/41310825672) passed all three platform jobs, including this real SSH fixture in the Linux job.

Reproduce ordinary checks:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test --manifest-path src-tauri/Cargo.toml --offline
```

Run the actual adapter against an already verified, separately obtained binary:

```sh
python3 scripts/spikes/run_herdr_adapter_test.py /absolute/path/to/herdr-core
# Requires Docker and OpenSSH; builds only a disposable guest fixture:
python3 scripts/spikes/run_herdr_ssh_test.py /absolute/path/to/herdr-core
```

The runner isolates XDG state/config/runtime directories and core session, uses shell-only fixtures, and stops the scratch core after the test. It does not run paid coding agents. `DEVELOPER_DIR` above selects this Mac's working Command Line Tools installation; the Node option avoids Node 25 Web Storage conflicting with jsdom.

## Remaining acceptance and scope

Windows is explicitly disabled pending ConPTY input encoding acceptance. Linux has automated live-adapter evidence, but no native Linux GUI acceptance. The app can browse a selected local core session and attach its existing local/remote terminals. Machine setup/login still uses Herdr/OpenSSH. Remote repository/worktree operations, new remote terminal creation, automatic UI reconnect, mobile access, and provider-specific native conversation resume are not implemented.

Manual reconnect is required after transport loss or a runtime restart. Missing event continuity also requests a reconnect and fresh snapshot. Codex interactive rendering, its permission menu, and a default-screen tool approval/cancellation/restart path have bounded native evidence. Authenticated Claude flows, other approval types, slow-viewer repaint at the upstream backlog threshold, crash/power-loss recovery, and large-session performance remain unverified. The regular test suite does not install or launch a runtime automatically; explicit CI acceptance steps download checksum-pinned test binaries and run disposable fixtures.

The [feasibility spike](2026-11-01-runtime-feasibility-spike.md) remains the historical decision record. These notes describe the implemented opt-in adapter and its current acceptance boundary. No third-party runtime binary is committed or bundled, and the original Pages comparison has not been rewritten.
