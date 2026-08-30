// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);

const FILES = ["src/state/store.ts", "src/components/TabBar.tsx", "README.md"];

const noop = () => {};

function activate() {
  useStore.setState({
    worktrees: { r1: [{ id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(FILES);
  useStore.setState({ terminals: [], activeTabId: null });
});

describe("CommandPalette file mode", () => {
  it("requests the active worktree's files on open", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("worktree_files", { path: "/wt1" }));
  });

  it("lists the files it received", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    expect(await screen.findByText("src/state/store.ts")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("fuzzy-filters by path", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/state/store.ts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tabbar" } });
    expect(screen.getByText("src/components/TabBar.tsx")).toBeTruthy();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("opens the selected file in the configured editor and closes", async () => {
    activate();
    const onClose = vi.fn();
    render(<CommandPalette mode="files" onClose={onClose} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/state/store.ts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tabbar" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_in_editor", {
        command: useStore.getState().settings.editorCommand,
        path: "/wt1/src/components/TabBar.tsx",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a calm empty state when the command fails, and pushes no toast", async () => {
    vi.mocked(invoke).mockRejectedValue("boom");
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeTruthy());
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("renders nothing from the command list while in file mode", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("README.md");
    expect(screen.queryByText("Open settings…")).toBeNull();
  });

  it("caps the rendered rows and says so", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `src/f${i}.ts`);
    vi.mocked(invoke).mockResolvedValue(many);
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/f0.ts");
    expect(screen.queryByText("src/f200.ts")).toBeNull();
    expect(screen.getByText(/showing 200 of 250/i)).toBeTruthy();
  });
});
