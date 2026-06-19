import { useEffect, useState } from "react";
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  // Poll worktree status (branch + dirty count) so the sidebar stays live.
  useEffect(() => {
    const t = setInterval(() => void refreshStatuses(), 2500);
    return () => clearInterval(t);
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
                {/* All panes stay mounted so their PTYs keep running in parallel;
                    only the active one is visible. */}
                {terminals.map((t) => (
                  <div
                    key={t.id}
                    className="terminal-host"
                    style={{ display: t.id === activeTabId ? "block" : "none" }}
                  >
                    <TerminalPane cwd={t.cwd} tabId={t.id} initialCommand={t.initialCommand} />
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
