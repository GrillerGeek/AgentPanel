import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPane,
  unregisterPane,
  livePaneIds,
  snapshotAll,
  saveAllScrollback,
} from "./scrollbackRegistry";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  for (const id of livePaneIds()) unregisterPane(id);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("scrollbackRegistry", () => {
  it("tracks registered panes and forgets unregistered ones", () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    expect(livePaneIds().sort()).toEqual(["p1", "p2"]);
    unregisterPane("p1");
    expect(livePaneIds()).toEqual(["p2"]);
  });

  it("snapshots every live pane", () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    expect(snapshotAll().sort((a, b) => a.paneId.localeCompare(b.paneId))).toEqual([
      { paneId: "p1", data: "one" },
      { paneId: "p2", data: "two" },
    ]);
  });

  it("skips a pane whose serializer throws, without losing the others", () => {
    registerPane("bad", () => {
      throw new Error("disposed mid-serialize");
    });
    registerPane("good", () => "kept");
    expect(snapshotAll()).toEqual([{ paneId: "good", data: "kept" }]);
  });

  it("skips empty buffers so a fresh pane does not write a useless file", () => {
    registerPane("empty", () => "");
    registerPane("full", () => "text");
    expect(snapshotAll()).toEqual([{ paneId: "full", data: "text" }]);
  });

  it("saveAllScrollback invokes scrollback_save once per pane", async () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    await saveAllScrollback();
    const calls = vi.mocked(invoke).mock.calls.filter(([c]) => c === "scrollback_save");
    expect(calls).toHaveLength(2);
    expect(calls.map(([, a]) => (a as { paneId: string }).paneId).sort()).toEqual(["p1", "p2"]);
  });

  it("saveAllScrollback resolves even when a save is rejected", async () => {
    vi.mocked(invoke).mockRejectedValue("disk full");
    registerPane("p1", () => "one");
    await expect(saveAllScrollback()).resolves.toBeUndefined();
  });
});
