import { describe, it, expect, vi } from "vitest";
import { makeCopyPasteKeyHandler, makeContextMenuHandler } from "./terminalClipboard";

// Issue #31: paste doubled. The custom key handler must BOTH suppress the
// WebView's native paste (preventDefault) and be the only paste pipeline
// (exactly one term.paste call, never a raw pty_write).

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: "keydown",
    key: "v",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function makeDeps(overrides: Partial<Parameters<typeof makeCopyPasteKeyHandler>[0]> = {}) {
  return {
    isMac: false,
    readClipboard: vi.fn().mockResolvedValue("CLIP"),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    pasteToTerminal: vi.fn(),
    getSelection: vi.fn().mockReturnValue(""),
    hasSelection: vi.fn().mockReturnValue(false),
    clearSelection: vi.fn(),
    openSearch: vi.fn(),
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("paste key chord (issue #31)", () => {
  it("Ctrl+V on Windows: prevents the native paste and pastes exactly once via the terminal", async () => {
    const deps = makeDeps({ isMac: false });
    const handler = makeCopyPasteKeyHandler(deps);
    const e = keyEvent({ ctrlKey: true });

    const result = handler(e);
    await flush();

    expect(result).toBe(false); // xterm must not process the chord
    expect(e.preventDefault).toHaveBeenCalled(); // native WebView paste suppressed
    expect(deps.pasteToTerminal).toHaveBeenCalledTimes(1);
    expect(deps.pasteToTerminal).toHaveBeenCalledWith("CLIP");
  });

  it("Cmd+V on macOS: prevents the native paste and pastes exactly once", async () => {
    const deps = makeDeps({ isMac: true });
    const handler = makeCopyPasteKeyHandler(deps);
    const e = keyEvent({ metaKey: true });

    const result = handler(e);
    await flush();

    expect(result).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(deps.pasteToTerminal).toHaveBeenCalledTimes(1);
  });

  it("macOS Ctrl+V (not Cmd) falls through to the shell untouched", async () => {
    const deps = makeDeps({ isMac: true });
    const handler = makeCopyPasteKeyHandler(deps);
    const e = keyEvent({ ctrlKey: true });

    expect(handler(e)).toBe(true);
    await flush();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(deps.pasteToTerminal).not.toHaveBeenCalled();
  });

  it("empty clipboard pastes nothing", async () => {
    const deps = makeDeps({ readClipboard: vi.fn().mockResolvedValue("") });
    const handler = makeCopyPasteKeyHandler(deps);
    handler(keyEvent({ ctrlKey: true }));
    await flush();
    expect(deps.pasteToTerminal).not.toHaveBeenCalled();
  });

  it("Ctrl+C with a selection copies and clears; without a selection falls through as interrupt", async () => {
    const deps = makeDeps({
      hasSelection: vi.fn().mockReturnValue(true),
      getSelection: vi.fn().mockReturnValue("SEL"),
    });
    const handler = makeCopyPasteKeyHandler(deps);
    expect(handler(keyEvent({ ctrlKey: true, key: "c" }))).toBe(false);
    expect(deps.writeClipboard).toHaveBeenCalledWith("SEL");
    expect(deps.clearSelection).toHaveBeenCalled();

    const deps2 = makeDeps({ hasSelection: vi.fn().mockReturnValue(false) });
    const handler2 = makeCopyPasteKeyHandler(deps2);
    expect(handler2(keyEvent({ ctrlKey: true, key: "c" }))).toBe(true);
    expect(deps2.writeClipboard).not.toHaveBeenCalled();
  });
});

describe("right-click QuickEdit (issue #31)", () => {
  it("with no selection: suppresses the menu and pastes exactly once via the terminal", async () => {
    const deps = makeDeps();
    const handler = makeContextMenuHandler(deps);
    const e = { preventDefault: vi.fn() } as unknown as MouseEvent;

    handler(e);
    await flush();

    expect(e.preventDefault).toHaveBeenCalled();
    expect(deps.pasteToTerminal).toHaveBeenCalledTimes(1);
    expect(deps.pasteToTerminal).toHaveBeenCalledWith("CLIP");
  });

  it("with a selection: copies instead of pasting", async () => {
    const deps = makeDeps({
      hasSelection: vi.fn().mockReturnValue(true),
      getSelection: vi.fn().mockReturnValue("SEL"),
    });
    const handler = makeContextMenuHandler(deps);
    handler({ preventDefault: vi.fn() } as unknown as MouseEvent);
    await flush();

    expect(deps.writeClipboard).toHaveBeenCalledWith("SEL");
    expect(deps.pasteToTerminal).not.toHaveBeenCalled();
  });
});
