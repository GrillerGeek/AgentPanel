import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore } from "./state/store";
import { noteOutput, noteExit, forgetPane } from "./state/agentRuntime";
import { schemeBySlug, xtermThemeFor } from "./themes/apply";
import "@xterm/xterm/css/xterm.css";

// Reused decoder for the activity tail (lossy is fine — it only feeds ASCII
// prompt matching; the terminal itself still renders the raw bytes).
const tailDecoder = new TextDecoder();

// The copy/paste modifier follows platform convention: Cmd on macOS, Ctrl
// elsewhere. This keeps Ctrl+C as the interrupt key on macOS (where Cmd+C
// copies) while giving Windows/Linux the Ctrl+C/Ctrl+V they expect.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Decode a base64 chunk from the Rust PTY into raw bytes for xterm. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Parse newline-separated KEY=VALUE pairs into an env map. */
function parseInjectedEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    out[key] = trimmed.slice(eq + 1);
  }
  return out;
}

async function resolveSpawnEnv(shell: string, terminalEnv: string, syncLoginPath: boolean) {
  const env = parseInjectedEnv(terminalEnv);
  if (syncLoginPath && !("PATH" in env)) {
    try {
      const path = await invoke<string>("detect_login_path", { shell: shell || null });
      if (path.trim()) env.PATH = path.trim();
    } catch {
      // Non-macOS or login-shell detection failed: keep explicit user env only.
    }
  }
  return Object.keys(env).length ? env : null;
}

function shouldShowMacPathOnboardingHint(
  terminalEnv: string,
  syncLoginPath: boolean,
  pathSyncHintShown: boolean,
): boolean {
  return IS_MAC && !pathSyncHintShown && !syncLoginPath && !("PATH" in parseInjectedEnv(terminalEnv));
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
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const setPaneSession = useStore((s) => s.setPaneSession);
  const shell = useStore((s) => s.settings.shell);
  const terminalEnv = useStore((s) => s.settings.terminalEnv);
  const syncLoginPath = useStore((s) => s.settings.syncLoginPath);
  const pathSyncHintShown = useStore((s) => s.settings.pathSyncHintShown);
  const themeSlug = useStore((s) => s.settings.theme);
  const webglEnabled = useStore((s) => s.settings.webgl);
  const fontFamily = useStore((s) => s.settings.fontFamily);
  const fontSize = useStore((s) => s.settings.fontSize);
  const pushToast = useStore((s) => s.pushToast);
  const updateSettings = useStore((s) => s.updateSettings);
  // WebGL is attached only when the pane is both enabled and visible.
  const webglWanted = webglEnabled && active;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (shouldShowMacPathOnboardingHint(terminalEnv, syncLoginPath, pathSyncHintShown)) {
      pushToast(
        'macOS tip: If commands are missing, open Settings and use "Import PATH from login shell" or enable "Auto-sync PATH from login shell".',
        "info",
      );
      updateSettings({ pathSyncHintShown: true });
    }

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
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    term.open(container);

    // Copy the current selection to the system clipboard (no-op if nothing is
    // selected). Async write is fire-and-forget — the key handler stays sync.
    const copySelection = () => {
      const sel = term.getSelection();
      if (sel) void writeText(sel);
    };
    // Paste clipboard text into the shell by writing it to the PTY, exactly as
    // if it had been typed. Guards against an empty clipboard / dead session.
    const pasteClipboard = () => {
      void readText().then((text) => {
        if (text && sessionRef.current !== null) {
          void invoke("pty_write", { id: sessionRef.current, data: text });
        }
      });
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      // Find uses Ctrl on every platform (it predates the clipboard work).
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
        setSearchOpen(true);
        return false;
      }
      // Copy/paste use the platform's primary modifier; require the *other*
      // modifier to be absent so e.g. macOS Ctrl+C still interrupts the shell.
      const copyPasteMod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (copyPasteMod && !e.altKey && !e.shiftKey) {
        // Copy when text is selected; with no selection, fall through so the
        // shell receives the interrupt — the key that stops a runaway agent.
        if (e.key === "c" || e.key === "C") {
          if (term.hasSelection()) {
            copySelection();
            term.clearSelection();
            return false;
          }
          return true;
        }
        if (e.key === "v" || e.key === "V") {
          pasteClipboard();
          return false;
        }
      }
      return true;
    });

    // Right-click follows the Windows-console "QuickEdit" model: copy the
    // selection if there is one, otherwise paste. Prevent the default so the
    // webview doesn't clear the selection or show its own context menu.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        copySelection();
        term.clearSelection();
      } else {
        pasteClipboard();
      }
    };
    container.addEventListener("contextmenu", onContextMenu);

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

    // Stream PTY output -> xterm, and feed the activity tracker (drives the
    // agent running/idle/awaiting status dots).
    const onOutput = new Channel<string>();
    onOutput.onmessage = (chunk) => {
      const bytes = decodeBase64(chunk);
      term.write(bytes);
      if (paneId) noteOutput(paneId, tailDecoder.decode(bytes));
    };

    // The child exiting on its own (not via pty_close) -> mark the agent done.
    let unlistenExit: (() => void) | undefined;
    void listen<{ sessionId: number; code: number | null }>("pty-exit", (e) => {
      if (paneId && e.payload.sessionId === sessionRef.current) {
        noteExit(paneId, e.payload.code ?? undefined);
      }
    }).then((u) => {
      if (disposed) u();
      else unlistenExit = u;
    });

    void resolveSpawnEnv(shell, terminalEnv, syncLoginPath)
      .then((env) =>
        invoke<number>("pty_spawn", {
          cwd: cwd ?? null,
          rows: term.rows,
          cols: term.cols,
          shell: shell || null,
          env,
          onOutput,
        }),
      )
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
      container.removeEventListener("contextmenu", onContextMenu);
      dataSub.dispose();
      unlistenExit?.();
      if (paneId) forgetPane(paneId);
      if (sessionId !== null) void invoke("pty_close", { id: sessionId });
      term.dispose(); // also disposes loaded addons (incl. WebGL, search)
      termRef.current = null;
      webglRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
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

  const runSearch = (q: string, prev = false) => {
    if (!q) return;
    if (prev) searchRef.current?.findPrevious(q);
    else searchRef.current?.findNext(q);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations?.();
    termRef.current?.focus();
  };

  return (
    <div className="terminal-pane-wrap">
      {searchOpen && (
        <div className="term-search" onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            className="term-search-input"
            placeholder="Find in terminal"
            value={query}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setQuery(v);
              runSearch(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query, e.shiftKey);
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button className="term-search-btn" title="Previous (Shift+Enter)" onClick={() => runSearch(query, true)}>
            ↑
          </button>
          <button className="term-search-btn" title="Next (Enter)" onClick={() => runSearch(query)}>
            ↓
          </button>
          <button className="term-search-btn" title="Close (Esc)" onClick={closeSearch}>
            ✕
          </button>
        </div>
      )}
      <div ref={containerRef} className="terminal-pane" />
    </div>
  );
}
