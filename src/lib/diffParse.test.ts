import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diffParse";

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,6 @@ function boot() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

describe("parseUnifiedDiff", () => {
  it("ignores the file header and returns one hunk", () => {
    const hunks = parseUnifiedDiff(PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("@@ -10,5 +10,6 @@ function boot() {");
  });

  it("classifies each line", () => {
    const kinds = parseUnifiedDiff(PATCH)[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(["context", "del", "add", "add", "context"]);
  });

  it("strips the leading marker from the text", () => {
    const texts = parseUnifiedDiff(PATCH)[0].lines.map((l) => l.text);
    expect(texts).toEqual(["const a = 1;", "const b = 2;", "const b = 3;", "const c = 4;", "const d = 5;"]);
  });

  it("numbers old and new sides independently", () => {
    const lines = parseUnifiedDiff(PATCH)[0].lines;
    expect(lines.map((l) => l.oldNo)).toEqual([10, 11, null, null, 12]);
    expect(lines.map((l) => l.newNo)).toEqual([10, null, 11, 12, 13]);
  });

  it("keeps blank context lines so numbering does not drift", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n \n b\n";
    const lines = parseUnifiedDiff(patch)[0].lines;
    expect(lines.map((l) => l.text)).toEqual(["a", "", "b"]);
    expect(lines.map((l) => l.newNo)).toEqual([1, 2, 3]);
  });

  it("handles a single-line hunk header with no comma", () => {
    const lines = parseUnifiedDiff("@@ -7 +7 @@\n-old\n+new\n")[0].lines;
    expect(lines[0].oldNo).toBe(7);
    expect(lines[1].newNo).toBe(7);
  });

  it("records the no-trailing-newline marker as meta without numbering it", () => {
    const lines = parseUnifiedDiff("@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n")[0].lines;
    expect(lines[2].kind).toBe("meta");
    expect(lines[2].oldNo).toBeNull();
    expect(lines[2].newNo).toBeNull();
  });

  it("splits multiple hunks", () => {
    const patch = "@@ -1,1 +1,1 @@\n-a\n+b\n@@ -50,1 +50,1 @@\n-c\n+d\n";
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines[1].newNo).toBe(50);
  });

  it("returns an empty array for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
