import { describe, expect, it } from "vitest";
import { copyGhosttySelection, findGhosttyText, readGhosttyText, type GraphemeBuffer, type TextCell } from "./ghosttyText";
const cell = (text: string, width = 1): TextCell => ({ codepoint: text.codePointAt(0) ?? 0, width, grapheme_len: [...text].length > 1 ? [...text].length : 0 });
function buffer(): GraphemeBuffer {
  return { getDimensions: () => ({ cols: 6, rows: 1 }), getScrollbackLength: () => 1,
    getScrollbackLine: () => [cell("👩🏽‍💻", 2), cell("", 0), cell(" "), cell("é"), cell(" "), cell(" ")],
    getLine: () => [cell("中", 2), cell("", 0), cell("a"), cell(" "), cell("b"), cell(" ")],
    getGraphemeString: () => "", getScrollbackGraphemeString: (_row, col) => col === 0 ? "👩🏽‍💻" : "é" };
}
describe("public Ghostty grapheme text", () => {
  it("preserves scrollback clusters, combining marks, spaces and CJK continuation widths", () => {
    const result = readGhosttyText(buffer()); expect(result.status).toBe("supported");
    if (result.status !== "supported") return;
    expect(result.value.text).toBe("👩🏽‍💻 é  \n中a b "); expect(result.value.lines[0].cells[0].width).toBe(2);
  });
  it("copies exclusive endpoints, snaps full clusters, and trims row padding across lines", () => {
    const result = readGhosttyText(buffer()); if (result.status !== "supported") throw new Error("fixture");
    expect(copyGhosttySelection(result.value, { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toEqual({ status: "supported", value: "👩🏽‍💻" });
    expect(copyGhosttySelection(result.value, { start: { x: 3, y: 1 }, end: { x: 3, y: 0 } })).toEqual({ status: "supported", value: "é\n中a" });
    expect(copyGhosttySelection(result.value, { start: { x: 1, y: 0 }, end: { x: 1, y: 0 } })).toEqual({ status: "supported", value: "" });
    expect(copyGhosttySelection(result.value, { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } })).toEqual({ status: "supported", value: "中" });
    expect(copyGhosttySelection(result.value, { start: { x: 3, y: 1 }, end: { x: 4, y: 1 } })).toEqual({ status: "supported", value: " " });
    expect(copyGhosttySelection(result.value, { start: { x: 0, y: -1 }, end: { x: 0, y: 0 } }).status).toBe("unsupported");
  });
  it("maps Unicode literal forward/backward matches to cells and reports wrap", () => {
    const result = readGhosttyText(buffer()); if (result.status !== "supported") throw new Error("fixture");
    const first = findGhosttyText(result.value, "👩🏽‍💻", -1, false);
    expect(first.match).toEqual({ start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, wrapped: false });
    expect(findGhosttyText(result.value, "👩🏽‍💻", first.offset, false).match?.wrapped).toBe(true);
    expect(findGhosttyText(result.value, "中a", -1, true).match?.end).toEqual({ x: 3, y: 1 });
    expect(findGhosttyText(result.value, "absent", -1, false).match).toBeNull();
  });
  it("returns unsupported for unavailable public data or buffers beyond extraction budget", () => {
    expect(readGhosttyText(buffer(), 1).status).toBe("unsupported");
    expect(readGhosttyText({ ...buffer(), getScrollbackLine: () => null }).status).toBe("unsupported");
  });
});

it("wraps backward from offset zero to the last occurrence", () => {
  const fixture = buffer(); fixture.getScrollbackLine = () => Array.from({ length: 6 }, () => cell("a")); fixture.getLine = fixture.getScrollbackLine;
  const result = readGhosttyText(fixture); if (result.status !== "supported") throw new Error("fixture");
  expect(findGhosttyText(result.value, "a", 0, true)).toMatchObject({ offset: 12, match: { wrapped: true, start: { x: 5, y: 1 } } });
});
it("joins only authoritative continuations, preserves real spaces, and maps logical search back to physical cells", () => {
  const rows = ["abcde ", "fghi  ", "next  "].map((line) => [...line].map((ch) => cell(ch)));
  const fixture: GraphemeBuffer = { getDimensions: () => ({ cols: 6, rows: 2 }), getScrollbackLength: () => 1,
    getScrollbackLine: (y) => rows[y], getLine: (y) => rows[y + 1], getGraphemeString: () => "", getScrollbackGraphemeString: () => "",
    getRowMetadata: () => ({ cols: 6, height: 2, history: 1, rows: [[1, 0, "000000", "111111"], [0, 1, "000000", "111100"], [0, 0, "000000", "111100"]] }) };
  const result = readGhosttyText(fixture); if (result.status !== "supported") throw new Error(result.reason);
  expect(result.value.text).toBe("abcde fghi\nnext");
  const match = findGhosttyText(result.value, "e fg", -1, false).match!;
  expect(match.start).toEqual({ x: 4, y: 0 }); expect(match.end).toEqual({ x: 2, y: 1 });
  expect(copyGhosttySelection(result.value, match)).toEqual({ status: "supported", value: "e fg" });
  const hard = findGhosttyText(result.value, "hi\nne", -1, false).match!;
  expect(copyGhosttySelection(result.value, hard)).toEqual({ status: "supported", value: "hi\nne" });
});
it("omits authoritative wide edge heads/tails without inserting a phantom copy/search space", () => {
  const rows = [[cell("a"), cell("b"), cell("c"), cell("")], [cell("中", 2), cell("", 0), cell("x"), cell(" ")]];
  const fixture: GraphemeBuffer = { getDimensions: () => ({ cols: 4, rows: 2 }), getScrollbackLength: () => 0,
    getLine: (y) => rows[y], getScrollbackLine: () => null, getGraphemeString: () => "", getScrollbackGraphemeString: () => "",
    getRowMetadata: () => ({ cols: 4, height: 2, history: 0, rows: [[1, 0, "0003", "1110"], [0, 1, "1200", "1010"]] }) };
  const result = readGhosttyText(fixture); if (result.status !== "supported") throw new Error(result.reason);
  expect(result.value.text).toBe("abc中x"); const match = findGhosttyText(result.value, "c中", -1, false).match!;
  expect(match).toMatchObject({ start: { x: 2, y: 0 }, end: { x: 2, y: 1 } }); expect(copyGhosttySelection(result.value, match).status).toBe("supported");
});
it("fails explicitly on missing/mismatched authoritative metadata instead of a physical-row fallback", () => {
  const fixture = buffer(); fixture.getRowMetadata = () => ({ cols: 99, height: 1, history: 1, rows: [] }); expect(readGhosttyText(fixture).status).toBe("unsupported");
  fixture.getRowMetadata = () => { throw new Error("ABI limit"); }; expect(readGhosttyText(fixture)).toMatchObject({ status: "unsupported", reason: expect.stringContaining("ABI limit") });
});
