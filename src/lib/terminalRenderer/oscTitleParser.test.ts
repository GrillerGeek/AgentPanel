import { describe, expect, it } from "vitest";
import { OscTitleParser } from "./oscTitleParser";
const bytes = (text: string) => new TextEncoder().encode(text);
describe("streaming titles", () => {
  it("handles every split boundary, UTF-8, OSC 0/2, BEL and ST exactly once", () => {
    const input = bytes("before\x1b]0;café 👩🏽‍💻\x07\x1b]2;second\x1b\\after");
    for (let split = 0; split <= input.length; split++) {
      const titles: string[] = []; const parser = new OscTitleParser((title) => titles.push(title));
      parser.write(input.slice(0, split)); parser.write(input.slice(split)); expect(titles).toEqual(["café 👩🏽‍💻", "second"]);
    }
  });
  it("handles one-byte chunks, empty titles and consecutive events", () => {
    const titles: string[] = []; const parser = new OscTitleParser((title) => titles.push(title));
    for (const byte of bytes("\x1b]2;\x07\x1b]2;a\x1b\\\x1b]2;b\x07")) parser.write(Uint8Array.of(byte));
    expect(titles).toEqual(["", "a", "b"]);
  });
  it("ignores OSC-looking bytes inside DCS, SOS, PM and APC payloads", () => {
    for (const opener of ["P", "X", "^", "_"]) {
      const titles: string[] = []; const parser = new OscTitleParser((title) => titles.push(title));
      parser.write(bytes(`\x1b${opener}opaque\x1b]2;fake\x07\x1b\\\x1b]2;real\x07`)); expect(titles).toEqual(["real"]);
    }
  });
  it("bounds oversize and incomplete sequences, cancels malformed controls and recovers", () => {
    const titles: string[] = []; const parser = new OscTitleParser((title) => titles.push(title), 8);
    parser.write(bytes("\x1b]2;123456789012345\x07\x1b]2;partial\x18\x1b]9;other\x07\x1b]2;ok\x07\x1b]2;unterminated"));
    expect(titles).toEqual(["ok"]); parser.reset(); parser.write(bytes("plain\x07")); expect(titles).toEqual(["ok"]);
  });
  it("does not mistake UTF-8 continuation bytes for 8-bit C1 controls", () => {
    const titles: string[] = []; const parser = new OscTitleParser((title) => titles.push(title)); parser.write(bytes("\x1b]2;ÛÜÝ\x07")); expect(titles).toEqual(["ÛÜÝ"]);
  });
});
