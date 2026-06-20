// Mirrors the Rust `model.rs` structs (serialized camelCase).

export interface Repository {
  id: string;
  path: string;
  name: string;
  isGit: boolean;
}

export interface Worktree {
  id: string;
  repoId: string;
  path: string;
  name: string;
  branch: string | null;
  isPrimary: boolean;
}

/** One terminal pane = one Rust PTY session. A tab holds 1–2 panes. */
export interface Pane {
  id: string;
  /** command auto-run once this pane's shell spawns (agent quick-launch) */
  initialCommand?: string;
}

/** An open terminal tab. All its panes share the worktree (cwd). */
export interface TerminalTab {
  id: string;
  worktreeId: string;
  cwd: string;
  title: string;
  panes: Pane[];
  /** for a 2-pane split: fraction of width given to the first pane (0.15–0.85) */
  splitRatio?: number;
}

/** User settings (persisted in localStorage). */
export interface Settings {
  shell: string;
  agentCommands: string[];
  theme: string; // scheme slug
}

/** A transient notification (e.g. a failed git/gh op). */
export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

/** Pull-request info for a worktree branch (via gh). */
export interface PrInfo {
  number: number;
  state: string; // OPEN | MERGED | CLOSED
  title: string;
  url: string;
  checks: string; // passing | failing | pending | none
}

/** Live status of a worktree (polled). */
export interface WorktreeStatus {
  branch: string | null;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommit: string | null;
}
