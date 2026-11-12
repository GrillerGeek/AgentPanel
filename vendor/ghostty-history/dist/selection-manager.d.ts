/**
 * Selection Manager - Handles text selection in the terminal
 *
 * Features:
 * - Mouse drag selection
 * - Double-click word selection
 * - Text extraction from terminal buffer
 * - Automatic clipboard copy
 * - Visual selection highlighting (integrated into CanvasRenderer cell rendering)
 * - Auto-scroll during drag selection
 */
import type { GhosttyTerminal } from './ghostty';
import type { IEvent } from './interfaces';
import type { CanvasRenderer } from './renderer';
import type { Terminal } from './terminal';
export interface SelectionCoordinates {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
}
export declare class SelectionManager {
    private terminal;
    private renderer;
    private wasmTerm;
    private textarea;
    private selectionStart;
    private selectionEnd;
    private isSelecting;
    private mouseDownTarget;
    private dirtySelectionRows;
    private selectionChangedEmitter;
    private boundMouseUpHandler;
    private boundContextMenuHandler;
    private boundClickHandler;
    private boundDocumentMouseMoveHandler;
    private autoScrollInterval;
    private autoScrollDirection;
    private static readonly AUTO_SCROLL_EDGE_SIZE;
    /**
     * Get current viewport Y position (how many lines scrolled into history)
     */
    private getViewportY;
    /**
     * Convert viewport row to absolute buffer row
     * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
     */
    private viewportRowToAbsolute;
    /**
     * Convert absolute buffer row to viewport row (may be outside visible range)
     */
    private absoluteRowToViewport;
    private static readonly AUTO_SCROLL_SPEED;
    private static readonly AUTO_SCROLL_INTERVAL;
    constructor(terminal: Terminal, renderer: CanvasRenderer, wasmTerm: GhosttyTerminal, textarea: HTMLTextAreaElement);
    /**
     * Get the selected text as a string
     */
    getSelection(): string;
    /**
     * Check if there's an active selection
     */
    hasSelection(): boolean;
    /**
     * Clear the selection
     */
    clearSelection(): void;
    /**
     * Select all text in the terminal
     */
    selectAll(): void;
    /**
     * Select text at specific column and row with length
     * xterm.js compatible API
     */
    select(column: number, row: number, length: number): void;
    /**
     * Select entire lines from start to end
     * xterm.js compatible API
     */
    selectLines(start: number, end: number): void;
    /**
     * Get selection position as buffer range
     * xterm.js compatible API
     */
    getSelectionPosition(): {
        start: {
            x: number;
            y: number;
        };
        end: {
            x: number;
            y: number;
        };
    } | undefined;
    /**
     * Deselect all text
     * xterm.js compatible API
     */
    deselect(): void;
    /**
     * Focus the terminal (make it receive keyboard input)
     */
    focus(): void;
    /**
     * Get current selection coordinates (for rendering)
     */
    getSelectionCoords(): SelectionCoordinates | null;
    /**
     * Get dirty selection rows that need redraw (for clearing old highlight)
     */
    getDirtySelectionRows(): Set<number>;
    /**
     * Clear the dirty selection rows tracking (after redraw)
     */
    clearDirtySelectionRows(): void;
    /**
     * Get selection change event accessor
     */
    get onSelectionChange(): IEvent<void>;
    /**
     * Cleanup resources
     */
    dispose(): void;
    /**
     * Attach mouse event listeners to canvas
     */
    private attachEventListeners;
    /**
     * Mark current selection rows as dirty for redraw
     */
    private markCurrentSelectionDirty;
    /**
     * Update auto-scroll based on mouse Y position within canvas
     */
    private updateAutoScroll;
    /**
     * Start auto-scrolling in the given direction
     */
    private startAutoScroll;
    /**
     * Stop auto-scrolling
     */
    private stopAutoScroll;
    /**
     * Convert pixel coordinates to terminal cell coordinates
     */
    private pixelToCell;
    /**
     * Normalize selection coordinates (handle backward selection)
     * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
     */
    private normalizeSelection;
    /**
     * Get word boundaries at a cell position
     */
    private getWordAtCell;
    /**
     * Copy text to clipboard
     */
    private copyToClipboard;
    /**
     * Request a render update (triggers selection overlay redraw)
     */
    private requestRender;
}
