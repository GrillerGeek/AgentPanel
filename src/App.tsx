import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TerminalPane } from "./Terminal";
import { useStore } from "./state/store";
import "./App.css";

function App() {
  const loadRepositories = useStore((s) => s.loadRepositories);
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  return (
    <div className="app">
      <header className="titlebar">AgentPanel</header>
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
                    <TerminalPane cwd={t.cwd} tabId={t.id} />
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
