// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TabBar } from "./TabBar";
import { useStore } from "../state/store";

afterEach(cleanup);

function seedOneTerminal() {
  useStore.setState({
    repositories: [],
    worktrees: {},
    terminals: [{ id: "tA", worktreeId: "wtA", cwd: ".", title: "Terminal", panes: [{ id: "pA" }] }],
    activeTabId: "tA",
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
