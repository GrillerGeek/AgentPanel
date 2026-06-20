import { Fragment, lazy, Suspense, useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { useStore } from "./state/store";
import { applyTheme, schemeBySlug } from "./themes/apply";
import { runBenchmark } from "./lib/bench";
import "./App.css";

// Lazy-loaded so the heavy xterm engine and on-demand modals are split out of
// the initial bundle (they only matter once a terminal opens / a modal opens).
const TerminalPane = lazy(() => import("./Terminal").then((m) => ({ default: m.TerminalPane })));
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);

/** Draggable divider between the two panes of a split tab. */
function PaneDivider({ onResize }: { onResize: (ratio: number) => void }) {
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const host = e.currentTarget.parentElement as HTMLElement;
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = (ev.clientX - rect.left) / rect.width;
      onResize(Math.min(0.85, Math.max(0.15, r)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div className="pane-divider" onPointerDown={onPointerDown} title="Drag to resize" />;
}

function App() {
  const loadRepositories = useStore((s) => s.loadRepositories);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshPrs = useStore((s) => s.refreshPrs);
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const closePane = useStore((s) => s.closePane);
  const setSplitRatio = useStore((s) => s.setSplitRatio);
  const pushToast = useStore((s) => s.pushToast);
  const theme = useStore((s) => s.settings.theme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply the selected theme to the app chrome (CSS variables on :root).
  useEffect(() => {
    applyTheme(schemeBySlug(theme));
  }, [theme]);

  // Perf benchmark: auto-run when launched with AGENTPANEL_BENCH=1, or on
  // Ctrl+Shift+B. Reports input-latency p95 + 25-terminal spawn responsiveness.
  useEffect(() => {
    const run = async () => {
      pushToast("Running perf benchmark…", "info");
      const r = (await runBenchmark()) as {
        latency: { p50: number; p95: number };
        spawn: { totalMs: number; maxFrameGapMs: number };
      };
      pushToast(
        `Latency p50 ${r.latency.p50}ms / p95 ${r.latency.p95}ms · 25 terms ${r.spawn.totalMs}ms, max frame gap ${r.spawn.maxFrameGapMs}ms`,
        "info",
      );
    };
    void invoke<boolean>("bench_requested").then((req) => {
      if (req) void run();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "B" || e.key === "b")) {
        e.preventDefault();
        e.stopPropagation();
        void run();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [pushToast]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  // Status poll as a safety net — only while the window is visible (no git
  // subprocess churn when backgrounded). Relaxed to 10s since the file watcher
  // drives instant updates while active.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) void refreshStatuses();
    }, 10000);
    return () => clearInterval(t);
  }, [refreshStatuses]);

  // Instant status refresh on file changes, debounced; skip while hidden.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    void listen("worktrees-changed", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden) void refreshStatuses();
      }, 200);
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [refreshStatuses]);

  // Poll PR/CI status less often (slower-changing, hits the network via gh),
  // and only while visible.
  useEffect(() => {
    void refreshPrs();
    const t = setInterval(() => {
      if (!document.hidden) void refreshPrs();
    }, 30000);
    return () => clearInterval(t);
  }, [refreshPrs]);

  // Catch up when the window becomes visible / regains focus. Debounced: moving
  // or resizing the window makes WebView2 fire a burst of focus/visibility events
  // during the modal drag loop, and we don't want each one kicking off a git/gh
  // refresh. One refresh ~300ms after the activity settles is plenty.
  useEffect(() => {
    let timer: number | undefined;
    const onActive = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          void refreshStatuses();
          void refreshPrs();
        }
      }, 300);
    };
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [refreshStatuses, refreshPrs]);

  // Global command-palette hotkey (Ctrl+Shift+P). Capture phase so it fires
  // before xterm.js consumes the keystroke when a terminal is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // Terminal tab shortcuts (capture phase so they beat xterm). State is read
  // fresh from the store so the listener can register once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.querySelector(".palette-backdrop")) return; // a modal is open
      const st = useStore.getState();
      const { terminals, activeTabId } = st;
      // Tab navigation is scoped to the active worktree (the tabs actually shown).
      const activeWt = terminals.find((t) => t.id === activeTabId)?.worktreeId ?? null;
      const wtTabs = terminals.filter((t) => t.worktreeId === activeWt);
      const idx = wtTabs.findIndex((t) => t.id === activeTabId);

      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if ((e.key === "t" || e.key === "T") && activeTabId) {
        take();
        st.duplicateActiveTerminal();
      } else if ((e.key === "w" || e.key === "W") && activeTabId) {
        take();
        st.closeTab(activeTabId);
      } else if (e.key === "Tab" && wtTabs.length > 1) {
        take();
        const next = e.shiftKey
          ? (idx - 1 + wtTabs.length) % wtTabs.length
          : (idx + 1) % wtTabs.length;
        st.setActiveTab(wtTabs[next].id);
      } else if (!e.shiftKey && e.key >= "1" && e.key <= "9") {
        const n = Number(e.key) - 1;
        if (n < wtTabs.length) {
          take();
          st.setActiveTab(wtTabs[n].id);
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <div className="app">
      <header className="titlebar">
        <span>AgentPanel</span>
        <span className="titlebar-right">
          <span className="titlebar-hint">Ctrl+Shift+P</span>
          <button className="gear" title="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </span>
      </header>
      <Toasts />
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <div className="body">
        <Sidebar />
        <main className="content">
          {terminals.length === 0 ? (
            <div className="placeholder">Select a worktree to open a terminal.</div>
          ) : (
            <>
              <TabBar />
              <div className="terminal-stack">
                {/* All tabs (and their panes) stay mounted so PTYs keep running
                    in parallel; only the active tab is visible. The xterm chunk
                    loads on first terminal (Suspense). */}
                <Suspense fallback={null}>
                {terminals.map((t) => (
                  <div
                    key={t.id}
                    className="terminal-host"
                    style={{ display: t.id === activeTabId ? "flex" : "none" }}
                  >
                    {t.panes.map((pane, paneIndex) => {
                      const ratio = t.splitRatio ?? 0.5;
                      const split = t.panes.length === 2;
                      return (
                        <Fragment key={pane.id}>
                          {paneIndex === 1 && (
                            <PaneDivider onResize={(r) => setSplitRatio(t.id, r)} />
                          )}
                          <div
                            className="pane-wrap"
                            style={split ? { flexGrow: paneIndex === 0 ? ratio : 1 - ratio } : undefined}
                          >
                            {t.panes.length > 1 && (
                              <button
                                className="pane-close"
                                title="Close pane"
                                onClick={() => closePane(t.id, pane.id)}
                              >
                                ✕
                              </button>
                            )}
                            <TerminalPane
                              cwd={t.cwd}
                              paneId={pane.id}
                              initialCommand={pane.initialCommand}
                              active={t.id === activeTabId}
                              autoFocus={t.id === activeTabId && paneIndex === 0}
                            />
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                ))}
                </Suspense>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
