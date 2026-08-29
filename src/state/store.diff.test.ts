// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({
    diffComments: {},
    diffOpen: false,
    notesOpen: false,
    selectedDiffFile: null,
    repositories: [],
    worktrees: {},
    terminals: [],
    activeTabId: null,
    paneSessions: {},
    notes: {},
  });
  vi.runOnlyPendingTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("diff review comments", () => {
  it("addDiffComment stores a comment with a generated id", () => {
    useStore.getState().addDiffComment("wtA", { file: "a.ts", line: 12, code: "const x = 1;", body: "rename this" });
    const list = useStore.getState().diffComments.wtA;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("rename this");
    expect(list[0].id).toBeTruthy();
  });

  it("gives each comment a distinct id", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "one" });
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "two" });
    const [first, second] = useStore.getState().diffComments.wtA;
    expect(first.id).not.toBe(second.id);
  });

  it("removeDiffComment drops only that comment", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "keep" });
    add("wtA", { file: "a.ts", line: 2, code: "b", body: "drop" });
    const dropId = useStore.getState().diffComments.wtA[1].id;
    useStore.getState().removeDiffComment("wtA", dropId);
    expect(useStore.getState().diffComments.wtA.map((c) => c.body)).toEqual(["keep"]);
  });

  it("clearDiffComments empties one worktree, leaving others", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "gone" });
    add("wtB", { file: "b.ts", line: 1, code: "b", body: "stays" });
    useStore.getState().clearDiffComments("wtA");
    expect(useStore.getState().diffComments.wtA ?? []).toEqual([]);
    expect(useStore.getState().diffComments.wtB).toHaveLength(1);
  });

  it("toggleDiff closes the notes panel, and toggleNotes closes the diff panel", () => {
    useStore.setState({ notesOpen: true, diffOpen: false });
    useStore.getState().toggleDiff();
    expect(useStore.getState().diffOpen).toBe(true);
    expect(useStore.getState().notesOpen).toBe(false);

    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(true);
    expect(useStore.getState().diffOpen).toBe(false);
  });

  it("persists comments to localStorage after the 300ms debounce", () => {
    useStore.getState().addDiffComment("wtA", { file: "a.ts", line: 3, code: "x", body: "note" });
    expect(localStorage.getItem("agentpanel.diffComments")).toBeNull();
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(localStorage.getItem("agentpanel.diffComments")!);
    expect(saved.wtA[0].body).toBe("note");
  });

  it("removeRepository prunes comments for that repo's worktrees, keeping others", async () => {
    useStore.setState({
      repositories: [{ id: "r1", path: "/r1", name: "r1", isGit: true }],
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/r1", name: "main", branch: "main", isPrimary: true }] },
      diffComments: {
        wt1: [{ id: "c1", file: "a.ts", line: 1, code: "a", body: "will go" }],
        wtOther: [{ id: "c2", file: "b.ts", line: 1, code: "b", body: "stays" }],
      },
    });
    await useStore.getState().removeRepository("r1");
    expect(useStore.getState().diffComments.wt1).toBeUndefined();
    expect(useStore.getState().diffComments.wtOther).toHaveLength(1);
  });

  it("deleteWorktree prunes the removed worktree's comments", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "delete_worktree" ? [] : undefined));
    useStore.setState({
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
      diffComments: {
        "/wt1": [{ id: "c1", file: "a.ts", line: 1, code: "a", body: "gone soon" }],
        wt2: [{ id: "c2", file: "b.ts", line: 1, code: "b", body: "stays" }],
      },
    });
    await useStore.getState().deleteWorktree("r1", "/wt1");
    expect(useStore.getState().diffComments["/wt1"]).toBeUndefined();
    expect(useStore.getState().diffComments.wt2).toHaveLength(1);
  });
});
