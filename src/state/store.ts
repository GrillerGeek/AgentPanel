import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Pane, PrInfo, Repository, Settings, TerminalTab, Toast, Worktree, WorktreeStatus } from "../types";
import { DEFAULT_THEME } from "../themes/apply";

let toastSeq = 0;

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
  agentCommands: ["claude", "codex"],
  theme: DEFAULT_THEME,
  webgl: true,
  fontFamily: "Cascadia Code",
  fontSize: 14,
};
function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
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
  settings: Settings;
  /** transient error/info notifications */
  toasts: Toast[];

  loadRepositories: () => Promise<void>;
  addRepository: () => Promise<void>;
  removeRepository: (id: string) => Promise<void>;
  loadWorktrees: (repoId: string) => Promise<void>;
  toggleExpand: (repoId: string) => Promise<void>;
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
  setPaneSession: (paneId: string, sessionId: number) => void;
  /** set the split ratio for a 2-pane tab (drag-resize) */
  setSplitRatio: (tabId: string, ratio: number) => void;
  /** move tab `fromId` to the position of `toId` (drag-reorder) */
  reorderTab: (fromId: string, toId: string) => void;
  /** close (await) all panes for a worktree so its directory is unlocked */
  closeWorktreeTerminals: (worktreeId: string) => Promise<void>;
  pushToast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
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
  settings: readSettings(),
  toasts: [],

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
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
        terminals,
        paneSessions,
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
            tabs: Array<{ worktreeId: string; cwd: string; title: string; panes?: number }>;
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
            return { id: nextTabId(), worktreeId: t.worktreeId, cwd: t.cwd, title: t.title, panes };
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
    try {
      const list = await invoke<Worktree[]>("delete_worktree", { repoId, worktreePath });
      set((s) => ({ worktrees: { ...s.worktrees, [repoId]: list } }));
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
        const activeTabId = s.activeTabId === tabId ? (terminals.at(-1)?.id ?? null) : s.activeTabId;
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
      const activeTabId = s.activeTabId === id ? (terminals.at(-1)?.id ?? null) : s.activeTabId;
      const paneSessions = { ...s.paneSessions };
      if (tab) for (const p of tab.panes) delete paneSessions[p.id];
      return { terminals, activeTabId, paneSessions };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setPaneSession: (paneId, sessionId) =>
    set((s) => ({ paneSessions: { ...s.paneSessions, [paneId]: sessionId } })),

  setSplitRatio: (tabId, ratio) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === tabId ? { ...t, splitRatio: ratio } : t)),
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

  pushToast: (message, kind = "error") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => get().dismissToast(id), 6000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Persist open terminal tabs (ephemeral UI session) to localStorage on change.
// Gated by `hydrated` so boot-time store loads don't overwrite the saved session
// before restoreSession() runs.
let lastSessionSnapshot = "";
useStore.subscribe((s) => {
  if (!hydrated) return;
  const snapshot = JSON.stringify({
    tabs: s.terminals.map((t) => ({ worktreeId: t.worktreeId, cwd: t.cwd, title: t.title, panes: t.panes.length })),
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
