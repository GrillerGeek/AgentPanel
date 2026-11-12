export interface QueueScheduler {
  schedule(task: () => void): unknown;
  cancel(handle: unknown): void;
  now(): number;
}
const taskScheduler: QueueScheduler = {
  schedule: (task) => setTimeout(task, 0),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};
interface Chunk { bytes: Uint8Array; offset: number; consumed?: () => void }
/** FIFO for a synchronous parser. Rendering/rAF never participates in credit. */
export class WriteQueue {
  private chunks: Chunk[] = [];
  private retained = 0;
  private scheduled: unknown;
  private hasTask = false;
  private failure?: Error;
  private waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  constructor(private parse: (bytes: Uint8Array) => void, private onError: (error: Error) => void,
    private scheduler = taskScheduler, private limits = { retained: 1024 * 1024, slice: 16 * 1024, turn: 64 * 1024, ms: 4 }) {}
  get retainedBytes() { return this.retained; }
  write(data: string | Uint8Array, consumed?: () => void) {
    if (this.failure) return;
    // A byte cap alone does not bound metadata for empty/tiny writes.
    if (this.chunks.length >= 4096 || data.length > this.limits.retained - this.retained) {
      this.fail(new Error("Terminal ingestion overflow (retained byte/entry limit)")); return;
    }
    const source = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (source.byteLength > this.limits.retained - this.retained) { this.fail(new Error("Terminal ingestion overflow (1 MiB retained limit)")); return; }
    // Own a bounded copy: caller views may retain a huge backing buffer or mutate.
    this.chunks.push({ bytes: source.slice(), offset: 0, consumed });
    this.retained += source.byteLength;
    this.schedule();
  }
  whenIdle(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.chunks.length) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  private schedule() {
    if (this.hasTask || this.failure) return;
    this.hasTask = true;
    this.scheduled = this.scheduler.schedule(() => { this.hasTask = false; this.run(); });
  }
  private run() {
    const start = this.scheduler.now(); let bytes = 0;
    try {
      while (this.chunks.length && !this.failure) {
        const chunk = this.chunks[0];
        const end = Math.min(chunk.offset + this.limits.slice, chunk.bytes.length);
        this.parse(chunk.bytes.subarray(chunk.offset, end));
        if (this.failure) return; // disposal can happen inside a parser callback
        bytes += end - chunk.offset; chunk.offset = end;
        if (end === chunk.bytes.length) {
          this.chunks.shift(); this.retained -= chunk.bytes.length;
          chunk.consumed?.();
        }
        if (bytes >= this.limits.turn || this.scheduler.now() - start >= this.limits.ms) break;
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return; }
    if (this.failure) return;
    if (this.chunks.length) this.schedule();
    else { const waiters = this.waiters.splice(0); for (const waiter of waiters) waiter.resolve(); }
  }
  private fail(error: Error, notify = true) {
    if (this.failure) return;
    this.failure = error;
    if (this.hasTask) this.scheduler.cancel(this.scheduled);
    this.hasTask = false; this.chunks = []; this.retained = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    if (notify) this.onError(error);
  }
  abort(error: Error) { this.fail(error); }
  dispose() { this.fail(new Error("Terminal renderer disposed"), false); }
}
