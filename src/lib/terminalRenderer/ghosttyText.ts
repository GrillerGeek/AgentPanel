import { unsupported, type CellPosition, type Result, type SearchMatch, type SelectionRange } from "./types";
export interface TextCell { codepoint: number; width: number; grapheme_len: number }
export interface GraphemeBuffer {
  getDimensions(): { cols: number; rows: number };
  getScrollbackLength(): number;
  getLine(row: number): TextCell[] | null;
  getScrollbackLine(row: number): TextCell[] | null;
  getGraphemeString(row: number, col: number): string;
  getScrollbackGraphemeString(row: number, col: number): string;
}
export interface MappedLine { text: string; cells: Array<{ start: number; end: number; x: number; width: number }> }
export interface MappedText { text: string; lines: MappedLine[]; starts: number[]; history: number }
/** Preserve full clusters and spaces; wide-cell continuations produce no extra space. */
export function readGhosttyText(buffer: GraphemeBuffer, maxCells = 2_000_000): Result<MappedText> {
  const { cols, rows } = buffer.getDimensions(); const history = buffer.getScrollbackLength();
  if (cols * (history + rows) > maxCells) return unsupported("Buffer exceeds bounded text extraction budget");
  const lines: MappedLine[] = []; const starts: number[] = []; let offset = 0;
  for (let y = 0; y < history + rows; y++) {
    const row = y < history ? buffer.getScrollbackLine(y) : buffer.getLine(y - history);
    if (!row) return unsupported("Public buffer line unavailable");
    let text = ""; const cells: MappedLine["cells"] = [];
    for (let x = 0; x < cols; x++) {
      const cell = row[x];
      if (cell?.width === 0) continue;
      const width = cell?.width || 1;
      const value = cell?.grapheme_len ? (y < history ? buffer.getScrollbackGraphemeString(y, x) : buffer.getGraphemeString(y - history, x)) : String.fromCodePoint(cell?.codepoint || 32);
      if (!value) return unsupported("Public grapheme lookup unavailable");
      const start = text.length; text += value; cells.push({ start, end: text.length, x, width });
    }
    starts.push(offset); offset += text.length + 1; lines.push({ text, cells });
  }
  return { status: "supported", value: { text: lines.map((line) => line.text).join("\n"), lines, starts, history } };
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
  const cols = mapped.lines[0]?.cells.reduce((n, cell) => Math.max(n, cell.x + cell.width), 0) ?? 0;
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
    if (through === cols) text = text.replace(/ +$/, "");
    result.push(text);
  }
  return { status: "supported", value: result.join("\n") };
}
export function findGhosttyText(mapped: MappedText, query: string, offset: number, backwards: boolean): { match: SearchMatch | null; offset: number } {
  if (!query) return { match: null, offset: -1 };
  let index = backwards ? (offset === 0 ? -1 : mapped.text.lastIndexOf(query, offset < 0 ? mapped.text.length : offset - 1)) : mapped.text.indexOf(query, offset + 1);
  let wrapped = false;
  if (index < 0) { wrapped = true; index = backwards ? mapped.text.lastIndexOf(query) : mapped.text.indexOf(query); }
  if (index < 0) return { match: null, offset: -1 };
  const position = (at: number, end: boolean): CellPosition => {
    let y = mapped.starts.length - 1;
    while (y > 0 && mapped.starts[y] > at) y--;
    const local = at - mapped.starts[y]; const line = mapped.lines[y];
    const cell = line.cells.find((c) => end ? local > c.start && local <= c.end : local >= c.start && local < c.end);
    return { y, x: cell ? cell.x + (end ? cell.width : 0) : line.cells.reduce((n, c) => Math.max(n, c.x + c.width), 0) };
  };
  return { match: { start: position(index, false), end: position(index + query.length, true), wrapped }, offset: index };
}
