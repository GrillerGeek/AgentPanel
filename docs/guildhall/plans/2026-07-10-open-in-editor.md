---
quest: Implement the "Open in editor" tab-bar button per the approved spec (issue #16)
mode: feature
started: 2026-07-10T17:07:03-04:00
spec: docs/superpowers/specs/2026-07-10-open-in-editor-design.md
slug: open-in-editor
status: completed
model_check: "sonnet (ok)"
parent_model: "claude-fable-5"
---

# Plan

## Context

Spec is short and was approved by the user today; its decision summary (verbatim):

> - **Placement:** one icon button in the tab bar, immediately after the
>   `repo / branch` context chip. It opens the *active* worktree.
> - **Editor:** configurable via a new `editorCommand` setting, default `"code"`.
> - **Launch mechanism:** new Tauri command in Rust that spawns the editor CLI
>   detached. [...] `code` on Windows is `code.cmd`, which CreateProcess cannot
>   exec directly.

Cited codebase patterns (verified by Grep this session):
- Settings defaults: `DEFAULT_SETTINGS` + spread-merge `readSettings()` at `src/state/store.ts:33-53` — a new field with a default is automatically backfilled for existing users.
- Settings type: `src/types.ts` `Settings` interface.
- SettingsModal local-state + Save flow: `agents` field pattern at `src/components/SettingsModal.tsx:28,63-74,227-236`.
- Tab bar context chip: `src/components/TabBar.tsx:145-151`; button goes right after it.
- Toasts: `useStore.pushToast(message, "error")`.
- Rust no-console-flash spawn: `configure_no_window` at `src-tauri/src/git.rs:14-20` (cfg(windows) CREATE_NO_WINDOW); commands registered in `src-tauri/src/lib.rs:45+` `generate_handler!` list.
- Component tests: `src/components/TabBar.test.tsx` (jsdom, seeded store, `getByTitle`).

No CLAUDE.md exists at the repo root — no local-conventions block to inline.

Pre-dispatch decisions: Aldric NOT dispatched — the work matches existing patterns end to end; architecture was settled in the approved spec.

Quest constraint from the user: **do not commit** — leave the working tree for review. Rook drafts the PR text only; the Guildmaster's parent session handles commit/PR afterward.

## Dispatch sequence

### Sequential build
1. [ ] Seraphine Dawnveil — test-author (sonnet)
   - Input: spec excerpt, TabBar.test.tsx patterns
   - Expected: failing tests in `src/components/TabBar.test.tsx` (button renders with accessible name, click invokes `open_in_editor` with configured command + active worktree path, error toast on rejection) and a settings-default assertion (`editorCommand === "code"`).
2. [ ] Bruga Ironseam — feature-implementer (sonnet)
   - Input: spec excerpt, failing test paths, cited patterns
   - Expected: `src/types.ts`, `src/state/store.ts` (DEFAULT_SETTINGS), `src/components/SettingsModal.tsx` (field), `src/components/TabBar.tsx` (button + toast), `src-tauri/src/commands.rs` (`open_in_editor`), `src-tauri/src/lib.rs` (register). Green suite + `cargo check` passing.
3. [ ] Tink Whiffletree — refactorer (haiku) — CONDITIONAL; Mordain inspects the green diff first.

### Parallel reviews (after green)
- [ ] Oriana the Watcher — security-reviewer (opus)
  - Input: diff; Focus: command-injection surface of user-configurable `editorCommand` passed to `cmd /C`, path handling.
- [ ] Cassian Inkwell — docs-writer (sonnet)
  - Input: diff; Focus: README settings/feature mention if the README documents settings.
- [ ] Vance Quillmark — observability-reviewer (sonnet)
  - Input: diff; Focus: is the spawn-failure path surfaced (toast) and not silently swallowed?

### Closer
- [ ] Rook Mossbrook — pr-author (sonnet) — PR title/body to stdout only (no commit per quest constraint).

## Reviewers selected

Always-on:
- Oriana (`security-reviewer`) — fires
- Cassian (`docs-writer`) — fires

Gated:
- Vance (`observability-reviewer`) — fired — default-on for a feature-implementer chain; the new user-action path has an error branch worth checking.
- Thalia (`reliability-reviewer`) — skipped — no network I/O, queues, retries, or concurrency; a one-shot detached spawn.
- Cassia (`performance-reviewer`) — skipped — no DB, hot paths, or user-scale data; a single button click.
- Garran (`ops-readiness-reviewer`) — skipped — desktop app with no deploy infrastructure; ships in a versioned installer release, rollback = previous installer.
- Ysolde (`migration-safety-reviewer`) — skipped — no migrations, schema, or backfills.
- Vera (`ui-test-author`) — skipped — repo has no Playwright harness; UI behavior is covered by the jsdom component tests the spec mandates, plus live Tauri verification by the Guildmaster after the quest.
- Lior (`accessibility-reviewer`) — skipped — pairs with Vera (not fired); the one a11y-sensitive element (icon-only button) gets an accessible-name assertion in Seraphine's tests instead.

## Decisions made by Mordain
- Skipped Aldric — pattern-matching work; architecture settled in the approved spec.
- Folded the icon button's accessible-name requirement into Seraphine's test contract rather than firing Lior for one element.
- Rust spawn logic gets `cargo check` as its gate (no Rust unit test; spec explicitly assigns live verification to the Tauri shell, handled by the Guildmaster post-quest).
- Skipped Tink — the green diff was small, doc-commented, and pattern-faithful; nothing to extract or rename.
- HALTED at the review gate on Vance's high findings (+ Oriana's med, same root): the spec's `cmd /C` launch was injection-prone and silent-on-failure. Surfaced to the user; user approved deviating from the spec. Bruga's second pass replaced it with direct spawn + `.cmd` fallback and added `console.error` to the frontend catch; spec doc updated with the deviation note. All gates re-verified green (43/43, tsc, cargo check).

## Open items for the user
- Live Tauri-shell verification of the real spawn (esp. the Windows `.cmd` fallback) before merge — `npm run tauri dev`, click the ⟨/⟩ button.
- Follow-up issue candidate (Oriana): `safe_branch` in create_worktree doesn't strip cmd metacharacters (`&`, `^`, `%`) from branch names — pre-existing, out of this quest's scope.
- Standing gap (Vance): the Rust backend has no logging framework; failures rely on toasts and webview console only.
- Residual accepted risk: an editor CLI that spawns but fails post-launch remains invisible (fire-and-forget by design).
