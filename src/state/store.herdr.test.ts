// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import { detectAgentState } from "./activity";
import { reportedState } from "./agentRuntime";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
const wt = { id: "/repo", repoId: "r", path: "/repo", name: "main", branch: "main", isPrimary: true };

beforeEach(() => { localStorage.clear(); useStore.setState({ terminals: [], worktrees: { r: [wt] }, activeTabId: null }); });

describe("per-pane runtime persistence", () => {
  it("keeps local as default and pins new persistent panes without converting old ones", () => {
    expect(useStore.getState().settings.terminalRuntime).toBe("local");
    useStore.getState().openWorktreeTerminal(wt);
    useStore.getState().updateSettings({ terminalRuntime: "herdr" });
    useStore.getState().duplicateActiveTerminal();
    const [local, persistent] = useStore.getState().terminals;
    expect(local.panes[0].runtime).toBeUndefined();
    expect(persistent.panes[0].runtime?.key).toMatch(/^[a-f0-9]{32}$/);
  });

  it("restores the original executable, session and core identity without a launch command", () => {
    const runtime = { kind: "herdr", executable: "/hc-1", session: "dedicated", key: "a".repeat(32),
      binding: { coreId: "original-core", address: "t7" } };
    localStorage.setItem("agentpanel.session", JSON.stringify({ activeIndex: 0,
      tabs: [{ worktreeId: wt.id, cwd: wt.path, title: "codex", paneIds: ["p123"], runtimeByPane: { p123: runtime } }] }));
    useStore.getState().updateSettings({ terminalRuntime: "local", herdrExecutable: "/hc-2" });
    useStore.getState().restoreSession();
    const pane = useStore.getState().terminals[0].panes[0];
    expect(pane.runtime).toEqual(runtime);
    expect(pane.initialCommand).toBeUndefined();
  });

  it("never treats quiet output or a missing report as successful completion", () => {
    const runtime = { lastOutputAt: 0, tail: "Do you want to continue?", exited: false, externalState: reportedState(null) };
    expect(detectAgentState(runtime, 999999)).toBe("unknown");
    runtime.externalState = "disconnected";
    expect(detectAgentState(runtime, 999999)).toBe("disconnected");
    expect(reportedState("blocked")).toBe("awaiting");
  });

  it("retains a persistent tab when its termination fails, then removes it after confirmed success", async () => {
    useStore.getState().updateSettings({ terminalRuntime: "herdr" });
    useStore.getState().openWorktreeTerminal(wt);
    const tab = useStore.getState().terminals[0];
    useStore.getState().setPaneSession(tab.panes[0].id, 17);
    vi.mocked(invoke).mockRejectedValueOnce("unavailable");
    useStore.getState().closeTab(tab.id);
    await vi.waitFor(() => expect(useStore.getState().toasts.at(-1)?.message).toContain("unavailable"));
    expect(useStore.getState().terminals).toHaveLength(1);
    vi.mocked(invoke).mockResolvedValue(undefined);
    useStore.getState().closeTab(tab.id);
    await vi.waitFor(() => expect(useStore.getState().terminals).toHaveLength(0));
    expect(invoke).toHaveBeenCalledWith("herdr_terminate", { id: 17 });
  });

  it("requires explicit consent to forget a pane that could not connect", async () => {
    useStore.getState().updateSettings({ terminalRuntime: "herdr" });
    useStore.getState().openWorktreeTerminal(wt);
    const tab = useStore.getState().terminals[0];
    useStore.getState().closeTab(tab.id);
    expect(useStore.getState().confirmState?.detail).toContain("may keep running");
    useStore.getState().resolveConfirm(false);
    await Promise.resolve();
    expect(useStore.getState().terminals).toHaveLength(1);
    useStore.getState().closeTab(tab.id);
    useStore.getState().resolveConfirm(true);
    await vi.waitFor(() => expect(useStore.getState().terminals).toHaveLength(0));
  });
});
