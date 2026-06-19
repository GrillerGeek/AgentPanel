import { describe, it, expect } from "vitest";
import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns 0 for an empty query (matches everything)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("returns null when chars are missing or out of order", () => {
    expect(fuzzyScore("xyz", "main")).toBeNull();
    expect(fuzzyScore("niam", "main")).toBeNull(); // wrong order
  });

  it("matches a subsequence", () => {
    expect(fuzzyScore("mn", "main")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("MA", "main")).not.toBeNull();
  });

  it("ranks a prefix/contiguous match above a scattered one", () => {
    const contiguous = fuzzyScore("main", "main")!;
    const scattered = fuzzyScore("main", "m-a-i-n")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("rewards a start-of-string match", () => {
    const atStart = fuzzyScore("ag", "agent-1")!;
    const inMiddle = fuzzyScore("ag", "my-agent")!;
    expect(atStart).toBeGreaterThan(inMiddle);
  });
});
