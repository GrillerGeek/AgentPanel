# AgentPanel

<img width="1344" height="761" alt="Screenshot 2026-07-23 at 9 39 23 PM" src="https://github.com/user-attachments/assets/2ec11c8a-bdb5-45f0-8f1f-4945af21f4d4" />

A cross-platform (**Windows**, **macOS**, and **Linux**) command center for running multiple AI
coding agents in parallel — each isolated in its own **git worktree**, each with its own
terminal. Built on Tauri (Rust) + React + xterm.js.

## Features

- **Repositories & worktrees** — add any folder/git repo; create, list, and remove git worktrees
  from the sidebar (an isolated branch per agent).
- **Parallel terminal tabs** — a real PTY shell per pane (ConPTY on Windows), all running at
  once; tabs survive switching, and you can **split** a tab into two side-by-side terminals.
- **Scrollback that survives a restart** — restored tabs come back with their text, not empty.
  Capped at 256 KB per terminal, stored locally, and switchable off in Settings.
- **Bring your own agent** — run any CLI (`claude`, `codex`, …); one-click quick-launch buttons.
- **Live git status** — branch, dirty-file count, and ahead/behind vs upstream per worktree,
  updated instantly via a file watcher.
- **Diff review** — read every file an agent changed in a worktree (committed *and*
  uncommitted), drop comments on any line, and send them all back to the agent as one prompt.
- **GitHub PR/CI** — per-worktree PR number + CI state via the `gh` CLI (click to open).
- **Open in editor** — one-click tab bar button to open the active worktree in your editor;
  configurable command (`code`, `cursor`, `code-insiders`, …) via Settings.
- **Quick open** (`Ctrl+P`, active worktree), **command palette** (`Ctrl+Shift+P`), keyboard
  shortcuts (`Ctrl+T/W/Tab/1–9`), session restore, and **12 themes** (Tokyo Night, Catppuccin,
  Dracula, Nord, Solarized, …).

## Runtime requirements

- **Windows 10 1809+ / Windows 11**, **macOS 11+** (Apple Silicon or Intel), or **Linux**
  (x86_64, glibc 2.35+ — Ubuntu 22.04, Debian 12, Fedora 36 and newer).
- **WebView2 runtime** (Windows only) — preinstalled on Windows 11; the installer fetches it if
  missing. macOS uses the system WebKit. Linux uses **WebKitGTK 4.1**
  (`libwebkit2gtk-4.1-0`); the `.deb` declares it as a dependency, and the AppImage
  expects it to be present.
- **Git** on `PATH` (required for worktrees).
- Optional: **GitHub CLI (`gh`)** for PR/CI info; your agent CLIs (`claude`, etc.).

## Install

Download the latest build for your platform from
[Releases](https://github.com/GrillerGeek/AgentPanel/releases):

- **Windows** — `AgentPanel_<version>_x64-setup.exe`. Per-user install, no admin required.
- **macOS (Apple Silicon)** — `AgentPanel_<version>_aarch64.dmg`. This is every Mac from 2020 on;
  check the Apple menu → About This Mac if unsure.
- **macOS (Intel)** — `AgentPanel_<version>_x64.dmg`.
- **Linux (x86_64)** — `AgentPanel_<version>_amd64.AppImage` (portable — `chmod +x` and run),
  or `AgentPanel_<version>_amd64.deb` for Debian/Ubuntu. Auto-update works on the
  AppImage only.

The macOS builds are signed and notarized by Apple — open the `.dmg` and drag the app to
Applications; no security workarounds needed.

### macOS shell PATH tip

If a GUI-launched terminal cannot find tools like `starship` or `fnm`, open **Settings → Terminal
environment overrides** and click **Import PATH from login shell**. You can also enable
**Auto-sync PATH from login shell** so new terminals inherit a Terminal.app-like PATH.

### Linux blank-window tip

On some NVIDIA proprietary drivers, WebKitGTK renders a blank or corrupted
window. Launch with the DMABUF renderer disabled:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./AgentPanel_<version>_amd64.AppImage
```

AgentPanel does not set this itself — it turns off hardware acceleration, which
the majority of Linux users do not need.

## Build from source

Prerequisites: [Rust](https://rustup.rs) (stable), Node.js 18+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS — on Windows: the MSVC
toolchain, VS C++ Build Tools, and WebView2; on macOS: the Xcode Command Line Tools; on
Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
patchelf build-essential libxdo-dev libssl-dev`.

```sh
npm install
npm run tauri dev      # run in development (hot reload)
npm run tauri build    # produce the release build + installer
```

Bundles are written under `src-tauri/target/release/bundle/` — `nsis/` on Windows, `dmg/` and
`macos/` on macOS, `appimage/` and `deb/` on Linux.

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

## Telemetry

AgentPanel can optionally report crashes and errors to help catch bugs in the wild. It is
**off by default** and strictly **opt-in** — you're asked once, on first run, and nothing is
sent until you say yes.

**What's sent, if you opt in:**
- The exception type, message, and stack trace
- The app version
- Your OS and CPU architecture

**What's never sent:**
- Terminal buffer contents or PTY input/output
- Environment variables
- Repository paths or file contents — absolute filesystem paths are stripped from every report
  (usernames and home directories are redacted; stack-frame paths are trimmed to the project-relative
  portion) before it leaves your machine
- Your hostname, or any other usage/analytics data — this is crash reporting only, never feature
  or usage tracking
- Reports don't include your IP address, and the Sentry project is configured not to store it —
  note this is a project-level setting on the receiving end, not something the app itself can
  enforce over the network
- Terminal scrollback saved for session restore — it is written only to AgentPanel's local
  app-data folder and is never transmitted (turn it off in Settings → "Remember terminal
  scrollback")

**How it works:** consent lives in a small local file
(`telemetry.json` in AgentPanel's app-data directory), not in browser storage, because the choice
has to be known before the app can even start crash reporting. Changing the setting takes effect
on your next launch. Reporting is also only wired up in official released builds — the Sentry
endpoint is baked in at release-build time, so builds from source (including forks and
`npm run tauri dev`) have none configured and send nothing, regardless of the toggle.

**To disable it:** uncheck "Send anonymous crash reports" in Settings, or answer "No" on the
first-run prompt. To change your answer later, use the Settings toggle — either way, restart
AgentPanel for the change to take effect.

Reports go to a Sentry project operated by the maintainer. See the [issue tracker](../../issues)
if you'd like to ask what region/retention that project uses.

## License

[MIT](LICENSE) © 2026 Jason Robey
