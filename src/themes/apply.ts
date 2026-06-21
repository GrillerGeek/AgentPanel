import type { ITheme } from "@xterm/xterm";
import { SCHEMES, type Scheme } from "./schemes";

export const DEFAULT_THEME = "tokyo-night";

export function schemeBySlug(slug: string): Scheme {
  return SCHEMES.find((s) => s.slug === slug) ?? SCHEMES[0];
}

/** Map a palette to an xterm ITheme (base16 ANSI mapping; brights reuse the
 *  accents, with base03/base07 for bright black/white). */
export function xtermThemeFor(s: Scheme): ITheme {
  const b = s.base;
  return {
    background: b[0],
    foreground: b[5],
    cursor: b[5],
    cursorAccent: b[0],
    selectionBackground: b[2],
    black: b[1],
    red: b[8],
    green: b[11],
    yellow: b[10],
    blue: b[13],
    magenta: b[14],
    cyan: b[12],
    white: b[5],
    brightBlack: b[3],
    brightRed: b[8],
    brightGreen: b[11],
    brightYellow: b[10],
    brightBlue: b[13],
    brightMagenta: b[14],
    brightCyan: b[12],
    brightWhite: b[7],
  };
}

// CSS variable -> palette index.
const VAR_MAP: ReadonlyArray<readonly [string, number]> = [
  ["--bg", 0],
  ["--bg-alt", 1],
  ["--bg-sidebar", 1],
  ["--bg-tab", 1],
  ["--bg-hover", 2],
  ["--bg-elevated", 2],
  ["--border", 2],
  ["--border-soft", 1],
  ["--fg-dim", 3],
  ["--fg-muted", 4],
  ["--fg", 5],
  ["--fg-strong", 6],
  ["--white", 6],
  ["--accent", 13],
  // A second, distinct accent (base0E — purple/magenta) for repo names, so they
  // read as a different hue from the branch's blue accent.
  ["--accent2", 14],
  ["--selection", 2],
  ["--selection-fg", 6],
  ["--green", 11],
  ["--red", 8],
  ["--yellow", 10],
];

/** Apply a palette to the app chrome by setting CSS variables on :root. */
export function applyTheme(s: Scheme): void {
  const root = document.documentElement;
  for (const [name, idx] of VAR_MAP) root.style.setProperty(name, s.base[idx]);
  root.style.colorScheme = s.variant;
}
