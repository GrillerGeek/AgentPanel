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
}: {
  cwd?: string;
  paneId?: string;
  initialCommand?: string;
  autoFocus?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const setPaneSession = useStore((s) => s.setPaneSession);
  const shell = useStore((s) => s.settings.shell);
  const themeSlug = useStore((s) => s.settings.theme);
  const webglEnabled = useStore((s) => s.settings.webgl);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      theme: xtermThemeFor(schemeBySlug(themeSlug)),
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // WebGL is the fast renderer locally but streams poorly over remote desktop;
    // only load it when enabled (toggled live by the effect below).
    if (webglEnabled) {
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
        if (paneId) setPaneSession(paneId, id);
        // Agent quick-launch: run the command once the shell is up.
        if (initialCommand) void invoke("pty_write", { id, data: initialCommand + "\r" });
      })
      .catch((err) => term.writeln(`\r\n[pty_spawn error] ${err}`));

    // Forward keystrokes -> PTY.
    const dataSub = term.onData((data) => {
      if (sessionId !== null) void invoke("pty_write", { id: sessionId, data });
    });

    // Keep the PTY sized to the viewport. Skip while hidden (a tab on another
    // screen has a 0x0 container; fitting to that would corrupt the layout).
    const resize = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      if (sessionId !== null) {
        void invoke("pty_resize", { id: sessionId, rows: term.rows, cols: term.cols });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      if (sessionId !== null) void invoke("pty_close", { id: sessionId });
      term.dispose(); // also disposes loaded addons (incl. WebGL)
      termRef.current = null;
      webglRef.current = null;
    };
  }, [cwd]);

  // Live-toggle the WebGL renderer when the setting changes (no remount, so
  // sessions/scrollback survive). Off = CPU rendering = smoother remote desktop.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (webglEnabled && !webglRef.current) {
      try {
        const w = new WebglAddon();
        term.loadAddon(w);
        webglRef.current = w;
      } catch (e) {
        console.warn("WebGL addon unavailable", e);
      }
    } else if (!webglEnabled && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
  }, [webglEnabled]);

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
