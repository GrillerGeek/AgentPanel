// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import type { Worktree } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const wt: Worktree = { id: "/repo-wt", repoId: "/repo", path: "/repo-wt", name: "feature", branch: "feature", isPrimary: false };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useStore.setState({
    worktrees: { "/repo": [wt] }, notes: { [wt.id]: "keep notes" },
    diffComments: { [wt.id]: [] }, toasts: [], confirmState: null,
    terminals: [{ id: "t1", worktreeId: wt.id, cwd: wt.path, title: "agent", panes: [{ id: "p1" }] }],
    activeTabId: "t1", paneSessions: { p1: 42 },
  });
});

describe("safe worktree removal", () => {
  it("leaves agents, notes and checkout state intact when preflight rejects", async () => {
    vi.mocked(invoke).mockRejectedValue("untracked files");
    await useStore.getState().deleteWorktree("/repo", wt.path);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("check_worktree_removal", { repoId: "/repo", worktreePath: wt.path });
    expect(useStore.getState().terminals).toHaveLength(1);
    expect(useStore.getState().paneSessions.p1).toBe(42);
    expect(useStore.getState().notes[wt.id]).toBe("keep notes");
    expect(useStore.getState().confirmState).toBeNull();
    expect(useStore.getState().toasts[0].message).toContain("untracked files");
  });

  it("requires confirmation before stopping terminals and honors cancellation", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const removal = useStore.getState().deleteWorktree("/repo", wt.path);
    await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
    expect(useStore.getState().confirmState?.dontAskKey).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    useStore.getState().resolveConfirm(false);
    await removal;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useStore.getState().terminals).toHaveLength(1);
  });

  it("stops terminals only after consent, removes safely, then clears notes", async () => {
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      calls.push(cmd);
      return (cmd === "delete_worktree" ? [] : undefined) as never;
    });
    const removal = useStore.getState().deleteWorktree("/repo", wt.path);
    await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
    useStore.getState().resolveConfirm(true);
    await removal;
    expect(calls).toEqual(["check_worktree_removal", "pty_close", "delete_worktree"]);
    expect(useStore.getState().terminals).toHaveLength(0);
    expect(useStore.getState().notes[wt.id]).toBeUndefined();
    expect(useStore.getState().worktrees["/repo"]).toEqual([]);
  });

  it("keeps notes and checkout state if execution recheck or Git fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "delete_worktree") throw "changed since preflight";
      return undefined as never;
    });
    const removal = useStore.getState().deleteWorktree("/repo", wt.path);
    await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
    useStore.getState().resolveConfirm(true);
    await removal;
    expect(useStore.getState().worktrees["/repo"]).toEqual([wt]);
    expect(useStore.getState().notes[wt.id]).toBe("keep notes");
    expect(useStore.getState().toasts[0].message).toContain("changed since preflight");
  });

  it("refuses primary and unknown paths before any backend or process operation", async () => {
    await useStore.getState().deleteWorktree("/repo", "/unrelated");
    useStore.setState({ worktrees: { "/repo": [{ ...wt, isPrimary: true }] } });
    await useStore.getState().deleteWorktree("/repo", wt.path);
    expect(invoke).not.toHaveBeenCalled();
    expect(useStore.getState().terminals).toHaveLength(1);
  });

  it("aborts deletion and retains terminal records if stopping a PTY fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "pty_close") throw "cannot stop process";
        return undefined as never;
      });
      const removal = useStore.getState().deleteWorktree("/repo", wt.path);
      await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
      useStore.getState().resolveConfirm(true);
      await removal;
      expect(invoke).not.toHaveBeenCalledWith("delete_worktree", expect.anything());
      expect(useStore.getState().terminals).toHaveLength(1);
      expect(useStore.getState().notes[wt.id]).toBe("keep notes");
    } finally {
      errorLog.mockRestore();
    }
  });
});
