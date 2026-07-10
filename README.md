# AgentPanel

A cross-platform (**Windows** and **macOS**) command center for running multiple AI coding agents in
parallel — each isolated in its own **git worktree**, each with its own terminal. Built on Tauri
(Rust) + React + xterm.js.

## Features

- **Repositories & worktrees** — add any folder/git repo; create, list, and remove git worktrees
  from the sidebar (an isolated branch per agent).
- **Parallel terminal tabs** — a real ConPTY shell per pane, all running at once; tabs survive
  switching, and you can **split** a tab into two side-by-side terminals.
- **Bring your own agent** — run any CLI (`claude`, `codex`, …); one-click quick-launch buttons.
- **Live git status** — branch, dirty-file count, and ahead/behind vs upstream per worktree,
  updated instantly via a file watcher.
- **GitHub PR/CI** — per-worktree PR number + CI state via the `gh` CLI (click to open).
- **Command palette** (`Ctrl+Shift+P`), keyboard shortcuts (`Ctrl+T/W/Tab/1–9`), session restore,
  and **12 themes** (Tokyo Night, Catppuccin, Dracula, Nord, Solarized, …).

## Runtime requirements

- **Windows 10 1809+ / Windows 11**, or **macOS 11+** (Apple Silicon).
- **WebView2 runtime** (Windows only) — preinstalled on Windows 11; the installer fetches it if
  missing. macOS uses the system WebKit.
- **Git** on `PATH` (required for worktrees).
- Optional: **GitHub CLI (`gh`)** for PR/CI info; your agent CLIs (`claude`, etc.).

## Install

Download the latest build for your platform from
[Releases](https://github.com/GrillerGeek/AgentPanel/releases):

- **Windows** — `AgentPanel_<version>_x64-setup.exe`. Per-user install, no admin required.
- **macOS** — `AgentPanel_<version>_aarch64.dmg` (Apple Silicon). Signed and notarized by Apple —
  open the `.dmg` and drag the app to Applications; no security workarounds needed.

### macOS shell PATH tip

If a GUI-launched terminal cannot find tools like `starship` or `fnm`, open **Settings → Terminal
environment overrides** and click **Import PATH from login shell**. You can also enable
**Auto-sync PATH from login shell** so new terminals inherit a Terminal.app-like PATH.

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable), Node.js 18+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS — on Windows: the MSVC
toolchain, VS C++ Build Tools, and WebView2; on macOS: the Xcode Command Line Tools.

```sh
npm install
npm run tauri dev      # run in development (hot reload)
npm run tauri build    # produce the release build + installer
```

Bundles are written under `src-tauri/target/release/bundle/` — `nsis/` on Windows, `dmg/` and
`macos/` on macOS.

### Tests

```sh
npm test                                              # frontend (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml       # Rust (git/gh layer)
```

## Architecture

- **`src-tauri/`** — Rust core: `pty.rs` (ConPTY session manager), `git.rs` (worktree ops via
  `git`), `gh.rs` (PR/CI), `watcher.rs` (file watching), `commands.rs`, `store.rs` (persistence).
- **`src/`** — React + TypeScript: `state/store.ts` (Zustand), `Terminal.tsx` (xterm.js + WebGL),
  `components/`, `themes/`.

The frontend talks to Rust through Tauri **commands** and streams PTY output over a **Channel**.

## License

[MIT](LICENSE) © 2026 Jason Robey
