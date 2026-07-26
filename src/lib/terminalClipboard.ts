/**
 * Terminal copy/paste handlers (issue #31: paste was doubled).
 *
 * There must be exactly ONE paste pipeline. The key handler both suppresses
 * the WebView's native paste (`preventDefault()` — xterm's custom-key-handler
 * "return false" alone does NOT cancel the browser default, so the native
 * paste event would fire into xterm's textarea as a second paste) and feeds
 * the clipboard through `pasteToTerminal` (xterm's `term.paste()`), which
 * applies bracketed-paste wrapping before the bytes reach the PTY.
 */

export interface ClipboardDeps {
  isMac: boolean;
  /** Tauri clipboard-manager readText */
  readClipboard: () => Promise<string | null>;
  /** Tauri clipboard-manager writeText */
  writeClipboard: (text: string) => Promise<void>;
  /** xterm term.paste — the single entry point for pasted text */
  pasteToTerminal: (text: string) => void;
  getSelection: () => string;
  hasSelection: () => boolean;
  clearSelection: () => void;
  /** open the search UI (Ctrl+F) */
  openSearch: () => void;
}

const copySelection = (deps: ClipboardDeps) => {
  const sel = deps.getSelection();
  if (sel) void deps.writeClipboard(sel);
};

const pasteClipboard = (deps: ClipboardDeps) => {
  void deps.readClipboard().then((text) => {
    if (text) deps.pasteToTerminal(text);
  });
};

/** Handler for xterm's attachCustomKeyEventHandler. */
export function makeCopyPasteKeyHandler(deps: ClipboardDeps) {
  return (e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") return true;
    // Find uses Ctrl on every platform (it predates the clipboard work).
    if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "f" || e.key === "F")) {
      deps.openSearch();
      return false;
    }
    // Copy/paste use the platform's primary modifier; require the *other*
    // modifier to be absent so e.g. macOS Ctrl+C still interrupts the shell.
    const copyPasteMod = deps.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (copyPasteMod && !e.altKey && !e.shiftKey) {
      // Copy when text is selected; with no selection, fall through so the
      // shell receives the interrupt — the key that stops a runaway agent.
      if (e.key === "c" || e.key === "C") {
        if (deps.hasSelection()) {
          copySelection(deps);
          deps.clearSelection();
          return false;
        }
        return true;
      }
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        pasteClipboard(deps);
        return false;
      }
    }
    return true;
  };
}

/**
 * Right-click follows the Windows-console "QuickEdit" model: copy the
 * selection if there is one, otherwise paste. Prevent the default so the
 * webview doesn't clear the selection or show its own context menu.
 */
export function makeContextMenuHandler(deps: ClipboardDeps) {
  return (e: MouseEvent): void => {
    e.preventDefault();
    if (deps.hasSelection()) {
      copySelection(deps);
      deps.clearSelection();
    } else {
      pasteClipboard(deps);
    }
  };
}
