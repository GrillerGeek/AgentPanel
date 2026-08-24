# Linux Build — Design

**Status:** ready to implement
**Author:** Jason Robey (with Claude)
**Date:** 2026-08-24

## Problem

AgentPanel ships Windows (`nsis`) and macOS (`app`/`dmg`) only. Linux is the
third platform every comparable tool (Orca, and others in this space) ships.
The Rust core is already platform-agnostic, so the cost is packaging and CI,
not a port.

## Evidence the code is already Linux-ready

Every conditional-compilation gate in `src-tauri/src/` is one of:

| Gate | Files | Linux takes |
|---|---|---|
| `cfg(windows)` / `cfg(not(windows))` | `commands.rs`, `fonts.rs`, `gh.rs`, `git.rs`, `pty.rs`, `shells.rs` | the `not(windows)` arm (already exercised by macOS) |
| `cfg(unix)` | `pty.rs:56` (`libc::kill(-pid, SIGKILL)`) | the same arm macOS takes |
| `cfg(target_os = "macos")` / `cfg(not(...))` | `pty.rs:222` (`detect_login_path`) | the `not(macos)` arm — returns a clean `Err` |
| `cfg(not(any(windows, macos)))` | `telemetry.rs:69` | an XDG data-dir arm **written specifically for Linux** |

`shells.rs`'s `not(windows)` `detect()` already probes `/bin/bash`, `/bin/zsh`,
`/usr/bin/fish`, `/bin/sh` and `$SHELL` — correct on Linux with no change.

`Cargo.toml` has no `target_arch` gates. `winreg` is `cfg(windows)`-scoped;
`libc` is `cfg(unix)`-scoped and therefore already builds on Linux.

## Requirements

1. **R1** — A tagged release produces an x86_64 Linux **AppImage** and a **`.deb`**.
2. **R2** — Auto-update works on Linux: `latest.json` must carry a
   `linux-x86_64` key, and the release must carry the matching
   `.AppImage.tar.gz` + `.sig` updater artifacts.
3. **R3** — `verify-manifest` must **fail the release** if `linux-x86_64` is
   missing, exactly as it already does for the three existing keys.
4. **R4** — The AppImage must run on distributions older than the CI runner.
   Build on `ubuntu-22.04`, not `ubuntu-latest`: an AppImage inherits the
   builder's glibc floor, and `ubuntu-latest` (24.04) would bump that to
   glibc 2.39 and lock out Debian 12, Ubuntu 22.04, and Mint 21.
5. **R5** — The existing Windows and macOS artifact names and updater keys must
   not change. A rename silently breaks auto-update for existing users.
6. **R6** — The release must stay serial. `strategy.max-parallel: 1` exists
   because build legs read-modify-write one shared `latest.json`; at v0.6.0 a
   race produced two assets both named `latest.json` holding disjoint platform
   sets. A fourth leg makes that race strictly more likely, not less.
7. **R7** — A PR must be able to catch a Linux compile break **before** a tag
   is pushed. Today the only workflow is `release.yml`, which runs on tags
   only, so a Linux regression would first surface mid-release.

## Decisions

### D1 — AppImage + deb, no rpm, no Flatpak, no Snap

AppImage satisfies R2 (it is the **only** Linux format `tauri-plugin-updater`
can update in place). `.deb` covers Debian/Ubuntu users who want a real package.
`rpm` adds a third artifact and a second packaging failure mode for a much
smaller share; skip it until someone asks. Flatpak and Snap need external
store accounts and review queues — out of scope.

### D2 — `bundle.targets` stays one global list

`tauri.conf.json` already lists `["nsis", "app", "dmg"]` and both the Windows
and macOS legs build cleanly from it, because the Tauri bundler skips targets
that are not supported on the host platform. Appending `"appimage"` and
`"deb"` follows that same proven path — no per-platform config split, and no
change to R5's artifact names.

### D3 — `ubuntu-22.04`, pinned, not `ubuntu-latest`

Per R4. This is a deliberate, load-bearing pin. It carries a comment in the
workflow so a future "keep runners current" cleanup does not quietly raise the
glibc floor.

### D4 — A new `check` workflow on PRs, Linux-only

Per R7. A single `ubuntu-22.04` job running `cargo check` + `cargo test` +
`npx tsc --noEmit` + `npm test`. It is not a bundling job — bundling is slow
and only meaningful at release time. It exists to make a Linux compile break a
red PR instead of a broken release.

### D5 — The DMABUF workaround is documented, not coded

WebKitGTK 2.42+ renders a blank or corrupt window on some NVIDIA proprietary
drivers unless `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set. Setting it
unconditionally in-app would disable hardware acceleration for the majority who
do not need it. It goes in the README's Linux troubleshooting note instead.

## Out of scope

- ARM64 Linux (`aarch64`). No CI runner without cross-compilation setup, and
  no evidence of demand yet.
- Wayland-specific fixes, tray icons, or `.desktop` file MIME associations.
- Signing Linux artifacts. AppImages are conventionally unsigned; the updater
  uses its own minisign key, which already covers integrity.
