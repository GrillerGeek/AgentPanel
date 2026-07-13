// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";
import { useStore } from "../state/store";
import { restartToUpdate } from "../lib/updater";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/updater", () => ({ restartToUpdate: vi.fn().mockResolvedValue(undefined) }));

afterEach(cleanup);

describe("UpdateBanner", () => {
  it("renders nothing when no update is ready", () => {
    useStore.setState({ updateStatus: "idle", updateVersion: null });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the staged version when ready", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    expect(screen.getByText(/0\.4\.0/)).toBeTruthy();
  });

  it("Restart now calls restartToUpdate", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /restart now/i }));
    expect(restartToUpdate).toHaveBeenCalledOnce();
  });

  it("Later dismisses the banner", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(screen.queryByText(/is ready/i)).toBeNull();
  });

  it("re-shows the banner when a newer version gets staged", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(screen.queryByText(/is ready/i)).toBeNull();

    act(() => {
      useStore.setState({ updateVersion: "0.4.1" });
    });

    expect(screen.getByText(/0\.4\.1/)).toBeTruthy();
  });
});
