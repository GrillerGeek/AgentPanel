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

## Open review items

This section will be reconciled with final verified results before handoff.
