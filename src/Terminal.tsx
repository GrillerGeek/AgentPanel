import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useStore } from "./state/store";
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
  tabId,
  initialCommand,
}: {
  cwd?: string;
  tabId?: string;
  initialCommand?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setTabSession = useStore((s) => s.setTabSession);
  const shell = useStore((s) => s.settings.shell);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      theme: { background: "#1e1e1e", foreground: "#d4d4d4" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // WebGL is the fast renderer but can fail on some GPUs / headless setups.
    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL addon unavailable, falling back to canvas/DOM", e);
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
        if (tabId) setTabSession(tabId, id);
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
      term.dispose();
    };
  }, [cwd]);

  return <div ref={containerRef} className="terminal-pane" />;
}
