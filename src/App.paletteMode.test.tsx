// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { paletteModeForKey } from "./App";

afterEach(() => vi.restoreAllMocks());

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: "p", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe("paletteModeForKey", () => {
  it("maps Ctrl+P to file mode", () => {
    expect(paletteModeForKey(ev({}))).toBe("files");
  });

  it("maps Ctrl+Shift+P to command mode", () => {
    expect(paletteModeForKey(ev({ shiftKey: true, key: "P" }))).toBe("commands");
  });

  it("ignores plain P", () => {
    expect(paletteModeForKey(ev({ ctrlKey: false }))).toBeNull();
  });

  it("ignores Ctrl+Alt+P so it can't shadow an OS or terminal binding", () => {
    expect(paletteModeForKey(ev({ altKey: true }))).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(paletteModeForKey(ev({ key: "P" }))).toBe("files");
    expect(paletteModeForKey(ev({ key: "p", shiftKey: true }))).toBe("commands");
  });
});
