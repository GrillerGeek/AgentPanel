// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.3.2") }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { runUpdateCheck, restartToUpdate } from "./updater";
import { useStore } from "../state/store";

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  useStore.setState({ updateStatus: "idle", updateVersion: null, toasts: [] });
  vi.mocked(check).mockReset();
});

describe("runUpdateCheck", () => {
  it("downloads and marks ready when an update is available", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue({ available: true, version: "0.4.0", downloadAndInstall } as never);
    await runUpdateCheck();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("stays idle and (manual) toasts when up to date", async () => {
    vi.mocked(check).mockResolvedValue(null as never);
    await runUpdateCheck({ manual: true });
    expect(useStore.getState().updateStatus).toBe("idle");
    expect(useStore.getState().toasts.some((t) => t.message.includes("latest version"))).toBe(true);
  });

  it("stays silent when up to date on an automatic check", async () => {
    vi.mocked(check).mockResolvedValue(null as never);
    await runUpdateCheck();
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("sets error and (manual) toasts when the check throws", async () => {
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    await runUpdateCheck({ manual: true });
    expect(useStore.getState().updateStatus).toBe("error");
    expect(useStore.getState().toasts.some((t) => t.message.includes("Couldn't check for updates"))).toBe(true);
  });

  it("sets error when downloadAndInstall rejects", async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error("network drop"));
    vi.mocked(check).mockResolvedValue({ available: true, version: "0.4.0", downloadAndInstall } as never);
    await expect(runUpdateCheck()).resolves.toBeUndefined(); // never throws
    expect(useStore.getState().updateStatus).toBe("error");
  });

  it("skips re-download when the available version is already staged", async () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue({ available: true, version: "0.4.0", downloadAndInstall } as never);
    await runUpdateCheck();
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("(manual) toasts a distinct message when the download fails", async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error("network drop"));
    vi.mocked(check).mockResolvedValue({ available: true, version: "0.4.0", downloadAndInstall } as never);
    await runUpdateCheck({ manual: true });
    expect(useStore.getState().updateStatus).toBe("error");
    expect(useStore.getState().toasts.some((t) => t.message.includes("Update download failed"))).toBe(true);
  });

  it("is a no-op outside a bundled Tauri app", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await runUpdateCheck();
    expect(check).not.toHaveBeenCalled();
    expect(useStore.getState().updateStatus).toBe("idle");
  });
});

describe("restartToUpdate", () => {
  it("calls relaunch", async () => {
    await restartToUpdate();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});
