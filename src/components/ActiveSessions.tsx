import { useMemo } from "react";
import { useStore, selectActiveWorktreeId, worktreeLabels } from "../state/store";
import { aggregateAgentState, agentStateLabel, type AgentState } from "../state/activity";

/**
 * The "Active terminals" section pinned to the top of the sidebar: every worktree
 * that currently has running terminals, shown as repo / branch. Clicking one makes
 * it the active session (its tabs fill the tab bar); the active one is highlighted
 * so it's always clear which repo/branch you're working in.
 */
export function ActiveSessions() {
  const terminals = useStore((s) => s.terminals);
  const repositories = useStore((s) => s.repositories);
  const worktrees = useStore((s) => s.worktrees);
  const labels = useMemo(() => worktreeLabels(repositories, worktrees), [repositories, worktrees]);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const agentStatus = useStore((s) => s.agentStatus);
  const setActiveWorktree = useStore((s) => s.setActiveWorktree);
  const closeWorktreeTerminals = useStore((s) => s.closeWorktreeTerminals);

  // Distinct worktrees with terminals, in first-appearance order, with tab counts
  // and an aggregated agent state (most attention-worthy pane wins).
  const counts = new Map<string, number>();
  const order: string[] = [];
  const stateByWorktree: Record<string, AgentState> = {};
  for (const t of terminals) {
    if (!counts.has(t.worktreeId)) order.push(t.worktreeId);
    counts.set(t.worktreeId, (counts.get(t.worktreeId) ?? 0) + 1);
  }
  for (const wtId of order) {
    const states = terminals
      .filter((t) => t.worktreeId === wtId)
      .flatMap((t) => t.panes.map((p) => agentStatus[p.id]))
      .filter(Boolean) as AgentState[];
    const agg = aggregateAgentState(states);
    if (agg) stateByWorktree[wtId] = agg;
  }

  if (order.length === 0) return null;

  return (
    <div className="sessions">
      <div className="sidebar-header">
        <span>Active terminals</span>
      </div>
      <div className="session-list">
        {order.map((worktreeId) => {
          const label = labels[worktreeId];
          const active = worktreeId === activeWorktreeId;
          return (
            <div key={worktreeId} className={`session-row ${active ? "active" : ""}`}>
              <button
                className="session"
                onClick={() => setActiveWorktree(worktreeId)}
                title={
                  (label ? `${label.repo} / ${label.branch}` : worktreeId) +
                  (stateByWorktree[worktreeId] ? ` — ${agentStateLabel(stateByWorktree[worktreeId])}` : "")
                }
              >
                {stateByWorktree[worktreeId] && (
                  <span
                    className={`agent-dot agent-${stateByWorktree[worktreeId]}`}
                    aria-label={agentStateLabel(stateByWorktree[worktreeId])}
                  />
                )}
                <span className="session-branch">{label?.branch ?? "terminal"}</span>
                {label?.repo && <span className="session-repo">{label.repo}</span>}
                <span className="session-count" title={`${counts.get(worktreeId)} terminal(s)`}>
                  {counts.get(worktreeId)}
                </span>
              </button>
              <button
                className="icon-btn"
                title="Close all terminals in this worktree"
                onClick={() => void closeWorktreeTerminals(worktreeId)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
