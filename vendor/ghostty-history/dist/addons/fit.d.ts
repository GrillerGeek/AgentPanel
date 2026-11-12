/**
 * FitAddon - Auto-resize terminal to fit container
 *
 * Provides automatic terminal resizing to fit its container element.
 * Compatible with xterm.js FitAddon API.
 *
 * Usage:
 * ```typescript
 * const fitAddon = new FitAddon();
 * term.loadAddon(fitAddon);
 * fitAddon.fit();              // Manual fit
 * fitAddon.observeResize();    // Auto-fit on resize
 * ```
 */
import type { ITerminalAddon, ITerminalCore } from '../interfaces';
export interface ITerminalDimensions {
    cols: number;
    rows: number;
}
export declare class FitAddon implements ITerminalAddon {
    private _terminal?;
    private _resizeObserver?;
    private _resizeDebounceTimer?;
    private _lastCols?;
    private _lastRows?;
    private _isResizing;
    /**
     * Activate the addon (called by Terminal.loadAddon)
     */
    activate(terminal: ITerminalCore): void;
    /**
     * Dispose the addon and clean up resources
     */
    dispose(): void;
    /**
     * Fit the terminal to its container
     *
     * Calculates optimal dimensions and resizes the terminal.
     * Does nothing if dimensions cannot be calculated or haven't changed.
     */
    fit(): void;
    /**
     * Propose dimensions to fit the terminal to its container
     *
     * Calculates cols and rows based on:
     * - Terminal container element dimensions (clientWidth/Height)
     * - Terminal element padding
     * - Font metrics (character cell size)
     * - Scrollbar width reservation
     *
     * @returns Proposed dimensions or undefined if cannot calculate
     */
    proposeDimensions(): ITerminalDimensions | undefined;
    /**
     * Observe the terminal's container for resize events
     *
     * Sets up a ResizeObserver to automatically call fit() when the
     * container size changes. Resize events are debounced to avoid
     * excessive calls during window drag operations.
     *
     * Call dispose() to stop observing.
     */
    observeResize(): void;
}
