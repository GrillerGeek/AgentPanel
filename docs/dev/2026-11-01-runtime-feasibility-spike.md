# AgentPanel runtime feasibility spike and worktree safety fix

## Recommendation

Build an **optional herdr-core adapter** for the next persistent-session prototype. Keep AgentPanel's existing local PTY mode as the default until the adapter passes graphical terminal, real SSH, and platform acceptance. Do not implement a second production daemon yet.

The October 25 [comparison](2026-10-25-herdr-feature-gap-report.md) evaluated the original Herdr terminal application. The current Herdr product now includes a separate graphical app and **herdr-core**, a headless runtime with a public raw terminal protocol. Herdr TUI remains a separate system; its sessions and integration-backed conversation recovery must not be attributed to the new core/app. See [Herdr's product distinction](https://herdr.dev/) and [core overview](https://herdr.dev/core/).

An isolated probe of the official macOS Apple Silicon **hc 0.1.16** binary passed ten checks. This establishes a viable client/runtime boundary. It does not establish that AgentPanel already integrates with hc or that remote control is ready to ship.

## Completed worktree fix

The backend now verifies that the target belongs to the selected repository and is a linked checkout. It rejects the primary checkout, modified or staged files, untracked files, and ignored files. Ignored files are included deliberately: Git's ordinary removal can delete ignored local data such as `.env` files even without `--force`.

Removal uses Git without force and never falls back to recursive filesystem deletion or pruning. Users must preserve their files through commit, stash, or moving them; this change does not add a force-delete UI.

The store performs a read-only preflight before showing a mandatory confirmation that explicitly says terminals will stop. Cancelling or failing preflight leaves terminal sessions intact. Only after confirmation does it stop terminals. If a known PTY fails to close, deletion aborts and the terminal records remain available. The backend repeats the file/membership check immediately before invoking Git, protecting changes made after the first preflight. Git operations run off the Tauri UI thread.

If Git refuses removal after terminals have stopped, the worktree, notes, and review comments remain. Those stopped processes cannot be restored automatically. An unrelated external writer can still race any filesystem check; the application does not provide an atomic filesystem snapshot or an OS sandbox. Git's own safe-removal checks remain the final guard for tracked and untracked changes.

Validation on this Mac:

- **239 frontend tests passed**, including six new removal tests and updated notes/comments tests that exercise the confirmation.
- **63 Rust tests passed**, including real disposable Git repositories covering modified, staged, untracked, ignored, locked, unrelated, and primary paths; clean removal keeps the branch.
- **TypeScript and the Vite production build passed.**
- Native desktop interaction and Windows/Linux execution were not exercised.

Reproduce the checks with:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test --manifest-path src-tauri/Cargo.toml --offline
```

The Node option avoids this machine's Node 25 Web Storage global conflicting with jsdom. The developer directory selects the separately installed Command Line Tools; the full Xcode installation currently requires license acceptance. No license was accepted or machine-wide settings changed.

## Runtime evidence

The reproducible [probe](../../scripts/spikes/herdr_core_probe.py) implements generation 1 framing independently from the upstream client. It calls `hc connect`, negotiates framed JSON-RPC, and consumes raw byte streams. It does not use Herdr's graphical app, a text-snapshot approximation, or paid agent sessions.

Machine-readable evidence: [final ten-check results](runtime-spike/2026-11-01-herdr-core-results.json).

| Check | Observed result |
| --- | --- |
| Handshake | Protocol generation 1; runtime advertises attach, event, status, and shell features. |
| Raw input and output | Input through a terminal stream produced actual ANSI color and UTF-8 output, matching an escape sequence rather than command echo. |
| Resize | A resize frame changed `stty size` to 37 rows and 101 columns. |
| Two clients | A second client observed the same terminal and program PID. |
| Zero clients and reattach | All viewer connections closed; delayed shell output appeared in the first repaint after reattachment, with the original PID still live. |
| Flow control | Consumed more than 300 KiB of output, exceeding the initial 256 KiB credit, by returning stream credit. |
| Program status | A controlled script emitted OSC 7501 and core reported `blocked` with app `spike`. No screen heuristics or agent brand detection were used. |
| Planned core restart | The core PID changed from 26118 to 26289 while shell PID 26128 survived; input/output worked after reattachment. |
| Machine routing and disconnection | A second isolated core was reached through a local stdio bridge. `peer/t1` was addressable; forgetting the machine left its process running, and the original local shell remained live. |
| Explicit termination | Killing the shell returned a finished record with reason `killed`. |

The machine-routing check is a **local transport simulation**, not a connection to another computer. SSH host keys, authentication, latency, network loss, suspend/resume, and firewalls remain untested. The raw stream was not rendered through AgentPanel's xterm instance. Slow-reader repaint behavior beyond the runtime's backlog limit, observer input rejection, full-screen TUIs, clipboard/image transfer, agent prompt correlation, event subscription reconciliation, runtime crashes, and high-cardinality performance remain acceptance work.

The probe uses private scratch state/config/runtime directories, separate `probe` and `peer` sessions, explicit working directories, and only `/bin/sh` commands. It stops both scratch sessions before saving successful evidence. Early probe failures exposed errors in the probe's response parsing, restart timing, cleanup command, and temporary executable discovery; those were corrected before the final full run. Orphaned processes from the early cleanup error were explicitly stopped. No user hc session, provider account, or project checkout was used.

## Pinned sources and binary

| Input | Version or revision |
| --- | --- |
| AgentPanel starting revision | `16affd84d996129e15526ed42ff18931f7d0f910`, plus the uncommitted worktree fix in this branch. |
| herdr-core source inspected | [`de82c962fa6d2a7780d4e5058fda288c14bd0d8f`](https://github.com/herdrdev/herdr-core/tree/de82c962fa6d2a7780d4e5058fda288c14bd0d8f) |
| Herdr app source inspected | [`ccbc8c5fbff9a36fed4c0a9cd569ef41c035ed5e`](https://github.com/herdrdev/herdr-app/tree/ccbc8c5fbff9a36fed4c0a9cd569ef41c035ed5e) |
| Original Herdr TUI inspected | [`ee5bfb5041bb3e4a49d591c72308aae3c81ecdde`](https://github.com/herdrdev/herdr/tree/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde) |
| Executable tested | Official `hc 0.1.16`, `herdr-core-macos-aarch64.tar.gz`, downloaded to a temporary directory without installing. |
| Archive SHA-256 | `698d8f0c44f4e4b15fec174d52a39d57a014cfd71added44b53a0753b469d0fd` |

The archive matched the checksum in the official [release manifest](https://releases.herdr.dev/core/0.1.16/manifest.json). That verifies consistency with the release service, not an independently signed provenance chain. Source inspection and the tested release are recorded separately; the binary was not rebuilt from the inspected source.

Protocol reference: [core API and stream framing](https://github.com/herdrdev/herdr-core/blob/de82c962fa6d2a7780d4e5058fda288c14bd0d8f/schema/README.md). Platform and trust reference: [core security and endpoint behavior](https://github.com/herdrdev/herdr-core/blob/de82c962fa6d2a7780d4e5058fda288c14bd0d8f/docs/security.md). Core uses Unix sockets or Windows named pipes and can carry the protocol over stdio; it has no per-client authorization layer and is not a sandbox.

To rerun, obtain the official binary for the machine, verify its archive against that release's manifest, extract it into a temporary directory, then run:

```sh
python3 scripts/spikes/herdr_core_probe.py /absolute/path/to/herdr-core \
  --output /private/tmp/agentpanel-runtime-results.json
```

This probe currently targets Unix shell behavior; it is not a Windows test. It requires permission to create PTYs, local IPC sockets, and child processes. Sandbox IPC failure is not runtime failure.

## Build versus integrate

| Dimension | Extract an AgentPanel runtime | Adapt herdr-core |
| --- | --- | --- |
| Process ownership | Existing `portable-pty` code is reusable, but currently embedded in Tauri. A new service and client lifecycle are required. | Detached ownership and reconnect passed the probe. Holder processes also preserved the shell across planned core restart. |
| Terminal restoration | Current xterm serialization runs in the WebView; a headless parser/screen snapshot and ordered replay would be new work. | First repaint plus raw streams are public and passed a basic reconnect test. |
| Remote routing | Transport, host identity, reconnect, and remote file operations must be designed and maintained. | Machine-qualified routing worked over a second local core; real SSH remains unverified. |
| Agent state | Maximum control over adapters, with the current heuristic model available as fallback. | Only program-reported OSC 7501 status. Non-reporting agents need an explicit AgentPanel fallback or adapter; absence of a report must remain unknown. |
| Conversation resume | New provider-specific session capture/resume work. | New core/app does not inherit the old TUI's native agent resume feature. This remains AgentPanel work. |
| Dependency and licensing | No external runtime dependency, but responsibility for parser, service, transport, recovery, and OS support. | Preview 0.x protocol, external release cadence, packaging and provenance obligations. Core and bundled third-party notices must remain intact if distributed. |
| Evidence level | Source-level extraction feasibility only. No competing native daemon was built during this spike. | Ten bounded runtime checks on macOS Apple Silicon. No cross-platform production acceptance. |

The new core changes the cost/benefit enough to defer a native-daemon implementation. The original TUI's UI-shaped protocol and Unix-only direct attach make it the weaker integration target. Core's dedicated raw stream removes that particular blocker. This is a recommendation for the next prototype, not a decision to make AgentPanel depend permanently on an unvalidated external runtime.

## Next implementation slice

1. Introduce a narrow runtime interface for create, attach, input, resize, detach, terminate, inventory, and events. Keep the current local implementation working.
2. Add an opt-in `HerdrCoreRuntime` implemented in Rust behind the Tauri boundary, using `hc connect` and capability negotiation. Do not send raw IPC credentials or terminal-control sockets to the browser.
3. Map AgentPanel panes to core identity plus terminal address. Persist project/worktree association separately; local paths are not global machine identities. Distinguish a retained terminal record from the current program instance.
4. Feed received bytes into xterm, return CREDIT only after its write callback, bound queues, and handle first repaint/reconnect without appending duplicate stale scrollback. Treat CLOSE as detach unless the user explicitly requests termination.
5. Subscribe to runtime events and reconcile snapshots on reconnect/missed events. Display unavailable/unknown states truthfully. Never resubmit uncertain mutations automatically.
6. Deliver one vertical slice: launch a shell from a worktree, close AgentPanel, reopen, and reattach to the same process with correct path and resize behavior.

Before enabling it by default, require actual Windows ConPTY and Linux runs, real SSH across two hosts, a native AgentPanel UI smoke, permission-prompt and full-screen agent testing, bounded memory/slow-viewer testing, and safe runtime installation/version handling. Preserve AgentPanel's diff review, notes, and Git operations; choosing a runtime does not replace its project workflow.

No production runtime adapter, default-setting change, bundled third-party executable, remote machine installation, or Pages report rewrite is part of this spike.
