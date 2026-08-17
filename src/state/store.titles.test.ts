// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import type { TerminalTab, Worktree } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

function tab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: "tab1",
    worktreeId: "wt1",
    cwd: "C:/repo",
    title: "main · claude",
    panes: [{ id: "p1" }, { id: "p2" }],
    agent: true,
    ...over,
  };
}

beforeEach(() => {
  useStore.setState({
    terminals: [tab()],
    activeTabId: "tab1",
    settings: { ...useStore.getState().settings, autoTabTitles: true },
  });
});

afterEach(() => {
  localStorage.clear();
});

/** Assert the store state object is unchanged (no-op paths must return `s`
 *  itself so zustand skips notifying subscribers — that identity is what keeps
 *  shell title churn from re-rendering / re-persisting anything). */
function expectNoop(fn: () => void) {
  const before = useStore.getState();
  fn();
  expect(useStore.getState()).toBe(before);
}

describe("inheritTabTitle", () => {
  it("adopts the title reported by the agent tab's first pane", () => {
    useStore.getState().inheritTabTitle("p1", "✳ fix sidebar bug");
    expect(useStore.getState().terminals[0].title).toBe("✳ fix sidebar bug");
  });

  it("trims whitespace, strips control chars, and caps the length", () => {
    useStore.getState().inheritTabTitle("p1", "  padded\u0007  ");
    expect(useStore.getState().terminals[0].title).toBe("padded");
    useStore.getState().inheritTabTitle("p1", "x".repeat(500));
    expect(useStore.getState().terminals[0].title).toHaveLength(120);
  });

  it("ignores empty titles", () => {
    expectNoop(() => useStore.getState().inheritTabTitle("p1", "   "));
  });

  it("ignores titles from a split (non-first) pane", () => {
    expectNoop(() => useStore.getState().inheritTabTitle("p2", "Windows PowerShell"));
  });

  it("does nothing when autoTabTitles is off", () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTabTitles: false } });
    expectNoop(() => useStore.getState().inheritTabTitle("p1", "new title"));
  });

  it("does nothing for non-agent tabs", () => {
    useStore.setState({ terminals: [tab({ agent: undefined })] });
    expectNoop(() => useStore.getState().inheritTabTitle("p1", "new title"));
  });

  it("does nothing for pinned tabs", () => {
    useStore.setState({ terminals: [tab({ titlePinned: true })] });
    expectNoop(() => useStore.getState().inheritTabTitle("p1", "new title"));
  });

  it("updates only the tab owning the pane when several agent tabs exist", () => {
    const other = tab({ id: "tab2", title: "main · codex", panes: [{ id: "p3" }] });
    useStore.setState({ terminals: [tab(), other] });
    useStore.getState().inheritTabTitle("p3", "codex session");
    const [t1, t2] = useStore.getState().terminals;
    expect(t1.title).toBe("main · claude");
    expect(t2.title).toBe("codex session");
  });

  it("renameTab pins the tab against later inherits", () => {
    useStore.getState().renameTab("tab1", "my session");
    expect(useStore.getState().terminals[0].titlePinned).toBe(true);
    useStore.getState().inheritTabTitle("p1", "auto title");
    expect(useStore.getState().terminals[0].title).toBe("my session");
  });
});

describe("session restore", () => {
  it("restores the saved title but not agent status — restored shells must not inherit", () => {
    const wt: Worktree = {
      id: "wt1",
      repoId: "r1",
      path: "C:/repo",
      name: "main",
      branch: "main",
      isPrimary: true,
    };
    localStorage.setItem(
      "agentpanel.session",
      // `agent`/`titlePinned` are deliberately absent from the snapshot shape,
      // but tolerate stale keys from older builds: they must be ignored.
      JSON.stringify({
        tabs: [{ worktreeId: "wt1", cwd: "C:/repo", title: "✳ old session", panes: 1, agent: true }],
        activeIndex: 0,
      }),
    );
    useStore.setState({ terminals: [], activeTabId: null, worktrees: { r1: [wt] } });
    useStore.getState().restoreSession();

    const restored = useStore.getState().terminals[0];
    expect(restored.title).toBe("✳ old session");
    expect(restored.agent).toBeUndefined();
    // A fresh shell repainting its title must not clobber the restored name.
    useStore.getState().inheritTabTitle(restored.panes[0].id, "Windows PowerShell");
    expect(useStore.getState().terminals[0].title).toBe("✳ old session");
  });
});

describe("autoTabTitles setting", () => {
  it("defaults to true, including for settings stored before the field existed", async () => {
    localStorage.setItem("agentpanel.settings", JSON.stringify({ fontSize: 16 }));
    vi.resetModules();
    const { useStore: fresh } = await import("./store");
    expect(fresh.getState().settings.autoTabTitles).toBe(true);
  });
});
