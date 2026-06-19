import { useStore } from "../state/store";

export function TabBar() {
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const duplicateActiveTerminal = useStore((s) => s.duplicateActiveTerminal);

  return (
    <div className="tabbar">
      {terminals.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(t.id)}
          title={t.cwd}
        >
          <span className="tab-title">{t.title}</span>
          <button
            className="tab-close"
            title="Close terminal"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {terminals.length > 0 && (
        <button className="tab-new" title="New terminal in this worktree" onClick={() => duplicateActiveTerminal()}>
          +
        </button>
      )}
    </div>
  );
}
