// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEscapeToClose } from "./useEscapeToClose";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useStore } from "../state/store";

afterEach(cleanup);

function Demo({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  return null;
}

describe("useEscapeToClose", () => {
  it("calls onClose when Escape is pressed anywhere in the window", () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "e" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Demo onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog Escape-to-cancel", () => {
  it("cancels the pending confirm when Escape is pressed", async () => {
    const pending = useStore.getState().requestConfirm({ message: "Close it all?" });
    expect(screen.queryByText("Close it all?")).toBeNull(); // not rendered yet
    render(<ConfirmDialog />);
    expect(screen.getByText("Close it all?")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(pending).resolves.toBe(false); // Escape = cancel
    expect(screen.queryByText("Close it all?")).toBeNull();
  });
});
