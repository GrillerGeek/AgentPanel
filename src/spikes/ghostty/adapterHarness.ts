import { createXtermRenderer } from "../../lib/terminalRenderer/xtermRenderer";
import { createGhosttyRenderer, getGhosttySelectionDiagnostics, repaintGhosttyCanvas } from "../../lib/terminalRenderer/ghosttyRenderer";
import type { SelectionDiagnostics } from "../../lib/terminalRenderer/ghosttySelection";
import type { TerminalRenderer } from "../../lib/terminalRenderer/types";
import { frames, writeWindow, type Kind } from "./engine";
export interface CanvasPaintEvidence { column: number; viewportRow: number; cellWidth: number; cellHeight: number; calls: Array<{ text: string; x: number; y: number }>; capped: boolean }
export interface AdapterEngine {
  kind: Kind;
  term: TerminalRenderer;
  renderer: string;
  consumption: "adapter";
  fit(): void;
  text(): string;
  write(data: string | Uint8Array): Promise<void>;
  dispose(): void;
  captureCanvasPaint?(action: () => void, column: number): Promise<CanvasPaintEvidence>;
  selectionPresentation?(): { owned: SelectionDiagnostics | undefined; visibleRects: Array<{ row: number; startCol: number; endCol: number; x: number; y: number; width: number; height: number }> };
}
export async function createAdapterEngine(kind: Kind, parent: HTMLElement): Promise<AdapterEngine> {
  const options = { cols: 80, rows: 24, scrollback: 2000, fontSize: 14, cursorBlink: false, webgl: true };
  const term = kind === "xterm" ? createXtermRenderer(parent, options) : await createGhosttyRenderer(parent, options);
  return { kind, term, renderer: kind === "xterm" ? "xterm adapter (WebGL requested)" : "Ghostty adapter (Canvas)", consumption: "adapter",
    fit: () => term.fit(), text() { const result = term.extractText(); if (result.status !== "supported") throw new Error(result.reason); return result.value; },
    write(data) { term.write(data); return term.whenIdle(); }, dispose: () => term.dispose(),
    ...(kind === "ghostty" ? {
      async captureCanvasPaint(action: () => void, column: number): Promise<CanvasPaintEvidence> {
        const canvas = parent.querySelector("canvas")!; const context = canvas.getContext("2d")!;
        const original = context.fillText; const calls: CanvasPaintEvidence["calls"] = [];
        const cellWidth = parseFloat(canvas.style.width) / term.cols; const cellHeight = parseFloat(canvas.style.height) / term.rows;
        let viewportRow = -1; let capped = false;
        const wrapped: CanvasRenderingContext2D["fillText"] = function(this: CanvasRenderingContext2D, text, x, y, maxWidth) {
          if (Math.abs(x - column * cellWidth) < 0.05 && Math.floor(y / cellHeight) === viewportRow) {
            if (calls.length < 16) calls.push({ text, x, y }); else capped = true;
          }
          if (maxWidth === undefined) original.call(this, text, x, y); else original.call(this, text, x, y, maxWidth);
        };
        context.fillText = wrapped;
        try {
          action(); const owned = getGhosttySelectionDiagnostics(term);
          viewportRow = owned?.range ? owned.range.start.y - owned.viewportTop : -1;
          repaintGhosttyCanvas(term); await frames();
          return { column, viewportRow, cellWidth, cellHeight, calls, capped };
        } finally { if (context.fillText === wrapped) context.fillText = original; }
      },
      selectionPresentation: () => ({ owned: getGhosttySelectionDiagnostics(term), visibleRects: Array.from(parent.querySelectorAll<HTMLElement>(".ghostty-selection-rect")).map((node) => {
      const rect = node.getBoundingClientRect(); return { row: Number(node.dataset.row), startCol: Number(node.dataset.startCol), endCol: Number(node.dataset.endCol), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }) }) } : {}) };
}
export interface AdapterCheck { name: string; status: "pass" | "fail" | "unsupported"; detail: unknown }
export async function adapterCompatibility(engine: AdapterEngine): Promise<AdapterCheck[]> {
  const term = engine.term; const checks: AdapterCheck[] = [];
  const record = (name: string, pass: boolean, detail: unknown) => checks.push({ name, status: pass ? "pass" : "fail", detail });
  const titles: string[] = []; const titleSub = term.onTitleChange((title) => titles.push(title));
  const errors: string[] = []; const errorSub = term.onError((error) => errors.push(error.message));
  const input: string[] = []; const inputSub = term.onData((data) => input.push(data));
  try {
    term.reset(); term.resize(80, 24);
    const fixture = new TextEncoder().encode("café 👩🏽‍💻 中文 é\r\n");
    for (let i = 0; i < fixture.length; i++) await engine.write(fixture.slice(i, i + 1));
    record("raw split UTF-8/full screen graphemes", engine.text().includes("café 👩🏽‍💻 中文 é"), engine.text().trim());
    for (const byte of new TextEncoder().encode("\x1b]0;café 👩🏽‍💻\x07\x1b]2;split\x1b\\")) await engine.write(Uint8Array.of(byte));
    record("raw titles BEL/ST and split UTF-8, exactly once", titles.length === 2 && titles[0] === "café 👩🏽‍💻" && titles[1] === "split", titles);
    await engine.write("\x1b[?2004h"); term.paste("PASTE-ONCE");
    record("single bracketed paste path", input.length === 1 && input[0] === "\x1b[200~PASTE-ONCE\x1b[201~", input.slice());
    await engine.write("\x1b[?1049hALT 👩🏽‍💻\x1b[?1049l");
    record("alternate screen restores normal", engine.text().includes("café 👩🏽‍💻") && !engine.text().includes("ALT"), engine.text().trim());
    term.resize(101, 37); await engine.write(Array.from({ length: 100 }, (_, i) => `history-${i} 👩🏽‍💻\r\n`).join(""));
    record("full scrollback graphemes after resize", engine.text().includes("history-0 👩🏽‍💻") && engine.text().includes("history-99 👩🏽‍💻"), { rows: term.rows, cols: term.cols });
    const selection = term.select({ start: { x: 0, y: 0 }, end: { x: 4, y: 0 } });
    if (selection.status === "unsupported") checks.push({ name: "programmatic selection after resize", status: "unsupported", detail: selection.reason });
    else { const copy = term.getSelection(); record("programmatic selection after resize", copy.status === "supported" && copy.value === "café", copy); }
    const search = term.search("history-0 👩🏽‍💻");
    await frames();
    const presentation = engine.selectionPresentation?.(); const selected = term.getSelection();
    const visibleMatch = !presentation || (!!presentation.owned?.range && presentation.visibleRects.some((rect) => rect.width > 0 && rect.height > 0) && selected.status === "supported" && selected.value === "history-0 👩🏽‍💻");
    checks.push({ name: "search navigation and visible highlight", status: search.status === "supported" ? search.found && visibleMatch ? "pass" : "fail" : "unsupported", detail: { search, selected, presentation } });
    if (engine.kind === "ghostty") checks.push(...await selectionSearchCompatibility(engine));
    const history = term.serializeStyledHistory();
    checks.push({ name: "replayable styled history", status: history.status === "supported" ? "pass" : "unsupported", detail: history.status === "supported" ? { bytes: history.value.length } : history.reason });
    term.setVisibility(false, false); let consumed = 0; const payload = new Uint8Array(96 * 1024).fill(120);
    term.write(payload, () => consumed++); await term.whenIdle(); term.setVisibility(true, true);
    record("hidden ingestion and exact original acknowledgement", consumed === 1, { consumed, bytes: payload.length, renderSuspension: term.capabilities.renderingSuspension });
    record("no adapter errors", errors.length === 0, errors);
  } finally { titleSub.dispose(); errorSub.dispose(); inputSub.dispose(); }
  return checks;
}
export async function adapterBenchmark(host: HTMLElement) {
  const payload = new TextEncoder().encode(Array.from({ length: 12000 }, (_, i) => `\x1b[3${i % 7 + 1}m${i} build output abcdefghijklmnopqrstuvwxyz\x1b[0m\r\n`).join(""));
  const results: unknown[] = [];
  for (let round = 0; round < 4; round++) for (const kind of (round % 2 ? ["ghostty", "xterm"] : ["xterm", "ghostty"]) as Kind[]) {
    const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
    const engine = await createAdapterEngine(kind, target);
    try {
      await engine.write("warmup\r\n"); engine.term.reset();
      const start = performance.now();
      // Same 16KiB chunks/64KiB window as the historical harness, adapters only.
      await writeWindow(engine, payload); await frames();
      results.push({ kind, round, bytes: payload.length, writeAndFramesMs: performance.now() - start, retainedLastLine: engine.text().includes("11999 build output"), consumption: "adapter" });
    } finally { engine.dispose(); target.remove(); }
  }
  return { method: "Adapter-only synthetic emulator writes, 16KiB chunks/64KiB window, four alternating rounds, warmup and two final frames; no incompatible addons; not real-agent latency", results };
}

/** Characterize stricter Unicode probes against an untouched raw xterm instance.
 * Failures stay failures; this only distinguishes inherited behavior from adapter regression.
 */
export async function characterizeXtermUnicode(host: HTMLElement) {
  const { createEngine } = await import("./engine");
  const observed: Record<string, { screen: string; titles: string[] }> = {};
  for (const kind of ["raw", "adapter"] as const) {
    const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
    const engine = kind === "raw" ? await createEngine("xterm", target, false) : await createAdapterEngine("xterm", target);
    const titles: string[] = []; const subscription = engine.term.onTitleChange((title) => titles.push(title));
    try {
      const bytes = new TextEncoder().encode("café 👩🏽‍💻 中文 é\r\n\x1b]2;café 👩🏽‍💻\x07");
      for (const byte of bytes) await engine.write(Uint8Array.of(byte));
      observed[kind] = { screen: engine.text().trim(), titles };
    } finally { subscription.dispose(); engine.dispose(); target.remove(); }
  }
  return { expected: { screen: "café 👩🏽‍💻 中文 é", titles: ["café 👩🏽‍💻"] }, ...observed,
    adapterMatchesRaw: JSON.stringify(observed.raw) === JSON.stringify(observed.adapter),
    meaning: "Untouched xterm vs xterm adapter, identical one-byte UTF-8 writes. Any missing grapheme codepoints remain strict compatibility failures; equality only characterizes the baseline." };
}

export const selectionSearchFixture = "\x1b[3J\x1b[2J\x1b[H" + Array.from({ length: 120 }, (_, i) =>
  `${i === 8 || i === 83 ? "needle 👩🏽‍💻 · " : ""}fixture-${String(i).padStart(3, "0")} café 👩🏽‍💻 中文  spaced\r\n`).join("");

export async function loadSelectionSearchFixture(engine: AdapterEngine) {
  await engine.term.whenIdle(); engine.term.reset(); await engine.write(selectionSearchFixture);
}
async function selectionSearchCompatibility(engine: AdapterEngine): Promise<AdapterCheck[]> {
  const term = engine.term; const checks: AdapterCheck[] = [];
  const record = (name: string, pass: boolean, detail: unknown) => checks.push({ name, status: pass ? "pass" : "fail", detail });
  await loadSelectionSearchFixture(engine); await frames();
  const lines = engine.text().split("\n"); const first = lines.findIndex((line) => line.includes("fixture-000"));
  const bottom = lines.findIndex((line) => line.includes("fixture-119")); const needleRows = lines.flatMap((line, y) => line.includes("needle 👩🏽‍💻") ? [y] : []);
  term.select({ start: { x: 0, y: first }, end: { x: 1, y: first } });
  const oneCell = term.getSelection(); const offscreen = engine.selectionPresentation?.();
  record("owned one-cell and offscreen scrollback copy", first >= 0 && oneCell.status === "supported" && oneCell.value === "f" && term.hasSelection() && offscreen?.owned?.range?.start.y === first && offscreen.owned.viewportTop > first && offscreen.visibleRects.length === 0, { oneCell, offscreen });
  term.select({ start: { x: 7, y: bottom }, end: { x: 0, y: bottom } }); const edge = term.getSelection();
  record("owned reversed bottom-edge selection", edge.status === "supported" && edge.value === "fixture" && (engine.selectionPresentation?.().visibleRects.length ?? 0) > 0, { edge, presentation: engine.selectionPresentation?.() });
  term.select({ start: { x: 4, y: first + 1 }, end: { x: 0, y: first } }); const multiline = term.getSelection();
  record("owned multiline copy trims terminal row padding", multiline.status === "supported" && multiline.value === `${lines[first].trimEnd()}\nfixt`, multiline);
  const query = "needle 👩🏽‍💻";
  const present = async (backwards = false) => {
    let result!: ReturnType<TerminalRenderer["search"]>;
    const paint = await engine.captureCanvasPaint?.(() => { result = term.search(query, backwards); }, 7);
    if (!paint) result = term.search(query, backwards);
    await frames(); return { result, selected: term.getSelection(), presentation: engine.selectionPresentation?.(), paint };
  };
  const at = (value: Awaited<ReturnType<typeof present>>, row: number) => value.result.status === "supported" && value.result.found && value.selected.status === "supported" && value.selected.value === query && value.presentation?.owned?.range?.start.y === row && value.presentation.owned.range.start.x === 0 && value.presentation.owned.range.end.x === 9 && value.presentation.visibleRects.some((rect) => rect.row === row && rect.startCol === 0 && rect.endCol === 9 && rect.width > 0 && rect.height > 0);
  const firstMatch = await present(); const secondMatch = await present(); const previousMatch = await present(true); const wrappedMatch = await present(true);
  record("search reveals and highlights actual old scrollback cells", needleRows.length === 2 && at(firstMatch, needleRows[0]), firstMatch);
  record("search next previous and wrap move actual selected occurrence", at(secondMatch, needleRows[1]) && at(previousMatch, needleRows[0]) && at(wrappedMatch, needleRows[1]), { secondMatch, previousMatch, wrappedMatch });
  const drawnCluster = (paint: CanvasPaintEvidence | undefined) => !!paint && paint.calls.length > 0 && !paint.capped && paint.calls.every((call) => call.text === "👩🏽‍💻");
  const activePaint = await engine.captureCanvasPaint?.(() => { term.search("fixture-119 café 👩🏽‍💻"); }, 17);
  record("Canvas paints the full cluster at highlighted history and active cells", drawnCluster(firstMatch.paint) && drawnCluster(secondMatch.paint) && drawnCluster(activePaint), { firstHistoryPaint: firstMatch.paint, secondHistoryPaint: secondMatch.paint, activePaint });
  term.clearSearch(); const cleared = !term.hasSelection() && engine.selectionPresentation?.().visibleRects.length === 0;
  await present(); const missing = term.search("no-such-fixture-needle");
  record("clear and no-match remove stale search highlights", cleared && missing.status === "supported" && !missing.found && !term.hasSelection() && engine.selectionPresentation?.().visibleRects.length === 0, { cleared, missing, presentation: engine.selectionPresentation?.() });
  term.select({ start: { x: 0, y: first }, end: { x: 1, y: first } }); term.clearSearch(); term.search("no-such-fixture-needle");
  const manualPreserved = term.hasSelection(); await engine.write("output invalidates old range");
  const outputCleared = !term.hasSelection(); term.select({ start: { x: 0, y: first }, end: { x: 1, y: first } });
  term.resize(term.cols + 1, term.rows + 1); const resizeCleared = !term.hasSelection();
  const newFirst = engine.text().split("\n").findIndex((line) => line.includes("fixture-000"));
  const afterResize = term.select({ start: { x: 0, y: newFirst }, end: { x: 1, y: newFirst } }); const resizedCopy = term.getSelection();
  record("output and grid changes clear stale ranges; new resize selection works", manualPreserved && outputCleared && resizeCleared && afterResize.status === "supported" && resizedCopy.status === "supported" && resizedCopy.value === "f", { manualPreserved, outputCleared, resizeCleared, afterResize, resizedCopy });
  term.clearSelection(); return checks;
}
