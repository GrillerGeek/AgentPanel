# Maya Chen — solo indie hacker

Persona: 29, solo indie hacker shipping small SaaS side-projects fast. Heavy AI-coding power user (Claude, Cursor), runs 3–4 agents in parallel, keyboard-driven, low friction tolerance, Windows + WSL.

## Overall impression

Honestly? This is the first tool I've seen that's built around the way I *actually* work — multiple agents, each in its own worktree, each in its own terminal, all visible at once. I currently fake this with a pile of Windows Terminal tabs and a `git worktree add` muscle-memory ritual, and it's a mess. AgentPanel's core model (worktree = session = terminal group) maps exactly onto my mental model. The ▶ claude / ▶ codex quick-launch buttons and the per-worktree tab scoping are the right primitives. My worry isn't the concept — it's whether it actually gets out of my way at speed, and whether it tells me *what each agent is doing* without me babysitting tabs. Right now the second part is the gap.

## Ease of use — 4/5

The conceptual model is intuitive and the keyboard shortcuts are mostly the ones my hands already expect (Ctrl+T, Ctrl+W, Ctrl+1–9); I docked a point because the sidebar's "Active terminals" vs "Repositories" split takes a beat to parse, and the whole worktree-creation flow lives in tiny inline affordances ("+ new worktree", ✕) that are easy to miss the first time.

## What worked well

- **Worktree-per-agent is the whole ballgame.** One agent refactoring on `refactor/api`, one spiking `feat/stripe`, one writing tests on `test/coverage` — each isolated, no `git stash` roulette. This is exactly my parallel-experiment workflow, productized.
- **▶ claude / ▶ codex quick-launch.** Spawning a terminal *and* auto-running the agent in one click removes the most repetitive thing I do all day. Configurable agent commands means I can add my own aliased invocations.
- **Per-worktree tab scoping + context chip.** Tabs only showing the active worktree's terminals (not a global soup of 20 tabs) plus the `repo / branch` chip means I always know which branch I'm typing into. That's a real safety win when you're juggling four agents.
- **PR/CI badge in the sidebar** (#number, green/red/yellow). I live in PR status. Having check state next to the branch without alt-tabbing to GitHub is genuinely great.
- **Live git status (↑↓●)** per worktree — instant read on which agent has produced uncommitted work.
- **WSL is a first-class shell option** and GPU rendering with an RDP off-switch — someone who actually uses Windows dev tooling designed this.
- **Session restore** reopening worktree terminals on relaunch. I crash/reboot a lot; not rebuilding my whole layout matters.

## Friction & confusion

- [major] **No way to tell what an agent is *doing* without clicking into its terminal.** Step 4 exposed this hard: with two agents running in two worktrees, the sidebar shows a terminal *count* but no activity signal — is claude waiting on my input, mid-run, done, or errored? I have to click each session to find out. For 3–4 parallel agents this is the #1 thing that breaks the value prop. I need a per-session status dot (running / awaiting-input / idle / exited) and ideally an unread-output indicator.
- [major] **Agents that pause for permission/approval get lost.** Claude and codex frequently stop to ask "can I run this command?". If that happens in a background worktree I won't know — there's no notification or badge surfacing "agent N needs you." That's a silent productivity sink.
- [minor] **Sidebar has two stacked lists ("Active terminals" + "Repositories")** showing overlapping concepts (a worktree appears in both once it has terminals). On first launch I wasn't sure if these were two different things. Took a second to realize "Active terminals" is just a fast-switch pin list.
- [minor] **Worktree creation is a tiny inline "+ new worktree" text field.** Powerful, but discoverability is low and there's no indication of where the worktree directory lands on disk or what base branch it forks from. As a git power user I want to *see* that.
- [minor] **Command palette is advertised (Ctrl+Shift+P) but its action vocabulary is unknown.** For a keyboard-driven user this is potentially the most important surface and the brief gives me nothing to evaluate — I'd want "new worktree", "launch claude in X", "jump to session" all in there.
- [minor] **No mention of how a crashed/exited agent terminal is surfaced** — does the tab just sit there dead? I need to know an agent died.

## Missing features for my workflow

- [must-have] **Per-session activity / status indicators** (running, awaiting-input, idle, exited) + unread-output dots — because with 3–4 parallel agents, "which one needs me right now" is the entire job, and counting terminals doesn't answer it.
- [must-have] **OS-level notifications when a background agent finishes or needs input** — so I can context-switch away and get pulled back, instead of polling tabs.
- [nice-to-have] **A diff/changes view per worktree** (even just `git diff --stat` on click) — so I can review what an agent produced without dropping into the terminal and typing git commands myself.
- [nice-to-have] **One-key "commit + push + open PR" per worktree** — closing the loop from agent-done to PR-up is my most repetitive multi-step flow.
- [nice-to-have] **Broadcast / send-same-prompt-to-N-agents**, or at least a quick way to kick off the same task across worktrees — handy for "try this three ways."
- [nice-to-have] **Global hotkey to summon the window** and a global session switcher across all worktrees (not just within current worktree) — Ctrl+Tab being scoped to one worktree means cross-agent switching is mouse-driven, which slows me down.

## My top 3 asks

1. **Tell me what each agent is doing at a glance** — per-session status dots + an "agent needs input" badge/notification. Without this, parallelism still means babysitting.
2. **Cross-worktree keyboard switching + a strong command palette** — global "jump to session" so I never touch the mouse to move between my four agents.
3. **Close the loop to a PR** — per-worktree diff view and a one-key commit/push/PR action, so agent output → reviewed → shipped without leaving the panel.

## Would I adopt it?

Maybe — leaning yes: the worktree-per-agent model is exactly what I want and I'd switch the day it surfaces *what each background agent is doing* (status + needs-input notifications) without me clicking into every terminal.
