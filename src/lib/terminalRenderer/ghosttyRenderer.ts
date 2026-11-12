// This module is imported ONLY by the experimental entry. Never export through a production barrel.
import { Ghostty, Terminal, FitAddon } from "../../../vendor/ghostty-history/dist/ghostty-history.js";
import wasmUrl from "../../../vendor/ghostty-history/dist/ghostty-history.wasm?url";
import { StyledHistoryRestorer } from "./historyArchive";
import { serializeGhosttyHistory, type HistoryDiagnostics } from "./ghosttyHistory";
import { WriteQueue, type QueueScheduler } from "./writeQueue";
import { OscTitleParser } from "./oscTitleParser";
import { events } from "./events";
import { copyGhosttySelection, findGhosttyText, normalizeGhosttyRange, readGhosttyText } from "./ghosttyText";
import { decorateGhosttyCanvas } from "./ghosttyCanvas";
import { GhosttySelection, type SelectionDiagnostics } from "./ghosttySelection";
import { unsupported, type RendererOptions, type TerminalRenderer } from "./types";
let loading: Promise<Ghostty> | undefined;
export function loadGhostty(): Promise<Ghostty> {
  if (!loading) loading = Ghostty.load(wasmUrl).catch((error) => { loading = undefined; throw error; });
  return loading;
}
const snapshotReaders = new WeakMap<TerminalRenderer, (screen: "primary" | "active") => ReturnType<NonNullable<Terminal["wasmTerm"]>["captureSnapshot"]> | undefined>();
export const captureGhosttyNativeSnapshot = (renderer: TerminalRenderer, screen: "primary" | "active" = "primary") => snapshotReaders.get(renderer)?.(screen);
const historyCaptures = new WeakMap<TerminalRenderer, { status: string; diagnostics?: HistoryDiagnostics; reason?: string }>();
export const getGhosttyHistoryDiagnostics = (renderer: TerminalRenderer) => historyCaptures.get(renderer);
const selections = new WeakMap<TerminalRenderer, GhosttySelection>();
const canvasRedraws = new WeakMap<TerminalRenderer, () => void>();
/** Isolated-harness diagnostics, deliberately outside the production renderer interface. */
/** Explicit harness repaint, no second render loop or private surface access. */
export const repaintGhosttyCanvas = (renderer: TerminalRenderer): void => canvasRedraws.get(renderer)?.();
export const getGhosttySelectionDiagnostics = (renderer: TerminalRenderer): SelectionDiagnostics | undefined => selections.get(renderer)?.diagnostics();
export async function createGhosttyRenderer(parent: HTMLElement, options: RendererOptions = {}, scheduler?: QueueScheduler): Promise<TerminalRenderer> {
  const { webgl: _webgl, ...terminalOptions } = options;
  const term = new Terminal({ scrollback: 2000, ...terminalOptions, smoothScrollDuration: 0, ghostty: await loadGhostty() });
  const fit = new FitAddon(); term.loadAddon(fit); term.open(parent);
  const titles = events<string>(); const errors = events<Error>();
  const parser = new OscTitleParser(titles.emit);
  let disposed = false; let searchOffset = -1; let lastQuery = "";
  const mapped = () => term.wasmTerm ? readGhosttyText(term.wasmTerm) : unsupported("Public WASM buffer unavailable");
  const publicRenderer = term.renderer;
  if (!publicRenderer) { term.dispose(); throw new Error("Public Ghostty Canvas renderer unavailable"); }
  const canvasPatch = decorateGhosttyCanvas(publicRenderer, () => term.wasmTerm, (error) => queue.abort(error));
  const selection = new GhosttySelection(parent, {
    canvas: publicRenderer.getCanvas(),
    geometry: () => ({ cols: term.cols, rows: term.rows, history: term.wasmTerm?.getScrollbackLength() ?? 0,
      viewport: term.getViewportY(), ...publicRenderer.getMetrics() }),
    normalize: (range) => term.wasmTerm ? normalizeGhosttyRange(term.wasmTerm, range) : unsupported("Public WASM buffer unavailable"),
    focus: () => term.focus(), isMouseTracking: () => term.wasmTerm?.hasMouseTracking() ?? false,
    scrollToDistance: (distance) => term.scrollToLine(distance), scrollLines: (lines) => term.scrollLines(lines),
    onScroll: (listener) => term.onScroll(listener),
  });
  const invalidate = () => { selection.invalidate(); searchOffset = -1; lastQuery = ""; };
  const queue = new WriteQueue((bytes) => {
    // No public line generation/eviction identity exists: never copy a stale range.
    invalidate();
    // Pinned 0.4.0 parses synchronously. Do not pass its rAF-scheduled callback.
    term.write(bytes); parser.write(bytes);
  }, errors.emit, scheduler);
  const afterGridChange = (cols: number, rows: number) => {
    if (term.cols !== cols || term.rows !== rows) invalidate();
    selection.refresh();
  };
  const resizeNative = (cols: number, rows: number) => { if (term.cols !== cols || term.rows !== rows) invalidate(); term.resize(cols, rows); selection.refresh(); };
  let restorer: StyledHistoryRestorer;
  const renderer: TerminalRenderer = {
    kind: "ghostty", capabilities: { selection: "limited", search: "limited", styledHistory: "supported", renderingSuspension: "unsupported" },
    get cols() { return term.cols; }, get rows() { return term.rows; },
    write: (data, consumed) => queue.write(data, consumed), whenIdle: () => queue.whenIdle(),
    fit: () => restorer.fit(),
    resize: (cols, rows) => restorer.resize(cols, rows), focus: () => term.focus(), paste: (text) => term.paste(text),
    onData: (listener) => term.onData(listener), onTitleChange: titles.on, onError: errors.on,
    setKeyHandler: (handler) => term.attachCustomKeyEventHandler((event) => !handler(event)),
    isMouseTracking: () => term.wasmTerm?.hasMouseTracking() ?? false,
    getSelection() {
      const range = selection.getRange(); if (!range) return { status: "supported", value: "" };
      const text = mapped(); return text.status === "supported" ? copyGhosttySelection(text.value, range) : text;
    },
    hasSelection: () => selection.hasSelection(), clearSelection: () => selection.clear(),
    select: (range) => selection.select(range),
    search(query, backwards = false) {
      const text = mapped();
      if (text.status !== "supported") { selection.clear("search"); return text; }
      if (query !== lastQuery) { searchOffset = -1; lastQuery = query; }
      const found = findGhosttyText(text.value, query, searchOffset, backwards); searchOffset = found.offset;
      if (!found.match) { selection.clear("search"); return { status: "supported", found: false }; }
      const presented = selection.select(found.match, "search", true);
      if (presented.status !== "supported") return presented;
      if (!selection.diagnostics().rectangles.length) { selection.clear("search"); return unsupported("Match cannot be presented on a hidden or zero-sized surface"); }
      return { status: "supported", found: true };
    },
    clearSearch() { searchOffset = -1; lastQuery = ""; selection.clear("search"); },
    restoreStyledHistory: (data) => restorer.restore(data),
    serializeStyledHistory() {
      try {
        if (!term.wasmTerm) return unsupported("Primary native metadata unavailable");
        const result = serializeGhosttyHistory(term.wasmTerm.captureSnapshot());
        historyCaptures.set(renderer, { status: result.status, diagnostics: result.diagnostics, ...(result.status === "supported" ? {} : { reason: result.reason }) });
        return result.status === "supported" ? { status: "supported", value: result.value } : unsupported(result.reason);
      } catch (error) {
        const reason = `Styled history capture failed: ${String(error)}`;
        historyCaptures.set(renderer, { status: "error", reason }); return unsupported(reason);
      }
    },
    extractText() { const text = mapped(); return text.status === "supported" ? { status: "supported", value: text.value.text } : text; },
    setAppearance(appearance) { const { cols, rows } = term; Object.assign(term.options, appearance); afterGridChange(cols, rows); },
    // Parsing remains task-budgeted while hidden. The wrapper has no public render-pause API.
    setVisibility(visible) { selection.setVisibility(visible); },
    reset() { invalidate(); term.reset(); parser.reset(); selection.refresh(); },
    dispose() { if (disposed) return; disposed = true; restorer.dispose(); queue.dispose(); selection.dispose(); canvasPatch.dispose(); selections.delete(renderer); canvasRedraws.delete(renderer); historyCaptures.delete(renderer); snapshotReaders.delete(renderer); parser.reset(); titles.clear(); errors.clear(); term.dispose(); },
  };
  restorer = new StyledHistoryRestorer({ grid: () => ({ cols: term.cols, rows: term.rows }), resize: resizeNative,
    fit: () => { const { cols, rows } = term; fit.fit(); afterGridChange(cols, rows); }, canFit: () => parent.clientWidth > 0 && parent.clientHeight > 0,
    idle: () => queue.whenIdle(), write: (data) => { queue.write(data); return queue.whenIdle(); }, reset: () => { invalidate(); term.reset(); parser.reset(); selection.refresh(); } });
  snapshotReaders.set(renderer, (screen) => !disposed ? term.wasmTerm?.captureSnapshot({ screen }) : undefined);
  selections.set(renderer, selection);
  canvasRedraws.set(renderer, () => { if (!disposed && term.wasmTerm) publicRenderer.render(term.wasmTerm, true, term.getViewportY(), term); });
  return renderer;
}
