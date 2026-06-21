import type { Worktree, WorktreeStatus } from "../types";

/**
 * Per-agent lifecycle state, derived from PTY output timing + the recent output
 * tail (see `agentRuntime.ts`). Deliberately heuristic and conservative: we'd
 * rather under-claim "awaiting" than cry wolf (the report's honesty tension).
 */
export type AgentState = "running" | "idle" | "awaiting" | "exited";

/** Higher = more deserving of your attention; used to aggregate + sort. */
export const AGENT_STATE_RANK: Record<AgentState, number> = {
  awaiting: 3,
  exited: 2,
  running: 1,
  idle: 0,
};

// Strip ANSI / escape sequences so prompt matching works on plain text. Each
// alternative requires the ESC () prefix, so literal text like "[y/n]"
// (which has no ESC) is preserved for matching.
const ANSI = /\[[0-9;?]*[ -/]*[@-~]|\][^]*|[@-Z\\-_]/g;

// Treat output within this window as "still working".
const RUNNING_MS = 1500;

// Explicit confirmation prompts only — NOT generic shell prompts. Conservative
// on purpose so an idle shell never reads as "needs input".
const AWAITING_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\[yes\/no\]/i,
  /press\s+enter\s+to\s+continue/i,
  /press\s+any\s+key/i,
  /\bcontinue\?\s*$/i,
  /\bproceed\?\s*$/i,
  /\boverwrite\b[^?\n]*\?/i,
  /do you want to (proceed|continue|allow)/i,
  /are you sure/i,
  /\bconfirm\b[^?\n]*\?/i,
  /allow this (action|command|tool)/i,
];

export interface PaneRuntime {
  lastOutputAt: number;
  tail: string;
  exited: boolean;
  code?: number;
}

/** Derive an agent's state from its runtime snapshot at time `now`. */
export function detectAgentState(r: PaneRuntime, now: number): AgentState {
  if (r.exited) return "exited";
  if (now - r.lastOutputAt < RUNNING_MS) return "running";
  const tail = r.tail.replace(ANSI, "");
  const lastLines = tail.split(/\r?\n/).slice(-3).join("\n").trimEnd();
  if (AWAITING_PATTERNS.some((re) => re.test(lastLines))) return "awaiting";
  return "idle";
}

/** Reduce many panes' states to the single most attention-worthy one. */
export function aggregateAgentState(states: AgentState[]): AgentState | null {
  let best: AgentState | null = null;
  for (const s of states) {
    if (best === null || AGENT_STATE_RANK[s] > AGENT_STATE_RANK[best]) best = s;
  }
  return best;
}

/** Short human label for tooltips. */
export function agentStateLabel(state: AgentState): string {
  switch (state) {
    case "awaiting":
      return "waiting for input";
    case "running":
      return "running";
    case "exited":
      return "exited";
    case "idle":
      return "idle";
  }
}

/**
 * Sidebar activity ranking (AgentPanel's analog of Supacode's
 * SidebarActiveClassification). Higher score sorts higher, so the worktrees
 * most likely to need attention float to the top.
 *
 * Signals available today: an open terminal (an agent is likely running here)
 * and dirty-file count. Live agent state layers on top in the sidebar sort.
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
