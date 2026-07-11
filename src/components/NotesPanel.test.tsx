// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import { useStore } from "../state/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
afterEach(cleanup);

function seed(open: boolean, notes: Record<string, string> = {}) {
  useStore.setState({
    notes,
    notesOpen: open,
    worktrees: {
      r1: [{ id: "wtA", repoId: "r1", path: "wtA", name: "alpha", branch: "alpha", isPrimary: true }],
    },
    terminals: [{ id: "tA", worktreeId: "wtA", cwd: ".", title: "Terminal", panes: [{ id: "pA" }] }],
    activeTabId: "tA",
  });
}

describe("NotesPanel", () => {
  it("renders nothing when closed", () => {
    seed(false);
    const { container } = render(<NotesPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the active session's note when open", () => {
    seed(true, { wtA: "remember the migration" });
    render(<NotesPanel />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("remember the migration");
  });

  it("writes edits back to the active session's note", () => {
    seed(true, {});
    render(<NotesPanel />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new note" } });
    expect(useStore.getState().notes.wtA).toBe("new note");
  });

  it("renders nothing when there is no active worktree", () => {
    useStore.setState({ notesOpen: true, terminals: [], activeTabId: null });
    const { container } = render(<NotesPanel />);
    expect(container.firstChild).toBeNull();
  });
});
