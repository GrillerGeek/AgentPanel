// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

// store.ts shells out via invoke in removeRepository/deleteWorktree.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

// Fake timers so the debounced notes write is deterministic (no real-timer leak
// across tests). beforeEach flushes any write scheduled by the state reset.
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({
    notes: {},
    notesOpen: false,
    repositories: [],
    worktrees: {},
    terminals: [],
    activeTabId: null,
    paneSessions: {},
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

describe("notes store", () => {
  it("setNote stores text under the worktree id", () => {
    useStore.getState().setNote("wtA", "hello");
    expect(useStore.getState().notes.wtA).toBe("hello");
  });

  it("toggleNotes flips notesOpen", () => {
    expect(useStore.getState().notesOpen).toBe(false);
    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(true);
    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(false);
  });

  it("persists notes to localStorage after the 300ms debounce", () => {
    useStore.getState().setNote("wtA", "draft");
    expect(localStorage.getItem("agentpanel.notes")).toBeNull(); // not yet
    vi.advanceTimersByTime(300);
    expect(JSON.parse(localStorage.getItem("agentpanel.notes")!)).toEqual({ wtA: "draft" });
  });

  it("persists notesOpen immediately", () => {
    useStore.getState().toggleNotes();
    expect(localStorage.getItem("agentpanel.notesOpen")).toBe("true");
  });

  it("removeRepository prunes notes for that repo's worktrees, keeping others", async () => {
    useStore.setState({
      repositories: [{ id: "r1", path: "/r1", name: "r1", isGit: true }],
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/r1", name: "main", branch: "main", isPrimary: true }] },
      notes: { wt1: "will go", wtOther: "stays" },
    });
    await useStore.getState().removeRepository("r1");
    expect(useStore.getState().notes.wt1).toBeUndefined();
    expect(useStore.getState().notes.wtOther).toBe("stays");
  });

  it("deleteWorktree prunes the removed worktree's note, keeping others", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "delete_worktree") return []; // wt1 removed; none remain
      return undefined; // pty_close etc.
    });
    useStore.setState({
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
      notes: { wt1: "gone soon", wt2: "stays" },
    });
    await useStore.getState().deleteWorktree("r1", "/wt1");
    expect(useStore.getState().notes.wt1).toBeUndefined();
    expect(useStore.getState().notes.wt2).toBe("stays");
  });

  it("flushes a pending debounced write synchronously when the document becomes hidden", () => {
    useStore.getState().setNote("wtA", "draft before hide");
    expect(localStorage.getItem("agentpanel.notes")).toBeNull(); // debounce not yet elapsed

    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      // No timer advance: the flush must write synchronously, not rely on the timer firing.
      expect(JSON.parse(localStorage.getItem("agentpanel.notes")!)).toEqual({ wtA: "draft before hide" });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, "visibilityState", originalDescriptor);
      } else {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      }
    }
  });
});
