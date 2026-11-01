# AgentPanel and Herdr feature comparison and implementation recommendations

Reviewed October 25, 2026. AgentPanel baseline: version 0.7.1, commit `16affd84d996129e15526ed42ff18931f7d0f910`. Herdr baseline: current public documentation and website, whose footer identifies v0.9.5.

AgentPanel should evolve into a development command center that lets a developer assign, monitor, review, and deliver work across agents, projects, and computers. Its largest gaps are **persistent execution independent of the desktop window, unified remote machine control, and a programmable agent control surface**. Closing those gaps would make the current worktree and review experience much more valuable.

Preserve AgentPanel's graphical diff review, worktree context, notes, and GitHub overview. Add a durable execution layer beneath them, then connect execution to explicit tasks and reviewable results. Matching Herdr's terminal features alone would not fulfill the broader product goal.

## Scope and evidence

This is a source and documentation review, not a hands-on reliability benchmark. AgentPanel findings come from the current implementation; Herdr findings describe documented capabilities rather than independently tested behavior. No applications were installed, remote machines connected, or performance comparisons run. An undocumented Herdr feature is marked **not established**, not assumed absent. Recommendations beyond the comparison are identified separately.

The existing [usability report](ux-research/findings-report.md) is explicitly a simulated persona study and predates several implemented features. It is useful context, but its missing-feature list is not a current inventory or evidence of real user demand.

## The multi computer capability

Your interpretation is correct, with an important execution boundary. Herdr supports a combined local and SSH machine view. Each host owns its own server, terminals, and agent processes; the client can switch among them and continue observing other machines' agent states. Connections recover independently. A machine profile targets a particular remote session, rather than combining every session on that host. See [Connecting machines](https://herdr.dev/docs/connecting-machines/).

For AgentPanel, the equivalent experience would be:

1. Run a local runtime on a desktop and another on a development server.
2. Connect a laptop's AgentPanel to both through SSH.
3. Start an agent on the desktop for Project A and a server-side agent for Project B.
4. Close the laptop client while both agents continue on their respective hosts.
5. Open AgentPanel on another authorized computer, connect to those hosts, and resume control.

This would require connection setup on each client. It would not automatically move an agent process, synchronize checkouts, copy provider credentials, or keep work running on a sleeping host. A remote host that remains awake can continue working while the laptop sleeps.

Herdr also distinguishes client detachment from server restart: detachment preserves processes; restart reconstructs saved layout and can resume supported native agent conversations. Its live server handoff is experimental. These are distinct promises AgentPanel should expose separately. See [Session state and restore](https://herdr.dev/docs/session-state/).

## Feature comparison

**Present** means implemented in AgentPanel's source, not independently accepted in a running build. **Partial** means the basic capability exists but has material limits. Priorities apply to AgentPanel: P0 is foundational or an immediate correctness concern; P1 completes the main experience; P2 expands it after the foundations.

### Execution and remote access

| Capability | Herdr evidence | AgentPanel today | Gap and priority |
| --- | --- | --- | --- |
| Terminal work independent of the client | Background server owns processes. [Concepts](https://herdr.dev/docs/concepts/) | PTY manager lives in the Tauri app; React terminal teardown calls `pty_close`. | Missing detached execution service. **P0** |
| Reattach from another computer | Clients attach to the host where work runs. [Remote access](https://herdr.dev/docs/persistence-remote/) | Desktop-local commands and PTY channels. | Missing remote protocol and client attachment. **P0** |
| Unified machines and agent inventory | Local and saved SSH hosts in one client. [Machines](https://herdr.dev/docs/connecting-machines/) | Repositories and worktrees have local paths, without host identity. | Missing host model, transport, and machine navigation. **P0** |
| Multiple clients at once | Independent viewed tabs; shared tab sizing has an explicit ownership rule. [Concepts](https://herdr.dev/docs/concepts/) | No multi-client runtime model. | Define input ownership, sizing, focus, and seen state. **P1** |
| Terminal text after restart | Optional screen history replay. [Restore](https://herdr.dev/docs/session-state/) | Present: locally persisted scrollback, capped at 256 KB per pane. | Preserve existing feature when moving storage to the runtime. **P1** |
| Native agent conversation recovery | Integration-backed session references. [Integrations](https://herdr.dev/docs/integrations/) | Restores fresh shell panes; saved schema has no native conversation reference. | Missing agent-aware resume. **P1** |
| Remote clipboard and phone access | SSH access from mobile terminals; local-client image paste bridge. [Remote access](https://herdr.dev/docs/persistence-remote/), [Working guide](https://herdr.dev/docs/how-to-work/) | Clipboard path handles text; no remote client or mobile surface. | Add remote file/image transfer after remote terminals work; defer a phone client. **P2** |

AgentPanel evidence: [PTY manager](../../src-tauri/src/pty.rs), [Tauri setup](../../src-tauri/src/lib.rs), [terminal lifecycle](../../src/Terminal.tsx), [restore and persistence](../../src/state/store.ts), [types](../../src/types.ts), [scrollback](../../src-tauri/src/scrollback.rs).

### Agent awareness and coordination

| Capability | Herdr evidence | AgentPanel today | Gap and priority |
| --- | --- | --- | --- |
| Run different agent CLIs | Recognizes numerous agents; other CLIs remain ordinary terminals. [Agents](https://herdr.dev/docs/agents/) | Present: arbitrary CLI commands and configurable quick launch, defaulting to Claude and Codex. | CLI execution is already broad; integration depth is the gap. **P1** |
| Agent identity and lifecycle | Process recognition, screen manifests, and integration reports. [Agents](https://herdr.dev/docs/agents/) | Partial: output timing and prompt regexes classify panes as running, idle, awaiting, exited. | Introduce agent identity and adapters; keep honest heuristic fallback. **P0** |
| Completion distinct from quiet output | Explicit lifecycle semantics include unseen completion and unknown state. [Concepts](https://herdr.dev/docs/concepts/) | Quiet output becomes idle; PTY exit triggers an “Agent finished” message. | Distinguish task completion, agent readiness, shell exit, and failure. **P0** |
| Attention routing | Workspace state rolls up from agents. [Agents](https://herdr.dev/docs/agents/) | Present: aggregated indicators, awaiting/exited priority, MRU session ordering, sidebar attention filter. | Improve precision and persist an actionable inbox. **P1** |
| Notifications | Configurable delivery, delays, and state-specific sound. [Config reference](https://herdr.dev/docs/config-reference/) | Present: OS notification and clickable in-app toast for non-active awaiting/exited panes. | Add durable unread events, preferences, and client-aware deduplication. **P1** |
| Scriptable agent operations | Agent start, prompt, read, wait, and terminal operations. [Automation](https://herdr.dev/docs/agent-automation/) | Internal Tauri commands; no external automation CLI or socket service. | Missing supported API/CLI. **P0** |
| Reliable agent-to-agent delegation | Automation primitives can coordinate agents. [Automation](https://herdr.dev/docs/agent-automation/) | Review comments can be pasted into a pane; no general coordination layer. | Add explicit targets, delivery receipts, waits, cancellation, and results. **P1** |
| Integration and extension surface | Schema, event subscriptions, state reporting, and plugins. [Socket API](https://herdr.dev/docs/socket-api/), [Plugins](https://herdr.dev/docs/plugins/) | App-specific frontend/backend interfaces only. | Versioned API first, adapters and extensions second. **P1/P2** |

AgentPanel evidence: [state detection](../../src/state/activity.ts), [runtime observations](../../src/state/agentRuntime.ts), [notification transitions](../../src/App.tsx), [active sessions](../../src/components/ActiveSessions.tsx), [notification delivery](../../src/lib/notify.ts), [review prompt delivery](../../src/state/store.ts).

### Projects and daily development

| Capability | Herdr evidence | AgentPanel today | Gap and priority |
| --- | --- | --- | --- |
| Worktree creation and existing checkout discovery | Create/open/remove worktrees, group under source workspace. [CLI reference](https://herdr.dev/docs/cli-reference/) | Present: `git worktree list --porcelain` discovers existing checkouts; creation supports existing or new branches and remembered base branch. | Do not plan “adopt existing worktrees” as missing. |
| Worktree location | Configurable root and explicit CLI path. [Configuration](https://herdr.dev/docs/configuration/), [CLI reference](https://herdr.dev/docs/cli-reference/) | Creation uses a fixed sibling `<repo>-worktrees/<branch>` convention. | Add global/repo defaults and path preview/override. **P1** |
| Safe checkout deletion | Git-safe removal, explicit escalation for dirty checkout. [Configuration](https://herdr.dev/docs/configuration/) | Confirmation exists, but backend starts with `--force` and falls back to recursive directory removal. | Add dirty/untracked protection and remove destructive fallback. **P0** |
| Rich terminal layouts | Right/down splits; zoom, swaps, resizing. [Concepts](https://herdr.dev/docs/concepts/), [Keyboard](https://herdr.dev/docs/keyboard/) | Tabs support at most two side-by-side panes with adjustable width. | Add nested layouts and zoom; presets before unrestricted complexity. **P2** |
| Remappable keys and portable configuration | File-based settings and keybindings. [Configuration](https://herdr.dev/docs/configuration/) | Settings UI and localStorage; shortcut handlers are hardcoded. | Exportable schema, per-platform keys, conflict handling. **P1** |
| Project and session navigation | Terminal workspaces and mouse/keyboard navigation. [Concepts](https://herdr.dev/docs/concepts/) | Present: repo search, attention filter, command palette, global worktree switching, reorderable repos/tabs. | Expand filters and saved views as fleet size grows. **P2** |
| Graphical code review | Comparable built-in line-comment review not established by reviewed Herdr docs. | Present: changed files, patches, line comments, prompt composition. | A strong base for differentiation; add revision-aware review and verification evidence. **P1** |
| Cross-project PR and CI overview | Equivalent built-in dashboard not established by reviewed Herdr docs. | Present, scoped to PRs returned for tracked worktree branches through `gh pr view`. | Add explicit failure states and broader repo PR discovery. **P1** |
| Notes, file opening, editor integration | Exact equivalents not established by reviewed Herdr docs. | Present: per-worktree notes, quick file open, configurable external editor. | Retain and connect them to tasks and handoffs. **P2** |
| Extensions and distribution | Executable plugins and community index. [Plugins](https://herdr.dev/docs/plugins/), [Marketplace](https://herdr.dev/docs/marketplace/) | No workflow extension mechanism; desktop installers and updater exist. | Start with local adapters and trusted project recipes; marketplace later. **P2** |
| Cross-platform operation | Documented Windows, macOS, Linux support. [Herdr](https://herdr.dev/) | Windows, macOS, Linux desktop packaging already exists. | Extend this parity to the runtime; do not count platform support as missing. **P0 constraint** |

AgentPanel evidence: [worktree commands](../../src-tauri/src/commands.rs), [Git operations](../../src-tauri/src/git.rs), [sidebar](../../src/components/Sidebar.tsx), [palette](../../src/components/CommandPalette.tsx), [PR dashboard](../../src/components/PrDashboard.tsx), [GitHub lookup](../../src-tauri/src/gh.rs), [diff panel](../../src/components/DiffPanel.tsx), [notes](../../src/components/NotesPanel.tsx), [configuration](../../src-tauri/tauri.conf.json).

## Recommended implementation program

Effort bands indicate relative complexity, not delivery estimates: S is a focused change, M crosses several modules, L introduces a subsystem, and XL changes architecture across platforms. Dependencies and acceptance gates should determine sequencing.

### G1 Persistent execution service

**Priority P0. Effort XL. Enables G2, G3, G4, and G5.**

Extract process ownership, PTY output capture, session state, and lifecycle events into a headless runtime. AgentPanel becomes a client of that runtime locally and remotely. Keep Git and file operations on the host that owns the checkout. The runtime must work without the desktop WebView.

Separate “disconnect this window,” “stop this agent,” and “stop this runtime.” Define behavior for app updates, runtime crashes, host reboot, and sleep. UI disconnection must not implicitly call the equivalent of `pty_close`.

The server needs a bounded terminal buffer or terminal state model for headless operation and later attachment. The current WebView owns xterm rendering and scrollback serialization, so extracting Rust process ownership alone will not supply a complete reattach experience. Define snapshot plus ordered output replay, resize ownership, and output backpressure.

**Acceptance:** close every client while agents and a test process run; reconnect and observe the same process identities and current output. Restart the host and show clearly which sessions resumed as new processes. Exercise Windows ConPTY, macOS, and Linux separately, including high-output processes and client crashes.

### G2 Unified SSH machines

**Priority P0. Effort L after G1.**

Introduce persistent `Machine`, `Project`, `Worktree`, `Pane`, and `AgentSession` identities. Qualify resource identifiers by host/runtime; today's path-based worktree ID will collide if two hosts use the same path. Show host context wherever input, Git operations, or cleanup could affect a different computer.

Start with the user's existing OpenSSH configuration and host-key verification. Connect through SSH stdio or a protected local endpoint forwarded through SSH. Use a local socket on Unix and an appropriately restricted named pipe on Windows. Keep provider credentials on the execution host. Do not expose an unauthenticated terminal-control HTTP port.

Show local and remote agents together, but preserve independent connection health. Offline state must be visibly stale; disable input until the runtime confirms the target and its fresh state. Add reconnect backoff, capability negotiation, and explicit remote install/update actions. Remote checkout paths are not local editor paths: provide remote file opening and editor targets deliberately.

**Acceptance:** control two hosts with the same checkout path, disconnect one, continue typing on the other, reconnect without duplicate prompts or focus theft, and attach a second client. Confirm host-key changes block connection and version mismatch cannot silently kill active agents.

### G3 Agent adapters and correct lifecycle semantics

**Priority P0. Effort M initially, L across many providers. Can begin before G1 extraction finishes.**

Create a distinct agent record with provider/kind, executable identity, native session reference, pane, current task, state source, timestamp, and confidence. Start with Claude Code and Codex, then extend based on actual use.

Prefer provider-supported hooks/events when available; use process inspection and terminal recognition as fallback. Preserve arbitrary CLI support. Show `unknown` when the runtime cannot classify an agent. Silence is insufficient evidence of successful completion, and an agent returning to its prompt does not terminate its parent shell.

The current detector reads the last 2 KB of output and a 14-line text window. A quiet agent becomes idle after 1.5 seconds, and old prompt text can remain in that tail. `pty-exit` is the shell child's exit, while the notification labels it “Agent finished.” These are specific reasons to upgrade the model before automating work based on it.

**Acceptance:** distinguish a thinking agent, a permission prompt, an agent ready for the next task, an exited agent inside a still-running shell, a failed shell, and an ordinary noisy build. Use captured, sanitized real CLI sessions alongside controlled fixtures. Track false completion and missed-input rates; never equate idle or exit with tests passing.

### G4 Public API and CLI

**Priority P0 foundation, P1 full coverage. Effort L. Depends on G1 and the identity model.**

Expose versioned operations for inventory, worktree creation, agent launch, output read, prompt submission, events, waiting, cancellation, and result retrieval. Use the same contracts for the desktop UI and a proposed `agentpanel` CLI. Publish machine-readable schemas and an agent usage guide.

Give mutating requests IDs and delivery receipts. Bind prompts to the expected live agent identity, host, worktree, and session generation. Reject a prompt if the pane has become a shell or another agent. Distinguish composing text, submitting a task, and answering an approval dialog. Persist enough request state to resolve uncertain delivery after a disconnect.

Herdr provides useful orchestration primitives, but its documented prompt waits do not correlate individual turns; a timeout can occur after input was delivered. AgentPanel should use explicit task/request correlation wherever an adapter supports it and report uncertainty otherwise. See [Agent automation](https://herdr.dev/docs/agent-automation/).

**Acceptance:** a script creates a worktree, starts a builder, waits for an identified result, starts a reviewer, and collects both results without focus changes or fixed sleeps. A transport retry must not submit the same task twice. A timed-out submission must be inspectable before retry.

An MCP adapter can follow the stable API so compatible agents can discover capabilities. It should be another client of the API rather than a separate execution engine.

### G5 Conversation recovery and durable activity

**Priority P1. Effort M to L. Depends on G1 and G3.**

Store native session IDs and explicit resume commands from adapters. Distinguish terminal output replay from conversation resume and process continuity. Move host-owned notes, task references, session metadata, and activity records out of client-local storage; keep appearance and window preferences local.

Add an activity inbox for needs-input, ready-for-review, failure, disconnection, and resumed sessions. Track unread state per user/client and provide notification routing, quiet hours, deduplication, and retention controls. Record metadata by default; make full terminal transcripts optional and bounded. Existing scrollback persistence is useful but is neither a task log nor a complete audit trail.

**Acceptance:** restart a runtime and resume the exact supported conversation; preserve an error placeholder for unavailable paths rather than silently dropping work. A second client sees the same task history without duplicating every desktop alert. Missing resume support is explicit.

### G6 Worktree safety and configuration

**Priority P0 for deletion safety, P1 for location controls. Effort S to M. Independent of remote work.**

Current worktree deletion uses forced removal immediately and can fall back to `remove_dir_all`. The existing confirmation says the directory is deleted and commits remain safe, but it does not enumerate uncommitted or untracked work. Protect those files before scaling the number of agents.

Attempt Git's safe removal first. If dirty, show the affected checkout and changes, offer preservation or cancellation, and require explicit force intent for deletion. Revalidate at execution because an agent can modify files after a preview. Do not turn arbitrary Git failures into recursive directory deletion. Apply the same contract to UI, CLI, and remote operations.

Add configurable worktree roots, per-project setup/teardown recipes, and explicit base/path preview. Existing worktree discovery already works and should remain authoritative through Git.

**Acceptance:** dirty and untracked files survive ordinary removal; running agents cannot race cleanup without an explicit stop decision; failed Git removal leaves the checkout intact. Test existing branches, nested names, missing folders, and host/path mismatches.

### G7 Tasks and reviewable delivery

**Priority P1 strategic differentiation. Effort L, delivered incrementally after G3/G4.**

This recommendation extends the product goal beyond terminal parity. Add a durable task object linking a request, project, worktree, assigned agent, status, dependencies, changed revision, tests, artifacts, and PR. Begin with assign, run, review, and complete; add general dependency graphs only when simpler workflows prove useful.

A useful default workflow is builder → tests → independent review → human approval → PR. Record evidence against the exact commit or working-tree snapshot it describes. New code changes should make old review/test evidence visibly stale. “Agent ready,” “tests passed,” and “human accepted” are separate states.

Extend today's review prompt flow into a targeted handoff with acknowledgement and a linked result. Add optional issue-to-task creation and PR creation/CI troubleshooting. Keep merge, release, and deployment as explicit actions with project policy. Improve `gh` diagnostics first: today missing `gh`, authentication failure, no PR, and parse failure all collapse to `None`.

**Acceptance:** complete a two-agent task with one failing check and a requested revision. The UI must show which work is blocked, which revision was tested, and why the task is ready for human review. No stale green check should certify later edits.

### G8 Reusable environments and extensions

**Priority P2, with individual setup recipes pulled forward when needed. Effort M to L.**

Add trusted project recipes for dependencies, environment variables, startup commands, agent roles, and service ports. Worktrees isolate files and branches, not network ports, databases, credentials, or the operating system. Detect port collisions and make project services discoverable; add SSH port forwarding as a separately scoped remote capability. Consider opt-in containers/devcontainers for environment isolation.

Then expose a small extension manifest for adapters, commands, event consumers, and project templates. Establish versioning, trust prompts, logs, and resource limits before building a public marketplace. Herdr's executable plugin model runs ordinary user code and is not a plugin sandbox; AgentPanel should make its own extension trust boundary equally clear. See [Plugins](https://herdr.dev/docs/plugins/).

For multi-project initiatives, connect tasks across repositories without pretending separate Git repositories can merge atomically. Surface cross-repo dependencies and release order.

### G9 Configurable navigation and richer layouts

**Priority P1 for keys, P2 for layout expansion. Effort M.**

Add a portable settings schema, key remapping, action search, shortcut conflict warnings, and an option to pass selected chords through to terminal applications. Retain the existing command palette, file search, terminal search, and global session switching.

Add named layout presets such as builder/reviewer/tests/logs, followed by nested horizontal/vertical panes and zoom. Limit active rendering to viewed terminals while the runtime continues processing all output. Build saved fleet views for host, project, waiting state, failed CI, and review readiness.

**Acceptance:** a user can operate four agent roles with remapped keys, restore the layout, and reach a waiting agent across projects without scanning every tab.

## Architecture and ownership

The recommended ownership model is:

```text
AgentPanel desktop clients       agentpanel CLI       optional MCP client
             \                         |                      /
              Versioned command and event protocol
                    |                           |
             Local transport              SSH transport
                    |                           |
             Local runtime                 Remote runtime
                    |                           |
          PTYs and agent adapters     PTYs and agent adapters
          Git and file operations     Git and file operations
          Tasks and session data      Tasks and session data
```

The client owns its presentation, focus, and preferences. Each runtime owns its processes and checkout state. Begin with per-host task authority and client aggregation; defer a global cloud database until cross-host scheduling requires one. Store durable results in project/Git artifacts where appropriate, with runtime records pointing to them.

The first shared-control release should support multiple viewers with explicit input ownership per pane. Define a resize owner separately from keyboard focus. Runtime events need sequence numbers and reconnect reconciliation so disconnected clients can recover state without replaying input. Bound output buffers, subscriber queues, histories, and concurrent Git/CLI operations.

## Build versus integrate

Before committing to a custom daemon, run a bounded feasibility spike comparing two implementations:

| Option | Benefit | Cost or uncertainty |
| --- | --- | --- |
| Native AgentPanel runtime extracted from Rust core | Full ownership of terminal protocol, identities, lifecycle, and graphical integration. | Largest implementation and cross-platform maintenance commitment. |
| Optional Herdr runtime adapter | Could reuse persistence, SSH, and agent integrations while AgentPanel supplies graphical project/review workflows. | Must prove raw terminal attachment, resizing, reconnect, stable identity, and required protocol coverage. Text snapshots alone cannot replace an interactive PTY stream. Dependency upgrades may constrain AgentPanel behavior. |

Herdr documents socket schemas and control operations, but that does not establish that its public API is already suitable as a drop-in xterm transport. See [Socket API](https://herdr.dev/docs/socket-api/). Test the integration before making a product commitment. Run third-party runtime code in a disposable test environment for this spike.

Use a narrow internal `RuntimeClient` abstraction either way. Choose based on an actual local/SSH terminal demonstration, platform coverage, event fidelity, and recovery behavior. Do not maintain two full runtime implementations in the first release. Keep licensing/provenance obligations intact if reusing third-party implementation code.

## Delivery order and release gates

| Milestone | Scope | Release gate |
| --- | --- | --- |
| 1 Correctness and runtime decision | G6 deletion fix; G3 lifecycle model and first adapters; build/integrate spike. | Dirty work cannot disappear through ordinary cleanup; lifecycle tests distinguish quiet, blocked, done, and exited; runtime path chosen from evidence. |
| 2 Persistent local operation | G1 service, protocol skeleton, local CLI inventory, replay, reconnect. | Agent keeps working with zero clients; reconnect recovers current terminal state on each supported OS. |
| 3 Multiple computers | G2 SSH machines, qualified IDs, capability checks, stale-state handling, shared viewing/input ownership. | Laptop controls desktop and server; disconnects and client switches preserve the correct process and input target. |
| 4 Programmable work and recovery | G4 prompt/read/wait/events; G5 native resume and inbox. | Script coordinates builder and reviewer; uncertain delivery is recoverable; restart behavior is truthful. |
| 5 Integrated delivery | G7 task/review/PR workflow; project setup recipes and worktree paths. | One real issue reaches a reviewed PR with revision-bound tests and explicit human acceptance. |
| 6 Scale and extensibility | G8 extensions/environment controls; G9 richer layouts and saved views; broader adapters. | Real multi-project users manage their normal workload without tab babysitting or environment collisions. |

Key remapping and targeted GitHub diagnostics can ship alongside the larger foundations. If distributed work is the immediate product priority, Milestones 2 and 3 should receive most engineering capacity after the correctness fixes.

## Validation and product measures

Use one developer workflow across two persistent hosts and two clients before expanding the feature count. Include two projects, an agent needing approval, a failing test, a client crash, and a network interruption. Require the developer to finish the review from the second client.

Proposed pilot gates, to be calibrated from measurements rather than represented as current performance:

| Measure | Initial gate |
| --- | --- |
| Process continuity | No process terminated by ordinary client closure in the supported platform matrix. |
| Input targeting | No prompt delivered to the wrong host, session generation, or replacement shell in reconnect/race tests. |
| Completion correctness | No “success” inferred solely from silence, exit, or transport loss. |
| Attention handling | Users identify the session requiring input without opening unrelated terminals. |
| Coordination | Replayed transport requests cannot create duplicate tasks or prompts. |
| Recovery | Supported conversation resumes exactly; unsupported cases remain visible and explainable. |
| Review integrity | Test and review results identify a revision and become stale after relevant changes. |
| Fleet performance | Measure 10/25/50 sessions, high-output panes, reconnect catch-up, memory growth, idle CPU, and interactive latency on each target OS. Set budgets after collecting current baselines. |

The historical [performance notes](baseline-performance-metrics.md) contain useful local measurements, but do not establish remote performance or current cross-platform fleet behavior.

## Features to defer

Defer a hosted relay/cloud account, public plugin marketplace, autonomous general-purpose scheduler, native mobile app, and provider-independent cost dashboard until the durable local/SSH workflow is reliable. Herdr's website labels its no-SSH Cloud offering as coming soon; it should not be counted as a shipped competitive requirement. See [Herdr](https://herdr.dev/).

Cost/context tracking could later use adapter-reported data with explicit coverage and uncertainty. A terminal wrapper cannot promise accurate universal token accounting. Team RBAC, organization audit/export, managed installation, and enterprise policy should follow confirmed team demand; SSH access under one user's account is not an organization authorization model.

The first product milestone worth aiming for is concrete: **start work on one machine, leave it running, review it from another, and know exactly which agent, checkout, and tested revision you are controlling.** That combines Herdr's strongest documented runtime capabilities with AgentPanel's existing development and review interface.
