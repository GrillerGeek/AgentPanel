import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useStore } from "./state/store";
import { schemeBySlug, xtermThemeFor } from "./themes/apply";
import "@xterm/xterm/css/xterm.css";

/** Decode a base64 chunk from the Rust PTY into raw bytes for xterm. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Nerd Fonts that carry the powerline / icon glyphs (private-use area) used by
// modern prompts. Appended after the user's chosen font so missing icon glyphs
// fall through to whichever of these is installed — that's what makes powerline
// icons appear without forcing a Nerd Font as the primary face.
const NERD_FALLBACK = [
  "Symbols Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Caskaydia Cove Nerd Font",
  "FiraCode Nerd Font",
  "JetBrainsMono Nerd Font",
  "MesloLGS Nerd Font",
]
  .map((f) => `'${f}'`)
  .join(", ");

/** Compose the effective xterm font-family: user's primary, then the Nerd Font
 *  icon fallback, then plain monospace as the last resort. */
function composeFont(primary: string): string {
  const p = (primary || "").trim() || "Cascadia Code";
  return `${p}, ${NERD_FALLBACK}, Consolas, monospace`;
}

/**
 * A single terminal pane bound to one Rust PTY session.
 *
 * `cwd` is the working directory the shell starts in — in Phase 1 this becomes
 * the selected worktree path. For the Phase 0 spike it defaults to the user's
 * home (whatever the shell opens to).
 */
export function TerminalPane({
  cwd,
  paneId,
  initialCommand,
  autoFocus,
  active = true,
}: {
  cwd?: string;
  paneId?: string;
  initialCommand?: string;
  autoFocus?: boolean;
  /** True when this pane's tab is the visible one. Background panes keep their
   *  PTY + scrollback but detach the GPU renderer to avoid WebGL-context churn. */
  active?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const setPaneSession = useStore((s) => s.setPaneSession);
  const shell = useStore((s) => s.settings.shell);
  const themeSlug = useStore((s) => s.settings.theme);
  const webglEnabled = useStore((s) => s.settings.webgl);
  const fontFamily = useStore((s) => s.settings.fontFamily);
  const fontSize = useStore((s) => s.settings.fontSize);
  // WebGL is attached only when the pane is both enabled and visible.
  const webglWanted = webglEnabled && active;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: composeFont(fontFamily),
      fontSize,
      cursorBlink: true,
      theme: xtermThemeFor(schemeBySlug(themeSlug)),
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(container);

    // WebGL is the fast renderer locally but streams poorly over remote desktop,
    // and each live context taxes the GPU compositor — so only attach it when
    // this pane is enabled AND visible (toggled live by the effect below).
    if (webglWanted) {
      try {
        const w = new WebglAddon();
        term.loadAddon(w);
        webglRef.current = w;
      } catch (e) {
        console.warn("WebGL addon unavailable, falling back to canvas/DOM", e);
      }
    }

    fit.fit();

    let sessionId: number | null = null;
    let disposed = false;

    // Stream PTY output -> xterm.
    const onOutput = new Channel<string>();
    onOutput.onmessage = (chunk) => term.write(decodeBase64(chunk));

    invoke<number>("pty_spawn", {
      cwd: cwd ?? null,
      rows: term.rows,
      cols: term.cols,
      shell: shell || null,
      onOutput,
    })
      .then((id) => {
        if (disposed) {
          void invoke("pty_close", { id });
          return;
        }
        sessionId = id;
        sessionRef.current = id;
        if (paneId) setPaneSession(paneId, id);
        // Agent quick-launch: run the command once the shell is up.
        if (initialCommand) void invoke("pty_write", { id, data: initialCommand + "\r" });
      })
      .catch((err) => term.writeln(`\r\n[pty_spawn error] ${err}`));

    // Forward keystrokes -> PTY.
    const dataSub = term.onData((data) => {
      if (sessionId !== null) void invoke("pty_write", { id: sessionId, data });
    });

    // Keep the PTY sized to the viewport. ResizeObserver can fire many times per
    // frame during a window drag-resize; coalesce to one fit per frame (rAF) and
    // only round-trip pty_resize when the cell grid actually changes — otherwise
    // a continuous resize floods the Rust IPC channel and stutters the drag.
    // Skip while hidden (a hidden tab has a 0x0 container; fitting corrupts it).
    let rafId = 0;
    let lastRows = term.rows;
    let lastCols = term.cols;
    const resize = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        fit.fit();
        if (sessionId !== null && (term.rows !== lastRows || term.cols !== lastCols)) {
          lastRows = term.rows;
          lastCols = term.cols;
          void invoke("pty_resize", { id: sessionId, rows: term.rows, cols: term.cols });
        }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      dataSub.dispose();
      if (sessionId !== null) void invoke("pty_close", { id: sessionId });
      term.dispose(); // also disposes loaded addons (incl. WebGL)
      termRef.current = null;
      webglRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [cwd]);

  // Live-apply font changes (no remount, so scrollback survives). Font metrics
  // change the cell grid even though the container size doesn't, so the
  // ResizeObserver won't fire — re-fit and resize the PTY explicitly here.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = composeFont(fontFamily);
    term.options.fontSize = fontSize;
    const id = requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c || c.clientWidth === 0 || c.clientHeight === 0) return;
      fitRef.current?.fit();
      if (sessionRef.current !== null) {
        void invoke("pty_resize", { id: sessionRef.current, rows: term.rows, cols: term.cols });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [fontFamily, fontSize]);

  // Attach/detach the WebGL renderer when the setting changes OR this pane's tab
  // shows/hides (no remount, so sessions/scrollback survive). Detaching hidden
  // panes keeps the live WebGL-context count to the visible tab, which the GPU
  // compositor can present smoothly during window move/resize.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (webglWanted && !webglRef.current) {
      try {
        const w = new WebglAddon();
        term.loadAddon(w);
        webglRef.current = w;
      } catch (e) {
        console.warn("WebGL addon unavailable", e);
      }
      // Becoming visible: container just went from 0x0 to sized — re-fit so the
      // grid matches the viewport (and the freshly-attached renderer paints it).
      requestAnimationFrame(() => {
        const c = containerRef.current;
        if (c && c.clientWidth > 0 && c.clientHeight > 0) fitRef.current?.fit();
      });
    } else if (!webglWanted && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, [webglWanted]);

  // Live-update the terminal colors when the theme changes (no remount).
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermThemeFor(schemeBySlug(themeSlug));
  }, [themeSlug]);

  // Focus this terminal when its tab becomes active, so keystrokes go straight
  // to it without a click. (A short rAF lets the host become visible first.)
  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  return <div ref={containerRef} className="terminal-pane" />;
}
