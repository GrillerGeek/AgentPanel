import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { useStore } from "./state/store";
import { applyTheme, schemeBySlug } from "./themes/apply";
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

function App() {
  const loadRepositories = useStore((s) => s.loadRepositories);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshPrs = useStore((s) => s.refreshPrs);
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const closePane = useStore((s) => s.closePane);
  const theme = useStore((s) => s.settings.theme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply the selected theme to the app chrome (CSS variables on :root).
  useEffect(() => {
    applyTheme(schemeBySlug(theme));
  }, [theme]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  // Poll worktree status as a safety net (the file watcher drives instant
  // updates; this catches anything the throttle's trailing edge misses).
  useEffect(() => {
    const t = setInterval(() => void refreshStatuses(), 5000);
    return () => clearInterval(t);
  }, [refreshStatuses]);

  // Instant status refresh on file changes, debounced to coalesce bursts.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    void listen("worktrees-changed", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => void refreshStatuses(), 200);
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [refreshStatuses]);

  // Poll PR/CI status less often (slower-changing, hits the network via gh).
  useEffect(() => {
    void refreshPrs();
    const t = setInterval(() => void refreshPrs(), 30000);
    return () => clearInterval(t);
  }, [refreshPrs]);

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
      const idx = terminals.findIndex((t) => t.id === activeTabId);

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
      } else if (e.key === "Tab" && terminals.length > 1) {
        take();
        const next = e.shiftKey
          ? (idx - 1 + terminals.length) % terminals.length
          : (idx + 1) % terminals.length;
        st.setActiveTab(terminals[next].id);
      } else if (!e.shiftKey && e.key >= "1" && e.key <= "9") {
        const n = Number(e.key) - 1;
        if (n < terminals.length) {
          take();
          st.setActiveTab(terminals[n].id);
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
                    {t.panes.map((pane, paneIndex) => (
                      <div key={pane.id} className="pane-wrap">
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
                          autoFocus={t.id === activeTabId && paneIndex === 0}
                        />
                      </div>
                    ))}
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
