// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const WT = { id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({ terminals: [], activeTabId: null, worktrees: { r1: [WT] }, paneSessions: {} });
  vi.runOnlyPendingTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function saveSession(tabs: unknown[], activeIndex = 0) {
  localStorage.setItem("agentpanel.session", JSON.stringify({ tabs, activeIndex }));
}

describe("pane id stability across restore", () => {
  it("reuses the saved pane ids instead of minting new ones", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", paneIds: ["p7", "p8"] }]);
    useStore.getState().restoreSession();
    expect(useStore.getState().terminals[0].panes.map((p) => p.id)).toEqual(["p7", "p8"]);
  });

  it("never hands a restored id to a brand-new pane", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", paneIds: ["p7"] }]);
    useStore.getState().restoreSession();
    useStore.getState().openWorktreeTerminal({ ...WT, id: "/wt2", path: "/wt2" });
    const ids = useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("p7");
  });

  it("does not let a minted id collide with an id a later tab restores", () => {
    // Tab 1 predates paneIds (count only); tab 2 has a saved id the counter
    // would otherwise hand out.
    saveSession([
      { worktreeId: "/wt1", cwd: "/wt1", title: "old", panes: 1 },
      { worktreeId: "/wt1", cwd: "/wt1", title: "new", paneIds: ["p1"] },
    ]);
    useStore.getState().restoreSession();
    const ids = useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still restores a legacy session that stored only a pane count", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: 2 }]);
    useStore.getState().restoreSession();
    expect(useStore.getState().terminals[0].panes).toHaveLength(2);
  });

  it("writes paneIds into the persisted session snapshot", () => {
    useStore.getState().restoreSession(); // sets hydrated so the subscriber writes
    useStore.getState().openWorktreeTerminal(WT);
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(localStorage.getItem("agentpanel.session")!);
    expect(Array.isArray(saved.tabs[0].paneIds)).toBe(true);
    expect(saved.tabs[0].paneIds).toEqual(useStore.getState().terminals[0].panes.map((p) => p.id));
  });
});
