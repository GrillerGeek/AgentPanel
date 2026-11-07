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

Automated feature checks: 258 frontend tests and 70 regular Rust tests passed locally; the two live tests run explicitly through the supplied runners. The SSH runner now attaches two unlabelled existing terminals through the actual Rust adapter, checks inventory, rejects termination through imported viewers, and proves the second guest usable during interruption of the first. Its [recorded result](runtime-spike/2026-11-01-machine-browser-ssh-results.json) distinguishes automated transport evidence from manual UI acceptance. The native debug bundle was rebuilt for the browser walkthrough. Review also checked keyboard focus containment/restoration, labelled fields, stale responses after modal close, lazy loading, and the separation of local worktree and imported terminal actions. Disconnected/stale rows explicitly mark their process state as last observed and current activity as unavailable.

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

## Remote project follow-up

Implemented on `feature/herdr-remote-projects`, stacked on the machine browser in PR #57 (which depends on PR #56). This extends the earlier terminal-only scope: open **Machines & terminals**, refresh a configured endpoint, choose **Add repository** on a connected remote machine, and enter an existing absolute Unix Git working-tree path. The sidebar distinguishes identical paths by machine and lists existing linked worktrees. Click a worktree to start a remote terminal; duplicate, split, and configured quick-launch commands stay pinned to that machine/core. The server selects its own shell and environment; client shell paths and environment secrets are not forwarded. Quick-launch commands must already be available on that host.

All remote terminals, including newly created project terminals, **detach on close**. Removing a project only forgets its records and detaches its viewers. It neither kills programs nor deletes files. Restore/reconnect is recover-only after the first creation attempt: a missing or ended program produces an error rather than a replacement shell or replayed launch command. Restored viewers start before remote repository discovery completes, so one unavailable host does not delay healthy restored viewers. Endpoint, aggregate core identity, remote core identity, worktree membership, and terminal address are checked. Remote paths never enter local Git, filesystem watchers, Quick Open, or editor launch routes.

Git status, tracking counts, changed-file lists, committed branch changes, and selected patches run through bounded remote Git queries. Refresh re-reads remote state; discovery failures retain stale inventory and status/diff failures show unavailable data. Review uses existing refs without fetching. External diff, textconv, fsmonitor, and optional index writes are disabled. Untracked files have unknown line counts until inspected; binary patches show a non-text notice; symlink patches show the link target. Diff requires an initial commit, while status remains available for an unborn branch. Non-UTF-8 responses and excessive output fail visibly.

Limits are four concurrent queries, a two-second query-slot wait, five seconds per remote command, 1 MiB framed responses, 512 KiB displayed patches, 2,000 changed files, and 256 worktrees. These are bounded prototype limits, not large-repository performance acceptance. Native Windows clients remain disabled. Remote worktree creation/deletion, program termination, machine provisioning/login, remote editor/files/Quick Open, and remote PR lookup are unavailable in this slice. Remote shell input remains an ordinary interactive shell, not a read-only sandbox.

**Current validation:** 267 frontend tests passed; 73 regular Rust tests passed, with three live tests intentionally ignored in that suite and run through explicit runners. TypeScript/Vite production build and the isolated native macOS debug bundle passed. The local runtime adapter runner passed after these changes. The two-SSH-guest runner now includes remote project acceptance (`--projects`): same-path machine separation, linked worktrees with spaces, per-host diffs, committed feature changes, untracked/binary/symlink behavior, invalid identity/path refusal, initial-commit handling, unchanged Git index hashes, disabled helper execution, server-side shell/environment selection, recover-only behavior, and detach-only remote terminals. Linux CI runs this extended fixture. Its [recorded result](runtime-spike/2026-11-01-remote-projects-results.json) is written only after cleanup succeeds.

**Native walkthrough:** added `/home/agentpanel/project` on two disposable Linux guests. Root terminals printed PIDs **225** (`linux`) and **131** (`other`); the linked worktree `/home/agentpanel/linked checkout` printed PID **285**. Git review distinguished `linux-change` from `other-change` at the same path and displayed the linked branch's committed change. Binary and symlink patches rendered appropriately without reading the symlink's target contents. During an SSH outage on the first host, restart restored all three viewers promptly, kept the first host disconnected with unavailable Git data, and left the second interactive at PID 131. After transport recovery, manual reconnect retained PID 225. Removed the first project while offline and then the second project; all three programs remained live at their original PIDs, independently verified through core after transport recovery. Neither guest executed the fixture's forbidden Git helper. The isolated app, core, both guests, and scratch SSH credentials were cleaned up. No real repository, existing SSH configuration, paid agent call, or normal application profile was used. Two loopback SSH guests do not establish physical-machine/WAN/sleep/MFA acceptance.

Assumptions for review: prioritize existing remote repositories and read-only review before checkout mutation; keep every remote close detach-only until explicit remote termination/deletion safety is designed; use existing core/OpenSSH configuration rather than adding credential management. The next implementation slice should address safe remote worktree creation/removal with dirty/untracked/ignored-file checks and explicit treatment of attached/running programs.

## 2026-11-02: remote worktree management

Implemented on `feature/herdr-remote-worktrees`, stacked on remote-project PR #58. Existing remote Git repositories now expose the **new worktree** form and linked-worktree removal controls. Creation lists the remote repository's local branches, starts a new branch from the selected branch's resolved commit (or HEAD), reserves a new sibling `<repository>-worktrees/<flattened-branch>` directory, and opens a terminal pinned to the remote machine. Existing branches, existing destination directories (including empty directories and flattened-name collisions), invalid branch names, and missing bases are refused. The chosen remote base is not saved as a default in this slice. No fetch, branch reset, branch deletion, or existing-branch checkout is performed.

Removal checks exact membership in the selected repository, rejects the primary, detached, locked, or missing/prunable checkout, and checks modified, staged, untracked, and ignored files. It requires **every program in the selected machine's Herdr session to have exited**, including detached programs and programs originally started in other checkouts. Core reports original directories, so checking only a program's original path cannot establish that it is no longer using a checkout. Finished programs are allowed; unavailable or unrecognized program state is not permission to remove. Programs on another machine do not block removal. The confirmation names the machine and absolute path, explains that the branch remains, and asks the user to stop other tools using the checkout. Cancelling preserves the directory, tabs, and notes.

After confirmation, the backend repeats membership/file/program checks, then uses ordinary `git worktree remove -- <path>`. It never adds force, prunes registration after failure, recursively removes files, or terminates programs. The UI detaches ended viewers and clears checkout notes only after successful removal. Remote mutations and new remote program creation share an in-process lock, preventing this AgentPanel process from starting a program between the final check and removal. **This is not an exclusive filesystem/process lease:** other AgentPanel instances, core clients, sessions, editors, and unmanaged processes can still act concurrently. Stop those tools before removing a checkout; checks cannot prove that every process on a remote host is idle.

Mutations retain the existing endpoint/core/machine checks, query/output bounds, and five-second command timeout. Git hooks and submodule recursion are disabled for checkout mutations; repository-configured checkout filters may still execute, so this feature is for trusted repositories. A failed/timed-out mutation may leave a new directory, branch, checkout, or incomplete operation. Errors request a refresh and inspection before retrying; there is no automatic retry, rollback, reset, or cleanup that could discard data. Unix Git/`mkdir` commands run on the selected machine, never on a locally interpreted remote path. Native Windows Herdr mode remains disabled. Git's [worktree documentation](https://git-scm.com/docs/git-worktree) describes the underlying add/remove/lock semantics.

Validation: **271 frontend tests, 74 regular Rust tests**, and four explicitly run live tests through the local adapter and two-guest SSH runners. The extended `--worktrees` runner also executes the existing remote attachment, persistence/outage, and Git-review acceptance before checkout mutation. New live checks cover branch/base selection, destination collisions, invalid inputs, wrong machine identity, primary/detached/missing/locked refusal, each dirty-file category, a write made after successful preflight, detached-program refusal, shell exit, clean removal, branch retention, and disabled hooks/fsmonitor. The frontend checks remote command routing, machine-pinned terminal creation, cancellation, preservation on execution recheck failure, and detaching only after successful removal. Production frontend and the isolated native macOS debug bundle passed. The [recorded SSH result](runtime-spike/2026-11-02-remote-worktrees-results.json) is published only after fixture cleanup.

Native acceptance used only the isolated test profile and disposable Linux guests. Created `ui/remote-worktree` from `main`, which opened `/home/agentpanel/project-worktrees/ui-remote-worktree` with shell PID **327**. Removal while live was refused. Wrote `keep.txt`, exited the shell normally, and observed removal refused for untracked data; an independent command verified its exact contents. Moved that file aside in the guest, cancelled the clean-removal confirmation once, then confirmed removal. The checkout and ended tab disappeared; independent queries verified the directory absent, branch `ui/remote-worktree` retained, preserved file still present outside the checkout, and the other guest's original program still live at PID **70**. No forbidden hook/fsmonitor helper ran. Removed only the app's disposable project record, quit the test app, then stopped the isolated core/guests and removed scratch SSH credentials. No normal app profile, real repository, existing SSH configuration, or paid agent call was used.

Assumptions to review: new branches only; conservative whole-session quiescence for removal; no automatic remote process termination; five-second mutation bounds may be too short for large repositories or filters. Physical hosts/WAN/sleep/MFA, concurrent independent-client deletion races, large-repository recovery/performance, native Windows, and authenticated Claude remain open acceptance areas.
