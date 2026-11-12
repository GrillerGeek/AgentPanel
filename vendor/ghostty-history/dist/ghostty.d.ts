import { type MetadataLimits, type MetadataSnapshot, type RowMetadata } from "./metadata";
/**
 * TypeScript wrapper for libghostty-vt WASM API
 *
 * High-performance terminal emulation using Ghostty's battle-tested VT100 parser.
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call.
 */
import { CellFlags, type Cursor, DirtyState, type GhosttyCell, type GhosttyTerminalConfig, type GhosttyWasmExports, KeyEncoderOption, type KeyEvent, type KittyKeyFlags, type RGB, type RenderStateColors, type RenderStateCursor } from './types';
export { CellFlags, type Cursor, DirtyState, type GhosttyCell, type GhosttyTerminalConfig, KeyEncoderOption, type RGB, type RenderStateColors, type RenderStateCursor, };
/**
 * Main Ghostty WASM wrapper class
 */
export declare class Ghostty {
    private exports;
    private memory;
    constructor(wasmInstance: WebAssembly.Instance);
    createKeyEncoder(): KeyEncoder;
    createTerminal(cols?: number, rows?: number, config?: GhosttyTerminalConfig): GhosttyTerminal;
    static load(wasmPath?: string): Promise<Ghostty>;
}
/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export declare class KeyEncoder {
    private exports;
    private encoder;
    constructor(exports: GhosttyWasmExports);
    setOption(option: KeyEncoderOption, value: boolean | number): void;
    setKittyFlags(flags: KittyKeyFlags): void;
    encode(event: KeyEvent): Uint8Array;
    dispose(): void;
}
/**
 * GhosttyTerminal - High-performance terminal emulator
 *
 * Uses Ghostty's native RenderState for optimal performance:
 * - ONE call to update all state (renderStateUpdate)
 * - ONE call to get all cells (getViewport)
 * - No per-row WASM boundary crossings!
 */
export declare class GhosttyTerminal {
    private exports;
    private memory;
    private handle;
    private _cols;
    private _rows;
    /** Size of GhosttyCell in WASM (16 bytes) */
    private static readonly CELL_SIZE;
    /** Reusable buffer for viewport operations */
    private viewportBufferPtr;
    private viewportBufferSize;
    /** Cell pool for zero-allocation rendering */
    private cellPool;
    /** Primary by default; read-only even while alternate screen is active. */
    captureSnapshot(options?: MetadataLimits): MetadataSnapshot;
    /** Compact active-row wrap/wide/text-presence metadata, without styles/links. */
    getRowMetadata(options?: MetadataLimits): RowMetadata;
    constructor(exports: GhosttyWasmExports, memory: WebAssembly.Memory, cols?: number, rows?: number, config?: GhosttyTerminalConfig);
    get cols(): number;
    get rows(): number;
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    free(): void;
    /**
     * Update render state from terminal.
     *
     * This syncs the RenderState with the current Terminal state.
     * The dirty state (full/partial/none) is stored in the WASM RenderState
     * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
     * returns true for ALL rows.
     *
     * The WASM layer automatically detects screen switches (normal <-> alternate)
     * and returns FULL dirty state when switching screens (e.g., vim exit).
     *
     * Safe to call multiple times - dirty state persists until markClean().
     */
    update(): DirtyState;
    /**
     * Get cursor state from render state.
     * Ensures render state is fresh by calling update().
     */
    getCursor(): RenderStateCursor;
    /**
     * Get default colors from render state
     */
    getColors(): RenderStateColors;
    /**
     * Check if a specific row is dirty
     */
    isRowDirty(y: number): boolean;
    /**
     * Mark render state as clean (call after rendering)
     */
    markClean(): void;
    /**
     * Get ALL viewport cells in ONE WASM call - the key performance optimization!
     * Returns a reusable cell array (zero allocation after warmup).
     */
    getViewport(): GhosttyCell[];
    /**
     * Get line - for compatibility, extracts from viewport.
     * Ensures render state is fresh by calling update().
     * Returns a COPY of the cells to avoid pool reference issues.
     */
    getLine(y: number): GhosttyCell[] | null;
    /** For compatibility with old API */
    isDirty(): boolean;
    /**
     * Check if a full redraw is needed (screen change, resize, etc.)
     * Note: This calls update() to ensure fresh state. Safe to call multiple times.
     */
    needsFullRedraw(): boolean;
    /** Mark render state as clean after rendering */
    clearDirty(): void;
    isAlternateScreen(): boolean;
    hasBracketedPaste(): boolean;
    hasFocusEvents(): boolean;
    hasMouseTracking(): boolean;
    /** Get dimensions - for compatibility */
    getDimensions(): {
        cols: number;
        rows: number;
    };
    /** Get number of scrollback lines (history, not including active screen) */
    getScrollbackLength(): number;
    /**
     * Get a line from the scrollback buffer.
     * Ensures render state is fresh by calling update().
     * @param offset 0 = oldest line, (length-1) = most recent scrollback line
     */
    getScrollbackLine(offset: number): GhosttyCell[] | null;
    /** Check if a row in the active screen is wrapped (soft-wrapped to next line) */
    isRowWrapped(row: number): boolean;
    /** Hyperlink URI not yet exposed in simplified API */
    getHyperlinkUri(_id: number): string | null;
    /**
     * Check if there are pending responses from the terminal.
     * Responses are generated by escape sequences like DSR (Device Status Report).
     */
    hasResponse(): boolean;
    /**
     * Read pending responses from the terminal.
     * Returns the response string, or null if no responses pending.
     *
     * Responses are generated by escape sequences that require replies:
     * - DSR 6 (cursor position): Returns \x1b[row;colR
     * - DSR 5 (operating status): Returns \x1b[0n
     */
    readResponse(): string | null;
    /**
     * Query arbitrary terminal mode by number
     * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
     * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
     */
    getMode(mode: number, isAnsi?: boolean): boolean;
    private initCellPool;
    private parseCellsIntoPool;
    /** Small buffer for grapheme lookups (reused to avoid allocation) */
    private graphemeBuffer;
    private graphemeBufferPtr;
    /**
     * Get all codepoints for a grapheme cluster at the given position.
     * For most cells this returns a single codepoint, but for complex scripts
     * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
     * @returns Array of codepoints, or null on error
     */
    getGrapheme(row: number, col: number): number[] | null;
    /**
     * Get a string representation of the grapheme at the given position.
     * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
     */
    getGraphemeString(row: number, col: number): string;
    /**
     * Get all codepoints for a grapheme cluster in the scrollback buffer.
     * @param offset Scrollback line offset (0 = oldest)
     * @param col Column index
     * @returns Array of codepoints, or null on error
     */
    getScrollbackGrapheme(offset: number, col: number): number[] | null;
    /**
     * Get a string representation of a grapheme in the scrollback buffer.
     */
    getScrollbackGraphemeString(offset: number, col: number): string;
    private invalidateBuffers;
}
