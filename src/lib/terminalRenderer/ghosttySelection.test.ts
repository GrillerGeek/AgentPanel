// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhosttySelection, selectionRectangles, viewportTop, type SelectionGeometry } from "./ghosttySelection";
import { normalizeGhosttyRange, type GraphemeBuffer } from "./ghosttyText";
function fixture() {
  const parent = document.createElement("div"); const canvas = document.createElement("canvas"); parent.append(canvas); document.body.append(parent);
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 110, bottom: 80, width: 100, height: 60 }) as DOMRect;
  parent.getBoundingClientRect = () => ({ left: 5, top: 10, width: 120, height: 80 }) as DOMRect;
  const geometry: SelectionGeometry = { cols: 10, rows: 3, history: 10, viewport: 0, width: 10, height: 20 };
  const row = () => Array.from({ length: geometry.cols }, () => ({ width: 1, codepoint: 65, grapheme_len: 0 }));
  const buffer: GraphemeBuffer = { getDimensions: () => geometry, getScrollbackLength: () => geometry.history, getLine: row, getScrollbackLine: row,
    getGraphemeString: () => "", getScrollbackGraphemeString: () => "" };
  let scrolled: (() => void) | undefined; const unsub = vi.fn(); let tracking = false;
  const focus = vi.fn(); const scroll = vi.fn((distance: number) => { geometry.viewport = distance; scrolled?.(); });
  const baselineMouseDown = vi.fn(); const baselineMouseUp = vi.fn(); const baselineDoubleClick = vi.fn();
  canvas.addEventListener("mousedown", baselineMouseDown); canvas.addEventListener("dblclick", baselineDoubleClick); document.addEventListener("mouseup", baselineMouseUp);
  const controller = new GhosttySelection(parent, { canvas, geometry: () => geometry, normalize: (range) => normalizeGhosttyRange(buffer, range),
    focus, isMouseTracking: () => tracking, scrollToDistance: scroll,
    scrollLines: (lines) => scroll(Math.max(0, Math.min(geometry.history, geometry.viewport - lines))),
    onScroll(listener) { scrolled = listener; return { dispose: unsub }; } });
  const event = (type: string, x: number, y: number, options: MouseEventInit = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...options });
    (type === "mousedown" || type === "dblclick" ? canvas : document).dispatchEvent(e); return e;
  };
  const dispose = () => { controller.dispose(); document.removeEventListener("mouseup", baselineMouseUp); parent.remove(); };
  return { parent, canvas, geometry, buffer, controller, event, focus, scroll, unsub, baselineMouseDown, baselineMouseUp, baselineDoubleClick, dispose, track: (value: boolean) => { tracking = value; } };
}
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
describe("owned Ghostty selection", () => {
  it("clips rectangles to visible rows and respects exclusive ends at row boundaries", () => {
    const geometry = { cols: 10, rows: 3, history: 10, viewport: 2.75, width: 8, height: 16 };
    expect(viewportTop(geometry)).toBe(8);
    const rectangles = selectionRectangles({ start: { x: 2, y: 6 }, end: { x: 0, y: 10 } }, geometry);
    expect(rectangles).toEqual([
      { x: 0, y: 0, width: 80, height: 16, row: 8, startCol: 0, endCol: 10 },
      { x: 0, y: 16, width: 80, height: 16, row: 9, startCol: 0, endCol: 10 },
    ]);
  });
  it("selects real one-cell/reversed ranges, no click range, and bounds endpoint-only work", () => {
    const s = fixture(); const rows = vi.spyOn(s.buffer, "getLine"); const history = vi.spyOn(s.buffer, "getScrollbackLine");
    expect(s.controller.select({ start: { x: 1, y: 10 }, end: { x: 0, y: 10 } }).status).toBe("supported");
    expect(s.controller.getRange()).toEqual({ start: { x: 0, y: 10 }, end: { x: 1, y: 10 } }); expect(s.controller.hasSelection()).toBe(true);
    expect(rows).toHaveBeenCalledTimes(2); expect(history).not.toHaveBeenCalled();
    expect(s.controller.diagnostics().rectangles).toMatchObject([{ width: 10, height: 20, row: 10 }]);
    s.controller.select({ start: { x: 1, y: 10 }, end: { x: 1, y: 10 } }); expect(s.controller.hasSelection()).toBe(false);
    expect(s.controller.select({ start: { x: 11, y: 10 }, end: { x: 1, y: 10 } }).status).toBe("unsupported");
    expect(s.controller.select({ start: { x: 0, y: -1 }, end: { x: 1, y: 10 } }).status).toBe("unsupported"); s.dispose();
  });
  it("snaps both endpoint continuations without reading all history", () => {
    const s = fixture(); const row = Array.from({ length: 10 }, () => ({ width: 1, codepoint: 65, grapheme_len: 0 })); row[0].width = 2; row[1].width = 0;
    s.buffer.getScrollbackLine = vi.fn(() => row);
    s.controller.select({ start: { x: 1, y: 0 }, end: { x: 1, y: 1 } });
    expect(s.controller.getRange()).toEqual({ start: { x: 0, y: 0 }, end: { x: 2, y: 1 } }); expect(s.buffer.getScrollbackLine).toHaveBeenCalledTimes(2); s.dispose();
  });
  it("reveals old scrollback using pinned distance-from-bottom semantics and tracks scroll/geometry", () => {
    const s = fixture(); s.controller.select({ start: { x: 2, y: 1 }, end: { x: 5, y: 1 } }, "search", true);
    expect(s.scroll).toHaveBeenLastCalledWith(9); expect(s.controller.diagnostics()).toMatchObject({ viewportTop: 1, rectangles: [{ row: 1, y: 0, width: 30 }] });
    s.geometry.width = 12; s.controller.refresh(); expect(s.controller.diagnostics().rectangles[0].width).toBe(36);
    s.scroll(10); expect(s.controller.diagnostics().rectangles[0].y).toBe(20);
    s.controller.setVisibility(false); expect(s.controller.diagnostics().rectangles).toEqual([]); expect(s.controller.hasSelection()).toBe(true);
    s.controller.setVisibility(true); expect(s.controller.diagnostics().rectangles).toHaveLength(1); s.dispose();
  });
  it("does not count clipped rectangles as presented inside an overflow-hidden pane", () => {
    const s = fixture(); s.parent.style.overflow = "hidden";
    Object.defineProperties(s.parent, { clientWidth: { value: 100 }, clientHeight: { value: 40 } });
    s.controller.select({ start: { x: 0, y: 12 }, end: { x: 1, y: 12 } }, "search", true);
    expect(s.controller.diagnostics().rectangles).toEqual([]);
    s.controller.select({ start: { x: 0, y: 10 }, end: { x: 1, y: 10 } }); expect(s.controller.diagnostics().rectangles).toHaveLength(1); s.dispose();
  });
  it("owns ordinary left drag without starting wrapper selection/autocopy and treats click as empty", () => {
    const s = fixture(); s.event("mousedown", 15, 25); s.event("mouseup", 15, 25);
    expect(s.controller.hasSelection()).toBe(false); expect(s.baselineMouseDown).not.toHaveBeenCalled(); expect(s.baselineMouseUp).not.toHaveBeenCalled();
    s.event("mousedown", 15, 25); s.event("mousemove", 45, 25); s.event("mouseup", 45, 25);
    expect(s.controller.getRange()).toEqual({ start: { x: 0, y: 10 }, end: { x: 3, y: 10 } }); expect(s.focus).toHaveBeenCalledTimes(2);
    s.event("dblclick", 15, 25); expect(s.baselineDoubleClick).not.toHaveBeenCalled(); s.dispose();
  });
  it("preserves right-click, modified links and mouse reports while Shift overrides tracking", () => {
    const s = fixture();
    s.event("mousedown", 15, 25, { button: 2 }); s.event("mousedown", 15, 25, { ctrlKey: true }); s.event("mousedown", 15, 25, { metaKey: true });
    s.track(true); s.event("mousedown", 15, 25); expect(s.baselineMouseDown).toHaveBeenCalledTimes(4);
    s.event("mousedown", 15, 25, { shiftKey: true }); s.event("mousemove", 35, 25); s.event("mouseup", 35, 25);
    expect(s.baselineMouseDown).toHaveBeenCalledTimes(4); expect(s.controller.hasSelection()).toBe(true); s.dispose();
  });
  it("keeps the earlier capture scrollbar and wheel handlers functional", () => {
    const parent = document.createElement("div"); const canvas = document.createElement("canvas"); parent.append(canvas); document.body.append(parent);
    const gutter = vi.fn((event: MouseEvent) => { if (event.clientX > 90) event.stopImmediatePropagation(); }); parent.addEventListener("mousedown", gutter, true);
    const baseline = vi.fn(); parent.addEventListener("wheel", baseline, true);
    const geometry = { cols: 10, rows: 3, history: 10, viewport: 0, width: 10, height: 20 };
    const focus = vi.fn(); const controller = new GhosttySelection(parent, { canvas, geometry: () => geometry, normalize: (range) => ({ status: "supported", value: range }), focus,
      isMouseTracking: () => false, scrollToDistance() {}, scrollLines() {}, onScroll: () => ({ dispose() {} }) });
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 95, button: 0 })); expect(focus).not.toHaveBeenCalled();
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 20 })); expect(baseline).toHaveBeenCalledOnce(); controller.dispose();
  });
  it("bounds edge autoscroll and removes document listeners/timers on release, blur, mutation and disposal", () => {
    vi.useFakeTimers(); const s = fixture(); const remove = vi.spyOn(document, "removeEventListener");
    s.event("mousedown", 15, 25); s.event("mousemove", 45, 5); vi.advanceTimersByTime(50); expect(s.scroll).toHaveBeenLastCalledWith(2);
    expect(s.controller.diagnostics().dragging).toBe(true); const before = s.scroll.mock.calls.length;
    window.dispatchEvent(new Event("blur")); vi.advanceTimersByTime(500); expect(s.scroll).toHaveBeenCalledTimes(before); expect(s.controller.diagnostics().dragging).toBe(false);
    s.event("mousedown", 15, 25); s.event("mousemove", 45, 5); s.controller.invalidate(); expect(s.controller.hasSelection()).toBe(false);
    vi.advanceTimersByTime(500); expect(s.scroll).toHaveBeenCalledTimes(before);
    s.event("mousedown", 15, 25); s.event("mousemove", 45, 5); s.dispose(); vi.advanceTimersByTime(500);
    expect(s.scroll).toHaveBeenCalledTimes(before); expect(s.unsub).toHaveBeenCalledOnce(); expect(s.parent.querySelector(".ghostty-owned-selection")).toBeNull();
    expect(remove).toHaveBeenCalledWith("mousemove", expect.any(Function), true); expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function), true); remove.mockRestore();
  });
  it("clearSearch semantics preserve later manual selection without storing duplicate text", () => {
    const s = fixture(); const range = { start: { x: 0, y: 10 }, end: { x: 2, y: 10 } };
    s.controller.select(range, "search"); s.controller.clear("search"); expect(s.controller.hasSelection()).toBe(false);
    s.controller.select(range, "manual"); s.controller.clear("search"); expect(s.controller.hasSelection()).toBe(true);
    expect(s.parent.querySelector(".ghostty-owned-selection")?.textContent).toBe(""); s.dispose();
  });
});
