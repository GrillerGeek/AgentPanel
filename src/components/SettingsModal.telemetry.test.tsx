// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.4.0") }));
vi.mock("../lib/updater", () => ({ runUpdateCheck: vi.fn().mockResolvedValue(undefined) }));

afterEach(cleanup);

type ConsentValue = "unset" | "granted" | "denied";

function mockConsent(consent: ConsentValue) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_telemetry_consent") {
      return Promise.resolve({ consent, active_this_session: consent === "granted" });
    }
    if (cmd === "set_telemetry_consent") return Promise.resolve(undefined);
    if (cmd === "list_shells" || cmd === "list_fonts") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
}

function telemetryCheckbox() {
  return screen.getByRole("checkbox", { name: /send anonymous crash reports/i }) as HTMLInputElement;
}

describe("SettingsModal telemetry toggle", () => {
  it("reflects granted consent as checked", async () => {
    mockConsent("granted");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(telemetryCheckbox().checked).toBe(true));
  });

  it("reflects denied consent as unchecked", async () => {
    mockConsent("denied");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(telemetryCheckbox()).toBeTruthy());
    expect(telemetryCheckbox().checked).toBe(false);
  });

  it("reflects unset consent as unchecked", async () => {
    mockConsent("unset");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(telemetryCheckbox()).toBeTruthy());
    expect(telemetryCheckbox().checked).toBe(false);
  });

  it("shows helper text that the change takes effect after restart", async () => {
    mockConsent("unset");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/takes effect after restart/i)).toBeTruthy());
  });

  it("checking the box calls set_telemetry_consent with granted", async () => {
    mockConsent("unset");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(telemetryCheckbox()).toBeTruthy());
    fireEvent.click(telemetryCheckbox());
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_telemetry_consent", { consent: "granted" }),
    );
  });

  it("unchecking an already-granted box calls set_telemetry_consent with denied", async () => {
    mockConsent("granted");
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(telemetryCheckbox().checked).toBe(true));
    fireEvent.click(telemetryCheckbox());
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_telemetry_consent", { consent: "denied" }),
    );
  });
});
