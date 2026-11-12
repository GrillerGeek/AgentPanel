import type { MetadataCell, MetadataSnapshot } from "../../../vendor/ghostty-history/dist/ghostty-history.js";
import { HISTORY_BYTE_LIMIT, historyHeader } from "./historyArchive.ts";
export { HISTORY_BYTE_LIMIT } from "./historyArchive.ts";
export interface HistoryDiagnostics {
  sourceRows: number; logicalRecords: number; retainedRecords: number; droppedRecords: number;
  incompletePrefixRows: number; trailingPaddingRows: number; bytes: number; maxBytes: number;
}
export type HistoryCapture = { status: "supported"; value: string; diagnostics: HistoryDiagnostics } |
  { status: "oversized" | "incomplete" | "error"; reason: string; diagnostics: HistoryDiagnostics };
const encode = new TextEncoder();
const neutral = "\x1b]8;;\x1b\\\x1b[0m";
const end = neutral;
const hex = (value: number) => value.toString(16).padStart(6, "0");
const rgb = (value: number) => `${hex(value).slice(0, 2)}/${hex(value).slice(2, 4)}/${hex(value).slice(4, 6)}`;
function colors(snapshot: MetadataSnapshot) {
  let prelude = "\x1b[?1049l\x1b[?7h\x1b[?2027h" + neutral + "\x1b[H\x1b[2J\x1b[3J";
  for (const [index, value] of snapshot.colors.palette.entries()) prelude += `\x1b]4;${index};rgb:${rgb(value)}\x1b\\`;
  prelude += `\x1b]10;rgb:${rgb(snapshot.colors.foreground)}\x1b\\\x1b]11;rgb:${rgb(snapshot.colors.background)}\x1b\\\x1b]12;rgb:${rgb(snapshot.colors.cursor)}\x1b\\`;
  return prelude;
}
export function cellHasMeaning(cell: MetadataCell) {
  return cell[2] === 1 || cell[3] !== 0 || cell[5] !== 0 || cell[7] !== 0 || cell[9] !== 0 || cell[10] !== 0 || cell[11] !== null;
}
const colorSgr = (prefix: number, tag: number, value: number) => tag === 0 ? `${prefix + 1}` : tag === 1 ? `${prefix};5;${value}` : `${prefix};2;${value >> 16 & 255};${value >> 8 & 255};${value & 255}`;
function style(cell: MetadataCell) {
  const codes = ["0"];
  for (const [bit, code] of [[1, 1], [2, 2], [4, 3], [8, 5], [16, 7], [32, 8], [64, 9], [128, 53]]) if (cell[9] & bit) codes.push(String(code));
  if (cell[10]) codes.push(`4:${cell[10]}`);
  codes.push(colorSgr(38, cell[3], cell[4]), colorSgr(48, cell[5], cell[6]), colorSgr(58, cell[7], cell[8]));
  return `\x1b[${codes.join(";")}m`;
}
function safeText(value: string, label: string) {
  if (/[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error(`${label} contains a non-replayable control character`);
  return value;
}
function link(cell: MetadataCell) {
  if (cell[11] === null) return "";
  const uri = safeText(cell[11], "Hyperlink URI"); const id = cell[12] === null ? "" : safeText(cell[12], "Hyperlink ID");
  if (/[;:]/.test(id)) throw new Error("Hyperlink ID cannot be represented by a canonical OSC8 parameter");
  return `\x1b]8;${id ? `id=${id}` : ""};${uri}\x1b\\`;
}
interface LogicalRecord { cells: MetadataCell[]; rows: number; meaningful: boolean }
/** Complete retained logical records. Only default/unwritten padding at hard row ends
 * is omitted. Explicit spaces, every style/color tag and links remain meaningful. */
export function historyRecords(snapshot: MetadataSnapshot): { records: LogicalRecord[]; incompletePrefixRows: number; trailingPaddingRows: number } {
  let first = 0;
  if (snapshot.rows[0]?.[1]) { first = 1; while (first < snapshot.rows.length && snapshot.rows[first][1]) first++; }
  const records: LogicalRecord[] = []; let cells: MetadataCell[] = []; let rowCount = 0; let meaningful = false;
  for (let y = first; y < snapshot.rows.length; y++) {
    const row = snapshot.rows[y]; const continued = snapshot.rows[y + 1]?.[1] === 1;
    let last = row[2].length;
    if (!continued) while (last > 0 && (row[2][last - 1][1] === 2 || row[2][last - 1][1] === 3 || !cellHasMeaning(row[2][last - 1]))) last--;
    for (const cell of row[2].slice(0, last)) if (cell[1] !== 2 && cell[1] !== 3) { cells.push(cell); meaningful ||= cellHasMeaning(cell); }
    rowCount++;
    if (!continued) { records.push({ cells, rows: rowCount, meaningful }); cells = []; rowCount = 0; meaningful = false; }
  }
  let trailingPaddingRows = 0;
  while (records.length && !records.at(-1)!.meaningful) trailingPaddingRows += records.pop()!.rows;
  return { records, incompletePrefixRows: first, trailingPaddingRows };
}
function recordAnsi(record: LogicalRecord, columns: number, limit: number): string | null {
  let output = neutral; let bytes = encode.encode(output).length; let currentStyle = ""; let currentLink = ""; let column = 0; let pendingWrap = false;
  for (const [index, cell] of record.cells.entries()) {
    const nextStyle = style(cell); const nextLink = link(cell); let part = "";
    if (currentLink !== nextLink) { part += "\x1b]8;;\x1b\\" + nextLink; currentLink = nextLink; }
    if (currentStyle !== nextStyle) { part += nextStyle; currentStyle = nextStyle; }
    if (cell[2] === 0) {
      // ECH preserves authoritative no-text/background-only cells. Printing SP
      // would change hasText and logical trailing-space copy after replay.
      if (pendingWrap || (column === columns - 1 && index + 1 < record.cells.length) || cell[3] !== 0 || cell[7] !== 0 || cell[9] !== 0 || cell[10] !== 0 || cell[11] !== null) throw new Error("Unwritten cell cannot be replayed without changing logical text/rendition");
      part += "\x1b[1X\x1b[1C"; column = Math.min(columns - 1, column + 1);
    } else {
      const width = cell[1] === 1 ? 2 : 1;
      if (pendingWrap || column + width > columns) { column = 0; pendingWrap = false; }
      part += safeText(cell[0], "Cell text");
      if (column + width === columns) { column = columns - 1; pendingWrap = true; } else column += width;
    }
    const length = encode.encode(part).length;
    if (bytes + length + encode.encode(neutral).length > limit) return null;
    output += part; bytes += length;
  }
  return output + neutral;
}
export function serializeGhosttyHistory(snapshot: MetadataSnapshot, maxBytes = HISTORY_BYTE_LIMIT): HistoryCapture {
  const diagnostics: HistoryDiagnostics = { sourceRows: snapshot.rows.length, logicalRecords: 0, retainedRecords: 0, droppedRecords: 0, incompletePrefixRows: 0, trailingPaddingRows: 0, bytes: 0, maxBytes };
  try {
    if (snapshot.abi !== 1 || snapshot.screen !== 0) throw new Error("History requires a primary ABI1 snapshot");
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > HISTORY_BYTE_LIMIT) throw new Error("Invalid history byte limit");
    const { records, incompletePrefixRows, trailingPaddingRows } = historyRecords(snapshot);
    Object.assign(diagnostics, { logicalRecords: records.length, incompletePrefixRows, trailingPaddingRows });
    if (!records.length) return incompletePrefixRows ? { status: "incomplete", reason: "No complete logical record remains after native prefix eviction", diagnostics } : { status: "supported", value: "", diagnostics };
    const prelude = historyHeader(snapshot.cols, snapshot.height) + colors(snapshot); const fixedBytes = encode.encode(prelude + end).length;
    // Scan from newest toward oldest. Never materialize an unbounded full archive.
    const retained: string[] = []; let bytes = fixedBytes;
    for (let i = records.length - 1; i >= 0; i--) {
      const value = recordAnsi(records[i], snapshot.cols, maxBytes - bytes - (retained.length ? 2 : 0));
      const length = value === null ? Infinity : encode.encode(value).length + (retained.length ? 2 : 0);
      if (value === null || bytes + length > maxBytes) {
        if (!retained.length) return { status: "oversized", reason: "Newest meaningful logical record cannot fit the history byte limit", diagnostics };
        break;
      }
      retained.push(value); bytes += length;
    }
    retained.reverse(); diagnostics.retainedRecords = retained.length; diagnostics.droppedRecords = records.length - retained.length; diagnostics.bytes = bytes;
    return { status: "supported", value: prelude + retained.join("\r\n") + end, diagnostics };
  } catch (error) { return { status: "error", reason: error instanceof Error ? error.message : String(error), diagnostics }; }
}
/** Semantic oracle: normalize only trailing entirely default/unwritten viewport
 * rows. Do not flatten color tags, links, text presence, styles or wide classes. */
export function normalizedHistorySnapshot(snapshot: MetadataSnapshot) {
  let last = snapshot.rows.length;
  while (last > 0 && snapshot.rows[last - 1][1] === 0 && snapshot.rows[last - 1][2].every((cell) => !cellHasMeaning(cell))) last--;
  return { cols: snapshot.cols, colors: snapshot.colors, rows: snapshot.rows.slice(0, last) };
}

/** Bounded first-difference evidence for explicit fixture review; never a history dump. */
export function firstHistoryDifference(expected: ReturnType<typeof normalizedHistorySnapshot>, actual: ReturnType<typeof normalizedHistorySnapshot>) {
  const difference = (field: string, before: unknown, after: unknown) => ({ field, expected: JSON.parse(JSON.stringify(before, (_key, value) => typeof value === "string" ? value.slice(0, 160) : value)), actual: JSON.parse(JSON.stringify(after, (_key, value) => typeof value === "string" ? value.slice(0, 160) : value)) });
  if (expected.cols !== actual.cols) return difference("cols", expected.cols, actual.cols);
  for (const field of ["foreground", "background", "cursor"] as const) if (expected.colors[field] !== actual.colors[field]) return difference(`colors.${field}`, expected.colors[field], actual.colors[field]);
  for (let i = 0; i < 256; i++) if (expected.colors.palette[i] !== actual.colors.palette[i]) return difference(`palette.${i}`, expected.colors.palette[i], actual.colors.palette[i]);
  if (expected.rows.length !== actual.rows.length) return difference("rowCount", expected.rows.length, actual.rows.length);
  for (let y = 0; y < expected.rows.length; y++) {
    if (expected.rows[y][0] !== actual.rows[y][0] || expected.rows[y][1] !== actual.rows[y][1]) return difference(`row.${y}.wrap`, expected.rows[y].slice(0, 2), actual.rows[y].slice(0, 2));
    for (let x = 0; x < expected.cols; x++) if (JSON.stringify(expected.rows[y][2][x]) !== JSON.stringify(actual.rows[y][2][x])) return difference(`row.${y}.cell.${x}`, expected.rows[y][2][x], actual.rows[y][2][x]);
  }
  return null;
}
