// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { registerPaneWriter, unregisterPaneWriter } from "../lib/paneWriters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const writerSpy = vi.fn();

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  writerSpy.mockReset();
  unregisterPaneWriter("p1");
  registerPaneWriter("p1", writerSpy);
  useStore.setState({
    diffComments: {},
    toasts: [],
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
    paneSessions: { p1: 7 },
  });
});

describe("sendReviewToAgent", () => {
  it("pastes the composed prompt into the active pane's terminal, not pty_write", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");

    expect(writerSpy).toHaveBeenCalledTimes(1);
    expect(writerSpy.mock.calls[0][0]).toContain("fix this");
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
  });

  it("delivers the composed prompt to the pane writer unmodified", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    const comments = useStore.getState().diffComments["/wt1"];
    await useStore.getState().sendReviewToAgent("/wt1");

    const { composeReviewPrompt } = await import("../lib/reviewPrompt");
    expect(writerSpy).toHaveBeenCalledWith(composeReviewPrompt(comments));
  });

  it("does not append a carriage return, so the agent is not auto-submitted", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    const delivered = writerSpy.mock.calls[0][0] as string;
    expect(delivered.endsWith("\r")).toBe(false);
    expect(delivered.endsWith("\n")).toBe(false);
  });

  it("writes nothing and says so when there are no comments", async () => {
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(writerSpy).not.toHaveBeenCalled();
    expect(useStore.getState().toasts[0].message).toMatch(/no review comments/i);
  });

  it("errors clearly and writes nothing when the pane has no registered writer", async () => {
    unregisterPaneWriter("p1");
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(writerSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
    expect(useStore.getState().toasts[0].kind).toBe("error");
  });

  it("errors clearly when the worktree has no live terminal at all", async () => {
    useStore.setState({ terminals: [], activeTabId: null });
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(writerSpy).not.toHaveBeenCalled();
    expect(useStore.getState().toasts[0].kind).toBe("error");
  });
});
