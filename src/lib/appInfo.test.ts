import { describe, it, expect, vi } from "vitest";

// Issue #32: no way to see the app version. The window title carries it
// (self-maintaining via getVersion), with Settings keeping the detailed row.

const setTitle = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("9.9.9") }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle }) }));

import { applyVersionWindowTitle } from "./appInfo";

describe("applyVersionWindowTitle (issue #32)", () => {
  it("sets the window title to AgentPanel v<version>", async () => {
    await applyVersionWindowTitle();
    expect(setTitle).toHaveBeenCalledWith("AgentPanel v9.9.9");
  });

  it("never throws when the version lookup fails", async () => {
    const { getVersion } = await import("@tauri-apps/api/app");
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("no ipc"));
    await expect(applyVersionWindowTitle()).resolves.toBeUndefined();
  });
});
