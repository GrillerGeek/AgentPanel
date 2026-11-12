# AgentPanel

<img width="1344" height="761" alt="Screenshot 2026-07-23 at 9 39 23 PM" src="https://github.com/user-attachments/assets/2ec11c8a-bdb5-45f0-8f1f-4945af21f4d4" />

A cross-platform (**Windows**, **macOS**, and **Linux**) command center for running multiple AI
coding agents in parallel — each isolated in its own **git worktree**, each with its own
terminal. Built on Tauri (Rust) + React + xterm.js.

## Features

- **Repositories & worktrees** — add any folder/git repo; create, list, and remove git worktrees
  from the sidebar (an isolated branch per agent). Pick which branch a new worktree is *based
  on*; the choice is remembered for local repos. Experimental remote worktrees support new branches.
- **Parallel terminal tabs** — a real PTY shell per pane (ConPTY on Windows), all running at
  once; tabs survive switching, and you can **split** a tab into two side-by-side terminals.
- **Scrollback that survives a restart** — local tabs can restore their saved text into a new
  shell (256 KB per terminal, switchable off in Settings). Experimental Herdr terminals can
  reconnect to the same running program.
- **Bring your own agent** — run any CLI (`claude`, `codex`, …); one-click quick-launch buttons.
- **Live git status** — branch, dirty-file count, and ahead/behind vs upstream per worktree,
  updated via a file watcher for local worktrees and polling for remote worktrees.
- **Diff review** — read every file an agent changed in a worktree (committed *and*
  uncommitted), drop comments on any line, and send them all back to the agent as one prompt.
- **GitHub PR/CI** — PR number + CI state for local worktrees via the `gh` CLI (click to open).
- **Open in editor** — one-click tab bar button to open the active local worktree in your editor;
  configurable command (`code`, `cursor`, `code-insiders`, …) via Settings.
- **Quick open** (`Ctrl+P`, active local worktree), **command palette** (`Ctrl+Shift+P`), keyboard
  shortcuts (`Ctrl+T/W/Tab/1–9`), session restore, and **12 themes** (Tokyo Night, Catppuccin,
  Dracula, Nord, Solarized, …).

## User guide

Start with the [AgentPanel user guide](docs/user-guide.md) for local projects, persistent
terminals, connecting remote machines, remote Git review, and creating/removing worktrees.
It includes the close-versus-detach rules and troubleshooting.

## Experimental persistent terminals and remote projects

AgentPanel can use [herdr-core](https://herdr.dev/core/) to keep programs running when you
close the app. Install core separately, then choose **Settings → Runtime for new local
terminals → Herdr core (experimental)** and save the executable and a dedicated session.
Existing panes keep their runtime; the built-in local PTY remains the default.

Use **Machines & terminals** to browse a core's configured machines, attach to existing
programs, or add an existing remote Git repository. Remote projects support Git status and
diffs, new terminals/splits/agent quick-launch, and new-branch worktree creation. Clean linked
worktrees can be removed after every program in the selected remote session has exited.
SSH setup and login use Herdr/OpenSSH outside AgentPanel.

**Closing the app detaches Herdr viewers. Closing an AgentPanel-created local Herdr pane
stops its program; closing a remote or imported pane only detaches.** Removing a repository
from the sidebar forgets its app record without deleting its files. See the
[behavior table](docs/user-guide.md#closing-terminals-and-the-app) before closing a session.

Herdr mode is experimental on macOS/Linux and disabled on Windows. Validation includes native
macOS walkthroughs and Linux runtime/SSH integration; physical-machine/WAN/sleep testing is
still pending. Remote projects currently require absolute Unix paths. Remote editor/Quick
Open, remote PR lookup, and in-app remote program termination are unavailable.

Follow the [setup instructions](docs/user-guide.md#set-up-persistent-local-terminals) and
[remote workflow](docs/user-guide.md#connect-a-remote-machine). Developer validation details
are in the [adapter acceptance notes](docs/dev/2026-11-01-herdr-adapter-acceptance.md).

The separate developer [Ghostty renderer experiment](docs/dev/2026-11-10-ghostty-history-wrap-report.md)
tests logical-wrap selection/search and bounded styled-history replay with a reproducible source
extension. It runs in an isolated comparison bundle; the app continues to use xterm.js.

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

Prerequisites: [Rust](https://rustup.rs) (stable), Node.js 20.19+ (20.x) or 22.12+, and the
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
npm test                                             # frontend (Vitest)
node --test scripts/test-updater-release.mjs          # updater release gate
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

### Updater releases

New builds require the Tauri updater signature to bind the advertised version.
Use the locked project CLI and a version higher than the published v0.7.1 when
preparing the first signed release. The release workflow verifies each draft
updater artifact with the configured public key and checks that the authenticated
version matches the release tag. Wait for that job before publishing the draft.
The published v0.7.1 feed uses legacy signatures. Existing clients can receive
the new version-bound signatures under the same key, and newer clients will
reject the legacy signatures if a feed advertises them as a newer version.

## Architecture

- **`src-tauri/`** — Rust core: `pty.rs` (ConPTY session manager), `git.rs` (worktree ops via
  `git`), `herdr.rs` / `herdr_commands.rs` (persistent runtime), `remote_projects.rs` /
  `remote_worktrees.rs` (remote Git), `gh.rs` (PR/CI), `watcher.rs` (local file watching),
  `commands.rs`, `store.rs` (persistence).
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
