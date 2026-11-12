/**
 * TypeScript type definitions for libghostty-vt WASM API
 * Based on include/ghostty/vt/*.h from Ghostty repository
 */
/**
 * SGR attribute tags - identifies the type of attribute
 * From include/ghostty/vt/sgr.h
 */
export declare enum SgrAttributeTag {
    UNSET = 0,
    UNKNOWN = 1,
    BOLD = 2,
    RESET_BOLD = 3,
    ITALIC = 4,
    RESET_ITALIC = 5,
    FAINT = 6,
    RESET_FAINT = 7,
    UNDERLINE = 8,
    RESET_UNDERLINE = 9,
    BLINK = 10,
    RESET_BLINK = 11,
    INVERSE = 12,
    RESET_INVERSE = 13,
    INVISIBLE = 14,
    RESET_INVISIBLE = 15,
    STRIKETHROUGH = 16,
    RESET_STRIKETHROUGH = 17,
    FG_8 = 18,// 8-color (0-7)
    FG_16 = 19,// 16-color (0-15)
    FG_256 = 20,// 256-color palette
    FG_RGB = 21,// RGB color
    FG_DEFAULT = 22,// Reset to default
    BG_8 = 23,// Background 8-color
    BG_16 = 24,// Background 16-color
    BG_256 = 25,// Background 256-color
    BG_RGB = 26,// Background RGB
    BG_DEFAULT = 27,// Reset background
    UNDERLINE_COLOR_8 = 28,
    UNDERLINE_COLOR_16 = 29,
    UNDERLINE_COLOR_256 = 30,
    UNDERLINE_COLOR_RGB = 31,
    UNDERLINE_COLOR_DEFAULT = 32
}
export interface RGBColor {
    r: number;
    g: number;
    b: number;
}
export type SgrAttribute = {
    tag: SgrAttributeTag.BOLD;
} | {
    tag: SgrAttributeTag.RESET_BOLD;
} | {
    tag: SgrAttributeTag.ITALIC;
} | {
    tag: SgrAttributeTag.RESET_ITALIC;
} | {
    tag: SgrAttributeTag.FAINT;
} | {
    tag: SgrAttributeTag.RESET_FAINT;
} | {
    tag: SgrAttributeTag.UNDERLINE;
} | {
    tag: SgrAttributeTag.RESET_UNDERLINE;
} | {
    tag: SgrAttributeTag.BLINK;
} | {
    tag: SgrAttributeTag.RESET_BLINK;
} | {
    tag: SgrAttributeTag.INVERSE;
} | {
    tag: SgrAttributeTag.RESET_INVERSE;
} | {
    tag: SgrAttributeTag.INVISIBLE;
} | {
    tag: SgrAttributeTag.RESET_INVISIBLE;
} | {
    tag: SgrAttributeTag.STRIKETHROUGH;
} | {
    tag: SgrAttributeTag.RESET_STRIKETHROUGH;
} | {
    tag: SgrAttributeTag.FG_8;
    color: number;
} | {
    tag: SgrAttributeTag.FG_16;
    color: number;
} | {
    tag: SgrAttributeTag.FG_256;
    color: number;
} | {
    tag: SgrAttributeTag.FG_RGB;
    color: RGBColor;
} | {
    tag: SgrAttributeTag.FG_DEFAULT;
} | {
    tag: SgrAttributeTag.BG_8;
    color: number;
} | {
    tag: SgrAttributeTag.BG_16;
    color: number;
} | {
    tag: SgrAttributeTag.BG_256;
    color: number;
} | {
    tag: SgrAttributeTag.BG_RGB;
    color: RGBColor;
} | {
    tag: SgrAttributeTag.BG_DEFAULT;
} | {
    tag: SgrAttributeTag.UNDERLINE_COLOR_RGB;
    color: RGBColor;
} | {
    tag: SgrAttributeTag.UNDERLINE_COLOR_DEFAULT;
} | {
    tag: SgrAttributeTag.UNKNOWN;
    params: number[];
};
/**
 * Kitty keyboard protocol flags
 * From include/ghostty/vt/key/encoder.h
 */
export declare enum KittyKeyFlags {
    DISABLED = 0,
    DISAMBIGUATE = 1,// Disambiguate escape codes
    REPORT_EVENTS = 2,// Report press and release
    REPORT_ALTERNATES = 4,// Report alternate key codes
    REPORT_ALL = 8,// Report all events
    REPORT_ASSOCIATED = 16,// Report associated text
    ALL = 31
}
/**
 * Key encoder options
 */
export declare enum KeyEncoderOption {
    CURSOR_KEY_APPLICATION = 0,// DEC mode 1
    KEYPAD_KEY_APPLICATION = 1,// DEC mode 66
    IGNORE_KEYPAD_WITH_NUMLOCK = 2,// DEC mode 1035
    ALT_ESC_PREFIX = 3,// DEC mode 1036
    MODIFY_OTHER_KEYS_STATE_2 = 4,// xterm modifyOtherKeys
    KITTY_KEYBOARD_FLAGS = 5
}
/**
 * Key action
 */
export declare enum KeyAction {
    RELEASE = 0,
    PRESS = 1,
    REPEAT = 2
}
/**
 * Physical key codes matching Ghostty's internal Key enum.
 * These values are used by Ghostty's key encoder to produce correct escape sequences.
 * Reference: ghostty/src/input/key.zig
 */
export declare enum Key {
    UNIDENTIFIED = 0,
    GRAVE = 1,// ` and ~
    BACKSLASH = 2,// \ and |
    BRACKET_LEFT = 3,// [ and {
    BRACKET_RIGHT = 4,// ] and }
    COMMA = 5,// , and <
    ZERO = 6,
    ONE = 7,
    TWO = 8,
    THREE = 9,
    FOUR = 10,
    FIVE = 11,
    SIX = 12,
    SEVEN = 13,
    EIGHT = 14,
    NINE = 15,
    EQUAL = 16,// = and +
    INTL_BACKSLASH = 17,
    INTL_RO = 18,
    INTL_YEN = 19,
    A = 20,
    B = 21,
    C = 22,
    D = 23,
    E = 24,
    F = 25,
    G = 26,
    H = 27,
    I = 28,
    J = 29,
    K = 30,
    L = 31,
    M = 32,
    N = 33,
    O = 34,
    P = 35,
    Q = 36,
    R = 37,
    S = 38,
    T = 39,
    U = 40,
    V = 41,
    W = 42,
    X = 43,
    Y = 44,
    Z = 45,
    MINUS = 46,// - and _
    PERIOD = 47,// . and >
    QUOTE = 48,// ' and "
    SEMICOLON = 49,// ; and :
    SLASH = 50,// / and ?
    ALT_LEFT = 51,
    ALT_RIGHT = 52,
    BACKSPACE = 53,
    CAPS_LOCK = 54,
    CONTEXT_MENU = 55,
    CONTROL_LEFT = 56,
    CONTROL_RIGHT = 57,
    ENTER = 58,
    META_LEFT = 59,
    META_RIGHT = 60,
    SHIFT_LEFT = 61,
    SHIFT_RIGHT = 62,
    SPACE = 63,
    TAB = 64,
    CONVERT = 65,
    KANA_MODE = 66,
    NON_CONVERT = 67,
    DELETE = 68,
    END = 69,
    HELP = 70,
    HOME = 71,
    INSERT = 72,
    PAGE_DOWN = 73,
    PAGE_UP = 74,
    DOWN = 75,
    LEFT = 76,
    RIGHT = 77,
    UP = 78,
    NUM_LOCK = 79,
    KP_0 = 80,
    KP_1 = 81,
    KP_2 = 82,
    KP_3 = 83,
    KP_4 = 84,
    KP_5 = 85,
    KP_6 = 86,
    KP_7 = 87,
    KP_8 = 88,
    KP_9 = 89,
    KP_PLUS = 90,// Keypad +
    KP_BACKSPACE = 91,
    KP_CLEAR = 92,
    KP_CLEAR_ENTRY = 93,
    KP_COMMA = 94,
    KP_PERIOD = 95,// Keypad .
    KP_DIVIDE = 96,// Keypad /
    KP_ENTER = 97,// Keypad Enter
    KP_EQUAL = 98,
    KP_MEMORY_ADD = 99,
    KP_MEMORY_CLEAR = 100,
    KP_MEMORY_RECALL = 101,
    KP_MEMORY_STORE = 102,
    KP_MEMORY_SUBTRACT = 103,
    KP_MULTIPLY = 104,// Keypad *
    KP_PAREN_LEFT = 105,
    KP_PAREN_RIGHT = 106,
    KP_MINUS = 107,// Keypad -
    KP_SEPARATOR = 108,
    NUMPAD_UP = 109,
    NUMPAD_DOWN = 110,
    NUMPAD_RIGHT = 111,
    NUMPAD_LEFT = 112,
    NUMPAD_BEGIN = 113,
    NUMPAD_HOME = 114,
    NUMPAD_END = 115,
    NUMPAD_INSERT = 116,
    NUMPAD_DELETE = 117,
    NUMPAD_PAGE_UP = 118,
    NUMPAD_PAGE_DOWN = 119,
    ESCAPE = 120,
    F1 = 121,
    F2 = 122,
    F3 = 123,
    F4 = 124,
    F5 = 125,
    F6 = 126,
    F7 = 127,
    F8 = 128,
    F9 = 129,
    F10 = 130,
    F11 = 131,
    F12 = 132,
    F13 = 133,
    F14 = 134,
    F15 = 135,
    F16 = 136,
    F17 = 137,
    F18 = 138,
    F19 = 139,
    F20 = 140,
    F21 = 141,
    F22 = 142,
    F23 = 143,
    F24 = 144,
    F25 = 145,
    FN_LOCK = 146,
    PRINT_SCREEN = 147,
    SCROLL_LOCK = 148,
    PAUSE = 149,
    BROWSER_BACK = 150,
    BROWSER_FAVORITES = 151,
    BROWSER_FORWARD = 152,
    BROWSER_HOME = 153,
    BROWSER_REFRESH = 154,
    BROWSER_SEARCH = 155,
    BROWSER_STOP = 156,
    EJECT = 157,
    LAUNCH_APP_1 = 158,
    LAUNCH_APP_2 = 159,
    LAUNCH_MAIL = 160,
    MEDIA_PLAY_PAUSE = 161,
    MEDIA_SELECT = 162,
    MEDIA_STOP = 163,
    MEDIA_TRACK_NEXT = 164,
    MEDIA_TRACK_PREVIOUS = 165,
    POWER = 166,
    SLEEP = 167,
    AUDIO_VOLUME_DOWN = 168,
    AUDIO_VOLUME_MUTE = 169,
    AUDIO_VOLUME_UP = 170,
    WAKE_UP = 171,
    COPY = 172,
    CUT = 173,
    PASTE = 174
}
/**
 * Modifier keys
 */
export declare enum Mods {
    NONE = 0,
    SHIFT = 1,
    CTRL = 2,
    ALT = 4,
    SUPER = 8,// Windows/Command key
    CAPSLOCK = 16,
    NUMLOCK = 32
}
/**
 * Key event structure
 */
export interface KeyEvent {
    action: KeyAction;
    key: Key;
    mods: Mods;
    consumedMods?: Mods;
    composing?: boolean;
    utf8?: string;
    unshiftedCodepoint?: number;
}
/**
 * Interface for libghostty-vt WASM exports
 */
export interface GhosttyWasmExports extends WebAssembly.Exports {
    ghostty_metadata_version(): number;
    ghostty_metadata_render_cell_size(): number;
    ghostty_metadata_capture(handle: number, screen: number, detail: number, out: number, capacity: number, maxRows: number, maxCells: number, maxStrings: number): number;
    memory: WebAssembly.Memory;
    ghostty_wasm_alloc_opaque(): number;
    ghostty_wasm_free_opaque(ptr: number): void;
    ghostty_wasm_alloc_u8_array(len: number): number;
    ghostty_wasm_free_u8_array(ptr: number, len: number): void;
    ghostty_wasm_alloc_u16_array(len: number): number;
    ghostty_wasm_free_u16_array(ptr: number, len: number): void;
    ghostty_wasm_alloc_u8(): number;
    ghostty_wasm_free_u8(ptr: number): void;
    ghostty_wasm_alloc_usize(): number;
    ghostty_wasm_free_usize(ptr: number): void;
    ghostty_sgr_new(allocator: number, parserPtrPtr: number): number;
    ghostty_sgr_free(parser: number): void;
    ghostty_sgr_reset(parser: number): void;
    ghostty_sgr_set_params(parser: number, paramsPtr: number, subsPtr: number, paramsLen: number): number;
    ghostty_sgr_next(parser: number, attrPtr: number): boolean;
    ghostty_sgr_attribute_tag(attrPtr: number): number;
    ghostty_sgr_attribute_value(attrPtr: number, tagPtr: number): number;
    ghostty_wasm_alloc_sgr_attribute(): number;
    ghostty_wasm_free_sgr_attribute(ptr: number): void;
    ghostty_key_encoder_new(allocator: number, encoderPtrPtr: number): number;
    ghostty_key_encoder_free(encoder: number): void;
    ghostty_key_encoder_setopt(encoder: number, option: number, valuePtr: number): number;
    ghostty_key_encoder_encode(encoder: number, eventPtr: number, bufPtr: number, bufLen: number, writtenPtr: number): number;
    ghostty_key_event_new(allocator: number, eventPtrPtr: number): number;
    ghostty_key_event_free(event: number): void;
    ghostty_key_event_set_action(event: number, action: number): void;
    ghostty_key_event_set_key(event: number, key: number): void;
    ghostty_key_event_set_mods(event: number, mods: number): void;
    ghostty_key_event_set_utf8(event: number, ptr: number, len: number): void;
    ghostty_terminal_new(cols: number, rows: number): TerminalHandle;
    ghostty_terminal_new_with_config(cols: number, rows: number, configPtr: number): TerminalHandle;
    ghostty_terminal_free(terminal: TerminalHandle): void;
    ghostty_terminal_resize(terminal: TerminalHandle, cols: number, rows: number): void;
    ghostty_terminal_write(terminal: TerminalHandle, dataPtr: number, dataLen: number): void;
    ghostty_render_state_update(terminal: TerminalHandle): number;
    ghostty_render_state_get_cols(terminal: TerminalHandle): number;
    ghostty_render_state_get_rows(terminal: TerminalHandle): number;
    ghostty_render_state_get_cursor_x(terminal: TerminalHandle): number;
    ghostty_render_state_get_cursor_y(terminal: TerminalHandle): number;
    ghostty_render_state_get_cursor_visible(terminal: TerminalHandle): boolean;
    ghostty_render_state_get_bg_color(terminal: TerminalHandle): number;
    ghostty_render_state_get_fg_color(terminal: TerminalHandle): number;
    ghostty_render_state_is_row_dirty(terminal: TerminalHandle, row: number): boolean;
    ghostty_render_state_mark_clean(terminal: TerminalHandle): void;
    ghostty_render_state_get_viewport(terminal: TerminalHandle, bufPtr: number, bufLen: number): number;
    ghostty_render_state_get_grapheme(terminal: TerminalHandle, row: number, col: number, bufPtr: number, bufLen: number): number;
    ghostty_terminal_is_alternate_screen(terminal: TerminalHandle): boolean;
    ghostty_terminal_has_mouse_tracking(terminal: TerminalHandle): number;
    ghostty_terminal_get_mode(terminal: TerminalHandle, mode: number, isAnsi: boolean): number;
    ghostty_terminal_get_scrollback_length(terminal: TerminalHandle): number;
    ghostty_terminal_get_scrollback_line(terminal: TerminalHandle, offset: number, bufPtr: number, bufLen: number): number;
    ghostty_terminal_get_scrollback_grapheme(terminal: TerminalHandle, offset: number, col: number, bufPtr: number, bufLen: number): number;
    ghostty_terminal_is_row_wrapped(terminal: TerminalHandle, row: number): number;
    ghostty_terminal_has_response(terminal: TerminalHandle): boolean;
    ghostty_terminal_read_response(terminal: TerminalHandle, bufPtr: number, bufLen: number): number;
}
/**
 * Dirty state from RenderState
 */
export declare enum DirtyState {
    NONE = 0,
    PARTIAL = 1,
    FULL = 2
}
/**
 * Cursor state from RenderState (8 bytes packed)
 * Layout: x(u16) + y(u16) + viewport_x(i16) + viewport_y(i16) + visible(bool) + blinking(bool) + style(u8) + _pad(u8)
 */
export interface RenderStateCursor {
    x: number;
    y: number;
    viewportX: number;
    viewportY: number;
    visible: boolean;
    blinking: boolean;
    style: 'block' | 'underline' | 'bar';
}
/**
 * Colors from RenderState (12 bytes packed)
 */
export interface RenderStateColors {
    background: RGB;
    foreground: RGB;
    cursor: RGB | null;
}
/**
 * Size of cursor struct in WASM (8 bytes)
 */
export declare const CURSOR_STRUCT_SIZE = 8;
/**
 * Size of colors struct in WASM (12 bytes)
 */
export declare const COLORS_STRUCT_SIZE = 12;
/**
 * Terminal configuration (passed to ghostty_terminal_new_with_config)
 * All color values use 0xRRGGBB format. A value of 0 means "use default".
 */
export interface GhosttyTerminalConfig {
    scrollbackLimit?: number;
    fgColor?: number;
    bgColor?: number;
    cursorColor?: number;
    palette?: number[];
}
/**
 * Size of GhosttyTerminalConfig struct in WASM memory (bytes).
 * Layout: scrollback_limit(u32) + fg_color(u32) + bg_color(u32) + cursor_color(u32) + palette[16](u32*16)
 * Total: 4 + 4 + 4 + 4 + 64 = 80 bytes
 */
export declare const GHOSTTY_CONFIG_SIZE = 80;
/**
 * Opaque terminal pointer (WASM memory address)
 */
export type TerminalHandle = number;
/**
 * Cell structure matching ghostty_cell_t in C (16 bytes)
 */
export interface GhosttyCell {
    codepoint: number;
    fg_r: number;
    fg_g: number;
    fg_b: number;
    bg_r: number;
    bg_g: number;
    bg_b: number;
    flags: number;
    width: number;
    hyperlink_id: number;
    grapheme_len: number;
}
/**
 * RGB color
 */
export interface RGB {
    r: number;
    g: number;
    b: number;
}
/**
 * Cell style flags (bitfield)
 */
export declare enum CellFlags {
    BOLD = 1,
    ITALIC = 2,
    UNDERLINE = 4,
    STRIKETHROUGH = 8,
    INVERSE = 16,
    INVISIBLE = 32,
    BLINK = 64,
    FAINT = 128
}
/**
 * Cursor position and visibility
 */
export interface Cursor {
    x: number;
    y: number;
    visible: boolean;
}
/**
 * Terminal configuration (passed to ghostty_terminal_new_with_config)
 */
export interface TerminalConfig {
    scrollback_limit: number;
    fg_color: RGB;
    bg_color: RGB;
}
/**
 * Represents a coordinate in the terminal buffer
 */
export interface IBufferCellPosition {
    x: number;
    y: number;
}
/**
 * Represents a range in the terminal buffer
 * Can span multiple lines for wrapped links
 */
export interface IBufferRange {
    start: IBufferCellPosition;
    end: IBufferCellPosition;
}
/**
 * Represents a detected link in the terminal
 */
export interface ILink {
    /** The URL or text of the link */
    text: string;
    /** The range of the link in the buffer (may span multiple lines) */
    range: IBufferRange;
    /** Called when the link is activated (clicked with modifier) */
    activate(event: MouseEvent): void;
    /** Optional: called when mouse enters/leaves the link */
    hover?(isHovered: boolean): void;
    /** Optional: called to clean up resources */
    dispose?(): void;
}
/**
 * Provides link detection for a specific type of link
 * Examples: OSC 8 hyperlinks, URL regex detection
 */
export interface ILinkProvider {
    /**
     * Provide links for a given row
     * @param y Absolute row in buffer (0-based)
     * @param callback Called with detected links (or undefined if none)
     */
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void;
    /** Optional: called when terminal is disposed */
    dispose?(): void;
}
/**
 * Simplified buffer line interface for link providers
 */
export interface IBufferLine {
    /** Number of cells in this line */
    length: number;
    /** Get cell at position */
    getCell(x: number): IBufferCell;
    /** Get text content of the line */
    translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}
/**
 * Simplified buffer cell interface for link providers
 */
export interface IBufferCell {
    /** Get the character codepoint */
    getCodepoint(): number;
    /** Get the hyperlink ID (0 = no link) */
    getHyperlinkId(): number;
    /** Get the width of the character (1 or 2 for wide chars) */
    getWidth(): number;
    /** Check if cell has specific flags */
    isBold(): boolean;
    isItalic(): boolean;
    isDim(): boolean;
}
/**
 * Simplified terminal buffer interface for link providers
 */
export interface IBuffer {
    /** Number of rows in the buffer (viewport + scrollback) */
    length: number;
    /** Get line at absolute buffer position */
    getLine(y: number): IBufferLine;
}
/**
 * Terminal buffer manager (active vs alternate screen)
 */
export interface IBufferManager {
    /** Currently active buffer */
    active: IBuffer;
    /** Normal screen buffer */
    normal: IBuffer;
    /** Alternate screen buffer (for fullscreen apps) */
    alternate: IBuffer;
}
/**
 * Event system interface (xterm.js compatible)
 */
export type IEvent<T> = (listener: (data: T) => void) => IDisposable;
export interface IDisposable {
    dispose(): void;
}
/**
 * Event emitter for custom events
 */
export declare class EventEmitter<T> {
    private listeners;
    /** Subscribe to events */
    readonly event: IEvent<T>;
    /** Emit an event to all listeners */
    fire(data: T): void;
    /** Remove all listeners */
    dispose(): void;
}
/**
 * Terminal mode identifiers
 *
 * ANSI modes (use with is_ansi = true):
 * - INSERT = 4
 *
 * DEC modes (use with is_ansi = false):
 * - CURSOR_VISIBLE = 25
 * - MOUSE_TRACKING_NORMAL = 1000
 * - MOUSE_TRACKING_BUTTON = 1002
 * - MOUSE_TRACKING_ANY = 1003
 * - FOCUS_EVENTS = 1004
 * - ALT_SCREEN = 1047
 * - ALT_SCREEN_WITH_CURSOR = 1049
 * - BRACKETED_PASTE = 2004
 */
export declare enum TerminalMode {
    INSERT = 4,
    CURSOR_VISIBLE = 25,
    MOUSE_TRACKING_NORMAL = 1000,
    MOUSE_TRACKING_BUTTON = 1002,
    MOUSE_TRACKING_ANY = 1003,
    FOCUS_EVENTS = 1004,
    ALT_SCREEN = 1047,
    ALT_SCREEN_WITH_CURSOR = 1049,
    BRACKETED_PASTE = 2004
}
