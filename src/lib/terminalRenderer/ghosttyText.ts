import { unsupported, type CellPosition, type Result, type SearchMatch } from "./types";
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
export function copyGhosttySelection(mapped: MappedText, range: { start: CellPosition; end: CellPosition }): Result<string> {
  // ghostty 0.4.0 public getSelectionPosition() endpoints are inclusive, absolute.
  let { start, end } = range;
  if (start.y > end.y || (start.y === end.y && start.x > end.x)) [start, end] = [end, start];
  if (![start.x, start.y, end.x, end.y].every(Number.isInteger) || start.y < 0 || end.y >= mapped.lines.length || start.x < 0 || end.x < 0) return unsupported("Selection coordinates unavailable or outside retained buffer");
  const result: string[] = [];
  for (let y = start.y; y <= end.y; y++) {
    const line = mapped.lines[y]; const from = y === start.y ? start.x : 0; const through = y === end.y ? end.x : Infinity;
    const cells = line.cells.filter((cell) => cell.x + cell.width > from && cell.x <= through);
    result.push(cells.map((cell) => line.text.slice(cell.start, cell.end)).join(""));
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
