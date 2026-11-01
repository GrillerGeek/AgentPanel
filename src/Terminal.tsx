import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  makeCopyPasteKeyHandler,
  makeContextMenuHandler,
  makeRightButtonGuard,
  type ClipboardDeps,
} from "./lib/terminalClipboard";
import { useStore } from "./state/store";
import { noteOutput, noteExit, forgetPane, noteRuntimeState, reportedState } from "./state/agentRuntime";
import { registerPane, unregisterPane } from "./lib/scrollbackRegistry";
import { registerPaneWriter, unregisterPaneWriter } from "./lib/paneWriters";
import type { HerdrRuntime } from "./types";
import { openTerminal, startInitialCommand, type TerminalConnection } from "./lib/terminalRuntime";
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
  runtime,
}: {
  cwd?: string;
  runtime?: HerdrRuntime;
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
  const sessionRef = useRef<TerminalConnection | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [reconnect, setReconnect] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const setPaneSession = useStore((s) => s.setPaneSession);
  const inheritTabTitle = useStore((s) => s.inheritTabTitle);
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
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
    term.open(container);

    // Copy/paste (issue #31): one paste pipeline only. Pasted text goes
    // through term.paste() -> onData -> pty_write, so bracketed paste is
    // honored and the WebView's native paste (suppressed in the handler)
    // can never produce a second write.
    const clipboardDeps: ClipboardDeps = {
      isMac: IS_MAC,
      readClipboard: readText,
      writeClipboard: writeText,
      pasteToTerminal: (text) => term.paste(text),
      getSelection: () => term.getSelection(),
      hasSelection: () => term.hasSelection(),
      clearSelection: () => term.clearSelection(),
      openSearch: () => setSearchOpen(true),
    };
    term.attachCustomKeyEventHandler(makeCopyPasteKeyHandler(clipboardDeps));
    const onContextMenu = makeContextMenuHandler(clipboardDeps);
    container.addEventListener("contextmenu", onContextMenu);
    // Keep right-clicks from also reaching a mouse-tracking app (e.g. Claude
    // Code), which would paste a second time.
    const onRightButton = makeRightButtonGuard(() => term.modes.mouseTrackingMode !== "none");
    container.addEventListener("mousedown", onRightButton, true);
    container.addEventListener("mouseup", onRightButton, true);

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

    let connection: TerminalConnection | null = null;
    let ready = false;
    let lost = false;
    setConnectionError("");
    if (runtime && paneId) noteRuntimeState(paneId, "unknown");
    let disposed = false;

    // Stream PTY output -> xterm, and feed the activity tracker (drives the
    // agent running/idle/awaiting status dots).
    const output = (chunk: string, consumed: () => void) => {
      if (disposed) return;
      const bytes = decodeBase64(chunk);
      term.write(bytes, consumed);
      if (paneId) noteOutput(paneId, tailDecoder.decode(bytes));
    };
    const disconnected = (message: string) => {
      if (disposed) return;
      ready = false;
      lost = true;
      setConnectionError(message);
      if (paneId) noteRuntimeState(paneId, "disconnected");
    };
    const failedInput = (error: unknown) => {
      if (runtime) disconnected(String(error));
      else pushToast(`Terminal input failed: ${error}`);
    };
    const terminateOnUnmount = () => !paneId || !useStore.getState().terminals.some((t) => t.panes.some((p) => p.id === paneId));

    // The child exiting on its own (not via pty_close) -> mark the agent done.
    let unlistenExit: (() => void) | undefined;
    void listen<{ sessionId: number; code: number | null }>("pty-exit", (e) => {
      if (paneId && !runtime && e.payload.sessionId === sessionRef.current?.id) {
        noteExit(paneId, e.payload.code ?? undefined);
      }
    }).then((u) => {
      if (disposed) u();
      else unlistenExit = u;
    });

    // Restore the saved buffer BEFORE the shell spawns, so the new prompt lands
    // after the restored text rather than racing it.
    //
    // The setting is read from the store here rather than taken as a hook
    // dependency on purpose: adding it to this effect's dep array would remount
    // every terminal — killing its PTY — whenever the toggle changes.
    const restoreThenSpawn = async () => {
      if (!runtime && paneId && useStore.getState().settings.persistScrollback) {
        try {
          const saved = await invoke<string>("scrollback_load", { paneId });
          if (!disposed && saved) {
            term.write(saved);
            // Dim rule so a stale buffer is never mistaken for a live agent.
            term.write("\r\n\x1b[2m── restored from your last session ──\x1b[0m\r\n");
          }
        } catch {
          // No saved buffer, or the store is unreadable — start clean.
        }
      }
      if (disposed) return;
      if (paneId && !runtime) registerPane(paneId, () => serialize.serialize());
      if (paneId) registerPaneWriter(paneId, (text) => term.paste(text));

      const env = await resolveSpawnEnv(shell, terminalEnv, syncLoginPath);
      const opened = await openTerminal({
        runtime, cwd: cwd ?? "", rows: term.rows, cols: term.cols, shell, env, output,
        status: (state) => { if (!disposed && paneId) noteRuntimeState(paneId, reportedState(state)); },
        closed: (code) => { ready = false; lost = true; if (!disposed && paneId) noteExit(paneId, code ?? undefined); },
        disconnected,
        binding: (binding) => { if (paneId) useStore.getState().setPaneBinding(paneId, binding); },
      });
      if (disposed) {
        await opened.dispose(terminateOnUnmount());
        return;
      }
      connection = opened;
      ready = !lost;
      sessionRef.current = opened;
      if (paneId) setPaneSession(paneId, opened.id);
      // Only a newly created terminal receives quick launch; reconnect never
      // replays a command into an existing shell/agent/approval dialog.
      if (ready) await startInitialCommand(opened, initialCommand);
    };
    void restoreThenSpawn().catch((err) => {
      if (!disposed) { term.writeln(`\r\n[terminal connection error] ${err}`); if (runtime) disconnected(String(err)); }
    });

    const dataSub = term.onData((data) => {
      if (connection && ready && !useStore.getState().confirmState) void connection.write(data).catch(failedInput);
    });

    // Agent CLIs (claude, codex) report session context via OSC title sequences;
    // agent tabs adopt it as the tab title (gating lives in inheritTabTitle).
    const titleSub = term.onTitleChange((title) => {
      if (paneId) inheritTabTitle(paneId, title);
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
        if (connection && (term.rows !== lastRows || term.cols !== lastCols)) {
          lastRows = term.rows;
          lastCols = term.cols;
          void connection.resize(term.rows, term.cols).catch(failedInput);
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
      container.removeEventListener("mousedown", onRightButton, true);
      container.removeEventListener("mouseup", onRightButton, true);
      dataSub.dispose();
      titleSub.dispose();
      unlistenExit?.();
      if (paneId) forgetPane(paneId);
      if (connection) void connection.dispose(terminateOnUnmount()).catch((err) => pushToast(`Could not close terminal: ${err}`));
      if (paneId) {
        if (!runtime && useStore.getState().settings.persistScrollback) {
          try {
            // An empty buffer means we never got a real capture (e.g. unmounted
            // before the restore load resolved) — writing it would overwrite this
            // pane's real history on disk with a blank "restored" banner.
            const data = serialize.serialize();
            if (data) void invoke("scrollback_save", { paneId, data }).catch(() => {});
          } catch {
            // Serialization can throw if the buffer is already torn down.
          }
        }
        unregisterPane(paneId);
        unregisterPaneWriter(paneId);
      }
      term.dispose(); // also disposes loaded addons (incl. WebGL, search)
      termRef.current = null;
      webglRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      sessionRef.current = null;
    };
  }, [cwd, reconnect]);

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
        void sessionRef.current.resize(term.rows, term.cols).catch((err) => pushToast(`Terminal resize failed: ${err}`));
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
      {runtime && <div className="runtime-status" role="status">
        Herdr core · {runtime.session}
        {connectionError && <> — {connectionError} <button onClick={() => setReconnect((n) => n + 1)}>Reconnect</button></>}
      </div>}
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
