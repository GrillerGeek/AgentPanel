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

/** A fake `Update` with independently observable download/install steps — the
 *  split matters because only `install()` terminates the app on Windows. */
function fakeUpdate(version = "0.4.0", overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    version,
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  useStore.setState({ updateStatus: "idle", updateVersion: null, toasts: [] });
  vi.mocked(check).mockReset();
  vi.mocked(relaunch).mockClear();
});

describe("runUpdateCheck", () => {
  it("downloads and marks ready when an update is available", async () => {
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck();
    expect(update.download).toHaveBeenCalledOnce();
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  // Regression: `downloadAndInstall()` runs the NSIS installer and then kills
  // this process via `std::process::exit(0)` (tauri-plugin-updater's
  // src/updater.rs). Calling it from the silent startup check made the app
  // vanish ~5s after launch on Windows, which read as a crash. The automatic
  // check must only ever stage the bytes.
  it("never installs during an automatic check", async () => {
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck();
    expect(update.install).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("never installs during a manual check either", async () => {
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck({ manual: true });
    expect(update.install).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
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

  it("sets error when the download rejects", async () => {
    const update = fakeUpdate("0.4.0", { download: vi.fn().mockRejectedValue(new Error("network drop")) });
    vi.mocked(check).mockResolvedValue(update as never);
    await expect(runUpdateCheck()).resolves.toBeUndefined(); // never throws
    expect(useStore.getState().updateStatus).toBe("error");
  });

  it("skips re-download when the available version is already staged", async () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck();
    expect(update.download).not.toHaveBeenCalled();
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("(manual) toasts a distinct message when the download fails", async () => {
    const update = fakeUpdate("0.4.0", { download: vi.fn().mockRejectedValue(new Error("network drop")) });
    vi.mocked(check).mockResolvedValue(update as never);
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
  it("installs the staged update, then relaunches", async () => {
    const update = fakeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck();

    await restartToUpdate();
    expect(update.install).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("relaunches without installing when nothing is staged", async () => {
    // A check that finds nothing clears any update staged by an earlier test —
    // the staged handle is module state, not per-test state.
    const stale = fakeUpdate();
    vi.mocked(check).mockResolvedValue(stale as never);
    await runUpdateCheck();
    vi.mocked(check).mockResolvedValue(null as never);
    await runUpdateCheck();

    await restartToUpdate();
    expect(stale.install).not.toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("surfaces an error and does not relaunch when the install fails", async () => {
    const update = fakeUpdate("0.4.0", { install: vi.fn().mockRejectedValue(new Error("installer blocked")) });
    vi.mocked(check).mockResolvedValue(update as never);
    await runUpdateCheck();

    await expect(restartToUpdate()).resolves.toBeUndefined(); // never throws
    expect(relaunch).not.toHaveBeenCalled();
    expect(useStore.getState().updateStatus).toBe("error");
    expect(useStore.getState().toasts.some((t) => t.message.includes("Update install failed"))).toBe(true);
  });
});
