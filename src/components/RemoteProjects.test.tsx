// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../state/store";
import { DiffPanel } from "./DiffPanel";
import { TabBar } from "./TabBar";
import { CommandPalette } from "./CommandPalette";
import type { RemoteTarget } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const remote: RemoteTarget = { endpoint: { executable: "/hc", session: "work" }, coreId: "aggregate",
  machine: "one", machineId: "remote", session: "dev" };
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue([]);
  useStore.setState({ repositories: [], terminals: [{ id: "t", repoId: "remote:one", worktreeId: "remote:wt", cwd: "/same/path", title: "main", remote, panes: [{ id: "p" }] }],
    activeTabId: "t", diffOpen: true, selectedDiffFile: null, worktrees: {
      "remote:one": [{ id: "remote:wt", repoId: "remote:one", path: "/same/path", name: "main", branch: "main", isPrimary: true, remote }],
    } });
});
afterEach(cleanup);

it("ignores the first host's late diff after switching to a second host with the same path", async () => {
  let resolveFirst!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((cmd, args) => {
    if (cmd !== "remote_worktree_diff") return Promise.resolve(undefined);
    if ((args as { repoId: string }).repoId === "remote:one") return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve([{ path: "second-host.txt", added: 1, removed: 0, binary: false, status: "added" }]);
  });
  render(<DiffPanel />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("remote_worktree_diff", { repoId: "remote:one", path: "/same/path" }));
  useStore.setState({ activeTabId: "second", worktrees: { "remote:two": [{ id: "wt2", repoId: "remote:two", path: "/same/path", name: "main", branch: "main", isPrimary: true, remote }] },
    terminals: [{ id: "second", repoId: "remote:two", worktreeId: "wt2", cwd: "/same/path", title: "main", remote, panes: [{ id: "p2" }] }] });
  expect(await screen.findByText("second-host.txt")).toBeTruthy();
  resolveFirst([{ path: "first-host.txt", added: 1, removed: 0, binary: false, status: "added" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("first-host.txt")).toBeNull();
  expect(screen.getByText("second-host.txt")).toBeTruthy();
});

it("loads remote diffs and patches through repository-scoped APIs only", async () => {
  vi.mocked(invoke).mockImplementation(async (cmd) => cmd === "remote_worktree_diff"
    ? [{ path: "a.txt", added: 1, removed: 1, binary: false, status: "modified" }]
    : "@@ -1 +1 @@\n-before\n+after\n");
  render(<DiffPanel />);
  fireEvent.click(await screen.findByText("a.txt"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("remote_worktree_file_patch", { repoId: "remote:one", path: "/same/path", file: "a.txt" }));
  expect(invoke).not.toHaveBeenCalledWith("worktree_diff", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("worktree_file_patch", expect.anything());
});

it("reports unavailable remote data instead of a clean worktree, and refuses missing identity fallback", async () => {
  vi.mocked(invoke).mockRejectedValue(Error("machine replaced"));
  const view = render(<DiffPanel />);
  expect((await screen.findByRole("alert")).textContent).toContain("machine replaced");
  expect(screen.queryByText("No changes in this worktree.")).toBeNull();
  view.unmount();
  useStore.setState({ worktrees: {}, terminals: [{ id: "t", worktreeId: "remote:wt", cwd: "/same/path", title: "main", remote, panes: [{ id: "p" }] }] });
  vi.mocked(invoke).mockClear();
  render(<DiffPanel />);
  expect((await screen.findByRole("alert")).textContent).toContain("identity is unavailable");
  expect(invoke).not.toHaveBeenCalledWith("worktree_diff", expect.anything());
});

it("keeps local editor and Quick Open routes unavailable for remote projects", async () => {
  const view = render(<TabBar onOpenSettings={vi.fn()} />);
  expect(screen.queryByTitle(/Open in/)).toBeNull();
  expect(screen.getByTitle("Detach terminal (leave program running)")).toBeTruthy();
  view.unmount();
  render(<CommandPalette mode="files" onClose={vi.fn()} onOpenSettings={vi.fn()} onOpenPrDashboard={vi.fn()} />);
  expect(await screen.findByText(/Remote file opening is unavailable/)).toBeTruthy();
  expect(invoke).not.toHaveBeenCalledWith("worktree_files", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("open_in_editor", expect.anything());
});
