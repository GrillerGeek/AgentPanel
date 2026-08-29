// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { DiffPanel } from "./DiffPanel";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";
import type { DiffFile } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

afterEach(cleanup);

const FILES: DiffFile[] = [
  { path: "src/a.ts", status: "modified", added: 3, removed: 1, binary: false },
  { path: "src/new.ts", status: "untracked", added: 9, removed: 0, binary: false },
];

function activateWorktree() {
  useStore.setState({
    diffOpen: true,
    diffComments: {},
    selectedDiffFile: null,
    worktrees: { r1: [{ id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useStore.setState({ diffOpen: false, selectedDiffFile: null, terminals: [], activeTabId: null });
});

describe("DiffPanel", () => {
  it("renders nothing when the panel is closed", () => {
    const { container } = render(<DiffPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("lists changed files with their counts", async () => {
    vi.mocked(invoke).mockResolvedValue(FILES);
    activateWorktree();
    render(<DiffPanel />);
    expect(await screen.findByText("src/a.ts")).toBeTruthy();
    expect(await screen.findByText("src/new.ts")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("shows a calm empty state when nothing changed", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    activateWorktree();
    render(<DiffPanel />);
    expect(await screen.findByText(/no changes/i)).toBeTruthy();
  });

  it("shows a calm empty state when the command fails, and pushes no error toast", async () => {
    vi.mocked(invoke).mockRejectedValue("boom");
    activateWorktree();
    render(<DiffPanel />);
    await waitFor(() => expect(screen.getByText(/no changes/i)).toBeTruthy());
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("requests the diff for the active worktree's path", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    activateWorktree();
    render(<DiffPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("worktree_diff", { path: "/wt1" }));
  });

  it("ignores a stale worktree_diff response that resolves after a newer one", async () => {
    let resolveSlow: (v: DiffFile[]) => void = () => {};
    const slow = new Promise<DiffFile[]>((r) => { resolveSlow = r; });
    const FAST: DiffFile[] = [{ path: "new.ts", status: "modified", added: 1, removed: 0, binary: false }];

    vi.mocked(invoke)
      .mockReturnValueOnce(slow as never)          // first (older) worktree
      .mockResolvedValueOnce(FAST as never);       // second (newer) worktree

    activateWorktree();
    const { rerender } = render(<DiffPanel />);
    // Switch worktrees, triggering the second fetch.
    useStore.setState({ terminals: [{ id: "t2", worktreeId: "/wt2", cwd: "/wt2", title: "c", panes: [{ id: "p2" }] }], activeTabId: "t2" });
    rerender(<DiffPanel />);
    expect(await screen.findByText("new.ts")).toBeTruthy();

    // The older call now resolves with different data — it must be ignored.
    resolveSlow([{ path: "STALE.ts", status: "modified", added: 9, removed: 9, binary: false }]);
    await waitFor(() => expect(screen.queryByText("STALE.ts")).toBeNull());
    expect(screen.getByText("new.ts")).toBeTruthy();
  });
});
