import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), terms: [] as any[] }));
vi.mock("ghostty-web", () => ({ Ghostty: { load: mocks.load }, FitAddon: class { fit = vi.fn(); }, Terminal: class {
  options: any; cols = 5; rows = 4; viewportY = 0; activeSelection = true;
  range: any = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }; key: any;
  wasmTerm = { hasMouseTracking: () => true, getDimensions: () => ({ cols: 5, rows: 4 }), getScrollbackLength: () => 1,
    getLine: () => [..."hello"].map((ch) => ({ codepoint: ch.charCodeAt(0), width: 1, grapheme_len: 0 })),
    getScrollbackLine: () => this.wasmTerm.getLine(), getGraphemeString: () => "", getScrollbackGraphemeString: () => "" };
  constructor(options: any) { this.options = options; mocks.terms.push(this); }
  loadAddon = vi.fn(); open = vi.fn(); write = vi.fn(); dispose = vi.fn(); reset = vi.fn(); resize = vi.fn(); focus = vi.fn(); paste = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() })); onTitleChange = vi.fn();
  attachCustomKeyEventHandler(handler: any) { this.key = handler; }
  getSelectionPosition() { return this.range; } hasSelection() { return this.activeSelection; } getViewportY() { return this.viewportY; } clearSelection = vi.fn();
} }));
const parent = { clientWidth: 800, clientHeight: 400 } as HTMLElement;
beforeEach(() => { vi.resetModules(); mocks.load.mockReset().mockResolvedValue({}); mocks.terms.length = 0; });
describe("isolated Ghostty adapter", () => {
  it("shares explicit-URL WASM loading and allows retry after rejection", async () => {
    const { loadGhostty } = await import("./ghosttyRenderer");
    mocks.load.mockRejectedValueOnce(new Error("WASM unavailable"));
    const first = loadGhostty(); expect(loadGhostty()).toBe(first); await expect(first).rejects.toThrow("unavailable");
    await loadGhostty(); expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.load.mock.calls[0][0]).toContain("ghostty-vt.wasm");
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
  it("reports search limitations and unsupported styled history instead of empty/plaintext fallback", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent);
    expect(renderer.search("hello")).toMatchObject({ status: "limited", match: { start: { x: 0, y: 0 } } });
    expect(renderer.search("absent")).toMatchObject({ status: "limited", match: null });
    expect(renderer.serializeStyledHistory()).toMatchObject({ status: "unsupported", reason: expect.stringContaining("styled history") });
    expect(renderer.select({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }).status).toBe("unsupported"); renderer.dispose();
  });
  it("copies only unambiguous interior active selections and refuses clipped/fractional/click endpoints", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent); const term = mocks.terms[0];
    expect(renderer.getSelection()).toEqual({ status: "supported", value: "el" });
    term.range.start.y = 0; expect(renderer.getSelection().status).toBe("unsupported"); term.range.start.y = 1;
    term.viewportY = 0.5; expect(renderer.getSelection().status).toBe("unsupported"); term.viewportY = 0;
    term.activeSelection = false; expect(renderer.hasSelection()).toBe(false); expect(renderer.getSelection().status).toBe("unsupported"); renderer.dispose();
  });
  it("stops on parser trap with no consumed callback and rejects disposal work", async () => {
    const { createGhosttyRenderer } = await import("./ghosttyRenderer"); const renderer = await createGhosttyRenderer(parent); const term = mocks.terms[0];
    const error = vi.fn(); const ack = vi.fn(); renderer.onError(error); term.write.mockImplementation(() => { throw new Error("WASM trap"); });
    renderer.write("bad", ack); await expect(renderer.whenIdle()).rejects.toThrow("WASM trap"); expect(error).toHaveBeenCalledOnce(); expect(ack).not.toHaveBeenCalled();
    renderer.dispose(); const another = await createGhosttyRenderer(parent); another.write("queued", ack); const idle = another.whenIdle(); another.dispose();
    await expect(idle).rejects.toThrow("disposed"); expect(ack).not.toHaveBeenCalled();
  });
});
