// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ create: vi.fn(), frames: vi.fn(), window: vi.fn() }));
vi.mock("./engine", () => ({ createEngine: fake.create, frames: fake.frames, writeWindow: fake.window }));
import { benchmark } from "./probes";

beforeEach(() => { vi.useFakeTimers(); fake.create.mockReset(); fake.frames.mockReset().mockResolvedValue(undefined); fake.window.mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });
const surface = () => ({ kind: "xterm", renderer: "test", term: { reset: vi.fn(), cols: 80, rows: 24 },
  write: vi.fn().mockResolvedValue(undefined), text: () => "11999 build output", dispose: vi.fn() });

it("records exact case/stage and window state when creation stalls; disposes a late surface", async () => {
  let complete!: (value: ReturnType<typeof surface>) => void;
  fake.create.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const progress = vi.fn(); const host = document.createElement("div");
  const resultPromise = benchmark(host, progress);
  await vi.advanceTimersByTimeAsync(10000);
  const result = await resultPromise;
  expect(result.results).toEqual([expect.objectContaining({ kind: "xterm", round: 0, consumption: "library-callback",
    stage: "create", timedOut: true, visibilityState: document.visibilityState, hasFocus: document.hasFocus(), error: expect.stringContaining("deadline: create") })]);
  expect(progress).toHaveBeenCalledExactlyOnceWith({ kind: "xterm", round: 0, consumption: "library-callback", stage: "create" });
  const late = surface(); complete(late); await Promise.resolve(); await Promise.resolve();
  expect(late.dispose).toHaveBeenCalledOnce(); expect(host.children).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});

it.each(["warmup", "write", "frames"])("reports a stalled %s as failure without advancing to another case", async (stall) => {
  const engine = surface(); fake.create.mockResolvedValue(engine);
  const never = () => new Promise<void>(() => {});
  if (stall === "warmup") engine.write.mockImplementation(never);
  if (stall === "write") fake.window.mockImplementation(never);
  if (stall === "frames") fake.frames.mockImplementation(never);
  const stages: string[] = []; const host = document.createElement("div");
  const resultPromise = benchmark(host, (sample) => { stages.push(sample.stage); });
  await vi.advanceTimersByTimeAsync(10000);
  const result = await resultPromise;
  expect(result.results).toEqual([expect.objectContaining({ stage: stall === "warmup" ? "warmup" : "write and render", timedOut: true })]);
  expect(stages).toEqual(stall === "warmup" ? ["create", "warmup"] : ["create", "warmup", "write and render"]);
  expect(engine.dispose).toHaveBeenCalledOnce(); expect(fake.create).toHaveBeenCalledOnce();
  expect(host.children).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});

it("retains all twelve successful raw cases and actual callback/frame completion", async () => {
  fake.create.mockImplementation(async () => surface());
  const progress = vi.fn(); const result = await benchmark(document.createElement("div"), progress);
  expect(result.results).toHaveLength(12); expect(result.results.every((row) => !!(row as { retainedLastLine?: boolean }).retainedLastLine)).toBe(true);
  expect(progress).toHaveBeenCalledTimes(36); expect(fake.frames).toHaveBeenCalledTimes(12); expect(fake.window).toHaveBeenCalledTimes(12);
  expect(vi.getTimerCount()).toBe(0);
});
