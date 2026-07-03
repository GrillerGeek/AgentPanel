# Elena Novak — platform / DevOps engineer

Terminal-native (tmux + neovim), keyboard-driven, scripts and customizes everything, skeptical of GUIs that wrap a terminal.

## Overall impression

It's a competent, honestly-built worktree-per-agent launcher, and I respect that it clearly thought about remote desktop (the WebGL toggle and pointer-based tab reorder tell me someone actually runs this over RDP). The worktree model is genuinely the right abstraction for parallel agents — that part I like. But it's a GUI wrapper around xterm.js, and as a tmux person my first instinct is "why isn't this just a tmux session per worktree plus a 20-line script?" The answer it gives — live git/PR status in a sidebar and one-click agent launch — is real, but thin. Nothing here is configurable the way I expect: keybindings are hardcoded, there's no config file, no scripting hook, no SSH story. It fights my muscle memory in small ways and gives me nothing to script my way out of them. It's a nice tool for someone who *doesn't* already live in tmux. For me it's a maybe, leaning toward "I'd keep using tmux."

## Ease of use — 4/5

The happy path is genuinely discoverable — add folder, click branch, terminal opens, hit ▶ claude — and I got through the whole protocol without reading docs. It loses a point because everything past the happy path (rebinding keys, knowing which agent is busy, any scripted/headless entry) is either hardcoded or absent.

## What worked well

- **Worktree-per-agent is the correct model.** Each agent on its own branch in its own checkout with its own PTY is exactly how I'd hand-roll it with `git worktree add` + tmux windows. The app makes that a two-click operation. This is the one thing that would actually pull me off my script.
- **Live git status in the sidebar** (↑ahead / ↓behind / ●dirty, with a notify file-watcher backing it, ~200ms debounce, 10s poll safety net) is the kind of at-a-glance signal I currently fake with a shell prompt + `watch git status`. Having it per-worktree without me wiring anything is nice.
- **Remote-desktop awareness is real, not marketing.** The GPU toggle for RDP/RustDesk, and the fact that tab reorder uses pointer capture instead of HTML5 drag-and-drop (which dies over a remote session) — that's someone who has actually felt this pain. Respect.
- **Shell auto-detection** picks up PowerShell 7, Git Bash, WSL, and a custom-path escape hatch. New terminals take the new shell while existing ones keep theirs — correct behavior, no surprise re-spawns.
- **Capture-phase hotkeys** mean Ctrl+Shift+P and the tab shortcuts fire *before* xterm swallows them. A lot of terminal-wrapper GUIs get this wrong and the shortcut only works when the terminal isn't focused. This one doesn't.
- **Nerd Font fallback auto-added** so my powerline glyphs render without me hunting down why my prompt is full of boxes. Small thing, saves a real annoyance.
- **PTYs stay mounted for inactive tabs**, so my agents keep running when I switch away. Table stakes, but they got it right.

## Friction & confusion

- [major] **Keybindings are hardcoded and Windows/VS-Code-flavored — no rebinding, no config file.** Ctrl+T new terminal, Ctrl+W close, Ctrl+Tab cycle, Ctrl+1–9 jump are baked into a `keydown` listener. There's no `keybindings.json`, no settings UI for it, nothing. My entire muscle memory is a tmux prefix (`Ctrl+a` then a key); this gives me a flat Ctrl-chord scheme I can't change. Worse, Ctrl+W and Ctrl+T are *also* things I press inside TUIs and shells constantly — the app intercepts them in capture phase, so they may never reach my program. For a tool aimed at terminal people, "you can't remap a single key" is close to a dealbreaker.
- [major] **No way to tell which agent is actually doing something.** The "Active terminals" list shows repo / branch / a tab *count* — that's it. When I'm running `claude` in three worktrees, I cannot see from the sidebar which one is mid-task, which is waiting on my input, and which is idle/done. I'd have to click into each session to find out. That's the single most important signal for "run N agents in parallel" and it's missing. tmux at least lets me script a `window-status-format` with activity flags.
- [minor] **Command palette is almost empty.** It does "Add repository", "New/Close terminal", and "Open <worktree>". No split, no run-agent, no theme switch, no settings, no close-worktree, no jump-to-session. For a Ctrl+Shift+P palette this is under-built — half the actions I'd want to keyboard-drive aren't in it, so I'm forced back to the mouse.
- [minor] **Tab navigation is scoped to the active worktree only.** Ctrl+Tab cycles within one worktree; to get to another agent I go to the sidebar (mouse) or the palette. There's no global "next session" keystroke. Coming from tmux where everything is one keystroke away, this constant context-switch to the sidebar breaks flow.
- [minor] **No scrollback/search affordance surfaced.** It's xterm.js so it presumably has a buffer, but I see no find-in-terminal, no copy-mode equivalent, no way to scroll-search an agent's output — which is exactly what I do constantly in tmux copy-mode. If it's there it's not discoverable.
- [minor] **Settings is localStorage, not a file.** Theme/shell/font/agents live in the browser store. I can't check it into dotfiles, diff it, or sync it across my machines. For someone who version-controls their entire environment, an un-exportable config is a smell.

## Missing features for my workflow

- [must-have] **Remappable keybindings via a config file** — because I refuse to relearn chords for one app, and I sync my keymaps across every machine; a hardcoded scheme I can't touch will lose to tmux every time.
- [must-have] **A real per-agent activity/state indicator** (running / awaiting-input / idle / exited) in the sidebar — because the entire value prop is "many agents at once," and without knowing who needs me I'm just clicking around blind.
- [must-have] **A first-class SSH / remote-host story** — because half my agents would run on remote boxes, and right now the only "remote" answer is "RDP into the Windows machine running the app," which is backwards for me; I want the app local and the shells remote (SSH/WSL distro/host targets per worktree).
- [nice-to-have] **A headless / CLI entry point** (`agentpanel open <repo> <branch> --run claude`) so I can script session setup from my existing tooling instead of clicking — driving it from a Makefile or a shell function is how I'd actually adopt it.
- [nice-to-have] **Exportable / file-based config + theme** so it lives in my dotfiles repo, not in a webview's localStorage.
- [nice-to-have] **Terminal find / copy-mode** with keyboard search through scrollback, matching what I rely on in tmux copy-mode every day.

## My top 3 asks

1. Let me remap every keybinding from a config file (and stop swallowing Ctrl+W / Ctrl+T before they reach my shell).
2. Show me, per session, which agent is busy vs. waiting on input vs. done — without clicking into each one.
3. Give me remote shells (SSH / host targets per worktree), not just "RDP into the box."

## Would I adopt it?

Maybe — I'd trial it for local multi-agent work because the worktree model and the git/PR sidebar are genuinely good, but until I can remap keys, see per-agent activity, and target remote hosts, I'll keep reaching for tmux.
