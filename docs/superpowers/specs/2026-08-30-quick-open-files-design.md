# Quick Open (files) — Design

**Status:** ready to implement
**Author:** Jason Robey (with Claude)
**Date:** 2026-08-30

## Problem

`Ctrl+Shift+P` finds commands, worktrees, and themes. It cannot find a **file**.

When an agent says "I changed `src/state/store.ts`", the only ways to open it are to type the path in a terminal or leave the app. Orca's Quick Open is its #5 listed feature for a reason: in a tool whose whole job is reading what an agent did, finding a file by name is a constant need.

## Requirements

1. **R1** — A dedicated hotkey opens a file finder over the **active worktree**, listing every file git tracks plus untracked files that are not ignored.
2. **R2** — Typing fuzzy-filters by path; results are ranked, with the best match selected.
3. **R3** — Enter opens the selected file in the configured editor, reusing the existing `open_in_editor` command and `editorCommand` setting.
4. **R4** — Listing files must never block the UI thread, and must not stall typing on a large repo.
5. **R5** — Graceful degradation: a plain (non-git) folder, a repo with no commits, or a missing `git` yields a calm empty state — never a toast, never an error dialog.
6. **R6** — The existing command palette keeps working exactly as it does today.

## Decisions

### D1 — `git ls-files`, not ripgrep

Orca uses ripgrep. We should not.

`git` is already a **hard runtime requirement** of AgentPanel (the README states it; worktrees are impossible without it). `git ls-files --cached --others --exclude-standard` returns tracked files plus untracked-not-ignored files, honouring `.gitignore` for free.

Choosing ripgrep would add a second binary dependency, a detection path, a fallback path, and a class of "install ripgrep" support questions — to do a job the existing dependency already does.

Non-git folders return an empty list (R5), which is correct: a folder with no git has no meaningful project file set to offer.

### D2 — Active worktree only

Not all worktrees. Searching every worktree means N subprocesses, and the same path existing in five worktrees makes results ambiguous ("which `store.ts`?"). "Find a file in what I'm looking at" is the need 95% of the time.

Cross-worktree search can be added later without changing this design.

### D3 — One palette component, two modes

`Ctrl+P` opens **file mode**; `Ctrl+Shift+P` opens **command mode**. That is VS Code's muscle memory, and this app's users live in VS Code.

Both modes are the **same component**, sharing its input, keyboard handling, scroll-into-view, and row rendering. Only the data source and placeholder differ. A separate component would duplicate all of that and drift.

### D4 — Fetch on open, no cache

The file list is fetched when the palette opens in file mode, and discarded when it closes. No cache, no invalidation, no staleness bugs.

A palette open is a deliberate, infrequent user action; `git ls-files` on a large repo is tens to low hundreds of milliseconds. Caching would buy little and would need invalidating against the file-watcher event that fires constantly while an agent writes — exactly the kind of coupling that produced this session's stale-data bugs.

### D5 — `async` + `spawn_blocking`, and a result cap

Per R4, the Rust command is `pub async fn` wrapping `spawn_blocking`, matching `worktree_status` / `worktree_pr` / `worktree_diff`. A synchronous Tauri command runs on the main thread and freezes the window.

Two caps protect typing:
- The Rust side returns at most **20,000** paths (a monorepo beyond that would make per-keystroke scoring janky regardless).
- The UI renders at most **200** rows, since nobody scrolls further.

Both are silent-truncation risks, so both are stated in the UI when they bite.

### D6 — Enter opens in the editor

One action, no modifier ambiguity. It reuses `open_in_editor(command, path)` and the `editorCommand` setting, both already shipped and proven.

"Insert the path into the agent's terminal" is arguably as useful in this app and is the obvious second action — deliberately deferred so v1 has one unambiguous behaviour.

### D7 — Files stay out of the `commands` array

`CommandPalette` builds every command in one `useMemo` and runs `fuzzyScore` over the whole array on each keystroke. Adding thousands of paths there would both drown the real commands in command mode and make typing stall.

File results are separate state, scored separately, and only in file mode.

## Out of scope

- Searching file **contents** (that is a different feature and genuinely does want ripgrep).
- Cross-worktree search.
- Recently-opened ordering, or any persistence.
- Previewing a file in-app.
- Inserting a path into a terminal.
