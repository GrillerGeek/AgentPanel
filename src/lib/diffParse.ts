/** What a diff line represents. `meta` is git's "\ No newline at end of file". */
export type DiffLineKind = "context" | "add" | "del" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** the line's content, with the leading +/-/space marker removed */
  text: string;
  /** 1-based line number on the old side, or null for an added line */
  oldNo: number | null;
  /** 1-based line number on the new side, or null for a deleted line */
  newNo: number | null;
}

export interface DiffHunk {
  /** the raw `@@ ... @@` line, shown as the hunk's caption */
  header: string;
  lines: DiffLine[];
}

// `@@ -old[,count] +new[,count] @@ optional trailing context`
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff into hunks with per-side line numbers.
 *
 * File headers (`diff --git`, `index`, `---`, `+++`) are skipped: they appear
 * before the first hunk, and anything unrecognized *after* a hunk ends it — so
 * a multi-file patch degrades safely instead of mis-numbering.
 *
 * Comments anchor to `newNo`, which is why the new side must stay exact. A
 * blank context line is a single space in a real patch, not an empty string,
 * so it is counted like any other context line.
 */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split(/\r?\n/)) {
    const m = HUNK.exec(raw);
    if (m) {
      cur = { header: raw, lines: [] };
      hunks.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!cur) continue; // still in the file header

    if (raw.startsWith("+")) {
      cur.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith("\\")) {
      cur.lines.push({ kind: "meta", text: raw.slice(1).trim(), oldNo: null, newNo: null });
    } else if (raw.startsWith(" ")) {
      cur.lines.push({ kind: "context", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (raw !== "") {
      // Anything else (e.g. the next file's `diff --git`) ends this hunk.
      cur = null;
    }
  }

  return hunks;
}
