import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, selectActiveWorktreeId, worktreeLabels } from "../state/store";
import { aggregateAgentState, agentStateLabel, type AgentState } from "../state/activity";

// Tab color swatches for the right-click menu.
const TAB_COLORS = ["#f7768e", "#e0af68", "#9ece6a", "#7dcfff", "#7aa2f7", "#bb9af7"];

/**
 * Base tab label. The branch/worktree is already shown permanently in the tab-bar
 * context chip on the left, so we don't repeat it on each tab:
 *  - a default tab (title == branch)        -> "Terminal" (generic)
 *  - an agent tab  (title == "branch · cmd")-> "cmd"      (generic)
 *  - a custom-renamed tab                   -> shown as-is (not generic)
 *
 * `generic` labels get numbered when several share the same text; custom names
 * are left exactly as the user typed them.
 */
function labelInfo(title: string, branch?: string): { text: string; generic: boolean } {
  if (!branch) return { text: title, generic: false };
  if (title === branch) return { text: "Terminal", generic: true };
  const prefix = `${branch} · `;
  if (title.startsWith(prefix)) return { text: title.slice(prefix.length), generic: true };
  return { text: title, generic: false };
}

/** Resolve display labels for a worktree's tabs, numbering repeated generic ones. */
export function displayLabels(titles: string[], branch?: string): string[] {
  const infos = titles.map((t) => labelInfo(t, branch));
  const counts = new Map<string, number>();
  for (const i of infos) if (i.generic) counts.set(i.text, (counts.get(i.text) ?? 0) + 1);
  const seen = new Map<string, number>();
  return infos.map((i) => {
    if (i.generic && (counts.get(i.text) ?? 0) > 1) {
      const n = (seen.get(i.text) ?? 0) + 1;
      seen.set(i.text, n);
      return `${i.text} ${n}`;
    }
    return i.text;
  });
}

export function TabBar({
  onOpenSettings,
  onToggleNotes,
  notesOpen = false,
}: {
  onOpenSettings: () => void;
  onToggleNotes?: () => void;
  notesOpen?: boolean;
}) {
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
  const editorCommand = useStore((s) => s.settings.editorCommand);
  const pushToast = useStore((s) => s.pushToast);

  // Right-click context menu (rename + color), positioned at the cursor.
  const [menu, setMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
    original: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openMenu = (e: ReactMouseEvent, tabId: string, label: string) => {
    e.preventDefault();
    setRenameValue(label);
    setMenu({ tabId, x: e.clientX, y: e.clientY, original: label });
  };
  // Commit a pending rename and close. Only renames if the text actually changed
  // from the prefill, so clicking a color on an un-renamed tab doesn't pin its
  // auto-generated label (e.g. "Terminal 2") as a custom name.
  const commitRename = () => {
    if (menu) {
      const name = renameValue.trim();
      if (name && name !== menu.original) renameTab(menu.tabId, name);
    }
    setMenu(null);
  };
  // Applying a color also commits whatever the user typed (the reported bug:
  // typing a name then clicking a swatch used to drop the name).
  const applyColor = (color: string | undefined) => {
    if (menu) setTabColor(menu.tabId, color);
    commitRename();
  };

  // Only the active worktree's tabs are shown — so the bar reflects the repo/
  // branch you're working in instead of mixing every repo's terminals together.
  const terminals = allTerminals.filter((t) => t.worktreeId === activeWorktreeId);
  const context = activeWorktreeId ? labels[activeWorktreeId] : undefined;
  const tabLabels = displayLabels(
    terminals.map((t) => t.title),
    context?.branch,
  );

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
  const activeWorktree = Object.values(worktrees)
    .flat()
    .find((w) => w.id === activeWorktreeId);

  return (
    <div className="tabbar">
      {context && (
        <span className="tabbar-context" title={`${context.repo} / ${context.branch}`}>
          <span className="ctx-repo">{context.repo}</span>
          <span className="ctx-sep">/</span>
          <span className="ctx-branch">{context.branch}</span>
        </span>
      )}
      {activeWorktree && (
        <button
          className="icon-btn editor-btn"
          title={`Open in "${editorCommand}"`}
          onClick={() => {
            invoke("open_in_editor", { command: editorCommand, path: activeWorktree.path }).catch((err) => {
              console.error("open_in_editor failed", err);
              pushToast(`Couldn't run "${editorCommand}" — is it on your PATH?`, "error");
            });
          }}
        >
          ⟨/⟩
        </button>
      )}
      {terminals.map((t, i) => {
        const tabState = aggregateAgentState(
          t.panes.map((p) => agentStatus[p.id]).filter(Boolean) as AgentState[],
        );
        const label = tabLabels[i];
        return (
        <div
          key={t.id}
          data-tabid={t.id}
          className={`tab ${t.id === activeTabId ? "active" : ""}`}
          style={t.color ? { boxShadow: `inset 3px 0 0 0 ${t.color}` } : undefined}
          title={t.cwd + (tabState ? ` — ${agentStateLabel(tabState)}` : "") + "  ·  right-click to rename / color"}
          onClick={() => onClickTab(t.id)}
          onContextMenu={(e) => openMenu(e, t.id, label)}
          onPointerDown={(e) => onPointerDown(e, t.id)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {tabState && <span className={`agent-dot agent-${tabState}`} aria-hidden />}
          <span className="tab-title">{label}</span>
          <button
            className="tab-close"
            title="Close terminal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={async (e) => {
              e.stopPropagation();
              if (tabState === "running" || tabState === "awaiting") {
                if (
                  !(await requestConfirm({
                    message: `Close "${label}"?`,
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
      <button
        className={`gear notes-toggle ${notesOpen ? "active" : ""}`}
        title="Notes for this session"
        onClick={() => onToggleNotes?.()}
      >
        📝
      </button>
      <button
        className="gear"
        title="Settings — command palette: Ctrl+Shift+P"
        onClick={onOpenSettings}
      >
        ⚙
      </button>

      {menu && (
        <>
          <div
            className="ctx-menu-backdrop"
            onClick={() => commitRename()}
            onContextMenu={(e) => {
              e.preventDefault();
              commitRename();
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
                if (e.key === "Escape") setMenu(null); // Esc cancels (no rename)
              }}
            />
            <div className="tab-menu-colors">
              {TAB_COLORS.map((c) => (
                <button
                  key={c}
                  className="tab-swatch"
                  style={{ background: c }}
                  title="Set tab color"
                  onClick={() => applyColor(c)}
                />
              ))}
              <button
                className="tab-swatch tab-swatch-none"
                title="No color"
                onClick={() => applyColor(undefined)}
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
