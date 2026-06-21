import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore, selectActiveWorktreeId, worktreeLabels } from "../state/store";
import { aggregateAgentState, agentStateLabel, type AgentState } from "../state/activity";

// Tab color swatches for the right-click menu.
const TAB_COLORS = ["#f7768e", "#e0af68", "#9ece6a", "#7dcfff", "#7aa2f7", "#bb9af7"];

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
  const requestConfirm = useStore((s) => s.requestConfirm);
  const renameTab = useStore((s) => s.renameTab);
  const setTabColor = useStore((s) => s.setTabColor);

  // Right-click context menu (rename + color), positioned at the cursor.
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openMenu = (e: ReactMouseEvent, t: { id: string; title: string }) => {
    e.preventDefault();
    setRenameValue(t.title);
    setMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
  };
  const commitRename = () => {
    if (menu) {
      const name = renameValue.trim();
      if (name) renameTab(menu.tabId, name);
    }
    setMenu(null);
  };

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
          style={t.color ? { boxShadow: `inset 3px 0 0 0 ${t.color}` } : undefined}
          title={t.cwd + (tabState ? ` — ${agentStateLabel(tabState)}` : "") + "  ·  right-click to rename / color"}
          onClick={() => onClickTab(t.id)}
          onContextMenu={(e) => openMenu(e, t)}
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
            onClick={async (e) => {
              e.stopPropagation();
              if (tabState === "running" || tabState === "awaiting") {
                if (
                  !(await requestConfirm({
                    message: `Close "${t.title}"?`,
                    detail: `An agent here is ${agentStateLabel(tabState)} — closing ends its session.`,
                    confirmLabel: "Close",
                    danger: true,
                    dontAskKey: "close-running-tab",
                  }))
                )
                  return;
              }
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

      {menu && (
        <>
          <div
            className="ctx-menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="tab-menu" style={{ left: menu.x, top: menu.y }}>
            <input
              autoFocus
              className="tab-menu-input"
              value={renameValue}
              placeholder="Tab name"
              onChange={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setMenu(null);
              }}
            />
            <div className="tab-menu-colors">
              {TAB_COLORS.map((c) => (
                <button
                  key={c}
                  className="tab-swatch"
                  style={{ background: c }}
                  title="Set tab color"
                  onClick={() => {
                    setTabColor(menu.tabId, c);
                    setMenu(null);
                  }}
                />
              ))}
              <button
                className="tab-swatch tab-swatch-none"
                title="No color"
                onClick={() => {
                  setTabColor(menu.tabId, undefined);
                  setMenu(null);
                }}
              >
                ✕
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
