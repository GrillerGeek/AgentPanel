// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { registerPane, unregisterPane, livePaneIds } from "../lib/scrollbackRegistry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const WT = { id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const id of livePaneIds()) unregisterPane(id);
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

describe("scrollback lifecycle", () => {
  it("defaults persistScrollback on", () => {
    expect(useStore.getState().settings.persistScrollback).toBe(true);
  });

  it("prunes saved buffers down to the panes that still exist", () => {
    useStore.getState().restoreSession(); // marks hydrated
    useStore.getState().openWorktreeTerminal(WT);
    vi.advanceTimersByTime(300);

    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_prune");
    expect(call).toBeTruthy();
    const keep = (call![1] as { keep: string[] }).keep;
    expect(keep).toEqual(useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id)));
  });

  it("saves every live pane when the window is hidden", () => {
    registerPane("p1", () => "buffer one");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_save");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ paneId: "p1", data: "buffer one" });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("saves every live pane on unload", () => {
    registerPane("p2", () => "buffer two");
    window.dispatchEvent(new Event("beforeunload"));
    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_save");
    expect((call![1] as { paneId: string }).paneId).toBe("p2");
  });

  it("saves nothing when the setting is off", () => {
    useStore.getState().updateSettings({ persistScrollback: false });
    vi.mocked(invoke).mockClear();
    registerPane("p3", () => "buffer three");
    window.dispatchEvent(new Event("beforeunload"));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "scrollback_save")).toBe(false);
  });

  it("purges everything already saved when the setting is switched off", () => {
    useStore.getState().updateSettings({ persistScrollback: false });
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "scrollback_clear")).toBe(true);
  });
});
