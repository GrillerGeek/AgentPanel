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

// worktreeId (the comment-store key) and path (the filesystem path handed to
// Rust) are deliberately different values here — I6 was DiffView passing the
// id where a path belongs, so a test using the same string for both would let
// that bug slip back in unnoticed.
const WORKTREE_ID = "wtid1";
const PATH = "/real/wt1";

function renderDiffView(overrides: Partial<{ file: string; refreshNonce: number }> = {}) {
  return render(
    <DiffView
      worktreeId={WORKTREE_ID}
      path={PATH}
      file={overrides.file ?? "src/a.ts"}
      refreshNonce={overrides.refreshNonce ?? 0}
    />,
  );
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(PATCH);
  useStore.setState({ diffComments: {} });
});

describe("DiffView", () => {
  it("requests the patch using the worktree's path, not its id", async () => {
    renderDiffView();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("worktree_file_patch", { path: PATH, file: "src/a.ts" }),
    );
  });

  it("re-fetches the patch when the refresh nonce changes", async () => {
    const { rerender } = renderDiffView({ refreshNonce: 0 });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    rerender(<DiffView worktreeId={WORKTREE_ID} path={PATH} file="src/a.ts" refreshNonce={1} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("renders the diff lines with new-side line numbers", async () => {
    renderDiffView();
    expect(await screen.findByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const b = 2;")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy(); // the added line's new number
  });

  it("adds a comment anchored to the clicked line", async () => {
    renderDiffView();
    const row = await screen.findByTestId("diff-line-11");
    fireEvent.click(row);
    fireEvent.change(screen.getByPlaceholderText(/comment/i), { target: { value: "too clever" } });
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    const stored = useStore.getState().diffComments[WORKTREE_ID];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ file: "src/a.ts", line: 11, code: "const b = 2;", body: "too clever" });
  });

  it("will not add an empty comment", async () => {
    renderDiffView();
    fireEvent.click(await screen.findByTestId("diff-line-11"));
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));
    expect(useStore.getState().diffComments[WORKTREE_ID] ?? []).toHaveLength(0);
  });

  it("shows existing comments for the file and can delete one", async () => {
    useStore.setState({
      diffComments: { [WORKTREE_ID]: [{ id: "c1", file: "src/a.ts", line: 11, code: "const b = 2;", body: "existing" }] },
    });
    renderDiffView();
    expect(await screen.findByText("existing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));
    expect(useStore.getState().diffComments[WORKTREE_ID]).toHaveLength(0);
  });

  it("shows a message instead of an empty pane when the patch is empty", async () => {
    vi.mocked(invoke).mockResolvedValue("");
    renderDiffView();
    expect(await screen.findByText(/nothing to show/i)).toBeTruthy();
  });

  it("can add a comment on the file as a whole, stored with line: null", async () => {
    renderDiffView();
    await screen.findByText("const a = 1;"); // wait for the patch to load
    fireEvent.click(screen.getByRole("button", { name: /comment on this file/i }));
    fireEvent.change(screen.getByPlaceholderText(/comment/i), { target: { value: "overall looks good" } });
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    const stored = useStore.getState().diffComments[WORKTREE_ID];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ file: "src/a.ts", line: null, body: "overall looks good" });
  });

  it("renders an existing file-level comment", async () => {
    useStore.setState({
      diffComments: { [WORKTREE_ID]: [{ id: "c1", file: "src/a.ts", line: null, code: "", body: "whole-file note" }] },
    });
    renderDiffView();
    expect(await screen.findByText("whole-file note")).toBeTruthy();
  });
});
