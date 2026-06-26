# Design: Cross-platform (macOS) support for AgentPanel

**Date:** 2026-06-26
**Status:** Approved
**Scope:** Make AgentPanel run on macOS (dev + local bundle) and add GitHub Actions CI
that builds Windows + macOS bundles. No Apple code signing / notarization yet.

## Background

AgentPanel is a Tauri 2 app and was written cross-platform from the start: every
`#[cfg(windows)]` block already has a non-Windows counterpart, the PTY layer uses
`portable-pty` (ConPTY on Windows, `openpty` on Unix), persistence uses Tauri's
`app_data_dir()`, and `winreg` is correctly gated under
`[target.'cfg(windows)'.dependencies]`. An `icon.icns` is already in the bundle.

Because of that, enabling macOS is a small, well-bounded change: one real code gap
plus configuration. This spec covers exactly those changes and nothing more (no
unrelated refactoring).

## Goals

- `npm run tauri dev` and a local `.app` / `.dmg` build work on macOS.
- Closing a terminal session on macOS kills the agent's entire subprocess tree
  (parity with Windows `taskkill /T /F`).
- `npm install` succeeds on macOS.
- A GitHub Actions workflow builds Windows + macOS bundles on a version-tag push.

## Non-goals

- Apple Developer account, code signing, notarization (a future, separate spec).
  Unsigned macOS builds will show a Gatekeeper warning on other machines.
- Linux support (the Unix code paths will likely work there too, but it is not a
  target and will not be tested).
- Any change to frontend behavior or UI.

## Changes

### 1. Unix process-tree kill (`src-tauri/src/pty.rs`) — the only real code change

Currently:

```rust
#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}   // no-op: leaks agent subprocesses on Unix
```

Replace with a process-group kill:

```rust
#[cfg(unix)]
fn kill_process_tree(pid: u32) {
    // portable-pty makes the PTY child a session leader (it calls setsid),
    // so the child's pid IS its process-group id. Negating it signals the
    // whole group — every subprocess the agent spawned — in one call.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
}
```

The existing `#[cfg(not(windows))]` attribute on the stub becomes `#[cfg(unix)]`
to make the intent explicit. The Windows implementation is unchanged.

**Behavior decision (confirmed):** forceful `SIGKILL` to the group, matching the
forceful Windows `taskkill /F`. Not a graceful `SIGTERM`-then-`SIGKILL` — close
means close, and parity keeps the two platforms reasoning identically.

**Why the negative-PID group kill works:** `kill(-pgid, sig)` signals an entire
process group atomically; the kernel walks the tree. Because portable-pty
`setsid`'s the shell into its own session, the shell's PID doubles as the group
ID. No `/proc` walking or descendant enumeration needed.

### 2. New Unix dependency (`src-tauri/Cargo.toml`)

```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

Gated to Unix so the Windows build is unaffected.

### 3. Bundle targets (`src-tauri/tauri.conf.json`)

```jsonc
"targets": ["nsis", "app", "dmg"]   // was ["nsis"]
```

Tauri skips targets that don't apply to the host OS, so Windows still produces the
NSIS installer and macOS produces `.app` + `.dmg`. `icon.icns` is already present
in the `bundle.icon` array.

### 4. `package.json` — remove Windows-only hard pins

Remove from `devDependencies`:

- `@rollup/rollup-win32-x64-msvc`
- `@tauri-apps/cli-win32-x64-msvc`

Both declare `"os": ["win32"]`, so `npm install` on macOS currently fails with
`EBADPLATFORM`. Their parent packages (`rollup`, `@tauri-apps/cli`) already list
them as *optional* dependencies and auto-resolve the correct per-platform binary,
so removing the explicit pins does not affect Windows installs.

### 5. CI workflow (`.github/workflows/release.yml`) — new file

Standard `tauri-apps/tauri-action` recipe:

- Trigger: push of a tag matching `v*` (e.g. `v0.2.1`).
- Matrix: `macos-latest`, `windows-latest`.
- Steps: checkout → setup Node + Rust → `npm ci` → `tauri-action` build.
- Output: a **draft** GitHub Release with both platforms' bundles attached.
- No signing secrets (consistent with the non-goal above).

### 6. Cosmetic wording

- `Cargo.toml` `description`: drop the trailing "(Windows)".
- `tauri.conf.json` `longDescription`: replace "a native Windows command center"
  with platform-neutral wording.

## Verification

- **Local (Windows, this machine):** `cargo check` / `cargo build` in `src-tauri`
  still compiles after the `pty.rs` + `Cargo.toml` edits. `npm install` still works.
- **macOS:** genuinely verified by the CI build on `macos-latest`, which is the
  first real compile of the `#[cfg(unix)]` path and the `.app`/`.dmg` bundling.
  This cannot be run from the Windows dev machine; we will not claim the macOS
  build passes until a CI run is green.

## Risks / open questions

- `portable-pty`'s `setsid` guarantee on macOS is what makes the group kill
  correct. If a future portable-pty version changed that, the group kill would
  miss descendants. Low risk; pinned at `0.8`.
- macOS minimum system version is left at Tauri's default; revisit only if a CI
  build surfaces a deployment-target warning.
