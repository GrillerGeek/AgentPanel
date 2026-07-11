import { useStore, selectActiveWorktreeId } from "../state/store";

/**
 * Right-side notes pane (issue #13). Shows a single freeform textarea bound to
 * the active worktree's note. Holds no local state — it selects the active
 * worktree and its note from the store, so every session-switch path (tab
 * click, session click, keyboard nav, MRU) drives it for free. Renders nothing
 * when closed or when no worktree is active.
 */
export function NotesPanel() {
  const activeWorktreeId = useStore(selectActiveWorktreeId);
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
        spellCheck={false}
        onChange={(e) => setNote(activeWorktreeId, e.target.value)}
      />
    </aside>
  );
}
