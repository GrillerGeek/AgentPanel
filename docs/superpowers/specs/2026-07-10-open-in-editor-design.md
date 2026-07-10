# Open in Editor Button — Design

**Date:** 2026-07-10
**Issue:** [#16](https://github.com/GrillerGeek/AgentPanel/issues/16) — Add ability to quickly open the branch/worktree in VS Code
**Status:** Approved

## Problem

A developer reviewing changes in an AgentPanel session wants to open the active
worktree folder in their editor (VS Code) with one click, so they can review
code with their familiar dev tools.

## Decision summary

- **Placement:** one icon button in the tab bar, immediately after the
  `repo / branch` context chip. It opens the *active* worktree. No per-row
  buttons in the sidebar (kept out of scope deliberately).
- **Editor:** configurable via a new `editorCommand` setting, default `"code"`.
  Cursor / VS Code Insiders users change one settings field (`cursor`,
  `code-insiders`).
- **Launch mechanism:** new Tauri command in Rust that spawns the editor CLI
  detached. The opener plugin's `openPath(path, with)` was rejected: `with`
  expects an application, not a CLI shim, and `code` on Windows is `code.cmd`,
  which CreateProcess cannot exec directly.
  - **Deviation (review-driven, user-approved 2026-07-10):** the original
    design prescribed `cmd /C <command> <path>` on Windows. A post-implementation
    security + observability review found two problems with that approach and
    the user approved replacing it before ship: (1) *security* — Rust quotes
    arguments for `CommandLineToArgvW`, but `cmd.exe` parses metacharacters
    (`&`, `|`, etc.) differently, so a space-free path containing `&` (e.g.
    `...\main&calc`) could reach `cmd` unquoted and execute the suffix as a
    second command; hand-rolled `cmd /C` requires manual escaping that the
    original design didn't do. (2) *observability* — `cmd.exe` always spawns
    successfully even when `command` is a typo or missing CLI, so `open_in_editor`
    returned `Ok` with no editor opened and no toast shown. The fix (below)
    spawns `command` directly instead.

## Components

### 1. Settings (`src/types.ts`, `src/state/store.ts`, `src/components/SettingsModal.tsx`)

- Add `editorCommand: string` to the `Settings` type.
- Default `"code"` in `readSettings()` (same defaulting pattern as
  `agentCommands`).
- SettingsModal: text input near "Agent commands", label "Editor command",
  hint: `CLI command for "Open in editor" — e.g. code, cursor, code-insiders.`
  Saved with the existing Save flow (local state + `updateSettings` on save).

### 2. Rust command (`src-tauri/src/commands.rs`, registered in the invoke handler)

```rust
#[tauri::command]
pub fn open_in_editor(command: String, path: String) -> Result<(), String>
```

- Reject empty/whitespace `command` with an error string.
- Windows: spawn `<command> <path>` directly (no `cmd /C`), using the existing
  `no_window` pattern (see `git.rs` / `gh.rs`) so no console flashes. Direct
  spawn avoids `cmd.exe` metacharacter parsing entirely (no injection surface),
  and it makes a missing/typo'd editor CLI fail the spawn immediately — so the
  frontend's `.catch` fires and the user sees the error toast instead of
  silence. If the first spawn fails *and* `command`'s final path segment has no
  `.` extension, retry once with `<command>.cmd <path>` (same `no_window`
  setup) — Rust >= 1.77 spawns `.cmd`/`.bat` shims (like `code.cmd`) with safe,
  automatic argument escaping, so this still covers npm-style CLI shims
  without shelling out through `cmd.exe`. The final error uses the last
  attempt's error.
- macOS/Linux: spawn `<command> <path>` directly.
- `spawn()` and return immediately — never wait on the child. Map spawn errors
  to `Err(String)`.

### 3. Tab bar button (`src/components/TabBar.tsx`)

- Icon button right after the `.tabbar-context` chip; rendered whenever an
  active worktree exists.
- Tooltip: `Open in "<editorCommand>"`.
- Click: `invoke("open_in_editor", { command: editorCommand, path })` where
  `path` is the active worktree's `path`. On rejection, push an error toast:
  `Couldn't run "<editorCommand>" — is it on your PATH?`

## Error handling

- Editor CLI missing / spawn failure → error toast (message above). No retry,
  no blocking dialog.
- No active worktree (no terminals open) → the tab bar is not rendered, so the
  button cannot be clicked; no special handling needed.

## Testing

- **TabBar unit test (jsdom):** button renders when a session is active;
  clicking invokes `open_in_editor` with the configured command and the active
  worktree's path (`@tauri-apps/api/core` mocked with `vi.mock`).
- **Rust:** the command is a thin spawn wrapper; covered by live verification
  rather than unit tests.
- **Live verification:** browser pass for placement/tooltip/toast; real spawn
  verified in the Tauri shell (`npm run tauri dev`) by clicking the button and
  confirming VS Code opens the worktree folder.

## Out of scope

- Per-row "open in editor" buttons on sidebar worktree/session rows.
- Multi-editor pickers or per-repo editor overrides.
- "Open file at line" deep links.
