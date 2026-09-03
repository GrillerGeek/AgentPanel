// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NewWorktreeForm } from "./Sidebar";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";
import type { Repository } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const repo: Repository = { id: "C:\r", path: "C:\r", name: "r", isGit: true, defaultBranch: null };

function seed(defaultBranch: string | null, headBranch = "other") {
  useStore.setState({
    repositories: [{ ...repo, defaultBranch }],
    worktrees: {
      [repo.id]: [{ id: repo.id, repoId: repo.id, path: repo.path, name: "r", branch: headBranch, isPrimary: true }],
    },
    terminals: [],
    activeTabId: null,
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "list_branches") return ["develop", "main", "other"];
    if (cmd === "create_worktree") return [];
    return undefined;
  });
});
afterEach(cleanup);

async function openForm(defaultBranch: string | null) {
  seed(defaultBranch);
  render(<NewWorktreeForm repo={{ ...repo, defaultBranch }} />);
  fireEvent.click(screen.getByText(/new worktree/));
  const select = (await screen.findByLabelText("Base branch")) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBe(3));
  return select;
}

describe("NewWorktreeForm base branch picker", () => {
  it("lists the repo's local branches", async () => {
    const select = await openForm(null);
    expect([...select.options].map((o) => o.value)).toEqual(["develop", "main", "other"]);
  });

  it("pre-selects the repo's saved default branch", async () => {
    const select = await openForm("main");
    expect(select.value).toBe("main");
  });

  it("falls back to the primary checkout's current branch when nothing is saved", async () => {
    const select = await openForm(null);
    expect(select.value).toBe("other");
  });

  it("creates the worktree from the chosen base", async () => {
    const select = await openForm("main");
    fireEvent.change(select, { target: { value: "develop" } });
    fireEvent.change(screen.getByPlaceholderText("new branch name"), { target: { value: "feat" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("create_worktree", { repoId: repo.id, branch: "feat", base: "develop" }),
    );
  });
});
