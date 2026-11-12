/**
 * Terminal - Main terminal emulator class
 *
 * Provides an xterm.js-compatible API wrapping Ghostty's WASM terminal emulator.
 *
 * Usage:
 * ```typescript
 * import { init, Terminal } from 'ghostty-web';
 *
 * await init();
 * const term = new Terminal();
 * term.open(document.getElementById('container'));
 * term.write('Hello, World!\n');
 * term.onData(data => console.log('User typed:', data));
 * ```
 */
import type { GhosttyCell, GhosttyTerminal } from './ghostty';
import type { IBufferNamespace, IBufferRange, IEvent, IKeyEvent, ITerminalAddon, ITerminalCore, ITerminalOptions, IUnicodeVersionProvider } from './interfaces';
import { CanvasRenderer } from './renderer';
import type { ILinkProvider } from './types';
export declare class Terminal implements ITerminalCore {
    cols: number;
    rows: number;
    element?: HTMLElement;
    textarea?: HTMLTextAreaElement;
    readonly buffer: IBufferNamespace;
    readonly unicode: IUnicodeVersionProvider;
    readonly options: Required<ITerminalOptions>;
    private ghostty?;
    wasmTerm?: GhosttyTerminal;
    renderer?: CanvasRenderer;
    private inputHandler?;
    private selectionManager?;
    private canvas?;
    private linkDetector?;
    private currentHoveredLink?;
    private mouseMoveThrottleTimeout?;
    private pendingMouseMove?;
    private dataEmitter;
    private resizeEmitter;
    private bellEmitter;
    private selectionChangeEmitter;
    private keyEmitter;
    private titleChangeEmitter;
    private scrollEmitter;
    private renderEmitter;
    private cursorMoveEmitter;
    readonly onData: IEvent<string>;
    readonly onResize: IEvent<{
        cols: number;
        rows: number;
    }>;
    readonly onBell: IEvent<void>;
    readonly onSelectionChange: IEvent<void>;
    readonly onKey: IEvent<IKeyEvent>;
    readonly onTitleChange: IEvent<string>;
    readonly onScroll: IEvent<number>;
    readonly onRender: IEvent<{
        start: number;
        end: number;
    }>;
    readonly onCursorMove: IEvent<void>;
    private isOpen;
    private isDisposed;
    private animationFrameId?;
    private addons;
    private customKeyEventHandler?;
    private currentTitle;
    viewportY: number;
    private targetViewportY;
    private scrollAnimationStartTime?;
    private scrollAnimationStartY?;
    private scrollAnimationFrame?;
    private customWheelEventHandler?;
    private lastCursorY;
    private isDraggingScrollbar;
    private scrollbarDragStart;
    private scrollbarDragStartViewportY;
    private scrollbarVisible;
    private scrollbarOpacity;
    private scrollbarHideTimeout?;
    private readonly SCROLLBAR_HIDE_DELAY_MS;
    private readonly SCROLLBAR_FADE_DURATION_MS;
    constructor(options?: ITerminalOptions);
    /**
     * Handle runtime option changes (called when options are modified after terminal is open)
     * This enables xterm.js compatibility where options can be changed at runtime
     */
    private handleOptionChange;
    /**
     * Handle font changes (fontSize or fontFamily)
     * Updates canvas size to match new font metrics and forces a full re-render
     */
    private handleFontChange;
    /**
     * Parse a CSS color string to 0xRRGGBB format.
     * Returns 0 if the color is undefined or invalid.
     */
    private parseColorToHex;
    /**
     * Convert terminal options to WASM terminal config.
     */
    private buildWasmConfig;
    /**
     * Open terminal in a parent element
     *
     * Initializes all components and starts rendering.
     * Requires a pre-loaded Ghostty instance passed to the constructor.
     */
    open(parent: HTMLElement): void;
    /**
     * Write data to terminal
     */
    write(data: string | Uint8Array, callback?: () => void): void;
    /**
     * Internal write implementation (extracted from write())
     */
    private writeInternal;
    /**
     * Write data with newline
     */
    writeln(data: string | Uint8Array, callback?: () => void): void;
    /**
     * Paste text into terminal (triggers bracketed paste if supported)
     */
    paste(data: string): void;
    /**
     * Input data into terminal (as if typed by user)
     *
     * @param data - Data to input
     * @param wasUserInput - If true, triggers onData event (default: false for compat with some apps)
     */
    input(data: string, wasUserInput?: boolean): void;
    /**
     * Resize terminal
     */
    resize(cols: number, rows: number): void;
    /**
     * Clear terminal screen
     */
    clear(): void;
    /**
     * Reset terminal state
     */
    reset(): void;
    /**
     * Focus terminal input
     */
    focus(): void;
    /**
     * Blur terminal (remove focus)
     */
    blur(): void;
    /**
     * Load an addon
     */
    loadAddon(addon: ITerminalAddon): void;
    /**
     * Get the selected text as a string
     */
    getSelection(): string;
    /**
     * Check if there's an active selection
     */
    hasSelection(): boolean;
    /**
     * Clear the current selection
     */
    clearSelection(): void;
    /**
     * Select all text in the terminal
     */
    selectAll(): void;
    /**
     * Select text at specific column and row with length
     */
    select(column: number, row: number, length: number): void;
    /**
     * Select entire lines from start to end
     */
    selectLines(start: number, end: number): void;
    /**
     * Get selection position as buffer range
     */
    /**
     * Get the current viewport Y position.
     *
     * This is the number of lines scrolled back from the bottom of the
     * scrollback buffer. It may be fractional during smooth scrolling.
     */
    getViewportY(): number;
    getSelectionPosition(): IBufferRange | undefined;
    /**
     * Attach a custom keyboard event handler
     * Returns true to prevent default handling
     */
    attachCustomKeyEventHandler(customKeyEventHandler: (event: KeyboardEvent) => boolean): void;
    /**
     * Attach a custom wheel event handler (Phase 2)
     * Returns true to prevent default handling
     */
    attachCustomWheelEventHandler(customWheelEventHandler?: (event: WheelEvent) => boolean): void;
    /**
     * Register a custom link provider
     * Multiple providers can be registered to detect different types of links
     *
     * @example
     * ```typescript
     * term.registerLinkProvider({
     *   provideLinks(y, callback) {
     *     // Detect URLs, file paths, etc.
     *     callback(detectedLinks);
     *   }
     * });
     * ```
     */
    registerLinkProvider(provider: ILinkProvider): void;
    /**
     * Scroll viewport by a number of lines
     * @param amount Number of lines to scroll (positive = down, negative = up)
     */
    scrollLines(amount: number): void;
    /**
     * Scroll viewport by a number of pages
     * @param amount Number of pages to scroll (positive = down, negative = up)
     */
    scrollPages(amount: number): void;
    /**
     * Scroll viewport to the top of the scrollback buffer
     */
    scrollToTop(): void;
    /**
     * Scroll viewport to the bottom (current output)
     */
    scrollToBottom(): void;
    /**
     * Scroll viewport to a specific line in the buffer
     * @param line Line number (0 = top of scrollback, scrollbackLength = bottom)
     */
    scrollToLine(line: number): void;
    /**
     * Smoothly scroll to a target viewport position
     * @param targetY Target viewport Y position (in lines, can be fractional)
     */
    private smoothScrollTo;
    /**
     * Animation loop for smooth scrolling
     * Uses asymptotic approach - moves a fraction of remaining distance each frame
     */
    private animateScroll;
    /**
     * Dispose terminal and clean up resources
     */
    dispose(): void;
    /**
     * Start the render loop
     */
    private startRenderLoop;
    /**
     * Get a line from native WASM scrollback buffer
     * Implements IScrollbackProvider
     */
    getScrollbackLine(offset: number): GhosttyCell[] | null;
    /**
     * Get scrollback length from native WASM
     * Implements IScrollbackProvider
     */
    getScrollbackLength(): number;
    /**
     * Clean up components (called on dispose or error)
     */
    private cleanupComponents;
    /**
     * Assert terminal is open (throw if not)
     */
    private assertOpen;
    /**
     * Handle mouse move for link hover detection and scrollbar dragging
     * Throttled to avoid blocking scroll events (except when dragging scrollbar)
     */
    private handleMouseMove;
    /**
     * Process mouse move for link detection (internal, called by throttled handler)
     */
    private processMouseMove;
    /**
     * Handle mouse leave to clear link hover
     */
    private handleMouseLeave;
    /**
     * Handle mouse click for link activation
     */
    private handleClick;
    /**
     * Handle wheel events for scrolling (Phase 2)
     */
    private handleWheel;
    /**
     * Handle mouse down for scrollbar interaction
     */
    private handleMouseDown;
    /**
     * Handle mouse up for scrollbar drag
     */
    private handleMouseUp;
    /**
     * Process scrollbar drag movement
     */
    private processScrollbarDrag;
    /**
     * Show scrollbar with fade-in and schedule auto-hide
     */
    private showScrollbar;
    /**
     * Hide scrollbar with fade-out
     */
    private hideScrollbar;
    /**
     * Fade in scrollbar
     */
    private fadeInScrollbar;
    /**
     * Fade out scrollbar
     */
    private fadeOutScrollbar;
    /**
     * Process any pending terminal responses and emit them via onData.
     *
     * This handles escape sequences that require the terminal to send a response
     * back to the PTY, such as:
     * - DSR 6 (cursor position): Shell sends \x1b[6n, terminal responds with \x1b[row;colR
     * - DSR 5 (operating status): Shell sends \x1b[5n, terminal responds with \x1b[0n
     *
     * Without this, shells like nushell that rely on cursor position queries
     * will hang waiting for a response that never comes.
     */
    private processTerminalResponses;
    /**
     * Check for title changes in written data (OSC sequences)
     * Simplified implementation - looks for OSC 0, 1, 2
     */
    private checkForTitleChange;
    /**
     * Query terminal mode state
     *
     * @param mode Mode number (e.g., 2004 for bracketed paste)
     * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
     * @returns true if mode is enabled
     */
    getMode(mode: number, isAnsi?: boolean): boolean;
    /**
     * Check if bracketed paste mode is enabled
     */
    hasBracketedPaste(): boolean;
    /**
     * Check if focus event reporting is enabled
     */
    hasFocusEvents(): boolean;
    /**
     * Check if mouse tracking is enabled
     */
    hasMouseTracking(): boolean;
}
