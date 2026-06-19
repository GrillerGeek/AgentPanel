import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Repository, Worktree } from "../types";

interface AppState {
  repositories: Repository[];
  /** worktrees keyed by repository id */
  worktrees: Record<string, Worktree[]>;
  /** which repositories are expanded in the sidebar */
  expanded: Record<string, boolean>;
  selectedWorktreeId: string | null;

  loadRepositories: () => Promise<void>;
  addRepository: () => Promise<void>;
  removeRepository: (id: string) => Promise<void>;
  loadWorktrees: (repoId: string) => Promise<void>;
  toggleExpand: (repoId: string) => Promise<void>;
  selectWorktree: (id: string) => void;
  /** find a worktree object by id across all repositories */
  worktreeById: (id: string) => Worktree | undefined;
}

export const useStore = create<AppState>((set, get) => ({
  repositories: [],
  worktrees: {},
  expanded: {},
  selectedWorktreeId: null,

  loadRepositories: async () => {
    const repositories = await invoke<Repository[]>("list_repositories");
    set({ repositories });
    // Eagerly load worktrees so the sidebar can show counts/status.
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
      const worktrees = { ...s.worktrees };
      delete worktrees[id];
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
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

  selectWorktree: (id) => set({ selectedWorktreeId: id }),

  worktreeById: (id) => {
    for (const list of Object.values(get().worktrees)) {
      const found = list.find((w) => w.id === id);
      if (found) return found;
    }
    return undefined;
  },
}));
