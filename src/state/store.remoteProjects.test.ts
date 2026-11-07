// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import type { RemoteTarget, Worktree } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const remote: RemoteTarget = { endpoint: { executable: "/hc", session: "work" }, coreId: "aggregate",
  machine: "box", machineId: "remote-core", session: "dev" };
const wt: Worktree = { id: "remote:worktree", repoId: "remote:repo", path: "/same/path", name: "main", branch: "main", isPrimary: true, remote };
const local = { ...wt, id: "/same/path", repoId: "local", remote: undefined };
const status = { branch: "main", dirty: 1, ahead: 0, behind: 0, lastCommit: "initial" };
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined); localStorage.clear();
  useStore.setState({ terminals: [], activeTabId: null, paneSessions: {}, worktrees: {}, repositories: [],
    repositoryErrors: {}, worktreeErrors: {}, statuses: {}, toasts: [] });
});

it("restores remote viewers before an unavailable host finishes project discovery", async () => {
  const s = useStore.getState(); s.openWorktreeTerminal(wt);
  const tab = useStore.getState().terminals[0];
  localStorage.setItem("agentpanel.session", JSON.stringify({ activeIndex: 0, tabs: [{ worktreeId: wt.id, repoId: wt.repoId,
    cwd: wt.path, title: "main", remote, paneIds: [tab.panes[0].id], runtimeByPane: { [tab.panes[0].id]: tab.panes[0].runtime } }] }));
  useStore.setState({ terminals: [], activeTabId: null });
  let release!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "list_repositories") return [{ id: wt.repoId, name: "project", path: wt.path, isGit: true, defaultBranch: null, remote }];
    if (cmd === "list_worktrees") return new Promise((resolve) => { release = resolve; });
    return status;
  });
  const loading = s.loadRepositories();
  await vi.waitFor(() => expect(useStore.getState().terminals).toHaveLength(1));
  expect(useStore.getState().terminals[0].remote).toEqual(remote);
  release([wt]); await loading;
});

it("routes equal paths by machine identity, never watches remote paths locally, and marks failed status unavailable", async () => {
  const repo = (id: string, target?: RemoteTarget) => ({ id, path: "/same/path", name: "project", isGit: true, defaultBranch: null, remote: target });
  useStore.setState({ repositories: [repo("local"), repo(wt.repoId, remote)], worktrees: { local: [local], [wt.repoId]: [wt] } });
  expect(invoke).toHaveBeenCalledWith("set_watched_paths", { paths: ["/same/path"] });
  vi.mocked(invoke).mockImplementation(async (cmd) => cmd === "worktree_pr" ? null : status);
  await useStore.getState().refreshStatuses();
  expect(invoke).toHaveBeenCalledWith("remote_worktree_status", { repoId: wt.repoId, path: wt.path });
  expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "worktree_status")).toHaveLength(1);
  await useStore.getState().refreshPrs();
  expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "worktree_pr")).toHaveLength(1);
  vi.mocked(invoke).mockImplementation(async (cmd) => { if (cmd === "remote_worktree_status") throw Error("offline"); return status; });
  await useStore.getState().refreshStatuses();
  expect(useStore.getState().statuses[wt.id]).toBeUndefined();
  expect(useStore.getState().worktreeErrors[wt.id]).toContain("offline");
  expect(useStore.getState().statuses[local.id]).toEqual(status);
});

it("pins remote terminal creation regardless of local defaults and makes retries recover-only", () => {
  const s = useStore.getState();
  s.updateSettings({ terminalRuntime: "local", shell: "/local-only-shell", terminalEnv: "CLIENT_SECRET=private" });
  s.openWorktreeTerminal(wt);
  s.runAgentInActive("codex"); s.splitActiveTab();
  const tab = useStore.getState().terminals[1];
  expect(tab.repoId).toBe(wt.repoId);
  for (const pane of tab.panes) expect(pane.runtime?.target).toEqual(remote);
  s.markRemoteAttempt(tab.panes[0].id);
  expect(useStore.getState().terminals[1].panes[0].runtime?.existingOnly).toBe(true);
  s.closeTab(tab.id);
  expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
});

it("restores remote programs while inventories are unavailable and removes their tabs with their repository", async () => {
  useStore.getState().openWorktreeTerminal(wt);
  const original = useStore.getState().terminals[0];
  localStorage.setItem("agentpanel.session", JSON.stringify({ activeIndex: 0, tabs: [{ worktreeId: wt.id, repoId: wt.repoId,
    cwd: wt.path, title: original.title, remote, paneIds: [original.panes[0].id],
    runtimeByPane: { [original.panes[0].id]: original.panes[0].runtime } }] }));
  useStore.setState({ worktrees: {}, terminals: [] });
  useStore.getState().restoreSession();
  const restored = useStore.getState().terminals[0];
  expect(restored.remote).toEqual(remote);
  expect(restored.panes[0].runtime?.existingOnly).toBe(true);
  expect(restored.panes[0].initialCommand).toBeUndefined();
  await useStore.getState().removeRepository(wt.repoId);
  expect(useStore.getState().terminals).toHaveLength(0);
  expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
});

it("keeps the last remote worktree inventory on discovery failure without calling it current", async () => {
  useStore.setState({ repositories: [{ id: wt.repoId, path: wt.path, name: "remote", isGit: true, defaultBranch: null, remote }], worktrees: { [wt.repoId]: [wt] } });
  vi.mocked(invoke).mockRejectedValue(Error("host identity changed"));
  await useStore.getState().loadWorktrees(wt.repoId);
  expect(useStore.getState().worktrees[wt.repoId]).toEqual([wt]);
  expect(useStore.getState().repositoryErrors[wt.repoId]).toContain("identity changed");
});
