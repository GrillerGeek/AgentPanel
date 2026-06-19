import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Repository, TerminalTab, Worktree } from "../types";

let seq = 0;
const nextTabId = () => `t${++seq}`;

interface AppState {
  repositories: Repository[];
  /** worktrees keyed by repository id */
  worktrees: Record<string, Worktree[]>;
  /** which repositories are expanded in the sidebar */
  expanded: Record<string, boolean>;

  /** open terminal tabs (each maps to one live PTY) */
  terminals: TerminalTab[];
  activeTabId: string | null;

  loadRepositories: () => Promise<void>;
  addRepository: () => Promise<void>;
  removeRepository: (id: string) => Promise<void>;
  loadWorktrees: (repoId: string) => Promise<void>;
  toggleExpand: (repoId: string) => Promise<void>;

  /** open (or focus the existing) terminal for a worktree */
  openWorktreeTerminal: (wt: Worktree) => void;
  /** open an additional terminal for the active tab's worktree */
  duplicateActiveTerminal: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  repositories: [],
  worktrees: {},
  expanded: {},
  terminals: [],
  activeTabId: null,

  loadRepositories: async () => {
    const repositories = await invoke<Repository[]>("list_repositories");
    set({ repositories });
    await Promise.all(repositories.map((r) => get().loadWorktrees(r.id)));
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
      // Close any terminals belonging to this repo's worktrees.
      const terminals = s.terminals.filter((t) => !wtIds.has(t.worktreeId));
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
        terminals,
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
      return { terminals, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),
}));
