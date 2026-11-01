# AgentPanel unattended review and acceptance work

## Assumptions for review

- Continue on `Herdrcompare`, preserving the existing safety fix, reports, and opt-in adapter.
- Open and maintain a draft PR, push follow-up fixes, and run CI. Leave merging, publishing a release, and enabling Herdr by default for Jason's review.
- Keep local PTY behavior supported. Do not enable Windows Herdr mode until native ConPTY behavior is verified.
- Use disposable projects, dedicated runtime sessions, and scratch state. Do not use Jason's real repositories or existing agent sessions for acceptance tests.
- Installed agent CLIs may be inspected and launched for bounded acceptance. Do not buy services, change provider credentials/models, disable approval safeguards, or run open-ended agent tasks. Record provider-dependent checks that cannot be completed.
- Use hosted CI for platform checks if local native hosts are unavailable. A successful build is not equivalent to live terminal acceptance.
- SSH requires a real reachable test host. Do not invent credentials, alter SSH trust settings, or claim that a local transport simulation proves network behavior.

## Starting state

Branch clean at `ef0f224`, one commit ahead of `origin/main`, tracking `origin/Herdrcompare`. No existing PR. Local acceptance from the preceding session: 250 frontend tests, 66 regular Rust tests, one explicitly run live adapter test, and macOS quit/reopen/termination acceptance. Those are baseline results; follow-up results will be recorded below.

## Progress

- Draft PR [#56](https://github.com/GrillerGeek/AgentPanel/pull/56) opened; Linux CI started.
- Review found that unknown viewer handles incorrectly counted as confirmed termination. Fixed by rejecting unknown handles and retaining known completed handles until detach; frontend cleanup now explicitly detaches after confirmed stop.
- Review found a stale initial-status race across the subscription boundary. Initial status now comes from the subscription snapshot; regression coverage added.
- Found a Windows-only test-fixture path assumption (`/tmp`); switched to the platform temporary directory. Windows runtime remains disabled.
- Installed tools: Codex CLI 0.164.0, Claude Code 2.1.316, Docker Linux aarch64, OpenSSH. No local PowerShell executable found.
- Committed/pushed review fixes as `37aa9aa`. [All three CI jobs passed](https://github.com/GrillerGeek/AgentPanel/actions/runs/41309836440): Linux, macOS, Windows. Linux includes the actual live adapter test; Windows still refuses experimental Herdr mode.
- Added and pushed `a3e8d65`: real OpenSSH acceptance through a disposable Linux guest, plus the actual Rust remote-binding test. Local acceptance passed, including reattachment after forcibly ending the guest SSH session and preserving remote shell PID 57. Strict host checking remained enabled; no existing SSH files, keys, or hosts were used. Success was emitted only after cleanup. [CI for this change](https://github.com/GrillerGeek/AgentPanel/actions/runs/41310825672) also passed all three jobs, including the actual SSH fixture in Linux.
- Corrected a probe assertion during development: `machine.exec` returns base64 stdout, so comparing its JSON directly with `Linux` was invalid. The corrected runner checks a successful exit and decoded exact output, then reopens the Rust adapter and rechecks the live PID.
- Rebuilt the isolated native app. One Codex rendering prompt returned `AGENTPANEL-SMOKE-OK`; reported running/idle states, the Read Only permission selector, and quit/reopen repaint passed. Independent core queries retained shell PID 10276 and foreground Codex PID 10769. No tools were requested, no model was changed, and the offered CLI update was skipped.
- A second bounded Codex check used the default full-screen UI and requested permission for one scratch-file `touch`. The actual approval dialog rendered; AgentPanel showed waiting for input and core reported `blocked` / `permission`. The dialog survived quit/reopen with shell PID 19670 and Codex PID 19969 unchanged. Declined it with Escape, observed idle, and independently confirmed that no file was created. Explicit close confirmed terminal killed and the foreground Codex PID gone. No permanent approval rule was saved.
- Claude rendered its trust prompt. Selected **No, exit**. CLI auth status reported no login, so authenticated responses/approvals remain pending. No credential or trust changes were made.
- Final local ordinary suite: **251 frontend tests; 68 Rust tests**, two live tests intentionally ignored in the ordinary Rust suite and run separately through their dedicated runners. Frontend production build and rebuilt native macOS debug bundle passed. One existing `configure_no_window` dead-code warning remains.
- Cleaned the UI fixture by explicitly closing its terminal, independently verifying `finished` / `killed`, stopping the dedicated core, and quitting the test app. Docker guests and temporary SSH credentials were removed by the runner. The fixture image and isolated application profile remain available for reuse; no runtime binary is committed or bundled.

## Open review items

1. Review draft PR [#56](https://github.com/GrillerGeek/AgentPanel/pull/56), especially the experimental Settings choice and explicit close-versus-detach behavior. No merge, release, or default-runtime change has been made.
2. Native Windows ConPTY acceptance requires a Windows test host; local PowerShell is unavailable. Hosted Windows build/tests are green but do not close this gate. Keep Herdr mode disabled there.
3. Authenticated Claude approval/response acceptance requires Jason's login. Codex's response, menu, default-screen tool approval cancellation, and pending-approval restart paths are verified. Other agent/approval variants remain open.
4. Two physical computers, WAN interruption, sleep/wake, and interactive SSH authentication need a selected host and human authentication. Loopback-to-Linux SSH integration is verified and must not be presented as that broader acceptance.
5. Slow viewers at upstream backlog limits, crash/power-loss behavior, and large-session performance remain open. No automatic replay or replacement process is an acceptable recovery shortcut.

## Recommended next implementation

Start with a read-only machine/session browser and **attach an existing terminal**, using core's existing machine inventory and machine-qualified terminal addresses. Show machine, core session, remote path, and connection state clearly before attach. Keep SSH credentials and trust with OpenSSH; show actionable authentication failures without copying keys or suppressing host verification. Preserve the current rule that reconnect validates identity and never starts a replacement program.

Repository identity currently uses a local path (`src-tauri/src/commands.rs::add_repository`); `Repository`, `Worktree`, and `TerminalTab.cwd` have no machine field (`src/types.ts`). Before introducing remote projects, add explicit machine/core identity and migrate existing entries to local. The same path on two machines must stay distinct. Local git, diff, file, editor, and worktree commands must never receive remote paths accidentally. A terminal browser can ship before these repository operations are routed remotely, provided unsupported actions are visibly unavailable.

Acceptance for that next slice: attach terminals on two configured machines concurrently; distinguish identical paths; restore each binding after app restart without launch replay; disconnect one machine without disrupting the other; preserve unknown status when reports are missing; keep offline terminals visible; refuse destructive remote actions until their own safety rules are implemented. Remote worktree creation/deletion should be a subsequent slice with the same dirty/untracked/ignored-file and confirmed-stop protections as local worktrees.

Assumption to review: prioritize reliable attachment and honest machine identity before remote project mutation, automatic reconnection policy, or broader task orchestration. This is a proposed next slice, not a claim that machine navigation has shipped in this PR.
