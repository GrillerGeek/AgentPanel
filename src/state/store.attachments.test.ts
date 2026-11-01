// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./store";
import type { HerdrInventory } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const endpoint = { executable: "/hc", session: "test" };
const inventory: HerdrInventory = { coreId: "aggregator", coreName: "mac", machines: [
  { name: "one", coreId: "core-one", host: "first", session: "work", state: "connected", why: null },
  { name: "two", coreId: "core-two", host: "second", session: "work", state: "connected", why: null },
], terminals: [] };
const terminal = (address: string) => ({ address, cwd: "/same/path", title: "codex", state: "live", status: null });
beforeEach(() => {
  vi.mocked(invoke).mockClear(); localStorage.clear();
  useStore.setState({ terminals: [], activeTabId: null, paneSessions: {}, worktrees: {}, toasts: [], diffOpen: false });
  useStore.getState().restoreSession();
});

it("distinguishes identical paths/terminal IDs across machines and focuses a repeated attachment", () => {
  const s = useStore.getState();
  s.attachHerdrTerminal(endpoint, inventory, terminal("one/t1"));
  s.attachHerdrTerminal(endpoint, inventory, terminal("two/t1"));
  const tabs = useStore.getState().terminals;
  expect(tabs).toHaveLength(2);
  expect(tabs[0].worktreeId).not.toBe(tabs[1].worktreeId);
  expect(tabs[1].panes[0].runtime?.binding?.machineId).toBe("core-two");
  s.attachHerdrTerminal(endpoint, inventory, terminal("one/t1"));
  expect(useStore.getState().terminals).toHaveLength(2);
  expect(useStore.getState().activeTabId).toBe(tabs[0].id);
});

it("retains bindings on restore without a local repository, inventory refresh, or launch command", async () => {
  useStore.getState().attachHerdrTerminal(endpoint, inventory, terminal("one/t1"));
  const original = useStore.getState().terminals[0];
  await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("agentpanel.session")!).tabs[0].attachment.machine).toBe("one"));
  useStore.setState({ terminals: [], activeTabId: null, worktrees: {} });
  useStore.getState().restoreSession();
  const restored = useStore.getState().terminals[0];
  expect(restored.attachment).toEqual(original.attachment);
  expect(restored.panes[0].runtime).toEqual(original.panes[0].runtime);
  expect(restored.panes[0].initialCommand).toBeUndefined();
  expect(invoke).not.toHaveBeenCalledWith("herdr_inventory", expect.anything());
});

it("refuses offline attachments and guards local launch/split/diff and worktree deletion paths", async () => {
  const s = useStore.getState();
  s.attachHerdrTerminal(endpoint, { ...inventory, machines: inventory.machines.map((m) => ({ ...m, state: "needs_login" })) }, terminal("one/t1"));
  expect(useStore.getState().terminals).toHaveLength(0);
  s.attachHerdrTerminal(endpoint, inventory, terminal("one/t1"));
  const tab = useStore.getState().terminals[0];
  s.duplicateActiveTerminal(); s.runAgentInActive("codex"); s.splitActiveTab(); s.toggleDiff();
  expect(useStore.getState().terminals).toHaveLength(1);
  expect(useStore.getState().terminals[0].panes).toHaveLength(1);
  expect(useStore.getState().diffOpen).toBe(false);
  await expect(s.closeWorktreeTerminals(tab.worktreeId, true)).rejects.toThrow("cannot authorize");
  s.setPaneSession(tab.panes[0].id, 21);
  s.closeTab(tab.id);
  expect(useStore.getState().terminals).toHaveLength(0);
  expect(invoke).not.toHaveBeenCalledWith("herdr_terminate", expect.anything());
});
