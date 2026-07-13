// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  useStore.setState({ updateStatus: "idle", updateVersion: null });
});

describe("update store slice", () => {
  it("setUpdate sets status and version", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("setUpdate keeps the existing version when the version arg is omitted", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    useStore.getState().setUpdate("checking");
    expect(useStore.getState().updateStatus).toBe("checking");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("setUpdate can clear the version with null", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    useStore.getState().setUpdate("idle", null);
    expect(useStore.getState().updateVersion).toBeNull();
  });
});
