/**
 * URL Regex Link Provider
 *
 * Detects plain text URLs using regex pattern matching.
 * Supports common protocols but excludes file paths.
 *
 * This provider runs after OSC8LinkProvider, so explicit hyperlinks
 * take precedence over regex-detected URLs.
 */
import type { ILink, ILinkProvider } from '../types';
/**
 * URL Regex Provider
 *
 * Detects plain text URLs on a single line using regex.
 * Does not support multi-line URLs or file paths.
 *
 * Supported protocols:
 * - https://, http://
 * - mailto:
 * - ftp://, ssh://, git://
 * - tel:, magnet:
 * - gemini://, gopher://, news:
 */
export declare class UrlRegexProvider implements ILinkProvider {
    private terminal;
    /**
     * URL regex pattern
     * Matches common protocols followed by valid URL characters
     * Excludes file paths (no ./ or ../ or bare /)
     */
    private static readonly URL_REGEX;
    /**
     * Characters to strip from end of URLs
     * Common punctuation that's unlikely to be part of the URL
     */
    private static readonly TRAILING_PUNCTUATION;
    constructor(terminal: ITerminalForUrlProvider);
    /**
     * Provide all regex-detected URLs on the given row
     */
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void;
    /**
     * Convert a buffer line to plain text string
     */
    private lineToText;
    dispose(): void;
}
/**
 * Minimal terminal interface required by UrlRegexProvider
 */
export interface ITerminalForUrlProvider {
    buffer: {
        active: {
            getLine(y: number): IBufferLineForUrlProvider | undefined;
        };
    };
}
/**
 * Minimal buffer line interface for URL detection
 */
interface IBufferLineForUrlProvider {
    length: number;
    getCell(x: number): {
        getCodepoint(): number;
    } | undefined;
}
export {};
