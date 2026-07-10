// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PaneErrorBoundary } from "./PaneErrorBoundary";

// React logs caught boundary errors to console.error; silence them so test
// output stays pristine while still failing on unexpected crashes.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

let broken = true;
function Flaky() {
  if (broken) throw new Error("PTY channel unavailable");
  return <div>terminal content</div>;
}

describe("PaneErrorBoundary (issue #18)", () => {
  it("renders its children when nothing throws", () => {
    broken = false;
    render(
      <PaneErrorBoundary>
        <Flaky />
      </PaneErrorBoundary>,
    );
    expect(screen.getByText("terminal content")).toBeTruthy();
  });

  it("catches a child render crash and shows a fallback instead of unmounting", () => {
    broken = true;
    render(
      <PaneErrorBoundary>
        <Flaky />
      </PaneErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/PTY channel unavailable/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reload pane/i })).toBeTruthy();
  });

  it("remounts its children when Reload pane is clicked", () => {
    broken = true;
    render(
      <PaneErrorBoundary>
        <Flaky />
      </PaneErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    broken = false; // the underlying problem goes away
    fireEvent.click(screen.getByRole("button", { name: /reload pane/i }));
    expect(screen.getByText("terminal content")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a sibling boundary's content alive when one pane crashes", () => {
    broken = true;
    render(
      <>
        <PaneErrorBoundary>
          <Flaky />
        </PaneErrorBoundary>
        <PaneErrorBoundary>
          <div>healthy pane</div>
        </PaneErrorBoundary>
      </>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("healthy pane")).toBeTruthy();
  });
});
