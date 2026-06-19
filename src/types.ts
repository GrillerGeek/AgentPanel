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

/** An open terminal tab bound (1:1) to a Rust PTY session. */
export interface TerminalTab {
  id: string;
  worktreeId: string;
  cwd: string;
  title: string;
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
