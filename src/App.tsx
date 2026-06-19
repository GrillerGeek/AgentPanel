import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsModal } from "./components/SettingsModal";
import { TerminalPane } from "./Terminal";
import { useStore } from "./state/store";
import "./App.css";

function App() {
  const loadRepositories = useStore((s) => s.loadRepositories);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshPrs = useStore((s) => s.refreshPrs);
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const closePane = useStore((s) => s.closePane);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
                    in parallel; only the active tab is visible. */}
                {terminals.map((t) => (
                  <div
                    key={t.id}
                    className="terminal-host"
                    style={{ display: t.id === activeTabId ? "flex" : "none" }}
                  >
                    {t.panes.map((pane) => (
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
                        <TerminalPane cwd={t.cwd} paneId={pane.id} initialCommand={pane.initialCommand} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
