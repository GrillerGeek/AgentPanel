import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ConfirmRequest,
  Pane,
  PrInfo,
  Repository,
  Settings,
  TerminalTab,
  Toast,
  Worktree,
  WorktreeStatus,
} from "../types";
import type { AgentState } from "./activity";
import { DEFAULT_THEME } from "../themes/apply";

let toastSeq = 0;
// Resolver for the in-flight confirmation Promise (kept off-store; not serializable).
let confirmResolver: ((ok: boolean) => void) | null = null;

let tabSeq = 0;
const nextTabId = () => `t${++tabSeq}`;
let paneSeq = 0;
const nextPaneId = () => `p${++paneSeq}`;

const SESSION_KEY = "agentpanel.session";
/** Gates session persistence until restore has run, so boot-time store
 *  mutations (loading repos/worktrees) can't clobber the saved session. */
let hydrated = false;

const SETTINGS_KEY = "agentpanel.settings";
const DEFAULT_SETTINGS: Settings = {
  shell: "powershell.exe",
  terminalEnv: "",
  syncLoginPath: true,
  pathSyncHintShown: false,
  agentCommands: ["claude", "codex"],
  editorCommand: "code",
  theme: DEFAULT_THEME,
  webgl: true,
  fontFamily: "Cascadia Code",
  fontSize: 14,
  notifications: true,
  confirmsDisabled: [],
};
function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const NOTES_KEY = "agentpanel.notes";
const NOTES_OPEN_KEY = "agentpanel.notesOpen";

function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function readNotesOpen(): boolean {
  try {
    return localStorage.getItem(NOTES_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

interface AppState {
  repositories: Repository[];
  /** worktrees keyed by repository id */
  worktrees: Record<string, Worktree[]>;
  /** which repositories are expanded in the sidebar */
  expanded: Record<string, boolean>;
  /** live status keyed by worktree id (polled) */
  statuses: Record<string, WorktreeStatus>;
  /** PR info keyed by worktree id (polled via gh; null = no PR) */
  prs: Record<string, PrInfo | null>;

  /** open terminal tabs; each tab has 1-2 panes, each pane a live PTY */
  terminals: TerminalTab[];
  activeTabId: string | null;
  /** paneId -> Rust PTY session id, so panes can be closed deterministically */
  paneSessions: Record<string, number>;
  /** remembers the last-active tab per worktree, so switching back to a worktree
   *  returns you to the tab you were on rather than its first one */
  lastTabByWorktree: Record<string, string>;
  /** live per-pane agent state (running/idle/awaiting/exited), keyed by paneId;
   *  recomputed by a 1s ticker from agentRuntime.ts */
  agentStatus: Record<string, AgentState>;
  /** most-recently-used stamp per worktree (higher = more recent), bumped when
   *  the active worktree changes; orders the Active-terminals list (issue #14) */
  worktreeMru: Record<string, number>;
  /** per-session notes, keyed by worktree id (= path); shared by a worktree's tabs */
  notes: Record<string, string>;
  /** whether the notes side panel is open (global toggle) */
  notesOpen: boolean;
  settings: Settings;
  /** transient error/info notifications */
  toasts: Toast[];
  /** the pending confirmation prompt, if any (rendered by ConfirmDialog) */
  confirmState: ConfirmRequest | null;

  loadRepositories: () => Promise<void>;
  addRepository: () => Promise<void>;
  removeRepository: (id: string) => Promise<void>;
  loadWorktrees: (repoId: string) => Promise<void>;
  toggleExpand: (repoId: string) => Promise<void>;
  /** expand or collapse every repository at once */
  setAllExpanded: (expanded: boolean) => void;
  refreshStatuses: () => Promise<void>;
  refreshPrs: () => Promise<void>;
  /** reopen previously-open worktree terminals (fresh shells) */
  restoreSession: () => void;
  createWorktree: (repoId: string, branch: string) => Promise<void>;
  deleteWorktree: (repoId: string, worktreePath: string) => Promise<void>;

  /** open (or focus the existing) terminal for a worktree */
  openWorktreeTerminal: (wt: Worktree) => void;
  /** open an additional terminal (separate tab) for the active tab's worktree */
  duplicateActiveTerminal: () => void;
  /** open a new terminal in the active worktree that auto-runs `command` */
  runAgentInActive: (command: string) => void;
  /** add a second pane to the active tab (split) */
  splitActiveTab: () => void;
  /** close one pane; if it was the tab's last pane, close the tab */
  closePane: (tabId: string, paneId: string) => void;
  closeTab: (id: string) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  setActiveTab: (id: string) => void;
  /** make a worktree the active one (its tabs fill the tab bar), returning to the
   *  tab last used in it */
  setActiveWorktree: (worktreeId: string) => void;
  /** set (replace) the note text for a worktree */
  setNote: (worktreeId: string, text: string) => void;
  /** open/close the notes side panel */
  toggleNotes: () => void;
  /** replace the derived per-pane agent-state map (called by the 1s ticker) */
  setAgentStatus: (status: Record<string, AgentState>) => void;
  setPaneSession: (paneId: string, sessionId: number) => void;
  /** set the split ratio for a 2-pane tab (drag-resize) */
  setSplitRatio: (tabId: string, ratio: number) => void;
  /** rename a tab (right-click → rename) */
  renameTab: (tabId: string, title: string) => void;
  /** assign or clear a tab's color (right-click → color) */
  setTabColor: (tabId: string, color: string | undefined) => void;
  /** move tab `fromId` to the position of `toId` (drag-reorder) */
  reorderTab: (fromId: string, toId: string) => void;
  /** close (await) all panes for a worktree so its directory is unlocked */
  closeWorktreeTerminals: (worktreeId: string) => Promise<void>;
  pushToast: (message: string, kind?: Toast["kind"], focusTabId?: string) => void;
  dismissToast: (id: number) => void;
  /** show a confirmation dialog; resolves true if confirmed. Auto-true if the
   *  request's dontAskKey was previously dismissed. */
  requestConfirm: (req: ConfirmRequest) => Promise<boolean>;
  /** resolve the open confirmation (called by ConfirmDialog) */
  resolveConfirm: (ok: boolean, dontAskAgain?: boolean) => void;
}

/** Build a fresh single-pane tab for a worktree. */
function newTab(worktreeId: string, cwd: string, title: string, initialCommand?: string): TerminalTab {
  return { id: nextTabId(), worktreeId, cwd, title, panes: [{ id: nextPaneId(), initialCommand }] };
}

export const useStore = create<AppState>((set, get) => ({
  repositories: [],
  worktrees: {},
  expanded: {},
  statuses: {},
  prs: {},
  terminals: [],
  activeTabId: null,
  paneSessions: {},
  lastTabByWorktree: {},
  agentStatus: {},
  worktreeMru: {},
  notes: readNotes(),
  notesOpen: readNotesOpen(),
  settings: readSettings(),
  toasts: [],
  confirmState: null,

  loadRepositories: async () => {
    const repositories = await invoke<Repository[]>("list_repositories");
    set({ repositories });
    await Promise.all(repositories.map((r) => get().loadWorktrees(r.id)));
    await get().refreshStatuses();
    get().restoreSession();
  },

  addRepository: async () => {
    const path = await open({ directory: true, multiple: false, title: "Add repository or folder" });
    if (typeof path !== "string") return; // cancelled
    let repo: Repository;
    try {
      repo = await invoke<Repository>("add_repository", { path });
    } catch (err) {
      get().pushToast(`Couldn't add repository: ${err}`);
      return;
    }
    set((s) =>
      s.repositories.some((r) => r.id === repo.id)
        ? s
        : { repositories: [...s.repositories, repo], expanded: { ...s.expanded, [repo.id]: true } },
    );
    await get().loadWorktrees(repo.id);
  },

  removeRepository: async (id) => {
    try {
      await invoke("remove_repository", { id });
    } catch (err) {
      get().pushToast(`Couldn't remove repository: ${err}`);
      return;
    }
    set((s) => {
      const wtIds = new Set((s.worktrees[id] ?? []).map((w) => w.id));
      const worktrees = { ...s.worktrees };
      delete worktrees[id];
      // Drop terminals belonging to this repo's worktrees (their panes unmount
      // and fire pty_close).
      const removed = s.terminals.filter((t) => wtIds.has(t.worktreeId));
      const terminals = s.terminals.filter((t) => !wtIds.has(t.worktreeId));
      const paneSessions = { ...s.paneSessions };
      for (const t of removed) for (const p of t.panes) delete paneSessions[p.id];
      const notes = { ...s.notes };
      for (const wtId of wtIds) delete notes[wtId];
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
        terminals,
        paneSessions,
        notes,
        activeTabId,
      };
    });
  },

  loadWorktrees: async (repoId) => {
    try {
      const list = await invoke<Worktree[]>("list_worktrees", { repoId });
      set((s) => ({ worktrees: { ...s.worktrees, [repoId]: list } }));
    } catch (err) {
      console.error(`list_worktrees failed for ${repoId}`, err);
      set((s) => ({ worktrees: { ...s.worktrees, [repoId]: [] } }));
    }
  },

  toggleExpand: async (repoId) => {
    const willExpand = !get().expanded[repoId];
    set((s) => ({ expanded: { ...s.expanded, [repoId]: willExpand } }));
    if (willExpand && !get().worktrees[repoId]) {
      await get().loadWorktrees(repoId);
    }
  },

  setAllExpanded: (expanded) =>
    set((s) => {
      const next: Record<string, boolean> = {};
      for (const r of s.repositories) next[r.id] = expanded;
      return { expanded: next };
    }),

  refreshStatuses: async () => {
    const gitRepoIds = new Set(get().repositories.filter((r) => r.isGit).map((r) => r.id));
    const all: Worktree[] = [];
    for (const [repoId, list] of Object.entries(get().worktrees)) {
      if (gitRepoIds.has(repoId)) all.push(...list);
    }
    const results = await Promise.all(
      all.map(async (wt): Promise<[string, WorktreeStatus] | null> => {
        try {
          return [wt.id, await invoke<WorktreeStatus>("worktree_status", { path: wt.path })];
        } catch {
          return null;
        }
      }),
    );
    set((s) => {
      const statuses = { ...s.statuses };
      for (const r of results) if (r) statuses[r[0]] = r[1];
      return { statuses };
    });
  },

  refreshPrs: async () => {
    const gitRepoIds = new Set(get().repositories.filter((r) => r.isGit).map((r) => r.id));
    const all: Worktree[] = [];
    for (const [repoId, list] of Object.entries(get().worktrees)) {
      if (gitRepoIds.has(repoId)) all.push(...list);
    }
    const results = await Promise.all(
      all.map(async (wt): Promise<[string, PrInfo | null]> => {
        try {
          return [wt.id, await invoke<PrInfo | null>("worktree_pr", { path: wt.path })];
        } catch {
          return [wt.id, null];
        }
      }),
    );
    set((s) => {
      const prs = { ...s.prs };
      for (const [id, pr] of results) prs[id] = pr;
      return { prs };
    });
  },

  restoreSession: () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const saved = raw
        ? (JSON.parse(raw) as {
            tabs: Array<{
              worktreeId: string;
              cwd: string;
              title: string;
              panes?: number;
              color?: string;
            }>;
            activeIndex: number;
          })
        : null;
      if (saved?.tabs?.length) {
        // Only restore tabs whose worktree still exists.
        const existing = new Set(Object.values(get().worktrees).flat().map((w) => w.id));
        const valid = saved.tabs.filter((t) => existing.has(t.worktreeId));
        if (valid.length) {
          const tabs: TerminalTab[] = valid.map((t) => {
            const count = Math.max(1, Math.min(2, t.panes ?? 1));
            const panes: Pane[] = Array.from({ length: count }, () => ({ id: nextPaneId() }));
            return {
              id: nextTabId(),
              worktreeId: t.worktreeId,
              cwd: t.cwd,
              title: t.title,
              panes,
              color: t.color,
            };
          });
          const activeSaved = saved.tabs[saved.activeIndex] ?? saved.tabs[0];
          const activeTabId = tabs.find((t) => t.worktreeId === activeSaved?.worktreeId)?.id ?? tabs[0].id;
          set({ terminals: tabs, activeTabId });
        }
      }
    } catch (err) {
      console.error("restoreSession failed", err);
    }
    hydrated = true;
  },

  createWorktree: async (repoId, branch) => {
    const list = await invoke<Worktree[]>("create_worktree", { repoId, branch });
    set((s) => ({
      worktrees: { ...s.worktrees, [repoId]: list },
      expanded: { ...s.expanded, [repoId]: true },
    }));
    const wt = list.find((w) => w.branch === branch);
    if (wt) get().openWorktreeTerminal(wt);
  },

  deleteWorktree: async (repoId, worktreePath) => {
    // Kill the worktree's terminals FIRST so the OS releases the directory
    // (on Windows a shell's cwd locks the dir and blocks `git worktree remove`).
    await get().closeWorktreeTerminals(worktreePath);
    const prev = get().worktrees[repoId] ?? [];
    try {
      const list = await invoke<Worktree[]>("delete_worktree", { repoId, worktreePath });
      set((s) => {
        const stillThere = new Set(list.map((w) => w.id));
        const removedIds = prev.filter((w) => !stillThere.has(w.id)).map((w) => w.id);
        const notes = { ...s.notes };
        for (const wtId of removedIds) delete notes[wtId];
        return { worktrees: { ...s.worktrees, [repoId]: list }, notes };
      });
    } catch (err) {
      get().pushToast(`Couldn't remove worktree: ${err}`);
    }
  },

  openWorktreeTerminal: (wt) => {
    const existing = get().terminals.find((t) => t.worktreeId === wt.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab = newTab(wt.id, wt.path, wt.name);
    set((s) => ({ terminals: [...s.terminals, tab], activeTabId: tab.id }));
  },

  duplicateActiveTerminal: () => {
    const active = get().terminals.find((t) => t.id === get().activeTabId);
    if (!active) return;
    const tab = newTab(active.worktreeId, active.cwd, active.title);
    set((s) => ({ terminals: [...s.terminals, tab], activeTabId: tab.id }));
  },

  runAgentInActive: (command) => {
    const active = get().terminals.find((t) => t.id === get().activeTabId);
    if (!active) return;
    const tab = newTab(active.worktreeId, active.cwd, `${active.title} · ${command}`, command);
    set((s) => ({ terminals: [...s.terminals, tab], activeTabId: tab.id }));
  },

  splitActiveTab: () =>
    set((s) => {
      const tab = s.terminals.find((t) => t.id === s.activeTabId);
      if (!tab || tab.panes.length >= 2) return s;
      const panes = [...tab.panes, { id: nextPaneId() }];
      return { terminals: s.terminals.map((t) => (t.id === tab.id ? { ...t, panes } : t)) };
    }),

  closePane: (tabId, paneId) =>
    set((s) => {
      const tab = s.terminals.find((t) => t.id === tabId);
      if (!tab) return s;
      const paneSessions = { ...s.paneSessions };
      delete paneSessions[paneId];
      const remaining = tab.panes.filter((p) => p.id !== paneId);
      if (remaining.length === 0) {
        const terminals = s.terminals.filter((t) => t.id !== tabId);
        let activeTabId = s.activeTabId;
        if (s.activeTabId === tabId) {
          // Prefer staying in the same worktree; fall back to any remaining tab.
          const sameWt = terminals.filter((t) => t.worktreeId === tab.worktreeId);
          activeTabId = (sameWt.at(-1) ?? terminals.at(-1))?.id ?? null;
        }
        return { terminals, activeTabId, paneSessions };
      }
      return {
        terminals: s.terminals.map((t) => (t.id === tabId ? { ...t, panes: remaining } : t)),
        paneSessions,
      };
    }),

  closeTab: (id) =>
    set((s) => {
      const tab = s.terminals.find((t) => t.id === id);
      const terminals = s.terminals.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === id) {
        // Prefer another tab in the same worktree so closing a tab keeps you in
        // the same session; otherwise fall back to any remaining tab.
        const sameWt = tab ? terminals.filter((t) => t.worktreeId === tab.worktreeId) : [];
        activeTabId = (sameWt.at(-1) ?? terminals.at(-1))?.id ?? null;
      }
      const paneSessions = { ...s.paneSessions };
      if (tab) for (const p of tab.panes) delete paneSessions[p.id];
      return { terminals, activeTabId, paneSessions };
    }),

  setActiveTab: (id) =>
    set((s) => {
      const wt = s.terminals.find((t) => t.id === id)?.worktreeId;
      return wt
        ? { activeTabId: id, lastTabByWorktree: { ...s.lastTabByWorktree, [wt]: id } }
        : { activeTabId: id };
    }),

  setAgentStatus: (agentStatus) => set({ agentStatus }),

  setActiveWorktree: (worktreeId) =>
    set((s) => {
      const tabs = s.terminals.filter((t) => t.worktreeId === worktreeId);
      if (tabs.length === 0) return s;
      const remembered = s.lastTabByWorktree[worktreeId];
      const target = tabs.find((t) => t.id === remembered) ?? tabs[tabs.length - 1];
      return { activeTabId: target.id };
    }),

  setNote: (worktreeId, text) =>
    set((s) => ({ notes: { ...s.notes, [worktreeId]: text } })),

  toggleNotes: () => set((s) => ({ notesOpen: !s.notesOpen })),

  setPaneSession: (paneId, sessionId) =>
    set((s) => ({ paneSessions: { ...s.paneSessions, [paneId]: sessionId } })),

  setSplitRatio: (tabId, ratio) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === tabId ? { ...t, splitRatio: ratio } : t)),
    })),

  renameTab: (tabId, title) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === tabId ? { ...t, title } : t)),
    })),

  setTabColor: (tabId, color) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === tabId ? { ...t, color } : t)),
    })),

  reorderTab: (fromId, toId) =>
    set((s) => {
      if (fromId === toId) return s;
      const arr = [...s.terminals];
      const from = arr.findIndex((t) => t.id === fromId);
      const to = arr.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return s;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { terminals: arr };
    }),

  updateSettings: (partial) =>
    set((s) => {
      const settings = { ...s.settings, ...partial };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (err) {
        console.error("settings persist failed", err);
      }
      return { settings };
    }),

  closeWorktreeTerminals: async (worktreeId) => {
    const tabs = get().terminals.filter((t) => t.worktreeId === worktreeId);
    const panes = tabs.flatMap((t) => t.panes);
    // Await EVERY pane's PTY close so all shells are dead (and the directory is
    // unlocked) before the caller removes the worktree.
    await Promise.all(
      panes.map(async (p) => {
        const sid = get().paneSessions[p.id];
        if (sid !== undefined) {
          try {
            await invoke("pty_close", { id: sid });
          } catch (err) {
            console.error(`pty_close failed for pane ${p.id}`, err);
          }
        }
      }),
    );
    set((s) => {
      const tabIds = new Set(tabs.map((t) => t.id));
      const terminals = s.terminals.filter((t) => !tabIds.has(t.id));
      const paneSessions = { ...s.paneSessions };
      for (const p of panes) delete paneSessions[p.id];
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return { terminals, paneSessions, activeTabId };
    });
  },

  pushToast: (message, kind = "error", focusTabId) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind, focusTabId }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  requestConfirm: (req) => {
    const s = get();
    // Honor a previous "don't ask again" for this action.
    if (req.dontAskKey && s.settings.confirmsDisabled.includes(req.dontAskKey)) {
      return Promise.resolve(true);
    }
    // Replace any stale dialog (resolve it false first).
    confirmResolver?.(false);
    return new Promise<boolean>((resolve) => {
      confirmResolver = resolve;
      set({ confirmState: req });
    });
  },

  resolveConfirm: (ok, dontAskAgain) => {
    const s = get();
    const key = s.confirmState?.dontAskKey;
    if (ok && dontAskAgain && key && !s.settings.confirmsDisabled.includes(key)) {
      get().updateSettings({ confirmsDisabled: [...s.settings.confirmsDisabled, key] });
    }
    set({ confirmState: null });
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve?.(ok);
  },
}));

/** The worktree whose terminals are currently shown — derived from the active
 *  tab, so it's always consistent with which tab is focused. */
export const selectActiveWorktreeId = (s: AppState): string | null =>
  s.terminals.find((t) => t.id === s.activeTabId)?.worktreeId ?? null;

/** Build a `worktreeId -> { repo, branch }` label map for the active-sessions
 *  list and the tab-bar context chip.
 *
 *  NOTE: this is a plain helper, NOT a Zustand selector — it constructs a new
 *  object, so passing it straight to `useStore` would return a fresh reference
 *  every render and trip useSyncExternalStore's infinite-loop guard (blank app).
 *  Call it inside `useMemo` over the stable `repositories` / `worktrees` slices. */
export function worktreeLabels(
  repositories: Repository[],
  worktrees: Record<string, Worktree[]>,
): Record<string, { repo: string; branch: string }> {
  const repoName: Record<string, string> = {};
  for (const r of repositories) repoName[r.id] = r.name;
  const out: Record<string, { repo: string; branch: string }> = {};
  for (const [repoId, list] of Object.entries(worktrees)) {
    for (const w of list) {
      out[w.id] = { repo: repoName[repoId] ?? repoId, branch: w.name };
    }
  }
  return out;
}

// Bump the active worktree's MRU stamp whenever it changes. A subscriber (rather
// than edits at every activeTabId mutation site) catches all paths — tab clicks,
// session clicks, opens, closes — in one place. The module-level guard makes the
// re-entrant notification from setState a no-op.
let lastMruWorktree: string | null = null;
let mruCounter = 0;
useStore.subscribe((s) => {
  const wt = selectActiveWorktreeId(s);
  if (wt && wt !== lastMruWorktree) {
    lastMruWorktree = wt;
    useStore.setState({ worktreeMru: { ...s.worktreeMru, [wt]: ++mruCounter } });
  }
});

// Persist open terminal tabs (ephemeral UI session) to localStorage on change.
// Gated by `hydrated` so boot-time store loads don't overwrite the saved session
// before restoreSession() runs.
let lastSessionSnapshot = "";
useStore.subscribe((s) => {
  if (!hydrated) return;
  const snapshot = JSON.stringify({
    tabs: s.terminals.map((t) => ({
      worktreeId: t.worktreeId,
      cwd: t.cwd,
      title: t.title,
      panes: t.panes.length,
      color: t.color,
    })),
    activeIndex: s.terminals.findIndex((t) => t.id === s.activeTabId),
  });
  if (snapshot !== lastSessionSnapshot) {
    lastSessionSnapshot = snapshot;
    try {
      localStorage.setItem(SESSION_KEY, snapshot);
    } catch (err) {
      console.error("session persist failed", err);
    }
  }
});

// Keep the Rust file watcher's path set in sync with the git worktrees.
let lastWatchedSnapshot = "";
useStore.subscribe((s) => {
  const gitRepoIds = new Set(s.repositories.filter((r) => r.isGit).map((r) => r.id));
  const paths: string[] = [];
  for (const [repoId, list] of Object.entries(s.worktrees)) {
    if (gitRepoIds.has(repoId)) for (const w of list) paths.push(w.path);
  }
  const snapshot = paths.slice().sort().join("|");
  if (snapshot !== lastWatchedSnapshot) {
    lastWatchedSnapshot = snapshot;
    void invoke("set_watched_paths", { paths }).catch((err) => console.error("set_watched_paths failed", err));
  }
});

// Persist per-session notes to localStorage, debounced so a burst of keystrokes
// collapses into one write. Gated by a snapshot string like the other subscribers.
let lastNotesSnapshot = JSON.stringify(useStore.getState().notes);
let notesWriteTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => {
  const snapshot = JSON.stringify(s.notes);
  if (snapshot === lastNotesSnapshot) return;
  lastNotesSnapshot = snapshot;
  if (notesWriteTimer) clearTimeout(notesWriteTimer);
  notesWriteTimer = setTimeout(() => {
    try {
      localStorage.setItem(NOTES_KEY, snapshot);
    } catch (err) {
      console.error("notes persist failed", err);
    }
  }, 300);
});

// Flush a pending (debounced) notes write synchronously when the window is
// hidden or closing, so the last keystrokes aren't lost if the app quits
// within the debounce window.
function flushNotes() {
  if (notesWriteTimer === undefined) return;
  clearTimeout(notesWriteTimer);
  notesWriteTimer = undefined;
  try {
    localStorage.setItem(NOTES_KEY, lastNotesSnapshot);
  } catch (err) {
    console.error("notes flush failed", err);
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushNotes);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNotes();
  });
}

// Persist the notes panel open/closed flag immediately (single boolean).
let lastNotesOpen = useStore.getState().notesOpen;
useStore.subscribe((s) => {
  if (s.notesOpen === lastNotesOpen) return;
  lastNotesOpen = s.notesOpen;
  try {
    localStorage.setItem(NOTES_OPEN_KEY, JSON.stringify(s.notesOpen));
  } catch (err) {
    console.error("notesOpen persist failed", err);
  }
});
