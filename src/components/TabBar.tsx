import { useStore } from "../state/store";

export function TabBar() {
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const duplicateActiveTerminal = useStore((s) => s.duplicateActiveTerminal);
  const splitActiveTab = useStore((s) => s.splitActiveTab);
  const runAgentInActive = useStore((s) => s.runAgentInActive);
  const agentCommands = useStore((s) => s.settings.agentCommands);

  const activeTab = terminals.find((t) => t.id === activeTabId);
  const canSplit = !!activeTab && activeTab.panes.length < 2;

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
      {canSplit && (
        <button className="tab-new" title="Split: second terminal beside this one" onClick={() => splitActiveTab()}>
          ◫
        </button>
      )}
      {activeTabId && agentCommands.length > 0 && (
        <span className="agent-launchers">
          {agentCommands.map((cmd) => (
            <button
              key={cmd}
              className="agent-btn"
              title={`Run "${cmd}" in a new terminal in the active worktree`}
              onClick={() => runAgentInActive(cmd)}
            >
              ▶ {cmd}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
