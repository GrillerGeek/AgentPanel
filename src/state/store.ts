import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Repository, TerminalTab, Worktree, WorktreeStatus } from "../types";

let seq = 0;
const nextTabId = () => `t${++seq}`;

const SESSION_KEY = "agentpanel.session";
/** Gates session persistence until restore has run, so boot-time store
 *  mutations (loading repos/worktrees) can't clobber the saved session. */
let hydrated = false;

interface AppState {
  repositories: Repository[];
  /** worktrees keyed by repository id */
  worktrees: Record<string, Worktree[]>;
  /** which repositories are expanded in the sidebar */
  expanded: Record<string, boolean>;
  /** live status keyed by worktree id (polled) */
  statuses: Record<string, WorktreeStatus>;

  /** open terminal tabs (each maps to one live PTY) */
  terminals: TerminalTab[];
  activeTabId: string | null;
  /** tabId -> Rust PTY session id, so terminals can be closed deterministically */
  tabSessions: Record<string, number>;

  loadRepositories: () => Promise<void>;
  addRepository: () => Promise<void>;
  removeRepository: (id: string) => Promise<void>;
  loadWorktrees: (repoId: string) => Promise<void>;
  toggleExpand: (repoId: string) => Promise<void>;
  refreshStatuses: () => Promise<void>;
  /** reopen previously-open worktree terminals (fresh shells) */
  restoreSession: () => void;
  createWorktree: (repoId: string, branch: string) => Promise<void>;
  deleteWorktree: (repoId: string, worktreePath: string) => Promise<void>;

  /** open (or focus the existing) terminal for a worktree */
  openWorktreeTerminal: (wt: Worktree) => void;
  /** open an additional terminal for the active tab's worktree */
  duplicateActiveTerminal: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabSession: (tabId: string, sessionId: number) => void;
  /** close (await) all terminals for a worktree so its directory is unlocked */
  closeWorktreeTerminals: (worktreeId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  repositories: [],
  worktrees: {},
  expanded: {},
  statuses: {},
  terminals: [],
  activeTabId: null,
  tabSessions: {},

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
    const repo = await invoke<Repository>("add_repository", { path });
    set((s) =>
      s.repositories.some((r) => r.id === repo.id)
        ? s
        : { repositories: [...s.repositories, repo], expanded: { ...s.expanded, [repo.id]: true } },
    );
    await get().loadWorktrees(repo.id);
  },

  removeRepository: async (id) => {
    await invoke("remove_repository", { id });
    set((s) => {
      const wtIds = new Set((s.worktrees[id] ?? []).map((w) => w.id));
      const worktrees = { ...s.worktrees };
      delete worktrees[id];
      // Close any terminals belonging to this repo's worktrees (their panes
      // unmount and fire pty_close).
      const removed = s.terminals.filter((t) => wtIds.has(t.worktreeId));
      const terminals = s.terminals.filter((t) => !wtIds.has(t.worktreeId));
      const tabSessions = { ...s.tabSessions };
      for (const t of removed) delete tabSessions[t.id];
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
        terminals,
        tabSessions,
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
    // Poll branch + dirty count for every git worktree currently loaded.
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

  restoreSession: () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const saved = raw ? (JSON.parse(raw) as { tabs: Array<{ worktreeId: string; cwd: string; title: string }>; activeIndex: number }) : null;
      if (saved?.tabs?.length) {
        // Only restore tabs whose worktree still exists.
        const existing = new Set(Object.values(get().worktrees).flat().map((w) => w.id));
        const valid = saved.tabs.filter((t) => existing.has(t.worktreeId));
        if (valid.length) {
          const tabs: TerminalTab[] = valid.map((t) => ({ id: nextTabId(), ...t }));
          const activeSaved = saved.tabs[saved.activeIndex] ?? saved.tabs[0];
          const activeTabId =
            tabs.find((t) => t.worktreeId === activeSaved?.worktreeId)?.id ?? tabs[0].id;
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
    const list = await invoke<Worktree[]>("delete_worktree", { repoId, worktreePath });
    set((s) => ({ worktrees: { ...s.worktrees, [repoId]: list } }));
  },

  openWorktreeTerminal: (wt) => {
    const existing = get().terminals.find((t) => t.worktreeId === wt.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: TerminalTab = { id: nextTabId(), worktreeId: wt.id, cwd: wt.path, title: wt.name };
    set((s) => ({ terminals: [...s.terminals, tab], activeTabId: tab.id }));
  },

  duplicateActiveTerminal: () => {
    const active = get().terminals.find((t) => t.id === get().activeTabId);
    if (!active) return;
    const tab: TerminalTab = {
      id: nextTabId(),
      worktreeId: active.worktreeId,
      cwd: active.cwd,
      title: active.title,
    };
    set((s) => ({ terminals: [...s.terminals, tab], activeTabId: tab.id }));
  },

  closeTab: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? (terminals.at(-1)?.id ?? null) : s.activeTabId;
      const tabSessions = { ...s.tabSessions };
      delete tabSessions[id];
      return { terminals, activeTabId, tabSessions };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setTabSession: (tabId, sessionId) =>
    set((s) => ({ tabSessions: { ...s.tabSessions, [tabId]: sessionId } })),

  closeWorktreeTerminals: async (worktreeId) => {
    const tabs = get().terminals.filter((t) => t.worktreeId === worktreeId);
    // Await each PTY close so the shells are actually dead (and the directory
    // unlocked) before the caller removes the worktree.
    await Promise.all(
      tabs.map(async (t) => {
        const sid = get().tabSessions[t.id];
        if (sid !== undefined) {
          try {
            await invoke("pty_close", { id: sid });
          } catch (err) {
            console.error(`pty_close failed for tab ${t.id}`, err);
          }
        }
      }),
    );
    set((s) => {
      const ids = new Set(tabs.map((t) => t.id));
      const terminals = s.terminals.filter((t) => !ids.has(t.id));
      const tabSessions = { ...s.tabSessions };
      for (const t of tabs) delete tabSessions[t.id];
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return { terminals, tabSessions, activeTabId };
    });
  },
}));

// Persist open terminal tabs (ephemeral UI session) to localStorage on change.
// Gated by `hydrated` so boot-time store loads don't overwrite the saved session
// before restoreSession() runs.
let lastSessionSnapshot = "";
useStore.subscribe((s) => {
  if (!hydrated) return;
  const snapshot = JSON.stringify({
    tabs: s.terminals.map((t) => ({ worktreeId: t.worktreeId, cwd: t.cwd, title: t.title })),
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
