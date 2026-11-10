import { describe, expect, it, vi } from "vitest";
import { WriteQueue, type QueueScheduler } from "./writeQueue";
function setup(parse = vi.fn()) {
  let now = 0; let id = 0;
  const tasks = new Map<number, () => void>();
  const scheduler: QueueScheduler = { now: () => now, schedule: (task) => { tasks.set(++id, task); return id; }, cancel: (handle) => { tasks.delete(handle as number); } };
  const error = vi.fn(); const queue = new WriteQueue(parse, error, scheduler);
  const turn = () => { const next = tasks.entries().next().value!; tasks.delete(next[0]); next[1](); };
  return { queue, parse, error, tasks, turn, tick: (ms: number) => { now += ms; } };
}
describe("bounded synchronous parser queue", () => {
  it("owns input, splits at 16KiB, yields after 64KiB and acknowledges original chunks exactly once in order", async () => {
    const s = setup(); const ack: number[] = [];
    const bytes = new Uint8Array(100_000).fill(65);
    s.queue.write(bytes, () => ack.push(1)); bytes.fill(66);
    s.queue.write("tail", () => ack.push(2));
    const idle = s.queue.whenIdle();
    s.turn(); expect(ack).toEqual([]); expect(s.parse).toHaveBeenCalledTimes(4); expect(s.tasks.size).toBe(1);
    expect(s.parse.mock.calls[0][0][0]).toBe(65);
    s.turn(); await idle; expect(ack).toEqual([1, 2]); expect(s.queue.retainedBytes).toBe(0);
    expect(s.parse.mock.calls.every(([part]) => part.length <= 16384)).toBe(true);
  });
  it("yields on slow parsing even before byte budget without animation frames", async () => {
    const s = setup(); s.parse.mockImplementation(() => s.tick(5));
    s.queue.write(new Uint8Array(32768)); s.turn(); expect(s.parse).toHaveBeenCalledTimes(1);
    expect(s.tasks.size).toBe(1); s.turn(); await s.queue.whenIdle();
  });
  it("accepts exactly 1MiB retained, rejects overflow without acknowledging or truncating", async () => {
    const s = setup(); const ack = vi.fn(); s.queue.write(new Uint8Array(1048576), ack);
    const idle = s.queue.whenIdle(); s.queue.write("x", ack);
    await expect(idle).rejects.toThrow("overflow"); await expect(s.queue.whenIdle()).rejects.toThrow("overflow");
    expect(s.tasks.size).toBe(0); expect(s.queue.retainedBytes).toBe(0); expect(ack).not.toHaveBeenCalled(); expect(s.error).toHaveBeenCalledTimes(1);
  });
  it("stops after parser failure, rejects idle, releases queued bytes, and never acknowledges unparsed data", async () => {
    const s = setup(vi.fn(() => { throw new Error("WASM trap"); })); const ack = vi.fn();
    s.queue.write("one", ack); s.queue.write("two", ack); const idle = s.queue.whenIdle(); s.turn();
    await expect(idle).rejects.toThrow("WASM trap"); expect(ack).not.toHaveBeenCalled(); expect(s.error).toHaveBeenCalledTimes(1);
    s.queue.write("three", ack); expect(s.tasks.size).toBe(0); expect(s.queue.retainedBytes).toBe(0);
  });
  it("disposal cancels tasks, callbacks, idle and repeated disposal", async () => {
    const s = setup(); const ack = vi.fn(); s.queue.write("one", ack); const idle = s.queue.whenIdle(); s.queue.dispose(); s.queue.dispose();
    await expect(idle).rejects.toThrow("disposed"); expect(s.tasks.size).toBe(0); expect(s.error).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
  });
  it("handles empty chunks and reentrant writes in FIFO order", async () => {
    const s = setup(); const ack: number[] = []; s.queue.write("", () => { ack.push(1); s.queue.write("last", () => ack.push(3)); }); s.queue.write("second", () => ack.push(2));
    s.turn(); await s.queue.whenIdle(); expect(ack).toEqual([1, 2, 3]);
  });
});
it("bounds metadata for empty writes and rejects huge strings before encoding", async () => {
  const s = setup(); for (let i = 0; i < 4096; i++) s.queue.write("");
  expect(s.tasks.size).toBe(1); s.queue.write(""); await expect(s.queue.whenIdle()).rejects.toThrow("overflow"); expect(s.tasks.size).toBe(0);
  const other = setup(); other.queue.write("x".repeat(1048577)); await expect(other.queue.whenIdle()).rejects.toThrow("overflow"); expect(other.parse).not.toHaveBeenCalled();
});
