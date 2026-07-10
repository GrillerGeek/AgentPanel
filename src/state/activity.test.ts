import { describe, it, expect } from "vitest";
import {
  worktreeActivityScore,
  sortWorktrees,
  sortActiveSessions,
  detectAgentState,
  aggregateAgentState,
  type AgentState,
  type PaneRuntime,
} from "./activity";
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

describe("sortActiveSessions (issue #14: no jumping)", () => {
  it("floats awaiting above exited, and exited above running/idle", () => {
    const states: Record<string, AgentState> = {
      a: "idle",
      b: "exited",
      c: "awaiting",
      d: "running",
    };
    expect(sortActiveSessions(["a", "b", "c", "d"], states, {})).toEqual(["c", "b", "a", "d"]);
  });

  it("ignores the running/idle distinction — a flapping session must not move", () => {
    const mru = { a: 3, b: 2, c: 1 };
    const before = sortActiveSessions(
      ["a", "b", "c"],
      { a: "idle", b: "running", c: "idle" },
      mru,
    );
    // b's agent goes quiet (running -> idle), a's agent prints (idle -> running):
    const after = sortActiveSessions(
      ["a", "b", "c"],
      { a: "running", b: "idle", c: "idle" },
      mru,
    );
    expect(after).toEqual(before);
  });

  it("orders non-attention sessions by most-recently-used", () => {
    const states: Record<string, AgentState> = { a: "idle", b: "running", c: "idle" };
    expect(sortActiveSessions(["a", "b", "c"], states, { a: 1, b: 5, c: 3 })).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("breaks ties within an attention bucket by most-recently-used", () => {
    const states: Record<string, AgentState> = { a: "awaiting", b: "awaiting", c: "idle" };
    expect(sortActiveSessions(["a", "b", "c"], states, { a: 1, b: 2 })).toEqual(["b", "a", "c"]);
  });

  it("falls back to first-appearance order when MRU is missing", () => {
    const states: Record<string, AgentState> = { a: "idle", b: "idle", c: "idle" };
    expect(sortActiveSessions(["a", "b", "c"], states, {})).toEqual(["a", "b", "c"]);
    // A session with no recorded state (no panes reported yet) also keeps its place.
    expect(sortActiveSessions(["a", "b"], {}, {})).toEqual(["a", "b"]);
  });
});

describe("detectAgentState", () => {
  const NOW = 100_000;
  const rt = (o: Partial<PaneRuntime>): PaneRuntime => ({
    lastOutputAt: NOW,
    tail: "",
    exited: false,
    ...o,
  });

  it("reports exited regardless of timing", () => {
    expect(detectAgentState(rt({ exited: true, lastOutputAt: NOW }), NOW)).toBe("exited");
  });

  it("reports running while output is recent", () => {
    expect(detectAgentState(rt({ lastOutputAt: NOW - 500 }), NOW)).toBe("running");
  });

  it("reports idle once output goes quiet at a normal prompt", () => {
    expect(detectAgentState(rt({ lastOutputAt: NOW - 5000, tail: "PS C:\\repo> " }), NOW)).toBe(
      "idle",
    );
  });

  it("detects a (y/n) confirmation prompt as awaiting", () => {
    const r = rt({ lastOutputAt: NOW - 5000, tail: "Apply this change? (y/n) " });
    expect(detectAgentState(r, NOW)).toBe("awaiting");
  });

  it("detects awaiting through surrounding ANSI color codes", () => {
    const r = rt({ lastOutputAt: NOW - 5000, tail: "[33mDo you want to proceed?[0m " });
    expect(detectAgentState(r, NOW)).toBe("awaiting");
  });

  it("does not treat a literal [y/n] as an ANSI sequence", () => {
    const r = rt({ lastOutputAt: NOW - 5000, tail: "Continue [y/n]" });
    expect(detectAgentState(r, NOW)).toBe("awaiting");
  });

  it("detects a Claude Code permission prompt (question above a numbered menu)", () => {
    const tail = [
      "Do you want to make this edit to App.tsx?",
      "",
      "❯ 1. Yes",
      "  2. Yes, allow all edits this session",
      "  3. No, and tell Claude what to do differently",
      "",
    ].join("\n");
    expect(detectAgentState(rt({ lastOutputAt: NOW - 5000, tail }), NOW)).toBe("awaiting");
  });

  it("does NOT flag a bare starship prompt as awaiting", () => {
    const r = rt({ lastOutputAt: NOW - 5000, tail: "user@host ~/repo on  main\n❯ " });
    expect(detectAgentState(r, NOW)).toBe("idle");
  });

  it("stays running while output is still streaming", () => {
    const tail = "Do you want to proceed?\n❯ 1. Yes\n";
    expect(detectAgentState(rt({ lastOutputAt: NOW - 200, tail }), NOW)).toBe("running");
  });
});

describe("aggregateAgentState", () => {
  it("returns the most attention-worthy state", () => {
    expect(aggregateAgentState(["idle", "running", "awaiting"])).toBe("awaiting");
    expect(aggregateAgentState(["idle", "exited", "running"])).toBe("exited");
    expect(aggregateAgentState(["idle", "running"])).toBe("running");
    expect(aggregateAgentState([])).toBeNull();
  });
});
