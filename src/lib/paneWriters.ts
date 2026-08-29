/**
 * Paste-capable writers for every live terminal pane, in a plain module-level
 * Map — NOT in the Zustand store — for the same reason `scrollbackRegistry.ts`
 * keeps its serializers out of the store: this must be reachable from
 * `store.ts` (which lives outside React), and a pane's writer is an imperative
 * handle onto a live xterm instance, not serializable UI state.
 *
 * This is a separate registry from `scrollbackRegistry.ts` on purpose: that one
 * lives for the lifetime of the pane and is read on a snapshot/flush cadence,
 * while this one exists purely so `sendReviewToAgent` can hand text to
 * `term.paste()` — a different lifetime, a different purpose, and mixing the
 * two would make either one harder to reason about.
 */
const writers = new Map<string, (text: string) => void>();

export function registerPaneWriter(paneId: string, write: (text: string) => void): void {
  writers.set(paneId, write);
}

export function unregisterPaneWriter(paneId: string): void {
  writers.delete(paneId);
}

/**
 * Paste `text` into the pane's terminal via its registered writer (`term.paste`),
 * so bracketed paste is honored exactly like a real clipboard paste — never a
 * raw `pty_write`, which would be interpreted as keystrokes (see terminalClipboard.ts).
 *
 * Returns `false` (rather than throwing) when there is no live writer for the
 * pane, or the writer itself throws (e.g. the terminal disposed mid-call), so
 * callers can fall back to a user-facing toast instead of an unhandled error.
 */
export function pasteToPane(paneId: string, text: string): boolean {
  const write = writers.get(paneId);
  if (!write) return false;
  try {
    write(text);
    return true;
  } catch {
    return false;
  }
}
