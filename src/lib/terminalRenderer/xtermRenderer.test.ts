import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ terms: [] as any[], fits: [] as any[], searches: [] as any[], gpus: [] as any[] }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24; options: any; callbacks: Array<() => void> = []; addons: any[] = []; key: any;
  modes = { mouseTrackingMode: "none" }; buffer = { active: { length: 1, getLine: () => ({ translateToString: () => "screen" }) } };
  constructor(options: any) { this.options = options; mocks.terms.push(this); }
  loadAddon(addon: any) { this.addons.push(addon); } open = vi.fn();
  write = vi.fn((_data, cb) => this.callbacks.push(cb));
  resize = vi.fn(); focus = vi.fn(); paste = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() })); onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
  attachCustomKeyEventHandler(handler: any) { this.key = handler; }
  getSelection = vi.fn(() => "selected"); hasSelection = vi.fn(() => true); clearSelection = vi.fn(); select = vi.fn(); reset = vi.fn();
  dispose = vi.fn(() => { for (const addon of this.addons) addon.dispose?.(); });
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); constructor() { mocks.fits.push(this); } } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class { findNext = vi.fn(() => true); findPrevious = vi.fn(() => false); clearDecorations = vi.fn(); constructor() { mocks.searches.push(this); } } }));
vi.mock("@xterm/addon-serialize", () => ({ SerializeAddon: class { serialize = vi.fn(() => "\x1b[31mstyled"); } }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { dispose = vi.fn(); constructor() { mocks.gpus.push(this); } } }));
import { createXtermRenderer } from "./xtermRenderer";
const parent = { clientWidth: 800, clientHeight: 400 } as HTMLElement;
beforeEach(() => { for (const list of Object.values(mocks)) list.length = 0; });
describe("production xterm adapter", () => {
  it("preserves raw writes/credits and idle completion; disposal cancels callbacks", async () => {
    const renderer = createXtermRenderer(parent); const term = mocks.terms[0]; const ack = vi.fn();
    const bytes = new Uint8Array([1, 2]); renderer.write(bytes, ack); const idle = renderer.whenIdle();
    expect(term.write).toHaveBeenCalledWith(bytes, expect.any(Function)); expect(ack).not.toHaveBeenCalled();
    term.callbacks.shift()(); await idle; expect(ack).toHaveBeenCalledTimes(1);
    renderer.write("pending", ack); const pending = renderer.whenIdle(); renderer.dispose();
    await expect(pending).rejects.toThrow("disposed"); term.callbacks.shift()(); expect(ack).toHaveBeenCalledTimes(1);
  });
  it("owns selection, search, styled serialization and normalized input hooks", () => {
    const renderer = createXtermRenderer(parent); const term = mocks.terms[0];
    const key = vi.fn(() => false); renderer.setKeyHandler(key); expect(term.key({})).toBe(false);
    renderer.paste("once"); expect(term.paste).toHaveBeenCalledExactlyOnceWith("once");
    expect(renderer.getSelection()).toEqual({ status: "supported", value: "selected" });
    expect(renderer.search("query")).toEqual({ status: "supported", found: true });
    expect(renderer.search("query", true)).toEqual({ status: "supported", found: false }); renderer.clearSearch();
    expect(mocks.searches[0].clearDecorations).toHaveBeenCalledOnce();
    expect(renderer.serializeStyledHistory()).toEqual({ status: "supported", value: "\x1b[31mstyled" });
    const title = vi.fn(); renderer.onTitleChange(title); expect(term.onTitleChange).toHaveBeenCalledWith(title);
    const input = vi.fn(); renderer.onData(input); expect(term.onData).toHaveBeenCalledWith(input);
    term.modes.mouseTrackingMode = "sgr"; expect(renderer.isMouseTracking()).toBe(true); renderer.dispose();
  });
  it("updates appearance and WebGL without recreating the terminal and never fits 0x0", () => {
    const host = { ...parent }; const renderer = createXtermRenderer(host); const term = mocks.terms[0];
    renderer.setAppearance({ fontSize: 18, fontFamily: "monospace", theme: { foreground: "#ffffff" } });
    expect(term.options.fontSize).toBe(18); expect(term.options.theme.foreground).toBe("#ffffff");
    renderer.setVisibility(true, true); renderer.setVisibility(true, true); expect(mocks.gpus).toHaveLength(1);
    renderer.setVisibility(false, true); expect(mocks.gpus[0].dispose).toHaveBeenCalledOnce();
    renderer.setVisibility(true, true); expect(mocks.gpus).toHaveLength(2);
    renderer.fit(); Object.assign(host, { clientWidth: 0 }); renderer.fit(); expect(mocks.fits[0].fit).toHaveBeenCalledOnce();
    renderer.dispose(); renderer.dispose(); expect(term.dispose).toHaveBeenCalledOnce(); expect(mocks.terms).toHaveLength(1);
  });
  it("reports parser failure and refuses further ingestion without acknowledging it", async () => {
    const renderer = createXtermRenderer(parent); const term = mocks.terms[0]; const error = vi.fn(); renderer.onError(error);
    term.write.mockImplementation(() => { throw new Error("parse failed"); }); const ack = vi.fn(); renderer.write("bad", ack); renderer.write("later", ack);
    await expect(renderer.whenIdle()).rejects.toThrow("parse failed"); expect(error).toHaveBeenCalledOnce(); expect(term.write).toHaveBeenCalledOnce(); expect(ack).not.toHaveBeenCalled(); renderer.dispose();
  });
});
