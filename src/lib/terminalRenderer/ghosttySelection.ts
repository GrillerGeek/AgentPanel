import type { CellPosition, Disposable, Result, SelectionRange } from "./types";
import { unsupported } from "./types";
export type SelectionOrigin = "manual" | "search";
export interface SelectionGeometry { cols: number; rows: number; history: number; viewport: number; width: number; height: number }
export interface SelectionRect { x: number; y: number; width: number; height: number; row: number; startCol: number; endCol: number }
export interface SelectionDiagnostics {
  range: SelectionRange | null; origin: SelectionOrigin | null; viewportTop: number;
  rectangles: SelectionRect[]; dragging: boolean; visible: boolean;
}
interface SelectionSurface {
  canvas: HTMLCanvasElement;
  geometry(): SelectionGeometry;
  normalize(range: SelectionRange): Result<SelectionRange>;
  focus(): void;
  isMouseTracking(): boolean;
  /** Pinned 0.4.0 expects distance from bottom despite scrollToLine's docstring. */
  scrollToDistance(distance: number): void;
  scrollLines(lines: number): void;
  onScroll(listener: () => void): Disposable;
}
export const viewportTop = (geometry: SelectionGeometry) => Math.max(0, geometry.history - Math.floor(geometry.viewport));
export function selectionRectangles(range: SelectionRange, geometry: SelectionGeometry): SelectionRect[] {
  const top = viewportTop(geometry); const rectangles: SelectionRect[] = [];
  if (geometry.width <= 0 || geometry.height <= 0) return rectangles;
  for (let y = Math.max(top, range.start.y); y <= Math.min(top + geometry.rows - 1, range.end.y); y++) {
    const startCol = y === range.start.y ? range.start.x : 0;
    const endCol = y === range.end.y ? range.end.x : geometry.cols;
    if (endCol > startCol) rectangles.push({ x: startCol * geometry.width, y: (y - top) * geometry.height,
      width: (endCol - startCol) * geometry.width, height: geometry.height, row: y, startCol, endCol });
  }
  return rectangles;
}
/** Owns only endpoints and visible rectangles, never a history/text snapshot. */
export class GhosttySelection {
  private range: SelectionRange | null = null;
  private origin: SelectionOrigin | null = null;
  private overlay: HTMLDivElement;
  private rectangles: SelectionRect[] = [];
  private visible = true;
  private disposed = false;
  private dragging = false;
  private anchor?: CellPosition;
  private pointer?: { x: number; y: number };
  private autoTask?: ReturnType<typeof setTimeout>;
  private scrollSub: Disposable;
  private previousPosition: string;
  private ownedPosition = false;
  constructor(private parent: HTMLElement, private surface: SelectionSurface) {
    const doc = parent.ownerDocument;
    this.previousPosition = parent.style.position;
    if (doc.defaultView?.getComputedStyle(parent).position === "static" || !doc.defaultView?.getComputedStyle(parent).position) {
      parent.style.position = "relative"; this.ownedPosition = true;
    }
    this.overlay = doc.createElement("div"); this.overlay.className = "ghostty-owned-selection";
    this.overlay.setAttribute("aria-hidden", "true"); this.overlay.contentEditable = "false";
    this.overlay.style.cssText = "position:absolute;pointer-events:none;overflow:hidden;z-index:1;user-select:none;";
    parent.append(this.overlay);
    // The wrapper's earlier parent-capture scrollbar listener gets first refusal.
    parent.addEventListener("mousedown", this.down, true);
    parent.addEventListener("dblclick", this.doubleClick, true);
    this.scrollSub = surface.onScroll(() => this.refresh());
  }
  select(range: SelectionRange, origin: SelectionOrigin = "manual", reveal = false): Result<void> {
    if (this.disposed) return unsupported("Selection surface disposed");
    const normalized = this.surface.normalize(range); if (normalized.status !== "supported") return normalized;
    const selected = normalized.value;
    this.range = selected.start.x === selected.end.x && selected.start.y === selected.end.y ? null : selected;
    this.origin = this.range ? origin : null;
    if (reveal && this.range) this.reveal(this.range);
    this.refresh(); return { status: "supported", value: undefined };
  }
  getRange(): SelectionRange | null { return this.range ? { start: { ...this.range.start }, end: { ...this.range.end } } : null; }
  hasSelection() { return !!this.range; }
  clear(origin?: SelectionOrigin) {
    if (!this.range || (origin && this.origin !== origin)) return;
    this.range = null; this.origin = null; this.refresh();
  }
  /** Output/reflow has no stable generation/line identity in the public wrapper. */
  invalidate() { this.endDrag(); if (this.range) this.clear(); }
  setVisibility(visible: boolean) { this.visible = visible; if (!visible) this.endDrag(); this.refresh(); }
  private reveal(range: SelectionRange) {
    const geometry = this.surface.geometry(); const top = viewportTop(geometry);
    const canvasRect = this.surface.canvas.getBoundingClientRect();
    const availableRows = Math.max(1, Math.min(geometry.rows, Math.floor(this.visibleSize(geometry, canvasRect, this.parent.getBoundingClientRect()).height / geometry.height)));
    const last = range.end.x === 0 && range.end.y > range.start.y ? range.end.y - 1 : range.end.y;
    let target = top;
    if (range.start.y < top || last - range.start.y >= availableRows) target = range.start.y;
    else if (last >= top + availableRows) target = last - availableRows + 1;
    target = Math.max(0, Math.min(geometry.history, target));
    this.surface.scrollToDistance(geometry.history - target);
  }
  private visibleSize(geometry: SelectionGeometry, canvas: DOMRect, parent: DOMRect) {
    let width = canvas.width > 0 ? geometry.cols * geometry.width : 0;
    let height = canvas.height > 0 ? geometry.rows * geometry.height : 0;
    const style = this.parent.ownerDocument.defaultView?.getComputedStyle(this.parent);
    const clips = (overflow: string | undefined) => !!overflow && overflow !== "visible";
    if (clips(style?.overflowX) || clips(style?.overflow)) width = Math.min(width, parent.left + this.parent.clientLeft + this.parent.clientWidth - canvas.left);
    if (clips(style?.overflowY) || clips(style?.overflow)) height = Math.min(height, parent.top + this.parent.clientTop + this.parent.clientHeight - canvas.top);
    return { width: Math.max(0, width), height: Math.max(0, height) };
  }
  refresh() {
    if (this.disposed) return;
    const geometry = this.surface.geometry(); const canvas = this.surface.canvas;
    const rect = canvas.getBoundingClientRect(); const parentRect = this.parent.getBoundingClientRect();
    this.overlay.style.left = `${rect.left - parentRect.left - this.parent.clientLeft + this.parent.scrollLeft}px`;
    this.overlay.style.top = `${rect.top - parentRect.top - this.parent.clientTop + this.parent.scrollTop}px`;
    this.overlay.style.width = `${geometry.cols * geometry.width}px`; this.overlay.style.height = `${geometry.rows * geometry.height}px`;
    this.overlay.style.display = this.visible ? "block" : "none";
    const area = this.visibleSize(geometry, rect, parentRect);
    this.rectangles = this.range && this.visible ? selectionRectangles(this.range, geometry).filter((rectangle) => rectangle.x >= 0 && rectangle.y >= 0 && rectangle.x + rectangle.width <= area.width && rectangle.y + rectangle.height <= area.height) : [];
    const fragment = this.parent.ownerDocument.createDocumentFragment();
    for (const rectangle of this.rectangles) {
      const node = this.parent.ownerDocument.createElement("div");
      node.className = "ghostty-selection-rect";
      node.dataset.row = String(rectangle.row); node.dataset.startCol = String(rectangle.startCol); node.dataset.endCol = String(rectangle.endCol);
      node.style.cssText = `position:absolute;left:${rectangle.x}px;top:${rectangle.y}px;width:${rectangle.width}px;height:${rectangle.height}px;background:rgba(96,165,250,.32);outline:1px solid rgba(147,197,253,.85);outline-offset:-1px;`;
      fragment.append(node);
    }
    this.overlay.replaceChildren(fragment);
  }
  diagnostics(): SelectionDiagnostics {
    return { range: this.getRange(), origin: this.origin, viewportTop: viewportTop(this.surface.geometry()), rectangles: this.rectangles.map((rect) => ({ ...rect })), dragging: this.dragging, visible: this.visible };
  }
  private point(clientX: number, clientY: number): CellPosition {
    const geometry = this.surface.geometry(); const rect = this.surface.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(geometry.cols, Math.floor((clientX - rect.left) / geometry.width)));
    const row = Math.max(0, Math.min(geometry.rows - 1, Math.floor((clientY - rect.top) / geometry.height)));
    return { x, y: viewportTop(geometry) + row };
  }
  private canOwn(event: MouseEvent) {
    return event.target === this.surface.canvas && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && (!this.surface.isMouseTracking() || event.shiftKey);
  }
  private down = (event: MouseEvent) => {
    if (this.disposed || !this.visible || !this.canOwn(event)) return;
    const { width, height } = this.surface.geometry(); if (width <= 0 || height <= 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.endDrag(); this.clear(); this.surface.focus();
    this.dragging = true; this.anchor = this.point(event.clientX, event.clientY); this.pointer = { x: event.clientX, y: event.clientY };
    const doc = this.parent.ownerDocument;
    doc.addEventListener("mousemove", this.move, true); doc.addEventListener("mouseup", this.up, true);
    doc.addEventListener("pointercancel", this.cancel, true); doc.defaultView?.addEventListener("blur", this.cancel);
  };
  private doubleClick = (event: MouseEvent) => {
    // Do not let the wrapper's second selection/autocopy path run behind ours.
    if (this.canOwn(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private updatePointer() {
    if (this.dragging && this.anchor && this.pointer) this.select({ start: this.anchor, end: this.point(this.pointer.x, this.pointer.y) });
  }
  private move = (event: MouseEvent) => {
    if (!this.dragging) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.pointer = { x: event.clientX, y: event.clientY }; this.updatePointer(); this.scheduleAutoScroll();
  };
  private up = (event: MouseEvent) => {
    if (event.button !== 0 || !this.dragging) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.pointer = { x: event.clientX, y: event.clientY }; this.updatePointer(); this.endDrag();
  };
  private cancel = () => { this.endDrag(); };
  private autoDirection() {
    if (!this.pointer) return 0;
    const rect = this.surface.canvas.getBoundingClientRect();
    return this.pointer.y < rect.top + 8 ? -1 : this.pointer.y > rect.bottom - 8 ? 1 : 0;
  }
  private scheduleAutoScroll() {
    if (this.autoTask !== undefined || !this.dragging || !this.autoDirection()) return;
    this.autoTask = setTimeout(() => {
      this.autoTask = undefined;
      if (!this.dragging || this.disposed) return;
      const direction = this.autoDirection(); if (!direction) return;
      const before = this.surface.geometry().viewport;
      this.surface.scrollLines(direction * 2); this.updatePointer();
      if (before !== this.surface.geometry().viewport) this.scheduleAutoScroll();
    }, 50);
  }
  private endDrag() {
    if (!this.dragging && this.autoTask === undefined) return;
    this.dragging = false; this.anchor = undefined; this.pointer = undefined;
    if (this.autoTask !== undefined) clearTimeout(this.autoTask); this.autoTask = undefined;
    const doc = this.parent.ownerDocument;
    doc.removeEventListener("mousemove", this.move, true); doc.removeEventListener("mouseup", this.up, true);
    doc.removeEventListener("pointercancel", this.cancel, true); doc.defaultView?.removeEventListener("blur", this.cancel);
  }
  dispose() {
    if (this.disposed) return;
    this.endDrag(); this.scrollSub.dispose(); this.parent.removeEventListener("mousedown", this.down, true); this.parent.removeEventListener("dblclick", this.doubleClick, true);
    this.overlay.remove(); this.range = null; this.rectangles = []; this.disposed = true;
    if (this.ownedPosition && this.parent.style.position === "relative") this.parent.style.position = this.previousPosition;
  }
}
