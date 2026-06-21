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
  /** optional user-assigned tab color (hex), shown as a left accent stripe */
  color?: string;
}

/** User settings (persisted in localStorage). */
export interface Settings {
  shell: string;
  agentCommands: string[];
  theme: string; // scheme slug
  /** xterm WebGL renderer — fast locally; turn off for smoother remote desktop */
  webgl: boolean;
  /** primary terminal font family; a Nerd Font fallback is appended for icons */
  fontFamily: string;
  /** terminal font size in px */
  fontSize: number;
  /** OS + in-app notifications when a background agent finishes / needs input */
  notifications: boolean;
  /** dontAskKeys the user dismissed via "don't ask again" on a confirm dialog */
  confirmsDisabled: string[];
}

/** A pending confirmation prompt (driven through the store, resolved by a Promise). */
export interface ConfirmRequest {
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** when set, offers "don't ask again" and remembers the choice in settings */
  dontAskKey?: string;
}

/** An interactive shell detected on the machine (from the Rust `list_shells`). */
export interface ShellInfo {
  /** Friendly name shown in Settings, e.g. "PowerShell 7". */
  label: string;
  /** Resolved path (or bare command) passed to the PTY. */
  path: string;
}

/** A transient notification (e.g. a failed git/gh op, or an agent update). */
export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
  /** if set, clicking the toast activates this tab (jump-to-session) */
  focusTabId?: string;
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
