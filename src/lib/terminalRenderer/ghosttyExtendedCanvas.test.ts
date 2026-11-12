// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { CanvasRenderer } from "../../../vendor/ghostty-history/dist/ghostty-history.js";
afterEach(() => vi.restoreAllMocks());
it("paints resolved RGB/palette black over a nonblack default rather than treating black as a sentinel", () => {
  const fills: Array<{ style: string; x: number; y: number; width: number; height: number }> = [];
  const context = { fillStyle: "", fillRect(x: number, y: number, width: number, height: number) { fills.push({ style: this.fillStyle, x, y, width, height }); },
    scale() {}, fillText() {}, measureText: () => ({ width: 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const canvas = document.createElement("canvas"); const renderer = new CanvasRenderer(canvas, { cursorBlink: false, devicePixelRatio: 1, theme: { background: "#123456" } });
  const cell = { codepoint: 65, fg_r: 255, fg_g: 255, fg_b: 255, bg_r: 0, bg_g: 0, bg_b: 0, flags: 0, width: 1, hyperlink_id: 0, grapheme_len: 0 };
  renderer.render({ getLine: () => [cell, cell], getCursor: () => ({ x: 0, y: 0, visible: false }), getDimensions: () => ({ cols: 2, rows: 1 }), isRowDirty: () => true, clearDirty() {} }, true);
  expect(fills.some((fill) => fill.style === "#123456")).toBe(true);
  expect(fills.filter((fill) => fill.style === "rgb(0, 0, 0)" && fill.width === 8)).toHaveLength(2); renderer.dispose();
});
