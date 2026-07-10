// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TabBar } from "./TabBar";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

// Module-level mock: the store module (src/state/store.ts) also imports `invoke`
// from this same package, so this single mock covers both TabBar's direct calls
// (if any) and any store action that shells out via `invoke`.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

function seedOneTerminal() {
  useStore.setState({
    repositories: [],
    worktrees: {},
    terminals: [{ id: "tA", worktreeId: "wtA", cwd: ".", title: "Terminal", panes: [{ id: "pA" }] }],
    activeTabId: "tA",
  });
}

/** Same as seedOneTerminal, but the active terminal's worktree is present in
 *  the `worktrees` record with a known `path`, so the active-worktree selector
 *  resolves to a real Worktree (needed for the "open in editor" button, which
 *  reads the active worktree's `path`). */
function seedOneTerminalWithActiveWorktree(path = "C:/fake/alpha") {
  useStore.setState({
    repositories: [],
    worktrees: {
      r1: [{ id: "wtA", repoId: "r1", path, name: "alpha", branch: "main", isPrimary: true }],
    },
    terminals: [{ id: "tA", worktreeId: "wtA", cwd: ".", title: "Terminal", panes: [{ id: "pA" }] }],
    activeTabId: "tA",
    toasts: [],
    settings: { ...useStore.getState().settings, editorCommand: "code" },
  });
}

describe("TabBar settings gear (issue #15)", () => {
  it("shows a settings gear in the tab bar and opens settings on click", () => {
    seedOneTerminal();
    const onOpenSettings = vi.fn();
    render(<TabBar onOpenSettings={onOpenSettings} />);
    const gear = screen.getByTitle(/settings/i);
    fireEvent.click(gear);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe("TabBar open-in-editor button", () => {
  it("defaults settings.editorCommand to \"code\" when no settings are persisted", () => {
    // jsdom's localStorage is empty in this environment, so readSettings() falls
    // back to DEFAULT_SETTINGS, which must include editorCommand: "code".
    expect(useStore.getState().settings.editorCommand).toBe("code");
  });

  it('renders an "Open in editor" button with the configured-command tooltip when a session is active', () => {
    seedOneTerminalWithActiveWorktree();
    render(<TabBar onOpenSettings={vi.fn()} />);
    expect(screen.getByTitle('Open in "code"')).toBeTruthy();
  });

  it("invokes open_in_editor with the configured command and the active worktree's path on click", async () => {
    seedOneTerminalWithActiveWorktree("C:/fake/alpha");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    render(<TabBar onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Open in "code"'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_in_editor", {
        command: "code",
        path: "C:/fake/alpha",
      });
    });
  });

  it('pushes an error toast reading Couldn\'t run "code" — is it on your PATH? when open_in_editor rejects', async () => {
    seedOneTerminalWithActiveWorktree("C:/fake/alpha");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("spawn ENOENT"));
    render(<TabBar onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Open in "code"'));

    await waitFor(() => {
      expect(
        useStore.getState().toasts.some((t) => t.message.includes('Couldn\'t run "code"')),
      ).toBe(true);
    });
  });
});
