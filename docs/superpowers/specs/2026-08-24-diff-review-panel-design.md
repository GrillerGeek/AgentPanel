# Diff Review Panel — Design

**Status:** ready to implement
**Author:** Jason Robey (with Claude)
**Date:** 2026-08-24

## Problem

AgentPanel can start agents, isolate them in worktrees, and tell you when they
finish — but it cannot show you **what they did**. Today, reviewing an agent's
work means leaving the app: `git diff` in the terminal, or an editor window.

That is the gap between "launcher" and the "command center" the README claims.
Orca's equivalent (Annotate AI Diffs) closes the loop: read the diff, drop a
comment on a line, send every comment back to the agent as one prompt.

## Requirements

1. **R1** — Show the files an agent changed in the active worktree, with
   per-file added/removed counts and a status (added / modified / deleted /
   untracked).
2. **R2** — The diff must cover **both committed and uncommitted** work. Agents
   commit mid-task; a working-tree-only diff would show nothing after a commit.
3. **R3** — Selecting a file shows its unified diff with line numbers.
4. **R4** — The user can attach a comment to any line of the diff, and to a file
   as a whole.
5. **R5** — Comments survive app restart, are scoped per worktree, and are
   pruned when their worktree or repository is removed (matching how
   `notes` already behave).
6. **R6** — One action composes every comment into a single prompt and delivers
   it to the agent running in the active tab.
7. **R7** — The panel refreshes when the worktree changes on disk, reusing the
   existing `worktrees-changed` watcher event rather than polling.
8. **R8** — A worktree with no changes, a non-git folder, or a repo with no
   commits must render a calm empty state — never an error toast.

## Decisions

### D1 — Diff base is the merge-base with the default branch

Per R2. The diff is computed as `git diff <merge-base>` with **no** second
revision, which compares that commit against the current **working tree** — so
one command covers commits *and* uncommitted edits.

Base resolution order:
1. `git symbolic-ref --short refs/remotes/origin/HEAD` → e.g. `origin/main`
2. First of `origin/main`, `origin/master`, `main`, `master` that
   `git rev-parse --verify` accepts
3. Fall back to `HEAD` — the diff degrades to uncommitted changes only

Then `git merge-base HEAD <base>`. If merge-base fails (unrelated histories,
a fresh repo with no commits), fall back to `HEAD`. **Never error** — R8.

### D2 — Rename detection off

`git diff --no-renames`. Rename detection makes `--numstat` emit paths in a
`{old => new}` brace form that needs its own parser, and makes `--name-status`
emit a third tab-separated column. Turning it off costs a rename showing as a
delete plus an add — honest, and it removes a whole class of parsing bug.

### D3 — Untracked files are synthesized, not skipped

An agent's brand-new file is exactly the thing you most want to read, and `git
diff` will not show it. Untracked files are discovered with
`git ls-files --others --exclude-standard`; their line counts and their patch
are synthesized in Rust as an all-added hunk. Binary detection is a NUL byte
within the first 8000 bytes.

### D4 — Two commands, not one

`diff_files` (the list) is cheap and refreshes on every watcher event.
`diff_file_patch` (one file's patch) is expensive and runs only on selection.
Bundling them would re-read every patch on every file save.

### D5 — Comments live in the frontend store, like notes

`diffComments` is a `Record<worktreeId, DiffComment[]>` persisted to
`localStorage` under `agentpanel.diffComments`, using the same debounced-write
plus hidden/unload-flush pattern as `notes`. No new Rust persistence.

A comment stores the **source line text** alongside the line number. If the
agent edits the file before you send, the anchor may be stale but the comment
still shows what it was about.

### D6 — Sending inserts text; it does not press Enter

`sendReviewToAgent` writes the composed prompt into the active pane's PTY via
the existing `pty_write` command with **no trailing `\r`**. The user reads it in
the agent's own input box and presses Enter themselves.

Auto-submitting would fire a large, irreversible prompt at an agent that may be
mid-task or awaiting a different question. The one keystroke is worth it.

### D7 — The prompt format is a deliberate, separate decision

How review comments are phrased determines whether the agent fixes the right
thing. That wording is a domain judgement, not a mechanical transform, so
`composeReviewPrompt()` is isolated in its own pure module with its own tests
(Task 6) rather than being buried in a component.

### D8 — The panel reuses the notes-panel slot

`App.tsx`'s `content-row` already hosts `<NotesPanel />` on the right. The diff
panel is a sibling with the same toggle pattern (a `TabBar` button plus a
command-palette entry). Only one of notes/diff is open at a time — opening one
closes the other — so the terminal never loses more than one panel's width.

## Out of scope

- Editing files in the panel. Read and comment only.
- Staging, committing, or reverting hunks.
- Side-by-side (split) diff view. Unified only.
- Syntax highlighting. Add/delete/context colouring only, from the existing
  theme CSS variables.
- Diffing against an arbitrary revision the user types. The base is derived.
