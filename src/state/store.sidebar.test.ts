// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

describe("sidebar width setting", () => {
  it("defaults to 260px", () => {
    expect(useStore.getState().settings.sidebarWidth).toBe(260);
  });

  it("updateSettings persists sidebarWidth to localStorage", () => {
    useStore.getState().updateSettings({ sidebarWidth: 320 });
    expect(useStore.getState().settings.sidebarWidth).toBe(320);
    const stored = JSON.parse(localStorage.getItem("agentpanel.settings") ?? "{}");
    expect(stored.sidebarWidth).toBe(320);
  });

  it("settings stored before this field existed fall back to the default", async () => {
    localStorage.setItem("agentpanel.settings", JSON.stringify({ fontSize: 16 }));
    vi.resetModules();
    const { useStore: freshStore } = await import("./store");
    expect(freshStore.getState().settings.sidebarWidth).toBe(260);
    expect(freshStore.getState().settings.fontSize).toBe(16);
  });
});
