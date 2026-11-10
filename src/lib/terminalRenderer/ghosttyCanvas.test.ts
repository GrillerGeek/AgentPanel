import { describe, expect, it, vi } from "vitest";
import type { CanvasRenderer, IRenderable } from "ghostty-web";
import { decorateGhosttyCanvas, type CanvasGraphemeSource } from "./ghosttyCanvas";
function fixture() {
  let alternate = false; let cols = 20; let history = 10;
  const source: CanvasGraphemeSource = {
    getLine: vi.fn(function(this: unknown, row) { expect(this).toBe(source); return [{ codepoint: row }] as never; }),
    getCursor: vi.fn(function(this: unknown) { expect(this).toBe(source); return { x: 2, y: 3, visible: true }; }),
    getDimensions: vi.fn(function(this: unknown) { expect(this).toBe(source); return { cols, rows: 5 }; }),
    isRowDirty: vi.fn(function(this: unknown) { expect(this).toBe(source); return true; }),
    needsFullRedraw: vi.fn(function(this: unknown) { expect(this).toBe(source); return false; }),
    clearDirty: vi.fn(function(this: unknown) { expect(this).toBe(source); }),
    getGraphemeString: vi.fn(function(this: unknown, row, col) { expect(this).toBe(source); return `active:${row}:${col}:👩🏽‍💻`; }),
    getScrollbackGraphemeString: vi.fn(function(this: unknown, row, col) { expect(this).toBe(source); return `history:${row}:${col}:é`; }),
    isAlternateScreen: () => alternate,
  };
  const provider = { getScrollbackLength: vi.fn(() => history), getScrollbackLine: vi.fn(() => null) };
  let drawn!: IRenderable; let options: unknown[] = [];
  const original = vi.fn((buffer: IRenderable, ...rest: unknown[]) => { drawn = buffer; options = rest; });
  const renderer = { render: original as CanvasRenderer["render"] };
  const patch = decorateGhosttyCanvas(renderer, () => source);
  return { source, provider, renderer, original, patch, drawn: () => drawn, options: () => options,
    alt: (value: boolean) => { alternate = value; }, resize: () => { cols = 30; history = 15; } };
}
describe("public Canvas viewport grapheme facade", () => {
  it("maps mixed history and active viewport rows and keeps original public receivers", () => {
    const f = fixture(); f.renderer.render(f.source, false, 2, f.provider, 0.5); const drawn = f.drawn();
    expect(drawn.getGraphemeString?.(0, 7)).toBe("history:8:7:é"); expect(drawn.getGraphemeString?.(1, 7)).toBe("history:9:7:é");
    expect(drawn.getGraphemeString?.(2, 7)).toBe("active:0:7:👩🏽‍💻"); expect(drawn.getGraphemeString?.(4, 7)).toBe("active:2:7:👩🏽‍💻");
    drawn.getLine(0); drawn.getCursor(); drawn.getDimensions(); drawn.isRowDirty(0); drawn.needsFullRedraw?.(); drawn.clearDirty();
    expect(f.provider.getScrollbackLength).toHaveBeenCalledOnce();
    expect(f.options()).toEqual([true, 2, f.provider, 0.5]); expect(f.source.getGraphemeString).not.toBe(drawn.getGraphemeString); f.patch.dispose();
  });
  it("normalizes fractional viewport for both cell selection and grapheme lookup and forces scrolled redraw", () => {
    const f = fixture(); f.renderer.render(f.source, false, 1.5, f.provider);
    expect(f.options()[0]).toBe(true); expect(f.options()[1]).toBe(1);
    expect(f.drawn().getGraphemeString?.(0, 1)).toBe("history:9:1:é"); expect(f.drawn().getGraphemeString?.(1, 1)).toBe("active:0:1:👩🏽‍💻"); f.patch.dispose();
  });
  it("uses active coordinates at bottom/alternate screen and current history after resize", () => {
    const f = fixture(); f.renderer.render(f.source, false, 0, f.provider); expect(f.drawn().getGraphemeString?.(3, 2)).toBe("active:3:2:👩🏽‍💻"); expect(f.options()[0]).toBe(false);
    f.alt(true); f.renderer.render(f.source, false, 8, f.provider); expect(f.options()[1]).toBe(0); expect(f.drawn().getGraphemeString?.(0, 2)).toBe("active:0:2:👩🏽‍💻");
    f.alt(false); f.resize(); f.renderer.render(f.source, false, 2, f.provider); expect(f.drawn().getDimensions().cols).toBe(30); expect(f.drawn().getGraphemeString?.(0, 2)).toBe("history:13:2:é"); f.patch.dispose();
  });
  it("mirrors the original active-row branch without a scrollback provider", () => {
    const f = fixture(); f.renderer.render(f.source, false, 2); expect(f.drawn().getGraphemeString?.(3, 2)).toBe("active:1:2:👩🏽‍💻"); f.patch.dispose();
  });
  it("forwards unrelated renderables unchanged and restores only its own decorator on disposal", () => {
    const f = fixture(); const unrelated = { ...f.source }; f.renderer.render(unrelated, true, 1.5, f.provider, 0.8);
    expect(f.original).toHaveBeenLastCalledWith(unrelated, true, 1.5, f.provider, 0.8);
    f.patch.dispose(); expect(f.renderer.render).toBe(f.original); f.patch.dispose();
    const other = fixture(); const later = vi.fn(); other.renderer.render = later; other.patch.dispose(); expect(other.renderer.render).toBe(later);
  });
});
