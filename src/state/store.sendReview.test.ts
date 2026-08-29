// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  useStore.setState({
    diffComments: {},
    toasts: [],
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
    paneSessions: { p1: 7 },
  });
});

describe("sendReviewToAgent", () => {
  it("writes the composed prompt to the active pane's PTY", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");

    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "pty_write");
    expect(call).toBeTruthy();
    const args = call![1] as { id: number; data: string };
    expect(args.id).toBe(7);
    expect(args.data).toContain("fix this");
  });

  it("does not append a carriage return, so the agent is not auto-submitted", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    const args = vi.mocked(invoke).mock.calls.find(([c]) => c === "pty_write")![1] as { data: string };
    expect(args.data.endsWith("\r")).toBe(false);
    expect(args.data.endsWith("\n")).toBe(false);
  });

  it("writes nothing and says so when there are no comments", async () => {
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
    expect(useStore.getState().toasts[0].message).toMatch(/no review comments/i);
  });

  it("errors clearly when the worktree has no live terminal", async () => {
    useStore.setState({ paneSessions: {} });
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
    expect(useStore.getState().toasts[0].kind).toBe("error");
  });
});
