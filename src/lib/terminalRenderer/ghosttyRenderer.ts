// This module is imported ONLY by the experimental entry. Never export through a production barrel.
import { Ghostty, Terminal, FitAddon } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { WriteQueue, type QueueScheduler } from "./writeQueue";
import { OscTitleParser } from "./oscTitleParser";
import { events } from "./events";
import { copyGhosttySelection, findGhosttyText, readGhosttyText } from "./ghosttyText";
import { unsupported, type RendererOptions, type TerminalRenderer } from "./types";
let loading: Promise<Ghostty> | undefined;
export function loadGhostty(): Promise<Ghostty> {
  if (!loading) loading = Ghostty.load(wasmUrl).catch((error) => { loading = undefined; throw error; });
  return loading;
}
const historyReason = "ghostty-web 0.4.0 cannot replay styled history: color provenance, scrollback wraps, inactive normal buffer, overline and hyperlink URIs are unavailable";
const searchReason = "Literal text match only; public selection/navigation cannot reliably present and highlight scrollback matches";
export async function createGhosttyRenderer(parent: HTMLElement, options: RendererOptions = {}, scheduler?: QueueScheduler): Promise<TerminalRenderer> {
  const { webgl: _webgl, ...terminalOptions } = options;
  const term = new Terminal({ scrollback: 2000, ...terminalOptions, ghostty: await loadGhostty() });
  const fit = new FitAddon(); term.loadAddon(fit); term.open(parent);
  const titles = events<string>(); const errors = events<Error>();
  const parser = new OscTitleParser(titles.emit);
  let disposed = false; let searchOffset = -1; let lastQuery = "";
  const queue = new WriteQueue((bytes) => {
    // Pinned 0.4.0 parses synchronously. Do not pass its rAF-scheduled callback.
    term.write(bytes); parser.write(bytes);
  }, errors.emit, scheduler);
  const mapped = () => term.wasmTerm ? readGhosttyText(term.wasmTerm) : unsupported("Public WASM buffer unavailable");
  return {
    kind: "ghostty", capabilities: { selection: "limited", search: "limited", styledHistory: "unsupported", renderingSuspension: "unsupported" },
    get cols() { return term.cols; }, get rows() { return term.rows; },
    write: (data, consumed) => queue.write(data, consumed), whenIdle: () => queue.whenIdle(),
    fit() { if (!disposed && parent.clientWidth > 0 && parent.clientHeight > 0) fit.fit(); },
    resize: (cols, rows) => term.resize(cols, rows), focus: () => term.focus(), paste: (text) => term.paste(text),
    onData: (listener) => term.onData(listener), onTitleChange: titles.on, onError: errors.on,
    setKeyHandler: (handler) => term.attachCustomKeyEventHandler((event) => !handler(event)),
    isMouseTracking: () => term.wasmTerm?.hasMouseTracking() ?? false,
    getSelection() {
      // Identical endpoints also occur on an ordinary click. The public API
      // cannot distinguish those from a one-cell programmatic selection.
      if (!term.hasSelection()) return unsupported("No unambiguous active selection (single-cell selection is unsupported)");
      const range = term.getSelectionPosition();
      if (!range) return unsupported("Public selection positions are unavailable for an offscreen selection");
      const viewport = term.getViewportY();
      // Public positions are viewport-relative and clipped at the viewport edges.
      // Interior endpoints are unambiguous; do not fabricate the hidden part of
      // an edge-crossing selection or round fractional smooth-scroll positions.
      if (!Number.isInteger(viewport) || range.start.y <= 0 || range.end.y >= term.rows - 1) return unsupported("Public selection positions clip at viewport boundaries; full copy cannot be recovered reliably");
      const text = mapped();
      if (text.status !== "supported") return text;
      const absolute = (point: { x: number; y: number }) => ({ x: point.x, y: text.value.history + point.y - viewport });
      return copyGhosttySelection(text.value, { start: absolute(range.start), end: absolute(range.end) });
    },
    // Preserve the wrapper's active-selection signal; a plain click must not copy.
    hasSelection: () => term.hasSelection(), clearSelection: () => term.clearSelection(),
    select: () => unsupported("ghostty-web select() clamps to viewport and uses inconsistent absolute coordinates after scrolling/resize"),
    search(query, backwards = false) {
      const text = mapped(); if (text.status !== "supported") return text;
      if (query !== lastQuery) { searchOffset = -1; lastQuery = query; }
      const found = findGhosttyText(text.value, query, searchOffset, backwards); searchOffset = found.offset;
      return { status: "limited", match: found.match, reason: searchReason };
    },
    clearSearch() { searchOffset = -1; lastQuery = ""; },
    serializeStyledHistory: () => unsupported(historyReason),
    extractText() { const text = mapped(); return text.status === "supported" ? { status: "supported", value: text.value.text } : text; },
    setAppearance(appearance) { Object.assign(term.options, appearance); },
    // Parsing remains task-budgeted while hidden. The wrapper has no public render-pause API.
    setVisibility() {},
    reset() { term.reset(); parser.reset(); searchOffset = -1; lastQuery = ""; },
    dispose() { if (disposed) return; disposed = true; queue.dispose(); parser.reset(); titles.clear(); errors.clear(); term.dispose(); },
  };
}
