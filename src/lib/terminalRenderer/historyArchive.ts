import type { Result } from "./types";
export const HISTORY_BYTE_LIMIT = 256 * 1024;
const reserved = "\x1b]777;AgentPanelHistory";
const st = "\x1b\\";
export interface Grid { cols: number; rows: number }
export type HistoryArchive = { kind: "legacy"; body: string } | { kind: "versioned"; body: string; grid: Grid };
export function historyHeader(cols: number, rows: number): string {
  if (![cols, rows].every((n) => Number.isInteger(n) && n > 0 && n <= 4096) || cols * rows > 1048576) throw new Error("Invalid saved history grid");
  return `${reserved};1;${cols};${rows}${st}`;
}
/** Interpret only explicit stored history at offset zero. Program writes never call this. */
export function parseHistoryArchive(data: string): Result<HistoryArchive> {
  const fail = (reason: string): Result<HistoryArchive> => ({ status: "unsupported", reason });
  if (data.length > HISTORY_BYTE_LIMIT || new TextEncoder().encode(data).length > HISTORY_BYTE_LIMIT) return fail("Stored history exceeds256KiB");
  const partial = data.startsWith("\x1b]777;") && reserved.startsWith(data);
  if (!data.startsWith(reserved) && !partial) return { status: "supported", value: { kind: "legacy", body: data } };
  const end = data.indexOf(st);
  if (end < 0 || end + st.length > 96) return fail("Incomplete or oversized saved history header");
  const match = /^\x1b\]777;AgentPanelHistory;1;([1-9][0-9]{0,3});([1-9][0-9]{0,3})\x1b\\$/.exec(data.slice(0, end + st.length));
  if (!match) return fail("Malformed or unsupported saved history header");
  const grid = { cols: Number(match[1]), rows: Number(match[2]) };
  try { historyHeader(grid.cols, grid.rows); } catch { return fail("Saved history dimensions exceed bounds"); }
  return { status: "supported", value: { kind: "versioned", grid, body: data.slice(end + st.length) } };
}
interface RestoreTarget {
  grid(): Grid; resize(cols: number, rows: number): void; fit(): void; canFit(): boolean;
  idle(): Promise<void>; write(data: string): Promise<void>; reset(): void;
}
/** Restore is a pre-transport operation, not a process/cursor/mode checkpoint.
 * Resize/fit requests during replay are deferred; the latest desired geometry wins. */
export class StyledHistoryRestorer {
  private restoring = false;
  private disposed = false;
  private desired?: Grid;
  private wantsFit = false;
  constructor(private target: RestoreTarget) {}
  resize(cols: number, rows: number) {
    if (this.disposed) return;
    if (this.restoring) { this.desired = { cols, rows }; this.wantsFit = false; }
    else this.target.resize(cols, rows);
  }
  fit() {
    if (this.disposed || !this.target.canFit()) return;
    if (this.restoring) this.wantsFit = true;
    else this.target.fit();
  }
  private applyDesired() {
    if (this.wantsFit && this.target.canFit()) this.target.fit();
    else if (this.desired) this.target.resize(this.desired.cols, this.desired.rows);
  }
  async restore(data: string): Promise<Result<void>> {
    const parsed = parseHistoryArchive(data);
    if (parsed.status !== "supported") return parsed;
    if (this.disposed || this.restoring) return { status: "unsupported", reason: this.disposed ? "Terminal renderer disposed" : "History restore already in progress" };
    this.restoring = true; this.desired = this.target.grid(); this.wantsFit = false;
    try {
      await this.target.idle();
      if (this.disposed) throw new Error("Terminal renderer disposed");
      if (parsed.value.kind === "versioned") {
        // Replace history from a known normal/reset state. ED2/ED3 alone do
        // not remove stale reflow/row metadata from an already-used core.
        this.target.reset(); this.target.resize(parsed.value.grid.cols, parsed.value.grid.rows);
      }
      await this.target.write(parsed.value.body);
      if (this.disposed) throw new Error("Terminal renderer disposed");
      this.applyDesired();
      return { status: "supported", value: undefined };
    } catch (error) {
      if (!this.disposed) {
        // Recovery is best effort. A partially parsed replay is not rolled back.
        try { this.target.reset(); } catch { /* surface the original restore failure */ }
        try { this.applyDesired(); } catch { /* caller blocks spawn/persistence */ }
      }
      return { status: "unsupported", reason: `History restore failed (partial replay may have been reset): ${String(error)}` };
    } finally { this.restoring = false; this.desired = undefined; this.wantsFit = false; }
  }
  dispose() { this.disposed = true; }
}
