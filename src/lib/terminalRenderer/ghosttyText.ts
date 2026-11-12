import { unsupported, type CellPosition, type Result, type SearchMatch, type SelectionRange } from "./types.ts";
export interface TextCell { codepoint: number; width: number; grapheme_len: number }
export interface GraphemeBuffer {
  getRowMetadata?(): { cols: number; height: number; history: number; rows: ReadonlyArray<readonly [number, number, string, string]> };
  getDimensions(): { cols: number; rows: number };
  getScrollbackLength(): number;
  getLine(row: number): TextCell[] | null;
  getScrollbackLine(row: number): TextCell[] | null;
  getGraphemeString(row: number, col: number): string;
  getScrollbackGraphemeString(row: number, col: number): string;
}
export interface MappedLine { text: string; continuation?: boolean; authoritative?: boolean; cells: Array<{ start: number; end: number; x: number; width: number }> }
export interface MappedText { text: string; lines: MappedLine[]; starts: number[]; history: number; cols?: number }
/** Preserve full clusters and spaces; wide-cell continuations produce no extra space. */
export function readGhosttyText(buffer: GraphemeBuffer, maxCells = 2_000_000): Result<MappedText> {
  const { cols, rows } = buffer.getDimensions(); const history = buffer.getScrollbackLength();
  if (cols * (history + rows) > maxCells) return unsupported("Buffer exceeds bounded text extraction budget");
  let metadata: ReturnType<NonNullable<GraphemeBuffer["getRowMetadata"]>> | undefined;
  try { metadata = buffer.getRowMetadata?.(); } catch (error) { return unsupported(`Authoritative row metadata unavailable: ${String(error)}`); }
  if (metadata && (metadata.cols !== cols || metadata.height !== rows || metadata.history !== history || metadata.rows.length !== history + rows)) return unsupported("Row metadata does not match the active buffer");
  const lines: MappedLine[] = [];
  for (let y = 0; y < history + rows; y++) {
    const row = y < history ? buffer.getScrollbackLine(y) : buffer.getLine(y - history);
    if (!row) return unsupported("Public buffer line unavailable");
    const meta = metadata?.rows[y];
    if (meta && (meta[2].length !== cols || meta[3].length !== cols)) return unsupported("Invalid authoritative row width");
    let text = ""; let lastPresent = 0; const cells: MappedLine["cells"] = [];
    for (let x = 0; x < cols; x++) {
      const cell = row[x]; const wide = meta ? Number(meta[2][x]) : undefined;
      if (wide === 2 || wide === 3 || (!meta && cell?.width === 0)) continue;
      const width = wide === 1 ? 2 : cell?.width || 1;
      const value = cell?.grapheme_len ? (y < history ? buffer.getScrollbackGraphemeString(y, x) : buffer.getGraphemeString(y - history, x)) : String.fromCodePoint(cell?.codepoint || 32);
      if (!value) return unsupported("Public grapheme lookup unavailable");
      const start = text.length; text += value; cells.push({ start, end: text.length, x, width });
      if (!meta || meta[3][x] === "1") lastPresent = text.length;
    }
    // A continued physical row's unwritten gaps become interior logical spaces.
    // At a hard end, omit only unwritten padding, never real trailing spaces.
    if (meta && metadata?.rows[y + 1]?.[1] !== 1) text = text.slice(0, lastPresent);
    lines.push({ text, cells, continuation: meta?.[1] === 1, authoritative: !!meta });
  }
  const starts: number[] = []; let text = "";
  for (let y = 0; y < lines.length; y++) {
    if (y > 0 && !lines[y].continuation) text += "\n";
    starts.push(text.length); text += lines[y].text;
  }
  return { status: "supported", value: { text, lines, starts, history, cols } };
}
/** Normalize absolute EXCLUSIVE endpoints and snap intersected wide cells to full clusters.
 * Reads at most the two endpoint rows; suitable for pointer movement. */
export function normalizeGhosttyRange(buffer: GraphemeBuffer, range: SelectionRange): Result<SelectionRange> {
  const { cols, rows } = buffer.getDimensions(); const history = buffer.getScrollbackLength();
  return normalizeRange(range, cols, history + rows, (y) => y < history ? buffer.getScrollbackLine(y) : buffer.getLine(y - history));
}
function normalizeRange(range: SelectionRange, cols: number, lineCount: number,
  getLine: (y: number) => Array<{ width: number }> | null): Result<SelectionRange> {
  let start = { ...range.start }; let end = { ...range.end };
  if (start.y > end.y || (start.y === end.y && start.x > end.x)) [start, end] = [end, start];
  if (![start.x, start.y, end.x, end.y].every(Number.isInteger) || start.y < 0 || end.y >= lineCount || start.x < 0 || end.x < 0 || start.x > cols || end.x > cols) return unsupported("Selection coordinates outside retained buffer");
  if (start.y === end.y && start.x === end.x) return { status: "supported", value: { start, end } };
  for (const [point, exclusive] of [[start, false], [end, true]] as const) {
    const row = getLine(point.y); if (!row) return unsupported("Public endpoint row unavailable");
    // A continuation has width zero. Locate the preceding wide base cell.
    if (point.x < cols && row[point.x]?.width === 0) {
      let x = point.x; while (x > 0 && row[x]?.width === 0) x--;
      const width = row[x]?.width ?? 1;
      if (x + width > point.x) point.x = exclusive ? Math.min(cols, x + width) : x;
    }
  }
  return { status: "supported", value: { start, end } };
}
export function copyGhosttySelection(mapped: MappedText, range: SelectionRange): Result<string> {
  const cols = mapped.cols ?? mapped.lines[0]?.cells.reduce((n, cell) => Math.max(n, cell.x + cell.width), 0) ?? 0;
  const normalized = normalizeRange(range, cols, mapped.lines.length, (y) => {
    const row = Array.from({ length: cols }, () => ({ width: 0 }));
    for (const cell of mapped.lines[y]?.cells ?? []) row[cell.x] = { width: cell.width };
    return mapped.lines[y] ? row : null;
  });
  if (normalized.status !== "supported") return normalized;
  const { start, end } = normalized.value;
  if (start.x === end.x && start.y === end.y) return { status: "supported", value: "" };
  const result: string[] = [];
  for (let y = start.y; y <= end.y; y++) {
    const line = mapped.lines[y]; const from = y === start.y ? start.x : 0; const through = y === end.y ? end.x : cols;
    let text = line.cells.filter((cell) => cell.x + cell.width > from && cell.x < through).map((cell) => line.text.slice(cell.start, cell.end)).join("");
    // Terminal padding at a physical row end is not part of multi-line copy.
    // Explicit trailing spaces inside a partial last-row range remain intact.
    if (through === cols && !line.authoritative) text = text.replace(/ +$/, "");
    result.push(text);
    if (y < end.y && !mapped.lines[y + 1].continuation) result.push("\n");
  }
  return { status: "supported", value: result.join("") };
}
export function findGhosttyText(mapped: MappedText, query: string, offset: number, backwards: boolean): { match: SearchMatch | null; offset: number } {
  if (!query) return { match: null, offset: -1 };
  let index = backwards ? (offset === 0 ? -1 : mapped.text.lastIndexOf(query, offset < 0 ? mapped.text.length : offset - 1)) : mapped.text.indexOf(query, offset + 1);
  let wrapped = false;
  if (index < 0) { wrapped = true; index = backwards ? mapped.text.lastIndexOf(query) : mapped.text.indexOf(query); }
  if (index < 0) return { match: null, offset: -1 };
  const position = (at: number, end: boolean): CellPosition => {
    const order = Array.from({ length: mapped.lines.length }, (_, y) => y);
    if (end) order.reverse();
    for (const y of order) {
      const line = mapped.lines[y]; const local = at - mapped.starts[y];
      const cell = line.cells.find((c) => c.start < line.text.length && (end ? local > c.start && local <= Math.min(c.end, line.text.length) : local >= c.start && local < c.end));
      if (cell) return { y, x: cell.x + (end ? cell.width : 0) };
    }
    // A hard separator has no cell. Preserve its physical row boundary.
    for (let y = 0; y < mapped.lines.length; y++) {
      if (end && mapped.starts[y] === at) return { x: 0, y };
      if (mapped.starts[y] + mapped.lines[y].text.length === at) {
        const last = [...mapped.lines[y].cells].reverse().find((cell) => cell.start < mapped.lines[y].text.length);
        return { x: last ? last.x + last.width : 0, y };
      }
    }
    return { x: 0, y: 0 };
  };
  return { match: { start: position(index, false), end: position(index + query.length, true), wrapped }, offset: index };
}
