import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useStore, selectActiveWorktreeId, worktreeLabels } from "../state/store";
import { aggregateAgentState, agentStateLabel, type AgentState } from "../state/activity";

export function TabBar() {
  const allTerminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const repositories = useStore((s) => s.repositories);
  const worktrees = useStore((s) => s.worktrees);
  const labels = useMemo(() => worktreeLabels(repositories, worktrees), [repositories, worktrees]);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const duplicateActiveTerminal = useStore((s) => s.duplicateActiveTerminal);
  const splitActiveTab = useStore((s) => s.splitActiveTab);
  const reorderTab = useStore((s) => s.reorderTab);
  const runAgentInActive = useStore((s) => s.runAgentInActive);
  const agentCommands = useStore((s) => s.settings.agentCommands);
  const agentStatus = useStore((s) => s.agentStatus);

  // Only the active worktree's tabs are shown — so the bar reflects the repo/
  // branch you're working in instead of mixing every repo's terminals together.
  const terminals = allTerminals.filter((t) => t.worktreeId === activeWorktreeId);
  const context = activeWorktreeId ? labels[activeWorktreeId] : undefined;

  // Pointer-based reorder (works locally AND over remote desktop, unlike the
  // native HTML5 drag-and-drop which doesn't survive a remote session).
  const drag = useRef<{ id: string; startX: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, startX: e.clientX, active: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.startX) < 5) return; // movement threshold
      d.active = true;
    }
    const overId = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-tabid]")?.dataset.tabid;
    if (overId && overId !== d.id) reorderTab(d.id, overId);
  };
  const onPointerUp = () => {
    if (drag.current?.active) suppressClick.current = true;
    drag.current = null;
  };
  const onClickTab = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return; // this "click" was the end of a drag
    }
    setActiveTab(id);
  };

  const activeTab = terminals.find((t) => t.id === activeTabId);
  const canSplit = !!activeTab && activeTab.panes.length < 2;

  return (
    <div className="tabbar">
      {context && (
        <span className="tabbar-context" title={`${context.repo} / ${context.branch}`}>
          <span className="ctx-repo">{context.repo}</span>
          <span className="ctx-sep">/</span>
          <span className="ctx-branch">{context.branch}</span>
        </span>
      )}
      {terminals.map((t) => {
        const tabState = aggregateAgentState(
          t.panes.map((p) => agentStatus[p.id]).filter(Boolean) as AgentState[],
        );
        return (
        <div
          key={t.id}
          data-tabid={t.id}
          className={`tab ${t.id === activeTabId ? "active" : ""}`}
          title={t.cwd + (tabState ? ` — ${agentStateLabel(tabState)}` : "")}
          onClick={() => onClickTab(t.id)}
          onPointerDown={(e) => onPointerDown(e, t.id)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {tabState && <span className={`agent-dot agent-${tabState}`} aria-hidden />}
          <span className="tab-title">{t.title}</span>
          <button
            className="tab-close"
            title="Close terminal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
            }}
          >
            ✕
          </button>
        </div>
        );
      })}
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
