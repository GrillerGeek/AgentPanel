/**
 * OSC 8 Hyperlink Provider
 *
 * Detects hyperlinks created with OSC 8 escape sequences.
 * Supports multi-line links that wrap across lines.
 *
 * OSC 8 format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
 *
 * The Ghostty WASM automatically assigns hyperlink_id to cells,
 * so we just need to scan for contiguous regions with the same ID.
 */
import type { ILink, ILinkProvider } from '../types';
/**
 * OSC 8 Hyperlink Provider
 *
 * Detects OSC 8 hyperlinks by scanning for hyperlink_id in cells.
 * Automatically handles multi-line links since Ghostty WASM preserves
 * hyperlink_id across wrapped lines.
 */
export declare class OSC8LinkProvider implements ILinkProvider {
    private terminal;
    constructor(terminal: ITerminalForOSC8Provider);
    /**
     * Provide all OSC 8 links on the given row
     * Note: This may return links that span multiple rows
     */
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void;
    /**
     * Find the full extent of a link by scanning for contiguous cells
     * with the same hyperlink_id. Handles multi-line links.
     */
    private findLinkRange;
    dispose(): void;
}
/**
 * Minimal terminal interface required by OSC8LinkProvider
 */
export interface ITerminalForOSC8Provider {
    buffer: {
        active: {
            length: number;
            getLine(y: number): {
                length: number;
                getCell(x: number): {
                    getHyperlinkId(): number;
                } | undefined;
            } | undefined;
        };
    };
    wasmTerm?: {
        getHyperlinkUri(id: number): string | null;
    };
}
