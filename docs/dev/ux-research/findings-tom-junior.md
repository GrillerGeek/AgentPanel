# Tom Walsh — junior developer

> 23, ~1 year out of a bootcamp. Loves AI coding tools, still shaky on git internals (worktrees genuinely confuse me), a little scared of the terminal and of breaking my repo. I live on clear labels, tooltips, and "are you sure?" prompts.

## Overall impression

Honestly my first reaction was a mix of "ooh this looks cool" and "wait, am I going to wreck my repo?" The app is clearly powerful and the terminals feel fast and clean. But it's built like the person using it already knows what a git worktree is, why you'd want several agents going at once, and what all the little arrows and dots mean. For me that's a wall right at the front door. Once someone walked me through it I think I'd get a lot out of it — but on my own, cold, I stalled out around step 3 and got nervous around the ✕ buttons. It feels like a tool made *by* a senior for seniors.

## Ease of use — 2/5

The core loop (add repo, open terminal, hit "▶ claude") is genuinely nice once you know the words, but there's zero onboarding and the central concept — worktrees — is never explained, so I spent most of my time guessing and being afraid to click things.

## What worked well

- The empty state in the sidebar actually tells me what to do: "No repositories yet. Click + Add to pick a folder." That one sentence was the only thing that oriented me at first launch, and I leaned on it hard.
- "+ Add" is a totally normal, friendly label and the folder picker is exactly what I expected. No surprises — good.
- The **▶ claude** and **▶ codex** buttons are the best part. A literal button that says "run claude" is so much less scary than me typing a command and worrying I typo'd it. This is the feature that made me actually want to keep going.
- The `repo / branch` context chip at the top of the tab bar is reassuring — it's the one place I always felt sure which project I was looking at.
- Tooltips exist on a lot of the small icons (I hovered the ↑ ↓ ● and they expanded to "2 ahead of upstream" etc.), which saved me once I thought to hover. Same with the PR badge.
- Themes/font/size apply instantly with a live preview — that's friendly and I felt safe poking at it because nothing there can break my code.

## Friction & confusion

- [blocker] **"Worktree" is never explained, anywhere.** It's in the sidebar, the buttons ("+ new worktree"), the tab logic — and I genuinely don't know what it is. I think of git as branches. Is a worktree a branch? A folder? Both? When I click "+ new worktree" and type a branch name, is it going to make a new folder on my disk somewhere? Move my files? Switch my current checkout? I couldn't tell, and that uncertainty alone made me not want to press it. This is the single thing that would make me close the app.
- [blocker] **The ✕ buttons terrified me and there's no confirmation.** There's an ✕ next to a repo ("Remove repository"), an ✕ next to a worktree ("Remove worktree"), and an ✕ on active sessions ("Close all terminals in this worktree"). To a nervous junior these all read like "delete." I could not tell whether "Remove worktree" deletes my branch, deletes my code on disk, or just hides it from the list. There's no "Are you sure?" and no undo toast that I noticed, so I just... didn't touch any of them, which means I couldn't really finish the cleanup parts of the task. A destructive action with no confirmation, on something I don't understand, is a hard stop for me.
- [major] **No first-run orientation at all.** Cold open drops me straight into an empty two-pane app. There's no welcome screen, no "here's what AgentPanel does," no 3-step tour, no link to docs. I had to infer the whole mental model from labels. For the target concept (running multiple agents in parallel), one intro screen would change everything.
- [major] **Two different "open" gestures that aren't obviously different.** Clicking a worktree row opens a terminal; clicking an "Active terminals" row up top switches to that session. Early on I clicked a worktree row twice thinking nothing happened and worried I'd opened two of something. The relationship between the top "Active terminals" list and the "Repositories" list below took me a while to get — they're the same worktrees in two states, but nothing says that.
- [major] **The git status glyphs (↑ ↓ ●) assume I already read git fluently.** I know "↑2" means ahead now because I hovered, but "ahead of upstream" is itself jargon. A junior needs words like "2 commits not pushed yet" before this means anything. Without hovering it's just cryptic symbols.
- [minor] **I don't know what each agent is actually doing.** Step 4 asks me to run two agents and tell what each is up to. I can switch sessions and the tab count shows "2," but there's no at-a-glance "this agent is working / waiting / finished / needs input." I'd have to click into each terminal and read scrollback, which defeats the "command center" promise for me.
- [minor] **"◫" (split) and "Ctrl+Shift+P" are unlabeled-by-default.** The ◫ glyph means nothing to me until I hover; the top bar just shows "Ctrl+Shift+P" with no words, so I didn't know it was a command palette until I tried it.
- [minor] **PR badge color meaning isn't discoverable.** A green/red/yellow "#123" is only meaningful if you already know it's CI status. I clicked it expecting an explanation and got sent to a browser, which was actually fine, but I didn't know that's what would happen.

## Missing features for my workflow

- [must-have] A one-line, plain-English explanation of what a worktree is (and what creating/removing one does to my files), right where the worktree controls are — a tooltip or an inline "?" — because without it I can't safely use the core feature of the app.
- [must-have] Confirmation dialogs (or at least an undo toast) on every ✕ / "Remove" action, spelling out exactly what gets deleted and whether my code on disk is touched, because right now fear of breaking my repo stops me from using half the UI.
- [must-have] A first-run welcome / quick tour (even 3 cards: what this is, add a repo, launch an agent), because there's currently no path from "never seen this" to "confident."
- [nice-to-have] Per-agent status indicators in the sidebar (working / idle / needs input / done) — that's the actual reason I'd want a multi-agent panel, so I can glance and know who needs me.
- [nice-to-have] Plain-language labels or a legend for the git status symbols (↑ ↓ ●) and the PR badge colors, because the symbols-only design assumes git fluency I don't have yet.
- [nice-to-have] A visible "git basics / help" link somewhere, so when I hit a word I don't know I can learn it without leaving for Google.

## My top 3 asks

1. Explain "worktree" in plain English right where I use it, and tell me whether creating/removing one changes files on my disk.
2. Put a confirmation (and ideally an undo) on every Remove/✕ — make destructive actions safe to approach.
3. Give me a first-run tour and a "what is each agent doing right now" status so the multi-agent idea is actually graspable and watchable.

## Would I adopt it?

Maybe — I love the agent-launch buttons and the speed, but until "worktree" is explained and the delete buttons stop scaring me, I wouldn't trust myself to use it on a real repo without help.
