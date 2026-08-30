import { describe, it, expect } from "vitest";
import { composeReviewPrompt } from "./reviewPrompt";
import type { DiffComment } from "../types";

const c = (over: Partial<DiffComment>): DiffComment => ({
  id: "x", file: "src/a.ts", line: 10, code: "const a = 1;", body: "rename a", ...over,
});

describe("composeReviewPrompt", () => {
  it("returns an empty string when there are no comments", () => {
    expect(composeReviewPrompt([])).toBe("");
  });

  it("includes every comment body", () => {
    const out = composeReviewPrompt([c({ body: "first" }), c({ body: "second", line: 20 })]);
    expect(out).toContain("first");
    expect(out).toContain("second");
  });

  it("names each file once, even with several comments in it", () => {
    const out = composeReviewPrompt([
      c({ file: "src/a.ts", line: 1, body: "one" }),
      c({ file: "src/a.ts", line: 2, body: "two" }),
    ]);
    expect(out.split("src/a.ts").length - 1).toBe(1);
  });

  it("groups comments by file", () => {
    const out = composeReviewPrompt([
      c({ file: "src/a.ts", body: "in a" }),
      c({ file: "src/b.ts", body: "in b" }),
      c({ file: "src/a.ts", line: 99, body: "also in a" }),
    ]);
    expect(out.indexOf("also in a")).toBeLessThan(out.indexOf("src/b.ts"));
  });

  it("cites the line number and the source line for an anchored comment", () => {
    const out = composeReviewPrompt([c({ line: 42, code: "  const total = 0;", body: "off by one" })]);
    expect(out).toContain("42");
    expect(out).toContain("const total = 0;");
  });

  it("marks a file-level comment instead of inventing a line number", () => {
    const out = composeReviewPrompt([c({ line: null, code: "", body: "split this module" })]);
    expect(out).toContain("whole file");
    expect(out).not.toMatch(/line \d/);
  });

  it("does not end with a newline, so the agent's input box gets no stray blank line", () => {
    expect(composeReviewPrompt([c({})]).endsWith("\n")).toBe(false);
  });

  it("omits the colon when the anchored line's source text is blank", () => {
    const out = composeReviewPrompt([c({ line: 42, code: "   ", body: "why is this blank?" })]);
    expect(out).toContain("line 42");
    expect(out).not.toMatch(/line 42:/);
    expect(out).toContain("why is this blank?");
  });
});
