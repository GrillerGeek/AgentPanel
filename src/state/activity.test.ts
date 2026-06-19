import { describe, it, expect } from "vitest";
import { worktreeActivityScore, sortWorktrees } from "./activity";
import type { Worktree, WorktreeStatus } from "../types";

function wt(id: string, opts: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId: "r",
    path: `/repo/${id}`,
    name: id,
    branch: id,
    isPrimary: false,
    ...opts,
  };
}

describe("worktreeActivityScore", () => {
  const w = wt("a");
  it("ranks terminal+dirty highest, then terminal, then dirty, then primary, then idle", () => {
    expect(worktreeActivityScore(w, true, 3)).toBe(4);
    expect(worktreeActivityScore(w, true, 0)).toBe(3);
    expect(worktreeActivityScore(w, false, 2)).toBe(2);
    expect(worktreeActivityScore(wt("a", { isPrimary: true }), false, 0)).toBe(1);
    expect(worktreeActivityScore(w, false, 0)).toBe(0);
  });
});

describe("sortWorktrees", () => {
  it("floats active/dirty worktrees above idle ones", () => {
    const list = [wt("idle"), wt("dirty"), wt("running")];
    const openIds = new Set(["running"]); // worktree ids with an open terminal
    const statuses: Record<string, WorktreeStatus> = {
      dirty: { branch: "dirty", dirty: 2, ahead: 0, behind: 0, lastCommit: null },
    };
    const sorted = sortWorktrees(list, openIds, statuses);
    expect(sorted.map((w) => w.id)).toEqual(["running", "dirty", "idle"]);
  });

  it("keeps a stable name order for equal activity", () => {
    const list = [wt("c"), wt("a"), wt("b")];
    const sorted = sortWorktrees(list, new Set(), {});
    expect(sorted.map((w) => w.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the primary above other idle worktrees", () => {
    const list = [wt("feature"), wt("main", { isPrimary: true })];
    const sorted = sortWorktrees(list, new Set(), {});
    expect(sorted[0].id).toBe("main");
  });
});
