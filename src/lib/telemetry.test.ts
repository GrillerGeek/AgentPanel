import { describe, it, expect } from "vitest";
import { scrubPaths } from "./telemetry";

// The spec does not pin down the exact replacement token used when a path is
// scrubbed (e.g. "~", "<home>", or something else) -- only that the
// username/home directory must not survive, and that messages are "kept but
// path-scrubbed" (not dropped). These tests assert that invariant rather than
// an exact scrubbed string, since asserting a specific token would be
// guessing at an unstated resolution.

describe("scrubPaths", () => {
  it("redacts a macOS home-directory username", () => {
    const input = "Error at /Users/jane/dev/agentpanel/src/lib/telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("jane");
    expect(out).not.toContain("/Users/jane");
  });

  it("redacts a Windows home-directory username", () => {
    const input = "Error at C:\\Users\\jane\\dev\\agentpanel\\src\\lib\\telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("jane");
    expect(out).not.toContain("C:\\Users\\jane");
  });

  it("keeps non-path message text intact", () => {
    const input = "TypeError: cannot read properties of undefined at /Users/jane/repo/src/App.tsx";
    const out = scrubPaths(input);
    expect(out).toContain("TypeError: cannot read properties of undefined");
    expect(out).not.toContain("jane");
  });

  // --- additional home/mount prefixes (fix round h) ---------------------

  it("redacts a Linux home-directory username", () => {
    const input = "Error at /home/jane/dev/agentpanel/src/lib/telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("jane");
    expect(out).not.toContain("/home/jane");
  });

  it("redacts the Linux root home directory", () => {
    const input = "Error at /root/repo/src/lib/telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("/root");
  });

  it("redacts a macOS volume mount", () => {
    const input = "Error at /Volumes/Untitled/dev/agentpanel/src/lib/telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("Untitled");
    expect(out).not.toContain("/Volumes/Untitled");
  });

  it("redacts a Windows UNC share", () => {
    const input = "Error at \\\\build-server\\repos\\agentpanel\\src\\lib\\telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("build-server");
    expect(out).not.toContain("repos");
  });

  it("redacts a lowercase-drive, forward-slash Windows path", () => {
    // Regression coverage for the widened truncation backstop, which
    // previously only matched uppercase `[A-Z]:\Users\`.
    const input = "Error at c:/Users/jane/dev/agentpanel/src/lib/telemetry.ts:10";
    const out = scrubPaths(input);
    expect(out).not.toContain("jane");
  });
});
