import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon as XtermFit } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Ghostty, Terminal as GhostTerminal, FitAddon as GhostFit } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";

export type Kind = "xterm" | "ghostty";
export type Emulator = Xterm | GhostTerminal;
export interface Engine {
  kind: Kind;
  term: Emulator;
  renderer: string;
  consumption: "library-callback" | "parse-return";
  fit(): void;
  text(): string;
  write(data: string | Uint8Array): Promise<void>;
  dispose(): void;
}
let ghostty: Promise<Ghostty> | undefined;
export async function createEngine(kind: Kind, parent: HTMLElement, webgl = true, consumption: Engine["consumption"] = "library-callback"): Promise<Engine> {
  const options = { cols: 80, rows: 24, fontSize: 14, fontFamily: "Menlo, Consolas, monospace", scrollback: 2000,
    cursorBlink: false, theme: { background: "#171923", foreground: "#d7dae0", cursor: "#a6e3a1" } };
  const term = kind === "ghostty"
    ? new GhostTerminal({ ...options, ghostty: await (ghostty ??= Ghostty.load(wasmUrl)) })
    : new Xterm(options);
  const fit = kind === "ghostty" ? new GhostFit() : new XtermFit();
  // Each factory branch uses its library's own addon; no xterm addon is assumed compatible.
  term.loadAddon(fit as never);
  term.open(parent);
  let renderer = "Canvas 2D";
  if (term instanceof Xterm) {
    renderer = "DOM";
    if (webgl) {
      try { term.loadAddon(new WebglAddon()); renderer = "WebGL"; } catch { /* record actual fallback */ }
    }
  }
  return { kind, term, renderer, consumption, fit: () => fit.fit(),
    text: () => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
      return lines.join("\n");
    },
    write: (data) => new Promise<void>((resolve, reject) => {
      try {
        if (kind === "ghostty" && consumption === "parse-return") {
          // Experimental only: pinned 0.4.0 parses synchronously in write().
          // Resolve after parsing, without waiting for its rAF callback. This
          // deliberately measures the latency tradeoff, not production behavior.
          term.write(data); resolve();
        } else term.write(data, resolve);
      } catch (e) { reject(e); }
    }),
    dispose: () => term.dispose() };
}

// Bound work while preserving the same consumed-callback contract used by Herdr.
export async function writeWindow(engine: Engine, bytes: Uint8Array, windowBytes = 65536): Promise<void> {
  const chunk = 16384;
  for (let offset = 0; offset < bytes.length; offset += windowBytes) {
    const pending: Promise<void>[] = [];
    for (let start = offset; start < Math.min(offset + windowBytes, bytes.length); start += chunk) {
      pending.push(engine.write(bytes.subarray(start, Math.min(start + chunk, bytes.length))));
    }
    await Promise.all(pending);
  }
}
export const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
