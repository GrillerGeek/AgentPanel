import type { Worktree, WorktreeStatus } from "../types";

/**
 * Sidebar activity ranking (AgentPanel's analog of Supacode's
 * SidebarActiveClassification). Higher score sorts higher, so the worktrees
 * most likely to need attention float to the top.
 *
 * Signals available today: an open terminal (an agent is likely running here)
 * and dirty-file count. When PTY busy/idle detection lands, this is the single
 * place that grows richer — call sites don't change.
 */
export function worktreeActivityScore(wt: Worktree, hasTerminal: boolean, dirty: number): number {
  if (hasTerminal && dirty > 0) return 4; // active agent with uncommitted work
  if (hasTerminal) return 3; // terminal open (agent likely running)
  if (dirty > 0) return 2; // uncommitted changes, no terminal
  if (wt.isPrimary) return 1; // main worktree anchor
  return 0; // idle
}

/**
 * Stable activity sort: by score desc, then primary-first, then name — so
 * equal-activity rows don't jitter as statuses poll.
 */
export function sortWorktrees(
  worktrees: Worktree[],
  openWorktreeIds: Set<string>,
  statuses: Record<string, WorktreeStatus>,
): Worktree[] {
  return [...worktrees].sort((a, b) => {
    const sa = worktreeActivityScore(a, openWorktreeIds.has(a.id), statuses[a.id]?.dirty ?? 0);
    const sb = worktreeActivityScore(b, openWorktreeIds.has(b.id), statuses[b.id]?.dirty ?? 0);
    if (sa !== sb) return sb - sa;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
