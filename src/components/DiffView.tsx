import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../state/store";
import { parseUnifiedDiff, type DiffHunk } from "../lib/diffParse";
import type { DiffComment } from "../types";

// Stable reference for "no comments yet": a fresh `[]` on every selector call
// would make zustand's useSyncExternalStore see a "changed" value on every
// render and re-render forever (no shallow-equal in zustand v5 by default).
const EMPTY_COMMENTS: DiffComment[] = [];

/**
 * One file's unified diff, with a comment affordance on every numbered line.
 *
 * Comments anchor to the **new-side** line number: that is the line that exists
 * in the agent's current file, so it is the one the agent can act on. Deleted
 * lines have no new-side number and are therefore not commentable — comment on
 * the surrounding context instead, or use the file-level comment.
 *
 * `worktreeId` and `path` are deliberately separate: `worktreeId` keys the
 * comment store (matching `notes`, `terminals`, etc. everywhere else in the
 * app), while `path` is the filesystem path handed to the Rust `worktree_*`
 * commands. They coincide for a real git worktree but not for a plain folder
 * (whose id is `"folder:" + path`) — passing the id where a path is expected
 * broke `worktree_file_patch` for that case.
 */
export function DiffView({
  worktreeId,
  path,
  file,
  refreshNonce,
}: {
  worktreeId: string;
  path: string;
  file: string;
  /** Bumped by DiffPanel on every worktrees-changed event, so an open diff
   *  re-fetches instead of going stale while the file list beneath it updates. */
  refreshNonce: number;
}) {
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  // `openLine` uses the sentinel "file" (rather than reusing `null`, which is
  // also a valid anchor) so a line-comment editor and the file-comment editor
  // can never both read as "open" at once.
  const [openLine, setOpenLine] = useState<number | "file" | null>(null);
  const [draft, setDraft] = useState("");
  const comments = useStore((s) => s.diffComments[worktreeId] ?? EMPTY_COMMENTS);
  const addDiffComment = useStore((s) => s.addDiffComment);
  const removeDiffComment = useStore((s) => s.removeDiffComment);

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("worktree_file_patch", { path, file })
      .then((patch) => {
        if (!cancelled) setHunks(parseUnifiedDiff(patch));
      })
      .catch(() => {
        if (!cancelled) setHunks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path, file, refreshNonce]);

  const fileComments = comments.filter((c) => c.file === file);
  const wholeFileComments = fileComments.filter((c) => c.line === null);

  const submit = (line: number | null, code: string) => {
    const body = draft.trim();
    if (!body) return;
    addDiffComment(worktreeId, { file, line, code, body });
    setDraft("");
    setOpenLine(null);
  };

  if (hunks === null) return <p className="diff-loading">Loading diff…</p>;
  if (hunks.length === 0) return <p className="diff-empty">Nothing to show for this file.</p>;

  return (
    <div className="diff-view">
      <div className="diff-file-comment">
        <button
          className="diff-file-comment-add"
          onClick={() => {
            setDraft("");
            setOpenLine(openLine === "file" ? null : "file");
          }}
        >
          Comment on this file
        </button>

        {wholeFileComments.map((c) => (
          <div className="diff-comment" key={c.id}>
            <span className="diff-comment-body">{c.body}</span>
            <button
              className="diff-comment-delete"
              aria-label="Delete comment"
              onClick={() => removeDiffComment(worktreeId, c.id)}
            >
              ✕
            </button>
          </div>
        ))}

        {openLine === "file" && (
          <div className="diff-comment-editor">
            <textarea
              autoFocus
              value={draft}
              placeholder="Comment on this file…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button onClick={() => submit(null, "")}>Add comment</button>
            <button onClick={() => setOpenLine(null)}>Cancel</button>
          </div>
        )}
      </div>

      {hunks.map((hunk, hi) => (
        <div className="diff-hunk" key={`${hunk.header}-${hi}`}>
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => {
            const anchored = line.newNo;
            const lineComments = fileComments.filter((c) => c.line === anchored && anchored !== null);
            return (
              <div key={`${hi}-${li}`}>
                <div
                  className={`diff-row diff-row-${line.kind}`}
                  data-testid={anchored === null ? undefined : `diff-line-${anchored}`}
                  onClick={() => {
                    if (anchored === null) return;
                    setDraft("");
                    setOpenLine(openLine === anchored ? null : anchored);
                  }}
                >
                  <span className="diff-lineno diff-lineno-old">{line.oldNo ?? ""}</span>
                  <span className="diff-lineno diff-lineno-new">{line.newNo ?? ""}</span>
                  <code className="diff-text">{line.text}</code>
                </div>

                {lineComments.map((c) => (
                  <div className="diff-comment" key={c.id}>
                    <span className="diff-comment-body">{c.body}</span>
                    <button
                      className="diff-comment-delete"
                      aria-label="Delete comment"
                      onClick={() => removeDiffComment(worktreeId, c.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {openLine !== null && openLine === anchored && (
                  <div className="diff-comment-editor">
                    <textarea
                      autoFocus
                      value={draft}
                      placeholder="Comment on this line…"
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button onClick={() => submit(anchored, line.text)}>Add comment</button>
                    <button onClick={() => setOpenLine(null)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
