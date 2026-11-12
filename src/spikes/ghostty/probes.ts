import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { createEngine, frames, writeWindow, type Engine, type Kind } from "./engine";

export interface Check { name: string; pass: boolean; detail: unknown }
const encode = (value: string) => new TextEncoder().encode(value);
export const approvalScreen = "\x1b[?1049h\x1b[2J\x1b[H\x1b[1;36mControlled approval fixture (no real tool call)\x1b[0m\r\n\r\nAllow a command in the scratch checkout?\r\n\x1b[32m❯ 1. Approve once\x1b[0m\r\n  2. Decline\r\n\r\nEsc cancels · arrows choose\r\n\r\nUnicode: café λ 中文 👩🏽‍💻\r\n";

export async function compatibility(engine: Engine): Promise<Check[]> {
  const t = engine.term;
  const checks: Check[] = [];
  const record = (name: string, pass: boolean, detail: unknown) => checks.push({ name, pass, detail });
  t.reset(); t.resize(80, 24);
  // Feed raw bytes, as production's base64 output decoder does.
  const utf8 = encode("split-utf8: café λ 中文\r\n");
  for (let i = 0; i < utf8.length; i++) await engine.write(utf8.subarray(i, i + 1));
  record("split UTF-8 bytes", engine.text().includes("split-utf8: café λ 中文"), engine.text().trim());
  await engine.write(encode("\x1b[31mRED\x1b[0m\r\n"));
  const cell = t.buffer.active.getLine(1)?.getCell(0);
  record("ANSI cell style", !!cell && cell.getFgColor() !== 0, { foreground: cell?.getFgColor(), text: engine.text().trim() });
  await engine.write(encode(approvalScreen));
  record("alternate approval screen", t.buffer.active.type === "alternate" && engine.text().includes("Approve once"), engine.text().trim());
  record("emoji grapheme buffer extraction", engine.text().includes("👩🏽‍💻"), engine.text().trim());
  await engine.write(encode("\x1b[?1049l"));
  record("normal screen restored", engine.text().includes("split-utf8:") && !engine.text().includes("Approve once"), engine.text().trim());
  const sent: string[] = []; const input = t.onData((data) => sent.push(data));
  await engine.write(encode("\x1b[?2004h"));
  t.paste("PASTE-ONCE");
  record("bracketed paste once", sent.length === 1 && sent[0] === "\x1b[200~PASTE-ONCE\x1b[201~", sent.slice());
  sent.length = 0;
  await engine.write(encode("\x1b[5n")); await frames();
  record("terminal status reply", sent.includes("\x1b[0n"), sent.slice()); input.dispose();
  const titles: string[] = []; const title = t.onTitleChange((value) => titles.push(value));
  await engine.write(encode("\x1b]2;raw-byte-title\x07"));
  record("title event from raw bytes", titles.includes("raw-byte-title"), titles.slice());
  titles.length = 0;
  await engine.write("\x1b]2;string-title\x07");
  record("title event from string", titles.includes("string-title"), titles.slice());
  titles.length = 0;
  await engine.write("\x1b]2;split-"); await engine.write("title\x07");
  record("title event across chunks", titles.includes("split-title"), titles.slice()); title.dispose();
  t.resize(101, 37);
  record("resize dimensions", t.cols === 101 && t.rows === 37, { cols: t.cols, rows: t.rows });
  await frames();
  t.select(0, 0, 5);
  record("selection extraction", t.getSelection() === "split", t.getSelection()); t.clearSelection();
  for (const [name, addon, inspect] of [
    ["existing SearchAddon", new SearchAddon(), (a: SearchAddon) => a.findNext("split-utf8")],
    ["existing SerializeAddon", new SerializeAddon(), (a: SerializeAddon) => a.serialize().includes("split-utf8")],
  ] as const) {
    try {
      t.loadAddon(addon as never);
      const result = (inspect as (a: typeof addon) => boolean)(addon);
      record(name, !!result, result); addon.dispose();
    } catch (error) { record(name, false, String(error)); try { addon.dispose(); } catch { /* incompatible addon */ } }
  }
  t.reset(); t.resize(80, 24);
  const history = Array.from({ length: 100 }, (_, i) => `history-${i}\r\n`).join("");
  await engine.write(encode(history));
  record("scrollback retention", engine.text().includes("history-0") && engine.text().includes("history-99"), { lines: t.buffer.active.length });
  t.reset(); t.resize(80, 24); await engine.write(encode(approvalScreen));
  return checks;
}

// Synthetic end-to-end emulator writes, including callback scheduling and two
// animation frames. This is not pure-parser throughput or PTY/SSH throughput.
export interface BenchmarkProgress { kind: Kind; consumption: Engine["consumption"]; round: number; stage: string }
export async function benchmark(host: HTMLElement, progress?: (sample: BenchmarkProgress) => Promise<unknown> | void) {
  const payload = encode(Array.from({ length: 12000 }, (_, i) => `\x1b[3${i % 7 + 1}m${String(i).padStart(5, "0")} build output: abcdefghijklmnopqrstuvwxyz 0123456789\x1b[0m\r\n`).join(""));
  const results: unknown[] = [];
  const cases: Array<{ kind: Kind; consumption: Engine["consumption"] }> = [
    { kind: "xterm", consumption: "library-callback" },
    { kind: "ghostty", consumption: "library-callback" },
    { kind: "ghostty", consumption: "parse-return" },
  ];
  rounds: for (let round = 0; round < 4; round++) {
    for (const { kind, consumption } of (round % 2 ? [...cases].reverse() : cases)) {
      const target = document.createElement("div"); target.style.cssText = "width:800px;height:420px"; host.append(target);
      let engine: Engine | undefined;
      let ticker: ReturnType<typeof setInterval> | undefined;
      let stage = "create";
      let timedOut = false;
      const bounded = async <T>(work: () => Promise<T>, ms: number): Promise<T> => {
        await progress?.({ kind, consumption, round, stage });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([work(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => { timedOut = true; reject(new Error(`Raw benchmark deadline: ${stage} after ${ms}ms`)); }, ms);
          })]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
      };
      try {
        let started = 0;
        const currentEngine = await bounded<Engine>(() => { started = performance.now(); return createEngine(kind, target, true, consumption).then((created) => {
          // A late WASM load must not open an orphaned surface after timeout.
          if (timedOut) { created.dispose(); throw new Error("Raw benchmark creation completed after deadline"); }
          return created;
        }); }, 10000);
        engine = currentEngine;
        const startupMs = performance.now() - started;
        stage = "warmup"; await bounded(() => currentEngine.write("warmup\r\n"), 5000); currentEngine.term.reset();
        let last = performance.now(); let maxGapMs = 0;
        ticker = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; }, 5);
        let begin = 0; stage = "write and render";
        await bounded(async () => { begin = performance.now(); await writeWindow(currentEngine, payload); await frames(); }, 10000);
        const writeAndFramesMs = performance.now() - begin; clearInterval(ticker); ticker = undefined;
        results.push({ kind, consumption, renderer: currentEngine.renderer, round, bytes: payload.length, cols: currentEngine.term.cols, rows: currentEngine.term.rows,
          startupMs, writeAndFramesMs, maxTimerGapMs: maxGapMs, retainedLastLine: currentEngine.text().includes("11999 build output") });
      } catch (error) {
        results.push({ kind, consumption, round, stage, timedOut, visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(), error: error instanceof Error ? error.stack : String(error) });
      }
      finally {
        if (ticker) clearInterval(ticker);
        try { engine?.dispose(); } catch (error) { results.push({ kind, consumption, round, stage: "dispose", error: String(error) }); }
        target.remove();
      }
      // A stalled callback/rAF is an explicit failed sample. Stop rather than
      // spending the whole native deadline repeating an unavailable condition.
      if (timedOut) break rounds;
    }
  }
  return { userAgent: navigator.userAgent, devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency,
    method: "80x24, 2000 scrollback; 16KiB raw byte chunks, 64KiB callback window; warmup; alternating 4 rounds; completion + two rAFs; explicit library-callback vs experimental parse-return consumption (parse-return may block longer); excludes shell/SSH; startup includes shared WASM warm state after first load", results };
}
