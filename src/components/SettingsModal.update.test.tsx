// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { runUpdateCheck } from "../lib/updater";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.3.2") }));
vi.mock("../lib/updater", () => ({ runUpdateCheck: vi.fn().mockResolvedValue(undefined) }));

afterEach(cleanup);

describe("SettingsModal check for updates", () => {
  it("shows the current version and runs a manual check on click", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/0\.3\.2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(runUpdateCheck).toHaveBeenCalledWith({ manual: true });
  });
});
