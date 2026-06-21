# Priya Raman — OSS maintainer

> 38, maintains several popular OSS repos; reviews a high volume of PRs, lives across dozens of worktrees and branches, and delegates chores to background AI agents. Needs PR/CI status at a glance and to know which agent needs her right now.

## Overall impression

This is clearly built by someone who actually runs multiple agents in parallel, and the core metaphor — one worktree, one terminal session, one agent — maps exactly onto how I already work. The per-worktree tab scoping, the `repo / branch` context chip, the live git status and PR badge in the sidebar are genuinely thoughtful and I'd be at home within a minute. But the whole thing is built around *me looking at it*. The one thing I need most — being told which of my eight running agents just finished or is blocked on a prompt — isn't here. And the sidebar is a flat, hand-managed list that I can already feel buckling at my scale. It's a lovely terminal multiplexer for agents; it is not yet a command center that triages my attention.

## Ease of use — 4/5

Orientation was fast and the agent-per-worktree model is intuitive and well-executed; I lost a point because at my scale (dozens of worktrees, several repos) the sidebar has no search/filter and nothing routes my attention, so "easy" degrades into "a long manual list I babysit."

## What worked well

- **Agent-per-worktree is the right primitive.** Each agent in its own worktree/session is exactly how I isolate parallel chores; no mental translation.
- **Tab bar scoped to the active worktree + the `repo / branch` context chip.** "Which branch am I actually typing into" is the question that bites me when switching constantly, and the chip answers it permanently. Best decision in the UI.
- **PR badge with CI color (green/red/yellow) on the worktree row, click-through to browser.** That's 80% of my PR triage, surfaced where I already am.
- **Live git status (↑ahead / ↓behind / ●dirty) per worktree** without running `git status` everywhere.
- **`▶ claude` / `▶ codex` quick-launch** removes the rote open/cd/type dance I do hundreds of times a week.
- **Remote-desktop awareness** (pointer-based tab drag, GPU toggle for RDP). I review from many machines; someone thought about that.
- **Session restore** on relaunch — a crash/update doesn't cost me my layout.

## Friction & confusion

- **[blocker] Nothing tells me an agent finished or is waiting for input.** Confirmed by design today: the activity score only knows "terminal open" and "dirty files," with an explicit note that busy/idle/waiting detection hasn't landed. With several agents running I must click into each session to learn which stopped, which is mid-run, which is blocked on a `(y/n)`. That polling *is* my pain, and it's exactly what this tool should remove.
- **[blocker] No notifications of any kind.** The only toast is a failed git/gh op. No OS notification, no taskbar badge, no in-app "needs attention" when a background agent completes. I switch apps constantly; a finished agent sits idle and I never find out.
- **[major] Sidebar doesn't scale past a handful of worktrees.** No search, filter, collapse-all, or "only show worktrees with running agents / open PRs / red CI." Dozens of worktrees becomes a hand-managed scroll.
- **[major] "Active terminals" is ordered by first-appearance, not by who needs me.** Blocked/finished agents should float to top; as written the order is just history, i.e. noise at six-plus sessions.
- **[major] No aggregated PR/CI view.** PR status is per-row only. My real question is "every branch with a red check or stale PR across all repos" — no roll-up, so I scan row by row.
- **[minor] Command palette can't find what I think in** — no filter by PR number, red-CI, or running-agent. Underpowered for someone who lives in the palette.
- **[minor] Closing a worktree's terminals is a bare ✕ with no confirmation** — fat-finger and a running agent's session dies.
- **[minor] No per-agent state in the tab title** (running/idle/exited).

## Missing features for my workflow

- **[must-have] Agent lifecycle detection + notifications** — busy / idle / **waiting-for-input** / finished, surfaced as a sidebar indicator AND an OS notification. Without it I'm still manually round-robining sessions.
- **[must-have] An attention queue** — auto-sort/view that puts "blocked on input" and "just finished" at the top across every repo. Tell me where to look.
- **[must-have] Fleet-scale sidebar: search + filters** (repo, running-agent, dirty, open-PR, CI-red) and saved/grouped views. Dozens of worktrees is my normal, not my edge case.
- **[must-have] Cross-repo PR/CI dashboard** — one sortable list of every open PR + check state across all repos.
- **[nice-to-have] Per-tab agent state badge** so I can read a worktree's state without entering it.
- **[nice-to-have] Confirm-on-close when an agent is running.**
- **[nice-to-have] Idle-agent / cost awareness** — how long an agent's been idle (or token/cost) so I stop leaking money on left-running agents.
- **[nice-to-have] "New worktree from this PR / branch"** to spin an agent on a contributor's PR branch in one step.

## My top 3 asks

1. **Tell me which agent needs me** — waiting-for-input and finished states in the sidebar and as OS notifications, neediest auto-sorted to top.
2. **Make the sidebar work at fleet scale** — search and filters (running / dirty / open-PR / CI-red).
3. **Give me a cross-repo PR/CI roll-up** — one triage list instead of per-row scanning.

## Would I adopt it?

Maybe — I'd adopt the day agent-state notifications and a scalable, filterable sidebar land; today it's a great agent-aware terminal but it can't yet route my attention across the fleet, which is the only reason I'd switch.
