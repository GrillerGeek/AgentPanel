/**
 * Buffer API - xterm.js-compatible buffer access
 *
 * Provides read-only access to terminal buffer contents, cursor state,
 * and viewport position. Wraps Ghostty WASM terminal state.
 *
 * Usage:
 * ```typescript
 * const cell = term.buffer.active.getLine(0)?.getCell(5);
 * console.log(cell?.getChars(), cell?.isBold());
 *
 * if (term.buffer.active.type === 'alternate') {
 *   console.log('Full-screen app running');
 * }
 * ```
 */
import type { IBuffer, IBufferCell, IBufferLine, IBufferNamespace, IEvent } from './interfaces';
import type { Terminal } from './terminal';
import type { GhosttyCell } from './types';
/**
 * Top-level buffer API namespace
 * Provides access to active, normal, and alternate screen buffers
 */
export declare class BufferNamespace implements IBufferNamespace {
    private terminal;
    private bufferChangeEmitter;
    private _normalBuffer?;
    private _alternateBuffer?;
    constructor(terminal: Terminal);
    get active(): IBuffer;
    get normal(): IBuffer;
    get alternate(): IBuffer;
    get onBufferChange(): IEvent<IBuffer>;
    /**
     * Internal: Fire buffer change event when screen switches
     * Should be called by Terminal when detecting screen change
     */
    _fireBufferChange(buffer: IBuffer): void;
}
/**
 * A terminal buffer (normal or alternate screen)
 */
export declare class Buffer implements IBuffer {
    private terminal;
    private bufferType;
    private nullCell;
    constructor(terminal: Terminal, type: 'normal' | 'alternate');
    get type(): 'normal' | 'alternate';
    get cursorX(): number;
    get cursorY(): number;
    get viewportY(): number;
    get baseY(): number;
    get length(): number;
    getLine(y: number): IBufferLine | undefined;
    getNullCell(): IBufferCell;
    private getWasmTerm;
}
/**
 * A single line in the buffer
 */
export declare class BufferLine implements IBufferLine {
    private cells;
    private _isWrapped;
    private _length;
    constructor(cells: GhosttyCell[], isWrapped: boolean, length: number);
    get length(): number;
    get isWrapped(): boolean;
    getCell(x: number): IBufferCell | undefined;
    translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}
/**
 * A single cell in the buffer
 */
export declare class BufferCell implements IBufferCell {
    private cell;
    private x;
    constructor(cell: GhosttyCell, x: number);
    getChars(): string;
    getCode(): number;
    getWidth(): number;
    getFgColorMode(): number;
    getBgColorMode(): number;
    getFgColor(): number;
    getBgColor(): number;
    isBold(): number;
    isItalic(): number;
    isUnderline(): number;
    isStrikethrough(): number;
    isBlink(): number;
    isInverse(): number;
    isInvisible(): number;
    isFaint(): number;
    /**
     * Get hyperlink ID for this cell (0 = no link)
     * Used by link detection system
     */
    getHyperlinkId(): number;
    /**
     * Get the Unicode codepoint for this cell
     * Used by link detection system
     */
    getCodepoint(): number;
    /**
     * Check if cell has dim/faint attribute
     * Added for IBufferCell compatibility
     */
    isDim(): boolean;
}
