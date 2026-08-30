import type { DiffComment } from "../types";

/**
 * Turn a worktree's review comments into one prompt for the agent.
 *
 * Grouped by file so the agent can batch its edits per file rather than
 * re-opening the same file once per comment. Each anchored comment cites both
 * the line number and the source text: the number may be stale if the agent
 * has edited since, and the text is what makes the comment recoverable when it
 * is.
 *
 * No trailing newline — this is written straight into the agent's input box
 * (see the store's sendReviewToAgent), and a trailing newline there reads as a
 * blank line, or on some CLIs submits early.
 */
export function composeReviewPrompt(comments: DiffComment[]): string {
  if (comments.length === 0) return "";

  const byFile = new Map<string, DiffComment[]>();
  for (const comment of comments) {
    const list = byFile.get(comment.file) ?? [];
    list.push(comment);
    byFile.set(comment.file, list);
  }

  const plural = comments.length === 1 ? "" : "s";
  const parts: string[] = [
    `Please address the following ${comments.length} review comment${plural} on your changes.`,
    "",
  ];

  for (const [file, list] of byFile) {
    parts.push(`${file}:`);
    for (const comment of list) {
      if (comment.line === null) {
        parts.push("  (whole file)");
      } else {
        const code = comment.code.trim();
        // `code` is the diff line's text, which is legitimately empty when the
        // comment anchors to a blank line — don't emit a dangling colon.
        parts.push(code ? `  line ${comment.line}: ${code}` : `  line ${comment.line}`);
      }
      parts.push(`    -> ${comment.body.trim()}`);
    }
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}
