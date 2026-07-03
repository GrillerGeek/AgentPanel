# AgentPanel — App Under Test (UX evaluation brief)

> Shared brief for a moderated usability evaluation. Each participant reads this,
> walks the task protocol below, and records findings in the required format.

## What AgentPanel is

A **Windows desktop app** (built with Tauri — a Rust core with a web UI and
xterm.js terminals) that acts as a **command center for running multiple AI
coding agents in parallel**. Each agent (a CLI such as `claude` or `codex`) runs
in its **own git worktree** with its **own terminal session**, so several agents
can work on different branches/tasks at once without colliding.

## How it works (current UI)

**Left sidebar — two sections:**

1. **Active terminals** (pinned at top): every git worktree that currently has
   running terminals, listed as **branch name + repo name + a count** of open
   terminals. Click one to switch to that *session*; the active one has an accent
   bar; an ✕ closes all terminals for that worktree.
2. **Repositories**: a **“+ Add”** button opens a folder picker to add a repo (or
   any folder). Each repo expands to its git **worktrees (branches)**. Each
   worktree row shows: its name, a **“main”** badge for the primary checkout,
   **live git status** (↑ commits ahead of upstream, ↓ behind, ● count of changed
   files), and — if GitHub’s `gh` CLI is installed — a **PR badge** (#number,
   colored green/red/yellow for CI checks passing/failing/pending) that opens the
   PR in a browser. You create a worktree by typing a new branch name
   (**“+ new worktree”**) and remove worktrees/repos with ✕.

**Top bar:** app name, a “Ctrl+Shift+P” hint, and a **settings** gear.

**Main area:**
- A **tab bar scoped to the active worktree only** — it shows a **`repo / branch`
  context chip**, then the terminal tabs for that worktree, plus buttons: **“+”**
  (new terminal in this worktree), **“◫”** (split into two side-by-side panes),
  and **“▶ claude” / “▶ codex”** quick-launch buttons that open a new terminal and
  auto-run that agent command.
- The **terminal(s)**: xterm.js with GPU (WebGL) rendering; split view supports two
  panes with a draggable divider.

**Other:**
- **Command palette:** Ctrl+Shift+P for quick actions.
- **Keyboard:** Ctrl+T new terminal, Ctrl+W close tab, Ctrl+Tab / Ctrl+Shift+Tab
  cycle tabs *within the current worktree*, Ctrl+1–9 jump to a tab.
- **Settings:** theme (12 curated dark/light schemes applied to app + terminals);
  shell (auto-detected: PowerShell 7, Windows PowerShell, Command Prompt, Git
  Bash, WSL, or custom); terminal font (auto-detected installed fonts, with a Nerd
  Font fallback auto-added so powerline/icon glyphs render) + size; agent commands
  (the list that becomes the ▶ quick-launch buttons); a GPU-acceleration toggle
  (turn off for smoother remote desktop / RDP).
- **Session restore:** on relaunch it reopens the worktree terminals you had open
  (with fresh shells).
- Git status updates **live** via a file watcher + periodic polling; PR/CI via `gh`.
- **Distribution:** a standalone Windows installer (NSIS), no admin required.

## Task protocol (walk through these as your persona)

1. **First launch / orientation** — From a cold open, is it clear what the app is
   for and how to begin? What do you look for first?
2. **Add a repository** and open a terminal in one of its branches.
3. **Create a new worktree/branch** and launch an agent (`claude`) in it.
4. **Run a second agent in a different worktree at the same time**, then switch
   back and forth between the two sessions. How do you know what each is doing?
5. **Check the git / PR status** of your branches from the sidebar.
6. **Customize** the shell, font, and theme in Settings.
7. **Reflect** — Would you adopt this for real work? What would stop you? What’s
   missing for *your* specific workflow?

## Required findings format (markdown)

Record findings using exactly these sections:

```
## Overall impression
(one short paragraph, in character)

## Ease of use — X/5
(one or two sentences on why)

## What worked well
- ...

## Friction & confusion
- [blocker|major|minor] ...

## Missing features for my workflow
- [must-have|nice-to-have] ... — one line on why it matters to me

## My top 3 asks
1. ...
2. ...
3. ...

## Would I adopt it?
(yes / no / maybe — one sentence)
```

Be specific, opinionated, and grounded in *your* real workflow. Call out anything
that would block adoption. Don’t be polite for its own sake — critical, concrete
feedback is the point.
