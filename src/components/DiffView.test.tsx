// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);

const PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -10,2 +10,3 @@
 const a = 1;
+const b = 2;
`;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(PATCH);
  useStore.setState({ diffComments: {} });
});

describe("DiffView", () => {
  it("requests the patch for its file", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("worktree_file_patch", { path: "/wt1", file: "src/a.ts" }),
    );
  });

  it("renders the diff lines with new-side line numbers", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const b = 2;")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy(); // the added line's new number
  });

  it("adds a comment anchored to the clicked line", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    const row = await screen.findByTestId("diff-line-11");
    fireEvent.click(row);
    fireEvent.change(screen.getByPlaceholderText(/comment/i), { target: { value: "too clever" } });
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    const stored = useStore.getState().diffComments["/wt1"];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ file: "src/a.ts", line: 11, code: "const b = 2;", body: "too clever" });
  });

  it("will not add an empty comment", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    fireEvent.click(await screen.findByTestId("diff-line-11"));
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));
    expect(useStore.getState().diffComments["/wt1"] ?? []).toHaveLength(0);
  });

  it("shows existing comments for the file and can delete one", async () => {
    useStore.setState({
      diffComments: { "/wt1": [{ id: "c1", file: "src/a.ts", line: 11, code: "const b = 2;", body: "existing" }] },
    });
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText("existing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));
    expect(useStore.getState().diffComments["/wt1"]).toHaveLength(0);
  });

  it("shows a message instead of an empty pane when the patch is empty", async () => {
    vi.mocked(invoke).mockResolvedValue("");
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText(/nothing to show/i)).toBeTruthy();
  });
});
