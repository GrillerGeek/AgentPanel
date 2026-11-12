/** AgentPanel experimental metadata ABI v1. Independent of the 16-byte render ABI. */
export const METADATA_ABI = 1;
export type ColorTag = 0 | 1 | 2; // default, palette index, RGB
export type Wide = 0 | 1 | 2 | 3; // narrow, wide base, tail, wrap-edge head
export type MetadataCell = [text: string, wide: Wide, textPresent: 0 | 1,
  fgTag: ColorTag, fg: number, bgTag: ColorTag, bg: number, underlineTag: ColorTag, underline: number,
  flags: number, underlineVariant: number, uri: string | null, explicitId: string | null];
export type MetadataRow = [wrap: 0 | 1, continuation: 0 | 1, wide: string, present: string];
export type SnapshotRow = [wrap: 0 | 1, continuation: 0 | 1, cells: MetadataCell[]];
export interface MetadataHeader {
  abi: 1; screen: 0 | 1; active: 0 | 1; cols: number; height: number; history: number;
  cursor: [number, number, number]; activeCursor: [number, number, number];
}
export interface RowMetadata extends MetadataHeader { rows: MetadataRow[] }
export interface MetadataSnapshot extends MetadataHeader {
  colors: { foreground: number; background: number; cursor: number; palette: number[] };
  rows: SnapshotRow[];
}
export interface MetadataLimits { screen?: "active" | "primary"; maxBytes?: number; maxRows?: number; maxCells?: number; maxStringBytes?: number }
export interface MetadataExports {
  memory: WebAssembly.Memory;
  ghostty_metadata_version(): number;
  ghostty_metadata_render_cell_size(): number;
  ghostty_metadata_capture(handle: number, screen: number, detail: number, out: number, capacity: number, maxRows: number, maxCells: number, maxStrings: number): number;
  ghostty_wasm_alloc_u8_array(length: number): number;
  ghostty_wasm_free_u8_array(ptr: number, length: number): void;
}
export function assertMetadataAbi(exports: MetadataExports): void {
  if (typeof exports.ghostty_metadata_version !== "function" || exports.ghostty_metadata_version() !== METADATA_ABI ||
      typeof exports.ghostty_metadata_render_cell_size !== "function" || exports.ghostty_metadata_render_cell_size() !== 16 ||
      typeof exports.ghostty_metadata_capture !== "function") throw new Error("Ghostty history extension requires metadata ABI1 and the16-byte render ABI; wrong/missing WASM distribution");
}
const reasons: Record<number, string> = { [-1]: "invalid arguments", [-2]: "row/cell/hard limit", [-3]: "output byte limit", [-4]: "string/grapheme limit", [-5]: "metadata unavailable" };
export function captureMetadata(exports: MetadataExports, handle: number, styled: boolean, options: MetadataLimits = {}): MetadataSnapshot | RowMetadata {
  assertMetadataAbi(exports);
  if (options.screen !== undefined && options.screen !== "active" && options.screen !== "primary") throw new Error("Invalid metadata screen");
  const maxBytes = options.maxBytes ?? (styled ? 32 * 1024 * 1024 : 2 * 1024 * 1024);
  const maxRows = options.maxRows ?? 4096; const maxCells = options.maxCells ?? 524288; const maxStrings = options.maxStringBytes ?? 4 * 1024 * 1024;
  for (const [name, value, cap] of [["bytes", maxBytes, 64 * 1024 * 1024], ["rows", maxRows, 8192], ["cells", maxCells, 1024 * 1024], ["strings", maxStrings, 8 * 1024 * 1024]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > cap) throw new Error(`Invalid metadata ${name} limit`);
  }
  const ptr = exports.ghostty_wasm_alloc_u8_array(maxBytes);
  if (!ptr) throw new Error("Metadata allocation failed");
  try {
    const size = exports.ghostty_metadata_capture(handle, options.screen === "primary" ? 1 : 0, styled ? 1 : 0, ptr, maxBytes, maxRows, maxCells, maxStrings);
    if (size < 0) throw new Error(`Ghostty metadata capture failed: ${reasons[size] ?? size}`);
    if (size === 0 || size > maxBytes) throw new Error("Invalid metadata output length");
    // Construct AFTER allocation/export: WASM memory growth invalidates old views.
    // Copy before free so no returned data aliases the allocator's storage.
    const bytes = new Uint8Array(exports.memory.buffer, ptr, size).slice();
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as MetadataSnapshot | RowMetadata;
    if (value.abi !== METADATA_ABI || !Array.isArray(value.rows) || value.rows.length > maxRows || !Number.isInteger(value.cols) || value.cols <= 0 || value.rows.length * value.cols > maxCells || value.rows.length !== value.history + value.height) throw new Error("Invalid metadata schema/bounds");
    return value;
  } finally { exports.ghostty_wasm_free_u8_array(ptr, maxBytes); }
}
