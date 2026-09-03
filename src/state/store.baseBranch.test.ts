// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";
import type { Repository, Worktree } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const repo: Repository = { id: "C:\r", path: "C:\r", name: "r", isGit: true, defaultBranch: null };
const wt = (branch: string): Worktree => ({
  id: `C:\r-worktrees\${branch}`,
  repoId: repo.id,
  path: `C:\r-worktrees\${branch}`,
  name: branch,
  branch,
  isPrimary: false,
});

beforeEach(() => {
  useStore.setState({ repositories: [repo], worktrees: {}, terminals: [], activeTabId: null });
  vi.mocked(invoke).mockReset();
});

describe("createWorktree with a base branch", () => {
  it("passes the base to the backend", async () => {
    vi.mocked(invoke).mockResolvedValue([wt("feat")]);
    await useStore.getState().createWorktree(repo.id, "feat", "develop");
    expect(invoke).toHaveBeenCalledWith("create_worktree", { repoId: repo.id, branch: "feat", base: "develop" });
  });

  it("remembers the base as the repo's default branch", async () => {
    vi.mocked(invoke).mockResolvedValue([wt("feat")]);
    await useStore.getState().createWorktree(repo.id, "feat", "develop");
    expect(useStore.getState().repositories[0].defaultBranch).toBe("develop");
  });

  it("leaves the saved default alone when no base is given", async () => {
    useStore.setState({ repositories: [{ ...repo, defaultBranch: "main" }] });
    vi.mocked(invoke).mockResolvedValue([wt("feat")]);
    await useStore.getState().createWorktree(repo.id, "feat");
    expect(invoke).toHaveBeenCalledWith("create_worktree", { repoId: repo.id, branch: "feat", base: undefined });
    expect(useStore.getState().repositories[0].defaultBranch).toBe("main");
  });

  it("does not change the default when creation fails", async () => {
    vi.mocked(invoke).mockRejectedValue("boom");
    await expect(useStore.getState().createWorktree(repo.id, "feat", "develop")).rejects.toBe("boom");
    expect(useStore.getState().repositories[0].defaultBranch).toBeNull();
  });
});

describe("listBranches", () => {
  it("returns the backend's branch list for the repo", async () => {
    vi.mocked(invoke).mockResolvedValue(["develop", "main"]);
    const branches = await useStore.getState().listBranches(repo.id);
    expect(invoke).toHaveBeenCalledWith("list_branches", { repoId: repo.id });
    expect(branches).toEqual(["develop", "main"]);
  });
});
