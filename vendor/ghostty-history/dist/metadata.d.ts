/** AgentPanel experimental metadata ABI v1. Independent of the 16-byte render ABI. */
export declare const METADATA_ABI = 1;
export type ColorTag = 0 | 1 | 2;
export type Wide = 0 | 1 | 2 | 3;
export type MetadataCell = [
    text: string,
    wide: Wide,
    textPresent: 0 | 1,
    fgTag: ColorTag,
    fg: number,
    bgTag: ColorTag,
    bg: number,
    underlineTag: ColorTag,
    underline: number,
    flags: number,
    underlineVariant: number,
    uri: string | null,
    explicitId: string | null
];
export type MetadataRow = [wrap: 0 | 1, continuation: 0 | 1, wide: string, present: string];
export type SnapshotRow = [wrap: 0 | 1, continuation: 0 | 1, cells: MetadataCell[]];
export interface MetadataHeader {
    abi: 1;
    screen: 0 | 1;
    active: 0 | 1;
    cols: number;
    height: number;
    history: number;
    cursor: [number, number, number];
    activeCursor: [number, number, number];
}
export interface RowMetadata extends MetadataHeader {
    rows: MetadataRow[];
}
export interface MetadataSnapshot extends MetadataHeader {
    colors: {
        foreground: number;
        background: number;
        cursor: number;
        palette: number[];
    };
    rows: SnapshotRow[];
}
export interface MetadataLimits {
    screen?: "active" | "primary";
    maxBytes?: number;
    maxRows?: number;
    maxCells?: number;
    maxStringBytes?: number;
}
export interface MetadataExports {
    memory: WebAssembly.Memory;
    ghostty_metadata_version(): number;
    ghostty_metadata_render_cell_size(): number;
    ghostty_metadata_capture(handle: number, screen: number, detail: number, out: number, capacity: number, maxRows: number, maxCells: number, maxStrings: number): number;
    ghostty_wasm_alloc_u8_array(length: number): number;
    ghostty_wasm_free_u8_array(ptr: number, length: number): void;
}
export declare function assertMetadataAbi(exports: MetadataExports): void;
export declare function captureMetadata(exports: MetadataExports, handle: number, styled: boolean, options?: MetadataLimits): MetadataSnapshot | RowMetadata;
