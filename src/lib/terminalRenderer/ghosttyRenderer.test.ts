// @vitest-environment jsdom
import { historyHeader } from "./historyArchive";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), terms: [] as any[] }));
vi.mock("../../../vendor/ghostty-history/dist/ghostty-history.js", () => ({ Ghostty: { load: mocks.load }, FitAddon: class { fit = vi.fn(); }, Terminal: class {
  options: any; cols = 5; rows = 4; viewportY = 0; activeSelection = true;
  canvas = document.createElement("canvas"); scrollListeners: Array<() => void> = [];
  render = vi.fn();
  renderer = { render: this.render, getCanvas: () => this.canvas, getMetrics: () => ({ width: 10, height: 20 }) };
  range: any = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }; key: any;
  wasmTerm = { hasMouseTracking: () => true, getDimensions: () => ({ cols: 5, rows: 4 }), getScrollbackLength: () => 1,
    getLine: () => [..."hello"].map((ch) => ({ codepoint: ch.charCodeAt(0), width: 1, grapheme_len: 0 })),
    getScrollbackLine: () => this.wasmTerm.getLine(), getGraphemeString: () => "", getScrollbackGraphemeString: () => "",
    captureSnapshot: () => ({ abi: 1, screen: 0, active: 0, cols: 5, height: 4, history: 1, cursor: [0, 0, 0], activeCursor: [0, 0, 0],
      colors: { foreground: 0xffffff, background: 0, cursor: 0xffffff, palette: Array(256).fill(0) },
      rows: Array.from({ length: 5 }, () => [0, 0, [..."hello"].map((ch) => [ch, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, null, null])]) }) };
  constructor(options: any) { this.options = options; mocks.terms.push(this); this.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 80, width: 50, height: 80 }) as DOMRect; }
  onScroll(listener: () => void) { this.scrollListeners.push(listener); return { dispose: vi.fn() }; }
  scrollToLine(distance: number) { this.viewportY = distance; for (const listener of this.scrollListeners) listener(); }
  scrollLines(lines: number) { this.scrollToLine(Math.max(0, Math.min(1, this.viewportY - lines))); }
  loadAddon = vi.fn(); open = vi.fn((parent: HTMLElement) => parent.append(this.canvas)); write = vi.fn(); dispose = vi.fn(); reset = vi.fn(); resize = vi.fn((cols: number, rows: number) => { this.cols = cols; this.rows = rows; }); focus = vi.fn(); paste = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() })); onTitleChange = vi.fn();
  attachCustomKeyEventHandler(handler: any) { this.key = handler; }
  getSelectionPosition() { return this.range; } hasSelection() { return this.activeSelection; } getViewportY() { return this.viewportY; } clearSelection = vi.fn();
} }));
let parent: HTMLElement;
beforeEach(() => { vi.resetModules(); mocks.load.mockReset().mockResolvedValue({}); mocks.terms.length = 0; document.body.replaceChildren(); parent = document.createElement("div"); document.body.append(parent); });
describe("isolated Ghostty adapter", () => {
  it("shares explicit-URL WASM loading and allows retry after rejection", async () => {
    const { loadGhostty } = await import("./ghosttyRenderer");
    mocks.load.mockRejectedValueOnce(new Error("WASM unavailable"));
    const first = loadGhostty(); expect(loadGhostty()).toBe(first); await expect(first).rejects.toThrow("unavailable");
    await loadGhostty(); expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.load.mock.calls[0][0]).toContain("ghostty-history.wasm");
  });
  it("normalizes clipboard keys, uses synchronous parse return and emits titles solely from original bytes", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent);
    const term = mocks.terms[0]; const titles: string[] = []; renderer.onTitleChange((title) => titles.push(title));
    const key = vi.fn(() => false); renderer.setKeyHandler(key); expect(term.key({})).toBe(true); key.mockReturnValue(true); expect(term.key({})).toBe(false);
    const ack = vi.fn(); const bytes = new TextEncoder().encode("\x1b]2;café\x07"); renderer.write(bytes, ack); await renderer.whenIdle();
    expect(ack).toHaveBeenCalledOnce(); expect(titles).toEqual(["café"]); expect(term.write).toHaveBeenCalledWith(bytes);
    expect(term.onTitleChange).not.toHaveBeenCalled(); expect(renderer.isMouseTracking()).toBe(true);
    renderer.paste("once"); expect(term.paste).toHaveBeenCalledExactlyOnceWith("once"); renderer.dispose();
  });
  it("presents search and captures a bounded primary styled history", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent);
    expect(renderer.search("hello")).toEqual({ status: "supported", found: true });
    expect(renderer.getSelection()).toEqual({ status: "supported", value: "hello" });
    expect(renderer.search("absent")).toEqual({ status: "supported", found: false });
    expect(renderer.serializeStyledHistory()).toMatchObject({ status: "supported", value: expect.stringContaining("hello") });
    expect(renderer.select({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }).status).toBe("supported"); renderer.dispose();
  });
  it("owns one-cell, edge, reversed and offscreen copy and invalidates before output/reset/grid changes", async () => {
    const { createGhosttyRenderer, getGhosttySelectionDiagnostics } = await import("./ghosttyRenderer");
    const renderer = await createGhosttyRenderer(parent);
    expect(renderer.getSelection()).toEqual({ status: "supported", value: "" });
    renderer.select({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    expect(renderer.hasSelection()).toBe(true); expect(renderer.getSelection()).toEqual({ status: "supported", value: "h" });
    expect(getGhosttySelectionDiagnostics(renderer)?.rectangles).toEqual([]); // retained offscreen range
    renderer.select({ start: { x: 5, y: 4 }, end: { x: 0, y: 4 } });
    expect(renderer.getSelection()).toEqual({ status: "supported", value: "hello" });
    expect(getGhosttySelectionDiagnostics(renderer)?.rectangles[0]).toMatchObject({ row: 4, startCol: 0, endCol: 5 });
    renderer.write("new output"); await renderer.whenIdle(); expect(renderer.hasSelection()).toBe(false);
    renderer.select({ start: { x: 0, y: 1 }, end: { x: 1, y: 1 } }); renderer.resize(5, 4); expect(renderer.hasSelection()).toBe(true);
    renderer.resize(6, 4); expect(renderer.hasSelection()).toBe(false);
    renderer.select({ start: { x: 0, y: 1 }, end: { x: 1, y: 1 } }); renderer.reset(); expect(renderer.hasSelection()).toBe(false); renderer.dispose();
  });
  it("clears stale search highlights without clearing later manual selections and refuses hidden presentation", async () => {
    const { createGhosttyRenderer, getGhosttySelectionDiagnostics } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent);
    renderer.search("hello"); expect(getGhosttySelectionDiagnostics(renderer)?.rectangles.length).toBeGreaterThan(0);
    renderer.clearSearch(); expect(renderer.hasSelection()).toBe(false);
    renderer.search("hello"); renderer.select({ start: { x: 0, y: 2 }, end: { x: 1, y: 2 } }); renderer.clearSearch(); expect(renderer.hasSelection()).toBe(true);
    renderer.search("missing"); expect(renderer.hasSelection()).toBe(true);
    renderer.setVisibility(false, false); expect(renderer.search("hello").status).toBe("unsupported"); expect(getGhosttySelectionDiagnostics(renderer)?.rectangles).toEqual([]);
    renderer.setVisibility(true, false); mocks.terms[0].canvas.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    expect(renderer.search("hello").status).toBe("unsupported"); renderer.dispose();
  });
  it("keeps ordinary no-selection output free of DOM geometry work", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent);
    const geometry = vi.spyOn(mocks.terms[0].canvas, "getBoundingClientRect");
    renderer.write(new Uint8Array(100_000)); await renderer.whenIdle(); expect(geometry).not.toHaveBeenCalled(); renderer.dispose();
  });
  it("raw program writes never interpret an embedded stored-history dimensions marker", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent); const native = mocks.terms[0];
    const marker = historyHeader(80, 40) + "program output"; renderer.write(marker); await renderer.whenIdle();
    expect([renderer.cols, renderer.rows]).toEqual([5, 4]); expect(native.resize).not.toHaveBeenCalled();
    expect(native.write).toHaveBeenCalledWith(new TextEncoder().encode(marker)); renderer.dispose();
  });
  it("forwards and freezes asynchronous Canvas errors through fatal ingestion/controller events", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent); const native = mocks.terms[0];
    const error = vi.fn(); const ack = vi.fn(); renderer.onError(error); renderer.write("queued", ack); const idle = renderer.whenIdle();
    native.render.mockImplementation(() => { throw new Error("Ghostty grapheme limit exceeded"); });
    expect(() => native.renderer.render({})).not.toThrow(); await expect(idle).rejects.toThrow("grapheme limit");
    native.renderer.render({}); expect(native.render).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce(); expect(ack).not.toHaveBeenCalled(); renderer.dispose();
  });
  it("stops on parser trap with no consumed callback and rejects disposal work", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent); const term = mocks.terms[0];
    const error = vi.fn(); const ack = vi.fn(); renderer.onError(error); term.write.mockImplementation(() => { throw new Error("WASM trap"); });
    renderer.write("bad", ack); await expect(renderer.whenIdle()).rejects.toThrow("WASM trap"); expect(error).toHaveBeenCalledOnce(); expect(ack).not.toHaveBeenCalled();
    renderer.dispose(); const another = await createGhosttyRenderer(parent); another.write("queued", ack); const idle = another.whenIdle(); another.dispose();
    await expect(idle).rejects.toThrow("disposed"); expect(ack).not.toHaveBeenCalled();
  });
});
