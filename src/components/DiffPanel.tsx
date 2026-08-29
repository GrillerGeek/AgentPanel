import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore, selectActiveWorktreeId } from "../state/store";
import type { DiffFile } from "../types";
import { DiffView } from "./DiffView";

/** Short marker shown before a file's path. */
const STATUS_MARK: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  untracked: "?",
};

/**
 * Right-side review panel: the list of files an agent changed in the active
 * worktree, plus the selected file's diff.
 *
 * Mirrors NotesPanel's shape — it selects the active worktree from the store,
 * so every session-switch path drives it for free, and renders nothing when
 * closed or when no worktree is active.
 *
 * Every failure path lands on the same empty state rather than a toast: an
 * unreadable diff is a normal condition (plain folder, no commits yet), and the
 * panel refreshes on every file-watcher event, so a toast here would spam.
 */
export function DiffPanel() {
  const diffOpen = useStore((s) => s.diffOpen);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const selectedDiffFile = useStore((s) => s.selectedDiffFile);
  const setSelectedDiffFile = useStore((s) => s.setSelectedDiffFile);
  const commentCount = useStore(
    (s) => (activeWorktreeId ? s.diffComments[activeWorktreeId]?.length ?? 0 : 0),
  );
  const sendReviewToAgent = useStore((s) => s.sendReviewToAgent);
  const clearDiffComments = useStore((s) => s.clearDiffComments);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!activeWorktreeId) return;
    // Overlapping refreshes are normal here: the panel re-fetches on every
    // worktrees-changed event AND on worktree switch. Ignore any response that
    // is no longer the newest request, or a slow older call can land last and
    // show the wrong worktree's files.
    const seq = ++reqRef.current;
    try {
      const next = await invoke<DiffFile[]>("worktree_diff", { path: activeWorktreeId });
      if (seq === reqRef.current) setFiles(next);
    } catch {
      if (seq === reqRef.current) setFiles([]); // spec R8 — never toast
    }
  }, [activeWorktreeId]);

  useEffect(() => {
    if (!diffOpen) return;
    void refresh();
  }, [diffOpen, refresh]);

  // Reuse the existing worktree file watcher (spec R7) rather than polling.
  useEffect(() => {
    if (!diffOpen) return;
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    let disposed = false;
    void listen("worktrees-changed", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [diffOpen, refresh]);

  if (!diffOpen || !activeWorktreeId) return null;

  return (
    <aside className="diff-panel">
      <header className="diff-panel-head">
        <span className="diff-panel-title">Review</span>
        <div className="diff-panel-actions">
          <button
            className="diff-send"
            disabled={commentCount === 0}
            title="Insert every comment into the active agent's terminal"
            onClick={() => void sendReviewToAgent(activeWorktreeId)}
          >
            Send {commentCount || ""} to agent
          </button>
          <button
            className="diff-clear"
            disabled={commentCount === 0}
            title="Delete every comment for this worktree"
            onClick={() => clearDiffComments(activeWorktreeId)}
          >
            Clear
          </button>
        </div>
      </header>

      {files.length === 0 ? (
        <p className="diff-empty">No changes in this worktree.</p>
      ) : (
        <ul className="diff-file-list">
          {files.map((f) => (
            <li key={f.path}>
              <button
                className={`diff-file${f.path === selectedDiffFile ? " selected" : ""}`}
                onClick={() => setSelectedDiffFile(f.path === selectedDiffFile ? null : f.path)}
                title={f.path}
              >
                <span className={`diff-status diff-status-${f.status}`}>
                  {STATUS_MARK[f.status] ?? "M"}
                </span>
                <span className="diff-file-path">{f.path}</span>
                {f.binary ? (
                  <span className="diff-binary">bin</span>
                ) : (
                  <>
                    <span className="diff-added">+{f.added}</span>
                    <span className="diff-removed">-{f.removed}</span>
                  </>
                )}
              </button>
              {f.path === selectedDiffFile && (
                <DiffView worktreeId={activeWorktreeId} file={f.path} />
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
