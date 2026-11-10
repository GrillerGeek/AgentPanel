import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebglAddon } from "@xterm/addon-webgl";
import { events } from "./events";
import type { TerminalRenderer, RendererOptions } from "./types";

/** Synchronous production factory; owns every xterm-specific addon. */
export function createXtermRenderer(parent: HTMLElement, options: RendererOptions = {}): TerminalRenderer {
  const { webgl = false, ...terminalOptions } = options;
  const term = new Terminal(terminalOptions);
  const fit = new FitAddon(); const search = new SearchAddon(); const serialize = new SerializeAddon();
  term.loadAddon(fit); term.loadAddon(search); term.loadAddon(serialize); term.open(parent);
  const errors = events<Error>();
  let gpu: WebglAddon | undefined; let disposed = false; let failure: Error | undefined; let pending = 0;
  let waiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of waiters.splice(0)) waiter.reject(failure);
    errors.emit(failure);
  };
  const setVisibility = (visible: boolean, enabled: boolean) => {
    if (disposed) return;
    if (visible && enabled && !gpu) {
      try { const addon = new WebglAddon(); term.loadAddon(addon); gpu = addon; }
      catch (error) { console.warn("WebGL addon unavailable, falling back to DOM", error); }
    } else if ((!visible || !enabled) && gpu) { gpu.dispose(); gpu = undefined; }
  };
  setVisibility(true, webgl);
  return {
    kind: "xterm", capabilities: { selection: "supported", search: "supported", styledHistory: "supported", renderingSuspension: "limited" },
    get cols() { return term.cols; }, get rows() { return term.rows; },
    write(data, consumed) {
      if (disposed || failure) return;
      pending++;
      try { term.write(data, () => {
        if (disposed || failure) return;
        pending--;
        try { consumed?.(); } catch (error) { fail(error); return; }
        if (!pending) { for (const waiter of waiters.splice(0)) waiter.resolve(); }
      }); } catch (error) { fail(error); }
    },
    whenIdle: () => failure ? Promise.reject(failure) : disposed ? Promise.reject(new Error("Terminal renderer disposed")) :
      pending ? new Promise((resolve, reject) => waiters.push({ resolve, reject })) : Promise.resolve(),
    fit() { if (!disposed && parent.clientWidth > 0 && parent.clientHeight > 0) fit.fit(); },
    resize: (cols, rows) => term.resize(cols, rows), focus: () => term.focus(), paste: (text) => term.paste(text),
    onData: (listener) => term.onData(listener), onTitleChange: (listener) => term.onTitleChange(listener), onError: errors.on,
    setKeyHandler: (handler) => term.attachCustomKeyEventHandler(handler),
    isMouseTracking: () => term.modes.mouseTrackingMode !== "none",
    getSelection: () => ({ status: "supported", value: term.getSelection() }), hasSelection: () => term.hasSelection(), clearSelection: () => term.clearSelection(),
    select(range) { term.select(range.start.x, range.start.y, (range.end.y - range.start.y) * term.cols + range.end.x - range.start.x); return { status: "supported", value: undefined }; },
    search: (query, backwards) => ({ status: "supported", found: backwards ? search.findPrevious(query) : search.findNext(query) }),
    clearSearch: () => search.clearDecorations(),
    serializeStyledHistory: () => ({ status: "supported", value: serialize.serialize() }),
    extractText() { const lines: string[] = []; for (let i = 0; i < term.buffer.active.length; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? ""); return { status: "supported", value: lines.join("\n") }; },
    setAppearance(appearance) { Object.assign(term.options, appearance); }, setVisibility,
    reset: () => term.reset(),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const waiter of waiters.splice(0)) waiter.reject(new Error("Terminal renderer disposed"));
      errors.clear(); term.dispose(); gpu = undefined;
    },
  };
}
