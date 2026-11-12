/** No terminal-library objects cross this boundary. False suppresses a key. */
export interface Disposable { dispose(): void }
export type Result<T> = { status: "supported"; value: T } | { status: "unsupported"; reason: string };
export type Capability = "supported" | "limited" | "unsupported";
export interface RendererCapabilities {
  selection: Capability;
  search: Capability;
  styledHistory: Capability;
  renderingSuspension: Capability;
}
export interface TerminalTheme {
  background?: string; foreground?: string; cursor?: string; cursorAccent?: string;
  selectionBackground?: string; selectionForeground?: string;
  black?: string; red?: string; green?: string; yellow?: string; blue?: string; magenta?: string; cyan?: string; white?: string;
  brightBlack?: string; brightRed?: string; brightGreen?: string; brightYellow?: string; brightBlue?: string;
  brightMagenta?: string; brightCyan?: string; brightWhite?: string;
}
export interface Appearance { fontFamily?: string; fontSize?: number; theme?: TerminalTheme }
export interface RendererOptions extends Appearance { cols?: number; rows?: number; scrollback?: number; cursorBlink?: boolean; webgl?: boolean }
export interface CellPosition { x: number; y: number }
export interface SelectionRange { start: CellPosition; end: CellPosition } // exclusive end
export interface SearchMatch { start: CellPosition; end: CellPosition; wrapped: boolean }
export type SearchResult = { status: "supported"; found: boolean } |
  { status: "limited"; match: SearchMatch | null; reason: string } |
  { status: "unsupported"; reason: string };
export interface TerminalRenderer {
  readonly kind: "xterm" | "ghostty";
  readonly capabilities: RendererCapabilities;
  readonly cols: number;
  readonly rows: number;
  /** Completion means parsed, not necessarily painted. Never acknowledges failed/unparsed data. */
  write(data: string | Uint8Array, consumed?: () => void): void;
  whenIdle(): Promise<void>;
  fit(): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  paste(text: string): void;
  onData(listener: (text: string) => void): Disposable;
  onTitleChange(listener: (title: string) => void): Disposable;
  onError(listener: (error: Error) => void): Disposable;
  setKeyHandler(handler: (event: KeyboardEvent) => boolean): void;
  isMouseTracking(): boolean;
  getSelection(): Result<string>;
  hasSelection(): boolean;
  clearSelection(): void;
  select(range: SelectionRange): Result<void>;
  search(query: string, backwards?: boolean): SearchResult;
  clearSearch(): void;
  serializeStyledHistory(): Result<string>;
  /** Explicit stored-archive replay before transport opens; never interpret raw program writes. */
  restoreStyledHistory(data: string): Promise<Result<void>>;
  /** Diagnostic text only; never a persistence fallback. */
  extractText(): Result<string>;
  setAppearance(appearance: Appearance): void;
  setVisibility(visible: boolean, webgl: boolean): void;
  reset(): void;
  dispose(): void;
}
export const unsupported = (reason: string): { status: "unsupported"; reason: string } => ({ status: "unsupported", reason });
