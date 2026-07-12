# Session Notes Pane — Design

**Date:** 2026-07-11
**Issue:** [#13](https://github.com/GrillerGeek/AgentPanel/issues/13) — Notes/tasks attached to a session
**Status:** Approved

## Problem

A developer runs many sessions at once. The worktree/branch name alone isn't
enough to recall what each session is doing or what's left to do. They want an
editable pane of notes/tasks attached to a session that persists across app
restarts.

## Decision summary

- **Scope:** notes attach to the **worktree (session)**, not the individual
  tab. A worktree may have several tabs (shell, agent, split); they all share
  one notes doc, shown whenever that session is active. This matches "attached
  to a session" and how the rest of the store is keyed (`worktreeId`).
- **Placement:** a fixed-width (~300px) collapsible **right side panel**, to the
  right of the terminal area and below the tab bar. Toggled by a 📝 button in
  the tab bar (beside the gear). One **global** open/closed toggle — opening it
  shows the active session's notes and stays open as you move between sessions.
- **Storage:** **localStorage**, keyed by worktree id (= path, stable across
  restarts — `git.rs:54`). No Rust changes. Mirrors the existing
  `agentpanel.session` / `agentpanel.settings` persistence.
- **Editing model:** a single freeform **plain `<textarea>`** per session,
  autosaved. No parsing, no item model — the user types prose, bullets, or
  `- [ ] task` lines by hand.

Alternatives rejected: storing notes in a file in the worktree or in a central
app-data file (both add Rust surface and don't serve a clear need over
localStorage); component-local state bypassing the store (breaks the
single-store convention and complicates sharing open-state with the TabBar);
folding notes into the per-tab session snapshot (wrong granularity — per-tab,
not per-session).

## Components

### 1. Store (`src/state/store.ts`)

Additive state + actions, mirroring the existing persistence pattern:

```ts
notes: Record<string, string>;   // worktreeId (= path) -> note text
notesOpen: boolean;              // panel open/closed (global)
setNote: (worktreeId: string, text: string) => void;
toggleNotes: () => void;
```

- Init from `readNotes()` / `readNotesOpen()` helpers beside `readSettings()`,
  each try/caught returning `{}` / `false` on parse failure (same defensive
  style as `readSettings`, store.ts:47-54).
- `setNote` writes `notes[worktreeId] = text`. `toggleNotes` flips `notesOpen`.
- **Orphan pruning:** `removeRepository` and `deleteWorktree` drop `notes`
  entries for worktree ids that no longer exist. This is the only change to
  existing store actions; everything else is purely additive.

### 2. Persistence (`src/state/store.ts` subscribe blocks)

Two keys, following store.ts:588-612:

```ts
const NOTES_KEY = "agentpanel.notes";
const NOTES_OPEN_KEY = "agentpanel.notesOpen";
```

- A `subscribe` block snapshots `JSON.stringify(s.notes)`; on change it writes
  `NOTES_KEY`, **debounced ~300ms** so a burst of keystrokes collapses into one
  write. Write wrapped in try/catch with `console.error` (like the session
  persist).
- `notesOpen` writes to `NOTES_OPEN_KEY` immediately (a single boolean that
  changes rarely).

### 3. NotesPanel component (`src/components/NotesPanel.tsx`)

```tsx
export function NotesPanel() {
  const activeWorktreeId = useStore(selectActiveWorktreeId);   // store.ts:549
  const notesOpen = useStore((s) => s.notesOpen);
  const note = useStore((s) => (activeWorktreeId ? s.notes[activeWorktreeId] ?? "" : ""));
  const setNote = useStore((s) => s.setNote);

  if (!notesOpen || !activeWorktreeId) return null;
  return (
    <aside className="notes-panel">
      <textarea
        className="notes-textarea"
        value={note}
        placeholder="Notes & tasks for this session…"
        onChange={(e) => setNote(activeWorktreeId, e.target.value)}
        spellCheck={false}
      />
    </aside>
  );
}
```

- A "derived-view" component: no local state. It selects
  `(activeWorktreeId, notes[id])` and re-renders. All existing session-switch
  paths (tab click, session click, Ctrl+Shift+↑/↓, MRU) drive it for free.
- Returns `null` when closed or when there's no active worktree, so it never
  shows on the empty placeholder screen.

### 4. Layout (`src/App.tsx`)

In the `terminals.length > 0` branch (App.tsx:326-379), wrap the terminal stack
and the panel in a flex row so the panel sits right of the terminals and below
the full-width tab bar:

```tsx
<TabBar onOpenSettings={…} onToggleNotes={toggleNotes} notesOpen={notesOpen} />
<div className="content-row">        {/* flex row: terminals | notes */}
  <div className="terminal-stack"> … existing … </div>
  <NotesPanel />
</div>
```

### 5. Tab bar button (`src/components/TabBar.tsx`)

- 📝 icon button beside the existing gear, receiving `onToggleNotes` and
  `notesOpen` (for active-state styling) — same prop-callback pattern the gear
  uses.
- Tooltip: `Notes for this session`.

### 6. Styling (`src/App.css`)

- `.content-row`: flex row, fills the space under the tab bar.
- `.notes-panel`: fixed ~300px width, left border matching app chrome, column
  layout.
- `.notes-textarea`: fills the panel, transparent background, theme-inherited
  font/color, no resize handle.
- **Fixed width for v1** — no draggable divider yet (YAGNI; `PaneDivider` exists
  to copy later if wanted).

## Error handling

- **localStorage read** (corruption/quota): try/caught to defaults (`{}` /
  `false`) — notes never break boot.
- **localStorage write** failure: try/caught with `console.error`, like the
  session persist. A failed save never breaks the app.
- **No active worktree** (empty screen): panel renders `null`; the 📝 button is
  in the TabBar, which only renders when terminals exist — no orphaned toggle.
- **Deleted worktree:** its note is pruned by the store actions (above); any
  note that slips through is unused text keyed by a dead id, harmless.

## Testing

Matches existing `*.test.ts(x)` conventions (`tabLabels.test.ts`,
`activity.test.ts`, `TabBar.test.tsx`, `PaneErrorBoundary.test.tsx`).

- **Store unit tests:** `setNote` stores under the right key; switching the
  active tab surfaces the right note; `toggleNotes` flips state; deleting a
  worktree / removing a repository prunes its note.
- **Persistence test:** `setNote` → (after debounce) `agentpanel.notes` holds
  the JSON; `readNotes()` round-trips it; `notesOpen` persists immediately.
- **Component test (`NotesPanel.test.tsx`, jsdom):** renders the active
  session's note; typing calls `setNote`; returns null when closed or with no
  active worktree.
- **Live verification** (per repo practice — tsc/unit tests miss render
  crashes): load the dev server, toggle the panel, type, switch sessions to
  confirm notes follow the active session, and restart to confirm persistence.

## Out of scope

- Clickable/interactive checkboxes or any markdown rendering (plain text only).
- A structured task-item model (add/edit/delete/reorder rows).
- Resizable / draggable panel width.
- Per-session open/closed memory (the toggle is global).
- Storing notes in the repo or syncing them across machines.
