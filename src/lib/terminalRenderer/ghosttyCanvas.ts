import type { CanvasRenderer, IRenderable } from "ghostty-web";
import type { Disposable } from "./types";
export interface CanvasGraphemeSource extends IRenderable {
  getGraphemeString(row: number, col: number): string;
  getScrollbackGraphemeString(row: number, col: number): string;
  isAlternateScreen(): boolean;
}
/** Pinned 0.4.0 selects scrolled cells correctly but asks for their graphemes in
 * viewport coordinates. Decorate its PUBLIC render boundary, not WASM/private
 * state, and preserve each other public method's original receiver. */
export function decorateGhosttyCanvas(renderer: Pick<CanvasRenderer, "render">, current: () => CanvasGraphemeSource | undefined): Disposable {
  const original = renderer.render;
  const decorated: CanvasRenderer["render"] = function(buffer, forceAll, viewportY = 0, provider, scrollbarOpacity) {
    const source = current();
    if (!source || buffer !== source) return original.call(renderer, buffer, forceAll, viewportY, provider, scrollbarOpacity);
    const distance = source.isAlternateScreen() ? 0 : Math.max(0, Math.floor(viewportY));
    const history = provider?.getScrollbackLength() ?? 0;
    const facade: IRenderable = {
      getLine: source.getLine.bind(source), getCursor: source.getCursor.bind(source), getDimensions: source.getDimensions.bind(source),
      isRowDirty: source.isRowDirty.bind(source), clearDirty: source.clearDirty.bind(source),
      getGraphemeString(row, col) {
        if (distance > 0 && row < distance && provider) return source.getScrollbackGraphemeString(history - distance + row, col);
        return source.getGraphemeString(row - distance, col);
      },
    };
    if (source.needsFullRedraw) facade.needsFullRedraw = source.needsFullRedraw.bind(source);
    // Integer rows keep the cell/grapheme boundary identical. A forced scrolled
    // draw bypasses the wrapper's active-cursor prepass; its main scrolled pass
    // already redraws every visible row, so this adds no extra row work.
    return original.call(renderer, facade, !!forceAll || distance > 0, distance, provider, scrollbarOpacity);
  };
  renderer.render = decorated;
  return { dispose() { if (renderer.render === decorated) renderer.render = original; } };
}
