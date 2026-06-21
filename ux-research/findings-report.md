# AgentPanel — Consolidated Usability Findings

> **Important caveat:** This was a **simulated study with five AI-roleplayed personas**, not real users running real work. Every finding below is a **hypothesis to validate with real users** — directional signal for prioritization, not usage data.

## Executive summary

- **The single loudest signal, unanimous across all 5 personas, is that AgentPanel cannot tell you what your background agents are doing.** With several agents running, the sidebar shows only a terminal *count* — no running / idle / **awaiting-input** / finished / exited state, and no notification when an agent completes or stops to ask permission. Every persona named this; for the power users (Maya, Elena, Priya) it is *the* reason the parallel-agent value prop currently breaks down to "babysitting tabs."
- **The core model is validated and loved.** Worktree = session = terminal group, per-worktree tab scoping, the `repo / branch` context chip, the ▶ agent quick-launch, live git status, and the PR/CI badge all landed well with everyone, including the skeptics. Protect these; do not touch them.
- **Adoption is gated differently per segment, but the gates are concrete:** junior devs are blocked by *unexplained worktrees + unconfirmed destructive ✕ buttons*; enterprise is blocked by *unsigned installer + no proxy/GHE + no audit trail*; power/terminal users are blocked by *no agent state, no remappable keys, weak command palette*; the OSS maintainer is blocked by *no attention queue / no fleet-scale sidebar*.
- **Notifications + agent-state detection is net-new foundational work** (confirmed not built) that simultaneously unblocks Maya, Elena, Priya, *and* Tom. It is the highest-leverage single investment.
- **A cluster of cheap safety/clarity wins** (confirmation/undo on ✕, an inline "what is a worktree" explainer, plain-language git glyph labels, surfacing the already-bundled terminal search, fleshing out the command palette) costs little and removes real blockers — especially for onboarding and trust.
- **No persona was a hard "no."** All five said "maybe, leaning yes" — they are describing the specific thing that would flip them. That makes the roadmap unusually legible.

## Methodology

**Personas (5), each walked the same 7-step task protocol** (first-launch orientation → add a repo → create a worktree + launch `claude` → run a second agent in parallel and switch between them → check git/PR status → customize shell/font/theme → reflect on adoption):

- **Maya — solo indie hacker.** Runs 3–4 agents in parallel, keyboard-driven, low friction tolerance, Windows + WSL. Cares about speed and knowing which agent needs her.
- **Raj — enterprise staff engineer.** Mandatory-PR monorepo, corporate proxy, GitHub Enterprise + SSO/2FA. Cares about deployability, auditability, and not surprising his git/filesystem state.
- **Elena — terminal-native DevOps.** tmux + neovim, scripts everything, skeptical of GUIs over terminals. Cares about remappable keys, config files, remote shells, agent state.
- **Tom — junior dev.** ~1 year out of bootcamp, shaky on git, scared of breaking his repo. Cares about onboarding, plain-language labels, and safe/confirmed destructive actions.
- **Priya — OSS maintainer.** Dozens of worktrees across many repos, high-volume PR triage, delegates chores to background agents. Cares about attention routing, fleet-scale sidebar, cross-repo PR/CI roll-up.

Protocol was a moderated walkthrough; findings recorded in a fixed format (impression, ease-of-use score, what worked, friction by severity, missing features, top-3 asks, adopt y/n/maybe).

## What's working (validated strengths — protect these)

- **Worktree-per-agent as the core primitive.** Named the best decision by all five. It maps directly onto how the power users already hand-roll parallel agents. Do not abstract it away.
- **Per-worktree tab scoping + the `repo / branch` context chip.** Repeatedly called out as a real safety win — "which branch am I typing into" is answered permanently. Maya, Priya, and Tom all singled out the chip.
- **▶ claude / ▶ codex quick-launch** (with configurable agent commands). The single feature that made Tom *want* to continue and that removes Maya/Priya's most repetitive daily ritual.
- **Live git status (↑↓●) and the PR/CI badge per worktree.** "80% of my PR triage where I already am" (Priya); "I live in PR status" (Maya).
- **The "Active terminals" pinned section** as a live fast-switch map (when it has real state behind it — see issues).
- **Genuine remote-desktop awareness** — GPU/WebGL toggle for RDP and pointer-capture tab drag. Elena, Raj, and Priya independently flagged this as proof a real Windows dev built it.
- **Solid terminal core** — ConPTY per pane, process-tree kill that reaps agent children, spawn serialization, capture-phase hotkeys, PTYs staying mounted for inactive tabs, Nerd Font fallback. Raj and Elena (the hardest critics) praised the engineering.
- **Session restore** of the worktree layout on relaunch.
- **Live-preview shell / font / theme pickers** — Tom felt safe experimenting here.

## Top usability issues

Ranked by how much each blocks adoption across personas.

| Issue | Severity | Personas affected | Recommendation |
|---|---|---|---|
| **No agent activity/state detection** — sidebar shows only a terminal count; no running / idle / **awaiting-input** / finished / exited. Can't tell which agent needs you without clicking into each. | **Blocker** | All 5 (Maya, Raj, Elena, Tom, Priya) | Build per-session state detection (heuristic: PTY output activity, prompt-idle, exit code, and pattern-match for permission prompts). Surface as a sidebar status dot + tab-title badge. This is the #1 priority. |
| **No notifications** when a background agent finishes or needs input — only toast today is a failed git/gh op. | **Blocker** | Maya, Priya (explicit); Elena, Tom (implied) | OS + in-app notification on "agent finished" and "agent awaiting input," with click-to-jump to that session. Depends on the state detection above. |
| **Destructive ✕ actions have no confirmation/undo** (Remove repo, Remove worktree, Close all terminals) and don't say whether disk/branch is touched. | **Blocker (Tom), Minor (others)** | Tom (blocker), Priya, Maya | Add confirmation dialogs spelling out exactly what is deleted (and that the branch/code on disk is *not*); confirm-on-close when an agent is running; ideally an undo toast. |
| **"Worktree" is never explained** — the central concept is undefined anywhere in the UI. | **Blocker (Tom)** | Tom (blocker); Maya wants disk-location/base-branch visibility | Inline plain-English explainer (tooltip / "?" / first-use) at the worktree controls: what a worktree is, where on disk it lands, what base branch it forks from, and that creating/removing one won't touch your files. |
| **Unsigned NSIS installer; no MSI/winget/signed artifact** — can't pass enterprise software distribution. | **Blocker (Raj)** | Raj | Code-sign; ship MSI/winget; offline-install option. Gates everything else for enterprise. |
| **No corporate-proxy / GitHub Enterprise support**; silent gh failures with no diagnostics. | **Blocker (Raj)** | Raj | Add proxy + GHE host config; clear gh-auth diagnostics that distinguish "no PR" from "auth/proxy blocked." |
| **No per-agent audit trail / transcript** surviving restart (restore uses fresh shells; scrollback lost). | **Major (Raj)** | Raj | Durable per-session transcript + git-action log persisted across restart. |
| **Sidebar doesn't scale past a handful of worktrees** — no search/filter/collapse, no attention sort. | **Major (Priya)** | Priya; Maya (cross-repo) | Sidebar search + filters (running-agent / dirty / open-PR / CI-red); auto-sort neediest agents to top ("attention queue"). |
| **Keybindings hardcoded, no config file** — and Ctrl+W/Ctrl+T get swallowed in capture phase before reaching the shell/TUI. | **Major (Elena)** | Elena; Maya (cross-worktree switching) | Remappable keybindings via an exportable config file; let users opt out of intercepting specific chords. |
| **Worktree location forced to sibling `<repo>-worktrees\branch`; can't adopt existing worktrees.** | **Major (Raj)** | Raj; Maya (wants to see where it lands) | Configurable worktree root; "use existing worktree" adopt mode. |
| **Command palette is thin** — add repo / new-close terminal / open worktree only. No split, run-agent, theme, settings, jump-to-session, or filtered search. | **Minor (named by 3)** | Elena, Maya, Priya | Expand palette to cover every primary action + jump-to-session + filter by PR#/red-CI/running-agent. |
| **No global cross-worktree session switching** — Ctrl+Tab is scoped to the active worktree only. | **Minor** | Maya, Elena | Add a global "next/prev session" + "jump to session" keystroke. |
| **No cross-repo PR/CI roll-up** — status is per-row only. | **Major (Priya)** | Priya | One sortable list of every open PR + check state across all repos. |
| **Git glyphs (↑↓●) assume git fluency**; PR badge color meaning not discoverable. | **Major (Tom)** | Tom | Plain-language labels/legend ("2 commits not pushed yet") and a one-line PR-color legend. |
| **No first-run onboarding** — cold-opens into an empty two-pane app. | **Major (Tom)** | Tom | 3-card first-run tour: what this is → add a repo → launch an agent. |
| **Terminal find/search not surfaced** (xterm search addon is bundled but hidden). | **Minor (Elena)** | Elena | Surface Ctrl+F find-in-terminal + scrollback search in the UI. |
| **"Active terminals" / "Repositories" overlap is confusing** on first read (a worktree appears in both). | **Minor** | Maya, Tom | Clarify the relationship (label, subtle visual link, or "active" indicator on the repo row). |
| **No SSH/remote-host targeting** — only "remote" answer is RDP into the box. | **Nice-to-have (Elena)** | Elena | Per-worktree remote shell targets (SSH / WSL distro / host). Larger bet. |

## Feature gaps

### Quick wins (low effort, high value)

1. **Confirmation + undo on every destructive ✕** — *Tom (must), Priya, Maya.* Removes a hard blocker for nervous users and a fat-finger risk for power users; clarifies that branches/disk aren't deleted. **Effort: S.**
2. **Inline "what is a worktree" explainer + show where it lands on disk / base branch** — *Tom (must), Maya.* Unblocks the app's central concept for newcomers; satisfies power users who want to *see* the git mechanics. **Effort: S.**
3. **Plain-language git-status labels + PR-color legend** — *Tom.* Tooltips already exist; add words ("2 commits not pushed yet") and a legend. **Effort: S.**
4. **Surface terminal find/search** (addon already bundled) — *Elena.* Pure UI exposure of existing capability. **Effort: S.**
5. **Flesh out the command palette** (split, run-agent, theme, settings, close-worktree, jump-to-session) + **global cross-worktree session switch** — *Elena, Maya, Priya.* Re-enables keyboard-driven flow the palette already implies. **Effort: S–M.**
6. **First-run 3-card tour** — *Tom.* One screen changes the cold-start experience. **Effort: S–M.**
7. **Confirm-on-close when an agent is running** — *Priya, Maya.* Subset of #1; prevents killing a live agent by accident. **Effort: S.**

### Bigger bets

1. **Agent lifecycle state detection** (running / idle / **awaiting-input** / finished / exited) surfaced as sidebar dots + tab badges — *all 5, must-have for Maya/Elena/Priya.* The keystone: it's the reason the parallel model exists. **Effort: M–L** (heuristics + UI; pattern-matching permission prompts is the hard part).
2. **Notifications** (OS + in-app, click-to-jump) on finished / needs-input — *Maya, Priya (must).* Depends on #1. **Effort: M.**
3. **Fleet-scale sidebar: search + filters + attention queue** (auto-sort neediest to top; filter by running/dirty/open-PR/CI-red; collapse) — *Priya (must).* **Effort: M.**
4. **Cross-repo PR/CI dashboard** — one sortable triage list across all repos — *Priya (must).* **Effort: M.**
5. **Remappable keybindings via exportable config file** (+ stop swallowing Ctrl+W/Ctrl+T) — *Elena (must).* Also unblocks dotfile-syncing power users. **Effort: M.**
6. **Enterprise deployability**: code-signed installer + MSI/winget + offline — *Raj (must).* Gates the entire enterprise segment. **Effort: M** (mostly build/release pipeline + cert).
7. **Proxy / GHE host config + gh-auth diagnostics** — *Raj (must).* **Effort: M.**
8. **Durable per-agent transcript / audit log** surviving restart — *Raj (must).* Also gives everyone real session history and recoverable scrollback. **Effort: M–L.**
9. **Configurable worktree location + adopt-existing-worktree** — *Raj (must), Maya.* **Effort: M.**
10. **Per-worktree diff view + one-key commit/push/PR** — *Maya (nice).* Closes the loop from agent-done to PR-up. **Effort: M.**
11. **SSH / remote-host shell targets per worktree** — *Elena (nice).* Inverts the remote story (local app, remote shells). **Effort: L.**

## Prioritized roadmap

The ordering logic: **(A)** ship the one thing everyone asked for first, because it converts the most personas and is a prerequisite for several other asks; **(B)** then bank the cheap trust/clarity wins that unblock onboarding and de-risk daily use; **(C)** then scale and harden for the two demanding segments (maintainer fleet, enterprise); **(D)** then power-user depth and remote.

**Theme 1 — Make agents observable (do this first; unblocks 5/5).**
1. **Agent state detection** (running / idle / awaiting-input / finished / exited) → sidebar status dots + tab-title badges.
2. **Notifications** (OS + in-app, click-to-jump) for "finished" and "needs input," built on #1.

**Theme 2 — Make it safe and learnable (cheap, parallelizable with Theme 1).**
3. Confirmation + undo on every destructive ✕; confirm-on-close when an agent is running.
4. Inline "what is a worktree" explainer + disk-location/base-branch visibility.
5. Plain-language git-status labels + PR-color legend.
6. First-run 3-card tour.

**Theme 3 — Make the keyboard/palette story whole (cheap power-user wins).**
7. Expand the command palette to all primary actions + jump-to-session.
8. Global cross-worktree session switching.
9. Surface terminal find/search.
10. Remappable keybindings via exportable config file (+ stop swallowing Ctrl+W/Ctrl+T).

**Theme 4 — Scale for the maintainer (fleet of worktrees/repos).**
11. Sidebar search + filters + attention-queue auto-sort.
12. Cross-repo PR/CI roll-up dashboard.

**Theme 5 — Harden for the enterprise (gates a whole segment, but only that segment).**
13. Code-signed installer + MSI/winget + offline.
14. Proxy / GHE config + gh-auth diagnostics.
15. Durable per-agent transcript / audit log.
16. Configurable worktree location + adopt-existing-worktree.

**Theme 6 — Power-user depth & loop-closing (later).**
17. Per-worktree diff view + one-key commit/push/PR.
18. SSH / remote-host shell targets per worktree.

Themes 1–3 are the cheapest path to flipping Maya, Elena, and Tom from "maybe" to "yes." Theme 4 flips Priya. Theme 5 is sequenced last *for the product overall* but is non-negotiable and standalone for Raj's segment — if enterprise is a near-term go-to-market priority, pull Theme 5 forward and run it as a parallel track, since it shares almost nothing with the others.

## Tensions & trade-offs

- **Junior guardrails vs. power-user speed.** Tom wants confirmations and explainers; Maya/Elena want zero friction and fast destructive actions. **Resolve by:** making guardrails *informative but dismissible* — a confirm dialog with a "don't ask again" / "I understand worktrees" toggle, and an undo toast instead of a modal where possible. Inline explainers as hover/"?" affordances, not blocking screens. Power users opt out once; juniors keep the net.
- **Enterprise lockdown vs. indie simplicity.** Raj needs signed/MSI/proxy/GHE/audit; Maya/Tom need none of it and shouldn't see config bloat. **Resolve by:** keeping enterprise features *off by default and out of the way* — proxy/GHE/audit-log live in an "Advanced/Enterprise" settings area; the default experience stays zero-config. Signing/MSI is invisible to indies (it just makes the installer trusted).
- **Configurable everything (Elena) vs. opinionated defaults (Tom).** Elena wants a config file and remappable keys; Tom would drown in options. **Resolve by:** ship strong defaults that work with no config, and make the config file an *optional power-user escape hatch* (file-based, exportable) that the default UI never forces anyone to open.
- **Agent-state heuristics vs. correctness (Raj's "disclose the polling lag").** Any "awaiting-input/finished" detection will be heuristic and occasionally wrong. **Resolve by:** showing state honestly (e.g., "idle since 2m," "looks like it's waiting") and never *silently* misreporting — surface confidence, and pair notifications with the audit log so users can verify. A wrong-but-disclosed signal beats no signal for everyone; a wrong-but-confident one would burn Raj's trust specifically.
- **Local-app/remote-desktop model (current) vs. local-app/remote-shells model (Elena).** These are different architectures. **Resolve by:** treating per-worktree SSH targets as additive, not a replacement — keep the RDP-aware local model (which Raj/Priya value) and add remote shell targeting as an opt-in for the DevOps segment.

## Recommended next step

Validate the top hypotheses with **real users**, because everything above is persona-simulated. Prioritized validation plan:

1. **Test the keystone (agent observability) first.** Build a *clickable prototype or a behind-a-flag MVP* of sidebar state dots + a "needs input" notification, and run **moderated sessions with 5–8 real users who actually run multiple agents in parallel** (the Maya/Priya/Elena profile). Task: "start 3 agents, walk away, come back when one needs you." Measure: do they correctly identify the right agent without opening every terminal? Does the awaiting-input detection fire reliably on real `claude`/`codex` permission prompts? This is the make-or-break hypothesis.
2. **Unmoderated first-run test of the onboarding/safety cluster** with **3–5 genuine juniors/git-novices** (Tom profile): cold-open, add a repo, create a worktree, then ask them to remove one. Measure: do they understand "worktree"? Do they complete the cleanup steps (today Tom stalled)? Does the confirmation copy make disk/branch impact clear?
3. **Enterprise feasibility interviews (not usability)** with **2–3 real platform/security engineers** (Raj profile): walk them through signing/MSI/proxy/GHE/audit plans and ask what specifically would or wouldn't clear their software-distribution and compliance review. This is a go/no-go on the enterprise segment, best answered by interview before building Theme 5.
4. **Instrument the real build** once state detection ships: log how often users open a terminal *only to check status* (should drop), notification click-through, and destructive-action confirm/undo usage — to confirm the simulated pains are the real ones.

Most-decisive single test: **#1**. If real parallel-agent users can't tell who needs them even with the new indicators, nothing else on the roadmap matters yet.
