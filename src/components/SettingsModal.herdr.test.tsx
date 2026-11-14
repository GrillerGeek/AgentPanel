// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { SettingsModal } from "./SettingsModal";
import { useStore } from "../state/store";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.7.1") }));
vi.mock("../lib/updater", () => ({ runUpdateCheck: vi.fn() }));
beforeEach(() => {
  useStore.getState().updateSettings({ terminalRuntime: "herdr", herdrExecutable: "herdr-core", herdrSession: "agentpanel" });
  vi.mocked(invoke).mockReset().mockImplementation((command) => {
    if (command === "herdr_detect_executable") return Promise.resolve("/home/user/.local/bin/hc");
    if (command === "get_telemetry_consent") return Promise.resolve({ consent: "denied", active_this_session: false });
    return Promise.resolve([]);
  });
});
afterEach(cleanup);
it("offers discovery in Settings, saves the absolute executable only on Save, and never connects", async () => {
  render(<SettingsModal onClose={vi.fn()} />);
  await screen.findByText("Found: /home/user/.local/bin/hc");
  expect(useStore.getState().settings.herdrExecutable).toBe("herdr-core");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(useStore.getState().settings.herdrExecutable).toBe("/home/user/.local/bin/hc"));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "herdr_inventory" || command === "herdr_open")).toBe(false);
});
it("preserves a custom path and does not run discovery on opening Settings", async () => {
  useStore.getState().updateSettings({ herdrExecutable: "/custom/core with spaces" });
  render(<SettingsModal onClose={vi.fn()} />);
  expect((screen.getByLabelText("Herdr core executable") as HTMLInputElement).value).toBe("/custom/core with spaces");
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "herdr_detect_executable")).toBe(false);
});
