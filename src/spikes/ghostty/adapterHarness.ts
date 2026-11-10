import { createXtermRenderer } from "../../lib/terminalRenderer/xtermRenderer";
import { createGhosttyRenderer } from "../../lib/terminalRenderer/ghosttyRenderer";
import type { TerminalRenderer } from "../../lib/terminalRenderer/types";
import { frames, writeWindow, type Kind } from "./engine";
export interface AdapterEngine {
  kind: Kind;
  term: TerminalRenderer;
  renderer: string;
  consumption: "adapter";
  fit(): void;
  text(): string;
  write(data: string | Uint8Array): Promise<void>;
  dispose(): void;
}
export async function createAdapterEngine(kind: Kind, parent: HTMLElement): Promise<AdapterEngine> {
  const options = { cols: 80, rows: 24, scrollback: 2000, fontSize: 14, cursorBlink: false, webgl: true };
  const term = kind === "xterm" ? createXtermRenderer(parent, options) : await createGhosttyRenderer(parent, options);
  return { kind, term, renderer: kind === "xterm" ? "xterm adapter (WebGL requested)" : "Ghostty adapter (Canvas)", consumption: "adapter",
    fit: () => term.fit(), text() { const result = term.extractText(); if (result.status !== "supported") throw new Error(result.reason); return result.value; },
    write(data) { term.write(data); return term.whenIdle(); }, dispose: () => term.dispose() };
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
    checks.push({ name: "search navigation and visible highlight", status: search.status === "supported" ? search.found ? "pass" : "fail" : "unsupported", detail: search });
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
