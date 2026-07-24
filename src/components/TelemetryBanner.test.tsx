// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { TelemetryBanner } from "./TelemetryBanner";
import { useStore } from "../state/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);

type ConsentValue = "unset" | "granted" | "denied";

function mockConsent(consent: ConsentValue, activeThisSession = false) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_telemetry_consent") {
      return Promise.resolve({ consent, active_this_session: activeThisSession });
    }
    if (cmd === "set_telemetry_consent") {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  });
}

describe("TelemetryBanner", () => {
  it("renders the crash-report prompt when consent is unset", async () => {
    mockConsent("unset");
    render(<TelemetryBanner />);
    await waitFor(() => expect(screen.getByText(/anonymous crash reports/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /^yes$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^no$/i })).toBeTruthy();
  });

  it("renders nothing when consent is already granted", async () => {
    mockConsent("granted");
    const { container } = render(<TelemetryBanner />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_telemetry_consent"));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when consent is already denied", async () => {
    mockConsent("denied");
    const { container } = render(<TelemetryBanner />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_telemetry_consent"));
    expect(container.firstChild).toBeNull();
  });

  it("Yes grants consent and dismisses the banner permanently", async () => {
    mockConsent("unset");
    render(<TelemetryBanner />);
    const yesButton = await screen.findByRole("button", { name: /^yes$/i });
    fireEvent.click(yesButton);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_telemetry_consent", { consent: "granted" }),
    );
    expect(screen.queryByText(/anonymous crash reports/i)).toBeNull();
  });

  it("No denies consent and dismisses the banner permanently", async () => {
    mockConsent("unset");
    render(<TelemetryBanner />);
    const noButton = await screen.findByRole("button", { name: /^no$/i });
    fireEvent.click(noButton);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_telemetry_consent", { consent: "denied" }),
    );
    expect(screen.queryByText(/anonymous crash reports/i)).toBeNull();
  });

  it("reverts and toasts when set_telemetry_consent rejects", async () => {
    mockConsent("unset");
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_telemetry_consent") {
        return Promise.resolve({ consent: "unset", active_this_session: false });
      }
      if (cmd === "set_telemetry_consent") {
        return Promise.reject(new Error("disk full"));
      }
      return Promise.resolve(undefined);
    });
    useStore.setState({ toasts: [] });
    render(<TelemetryBanner />);
    const yesButton = await screen.findByRole("button", { name: /^yes$/i });
    fireEvent.click(yesButton);

    // Banner stays up (consent reverted to "unset") and a toast is pushed --
    // same pattern as SettingsModal.tsx's onCrashReportsChange.
    await waitFor(() => expect(useStore.getState().toasts.length).toBeGreaterThan(0));
    expect(screen.getByText(/anonymous crash reports/i)).toBeTruthy();
  });
});
