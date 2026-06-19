import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./Terminal";
import { useStore } from "./state/store";
import "./App.css";

function App() {
  const loadRepositories = useStore((s) => s.loadRepositories);
  const selectedWorktreeId = useStore((s) => s.selectedWorktreeId);
  const worktrees = useStore((s) => s.worktrees);

  const selectedWorktree = selectedWorktreeId
    ? Object.values(worktrees)
        .flat()
        .find((w) => w.id === selectedWorktreeId)
    : undefined;

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  return (
    <div className="app">
      <header className="titlebar">AgentPanel</header>
      <div className="body">
        <Sidebar />
        <main className="content">
          {selectedWorktree ? (
            <TerminalPane key={selectedWorktree.id} cwd={selectedWorktree.path} />
          ) : (
            <div className="placeholder">Select a worktree to open a terminal.</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
