/**
 * Public API for @cmux/ghostty-terminal
 *
 * Main entry point following xterm.js conventions
 */
import { Ghostty } from './ghostty';
/**
 * Initialize the ghostty-web library by loading the WASM module.
 * Must be called before creating any Terminal instances.
 *
 * This creates a shared WASM instance that all Terminal instances will use.
 * For test isolation, pass a Ghostty instance directly to Terminal constructor.
 *
 * @example
 * ```typescript
 * import { init, Terminal } from 'ghostty-web';
 *
 * await init();
 * const term = new Terminal();
 * term.open(document.getElementById('terminal'));
 * ```
 */
export declare function init(): Promise<void>;
/**
 * Get the initialized Ghostty instance.
 * Throws if init() hasn't been called.
 * @internal
 */
export declare function getGhostty(): Ghostty;
export { Terminal } from './terminal';
export type { ITerminalOptions, ITheme, ITerminalAddon, ITerminalCore, IDisposable, IEvent, IBufferRange, IKeyEvent, IUnicodeVersionProvider, } from './interfaces';
export { Ghostty, GhosttyTerminal, KeyEncoder, CellFlags, KeyEncoderOption } from './ghostty';
export type { KeyEvent, KeyAction, Key, Mods, GhosttyCell, RGB, Cursor, TerminalHandle, } from './types';
export { CanvasRenderer } from './renderer';
export type { RendererOptions, FontMetrics, IRenderable } from './renderer';
export { InputHandler } from './input-handler';
export { EventEmitter } from './event-emitter';
export { SelectionManager } from './selection-manager';
export type { SelectionCoordinates } from './selection-manager';
export { FitAddon } from './addons/fit';
export type { ITerminalDimensions } from './addons/fit';
export { OSC8LinkProvider } from './providers/osc8-link-provider';
export { UrlRegexProvider } from './providers/url-regex-provider';
export { LinkDetector } from './link-detector';
export type { ILink, ILinkProvider, IBufferCellPosition } from './types';
export { METADATA_ABI, assertMetadataAbi } from "./metadata";
export type { MetadataCell, MetadataRow, MetadataSnapshot, RowMetadata, SnapshotRow, MetadataLimits } from "./metadata";
