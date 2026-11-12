/**
 * Canvas Renderer for Terminal Display
 *
 * High-performance canvas-based renderer that draws the terminal using
 * Ghostty's WASM terminal emulator. Features:
 * - Font metrics measurement with DPI scaling
 * - Full color support (256-color palette + RGB)
 * - All text styles (bold, italic, underline, strikethrough, etc.)
 * - Multiple cursor styles (block, underline, bar)
 * - Dirty line optimization for 60 FPS
 */
import type { ITheme } from './interfaces';
import type { SelectionManager } from './selection-manager';
import type { GhosttyCell } from './types';
export interface IRenderable {
    getLine(y: number): GhosttyCell[] | null;
    getCursor(): {
        x: number;
        y: number;
        visible: boolean;
    };
    getDimensions(): {
        cols: number;
        rows: number;
    };
    isRowDirty(y: number): boolean;
    /** Returns true if a full redraw is needed (e.g., screen change) */
    needsFullRedraw?(): boolean;
    clearDirty(): void;
    /**
     * Get the full grapheme string for a cell at (row, col).
     * For cells with grapheme_len > 0, this returns all codepoints combined.
     * For simple cells, returns the single character.
     */
    getGraphemeString?(row: number, col: number): string;
}
export interface IScrollbackProvider {
    getScrollbackLine(offset: number): GhosttyCell[] | null;
    getScrollbackLength(): number;
}
export interface RendererOptions {
    fontSize?: number;
    fontFamily?: string;
    cursorStyle?: 'block' | 'underline' | 'bar';
    cursorBlink?: boolean;
    theme?: ITheme;
    devicePixelRatio?: number;
}
export interface FontMetrics {
    width: number;
    height: number;
    baseline: number;
}
export declare const DEFAULT_THEME: Required<ITheme>;
export declare class CanvasRenderer {
    private canvas;
    private ctx;
    private fontSize;
    private fontFamily;
    private cursorStyle;
    private cursorBlink;
    private theme;
    private devicePixelRatio;
    private metrics;
    private palette;
    private cursorVisible;
    private cursorBlinkInterval?;
    private lastCursorPosition;
    private lastViewportY;
    private currentBuffer;
    private selectionManager?;
    private currentSelectionCoords;
    private hoveredHyperlinkId;
    private previousHoveredHyperlinkId;
    private hoveredLinkRange;
    private previousHoveredLinkRange;
    constructor(canvas: HTMLCanvasElement, options?: RendererOptions);
    private measureFont;
    /**
     * Remeasure font metrics (call after font loads or changes)
     */
    remeasureFont(): void;
    private rgbToCSS;
    /**
     * Resize canvas to fit terminal dimensions
     */
    resize(cols: number, rows: number): void;
    /**
     * Render the terminal buffer to canvas
     */
    render(buffer: IRenderable, forceAll?: boolean, viewportY?: number, scrollbackProvider?: IScrollbackProvider, scrollbarOpacity?: number): void;
    /**
     * Render a single line using two-pass approach:
     * 1. First pass: Draw all cell backgrounds
     * 2. Second pass: Draw all cell text and decorations
     *
     * This two-pass approach is necessary for proper rendering of complex scripts
     * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
     * base character into the previous cell's visual area. If we draw backgrounds
     * and text in a single pass (cell by cell), the background of cell N would
     * cover any left-extending portions of graphemes from cell N-1.
     */
    private renderLine;
    /**
     * Render a cell's background only (Pass 1 of two-pass rendering)
     * Selection highlighting is integrated here to avoid z-order issues with
     * complex glyphs (like Devanagari) that extend outside their cell bounds.
     */
    private renderCellBackground;
    /**
     * Render a cell's text and decorations (Pass 2 of two-pass rendering)
     * Selection foreground color is applied here to match the selection background.
     */
    private renderCellText;
    /**
     * Render cursor
     */
    private renderCursor;
    private startCursorBlink;
    private stopCursorBlink;
    /**
     * Update theme colors
     */
    setTheme(theme: ITheme): void;
    /**
     * Update font size
     */
    setFontSize(size: number): void;
    /**
     * Update font family
     */
    setFontFamily(family: string): void;
    /**
     * Update cursor style
     */
    setCursorStyle(style: 'block' | 'underline' | 'bar'): void;
    /**
     * Enable/disable cursor blinking
     */
    setCursorBlink(enabled: boolean): void;
    /**
     * Get current font metrics
     */
    /**
     * Render scrollbar (Phase 2)
     * Shows scroll position and allows click/drag interaction
     * @param opacity Opacity level (0-1) for fade in/out effect
     */
    private renderScrollbar;
    getMetrics(): FontMetrics;
    /**
     * Get canvas element (needed by SelectionManager)
     */
    getCanvas(): HTMLCanvasElement;
    /**
     * Set selection manager (for rendering selection)
     */
    setSelectionManager(manager: SelectionManager): void;
    /**
     * Check if a cell at (x, y) is within the current selection.
     * Uses cached selection coordinates for performance.
     */
    private isInSelection;
    /**
     * Set the currently hovered hyperlink ID for rendering underlines
     */
    setHoveredHyperlinkId(hyperlinkId: number): void;
    /**
     * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
     * Pass null to clear the hover state
     */
    setHoveredLinkRange(range: {
        startX: number;
        startY: number;
        endX: number;
        endY: number;
    } | null): void;
    /**
     * Get character cell width (for coordinate conversion)
     */
    get charWidth(): number;
    /**
     * Get character cell height (for coordinate conversion)
     */
    get charHeight(): number;
    /**
     * Clear entire canvas
     */
    clear(): void;
    /**
     * Cleanup resources
     */
    dispose(): void;
}
