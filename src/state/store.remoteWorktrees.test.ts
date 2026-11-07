// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import type { RemoteTarget, Worktree } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const remote: RemoteTarget = { endpoint: { executable: "hc", session: "work" }, coreId: "aggregate", machine: "linux", machineId: "peer", session: "dev" };
const wt: Worktree = { id: "remote:wt", repoId: "remote:repo", path: "/project-worktrees/feature", name: "feature", branch: "feature", isPrimary: false, remote };
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined); localStorage.clear();
  useStore.setState({ repositories: [{ id: wt.repoId, path: "/project", name: "project", isGit: true, defaultBranch: null, remote }],
    worktrees: { [wt.repoId]: [wt] }, terminals: [], activeTabId: null, paneSessions: {}, notes: { [wt.id]: "keep" }, diffComments: {},
    toasts: [], confirmState: null, repositoryErrors: {}, worktreeErrors: {} });
});
it("creates on the remote host and opens a machine-pinned terminal without changing the saved base", async () => {
  vi.mocked(invoke).mockResolvedValue([wt]);
  await useStore.getState().createWorktree(wt.repoId, "feature", "main");
  expect(invoke).toHaveBeenCalledWith("remote_create_worktree", { repoId: wt.repoId, branch: "feature", base: "main" });
  expect(useStore.getState().terminals[0].panes[0].runtime?.target).toEqual(remote);
  expect(useStore.getState().repositories[0].defaultBranch).toBeNull();
  await useStore.getState().listBranches(wt.repoId);
  expect(invoke).toHaveBeenCalledWith("remote_list_branches", { repoId: wt.repoId });
});
it("blocks at preflight without detaching or discarding notes", async () => {
  useStore.getState().openWorktreeTerminal(wt);
  vi.mocked(invoke).mockRejectedValue("Exit all programs");
  await useStore.getState().deleteWorktree(wt.repoId, wt.path);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(useStore.getState().terminals).toHaveLength(1);
  expect(useStore.getState().notes[wt.id]).toBe("keep");
  expect(useStore.getState().confirmState).toBeNull();
});
it("keeps remote viewers and notes if recheck rejects after consent", async () => {
  useStore.getState().openWorktreeTerminal(wt);
  vi.mocked(invoke).mockImplementation(async (cmd) => { if (cmd === "remote_delete_worktree") throw "changed since preflight"; return undefined as never; });
  const pending = useStore.getState().deleteWorktree(wt.repoId, wt.path);
  await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
  expect(useStore.getState().confirmState?.message).toContain("linux");
  useStore.getState().resolveConfirm(true); await pending;
  expect(useStore.getState().terminals).toHaveLength(1);
  expect(useStore.getState().notes[wt.id]).toBe("keep");
  expect(invoke).not.toHaveBeenCalledWith("herdr_detach", expect.anything());
  expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
});
it("honors cancellation and detaches ended viewers only after successful remote removal", async () => {
  useStore.getState().openWorktreeTerminal(wt);
  const pane = useStore.getState().terminals[0].panes[0]; useStore.getState().setPaneSession(pane.id, 42);
  vi.mocked(invoke).mockImplementation(async (cmd) => (cmd === "remote_delete_worktree" ? [] : undefined) as never);
  let pending = useStore.getState().deleteWorktree(wt.repoId, wt.path);
  await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
  useStore.getState().resolveConfirm(false); await pending;
  expect(invoke).not.toHaveBeenCalledWith("remote_delete_worktree", expect.anything());
  vi.mocked(invoke).mockClear();
  pending = useStore.getState().deleteWorktree(wt.repoId, wt.path);
  await vi.waitFor(() => expect(useStore.getState().confirmState).not.toBeNull());
  useStore.getState().resolveConfirm(true); await pending;
  expect(vi.mocked(invoke).mock.calls.map(([cmd]) => cmd)).toEqual(["remote_check_worktree_removal", "remote_delete_worktree", "herdr_detach"]);
  expect(useStore.getState().terminals).toHaveLength(0);
  expect(useStore.getState().notes[wt.id]).toBeUndefined();
});
