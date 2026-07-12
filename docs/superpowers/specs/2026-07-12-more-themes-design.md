# Support More Themes — Design

**Date:** 2026-07-12
**Issue:** [#11](https://github.com/GrillerGeek/AgentPanel/issues/11) — Support More Themes
**Status:** Approved

## Problem

Users want more built-in color themes (the issue names Material and GitHub).
Today `src/themes/schemes.ts` ships 12 curated base16 palettes.

## Decision summary

- **Approach:** hand-curate a batch of well-known themes as base16 palettes,
  exactly like the existing 13 — no new dependencies, no picker redesign, no
  user-defined-theme editor (both considered and rejected as out of scope /
  YAGNI).
- **Add 10 themes** (6 dark, 4 light), balancing the currently dark-heavy set
  (only 2 light today) and guaranteeing the two the issue named:

  | slug | name | variant |
  |------|------|---------|
  | `material` | Material | dark |
  | `github-dark` | GitHub Dark | dark |
  | `ayu-dark` | Ayu Dark | dark |
  | `ayu-mirage` | Ayu Mirage | dark |
  | `material-palenight` | Material Palenight | dark |
  | `kanagawa` | Kanagawa | dark |
  | `github-light` | GitHub Light | light |
  | `one-light` | One Light | light |
  | `gruvbox-light` | Gruvbox Light | light |
  | `ayu-light` | Ayu Light | light |

  Result: 12 → 22 themes; light options go 2 → 6.

  (Night Owl was originally proposed but has no canonical base16 palette in the
  tinted-theming collection, so Material Palenight — a comparable deep blue
  dark theme with a verified palette — was substituted.)

## Components

### 1. Palette data (`src/themes/schemes.ts`)

- Append 10 `Scheme` entries to the `SCHEMES` array, each `{ slug, name,
  variant, base }` where `base` is `base00..base0F` (length 16, `#rrggbb`).
- Palette values sourced from the well-known tinted-theming / upstream base16
  collection, matching the provenance of the existing entries (see the file's
  header comment). The base16 index meaning is unchanged:
  `00 bg · 01 alt-bg · 02 selection · 03 dim · 04 muted-fg · 05 fg ·
  06 strong-fg · 07 lightest · 08 red · 09 orange · 0A yellow · 0B green ·
  0C cyan · 0D blue · 0E magenta · 0F brown`.

### 2. Application & selection — no changes

- `src/themes/apply.ts` (`schemeBySlug`, `xtermThemeFor`, `applyTheme`) is
  fully data-driven and needs no change.
- `src/components/SettingsModal.tsx` renders `SCHEMES.filter(s => s.variant ===
  "dark" | "light")` into grouped `<option>`s and applies the theme live on
  change; the 10 new entries appear automatically. The picker stays a grouped
  `<select>` (no search/preview redesign).

## Error handling

- `schemeBySlug` already falls back to the default when a slug is unknown
  (`apply.ts:6`), so a persisted theme that no longer exists degrades safely.
  No new error paths are introduced — this change is purely additive data.

## Testing

- **New unit test `src/themes/schemes.test.ts`** validating the whole `SCHEMES`
  array (guards the 10 additions and any future palette):
  - every scheme's `base` has exactly 16 entries;
  - every color matches `/^#[0-9a-fA-F]{6}$/`;
  - all `slug`s are unique;
  - every `variant` is `"dark"` or `"light"`;
  - `DEFAULT_THEME` resolves to a real scheme (`schemeBySlug(DEFAULT_THEME).slug
    === DEFAULT_THEME`).
- **Live verification** (per repo practice — render, don't just typecheck):
  load the app, open Settings, and switch to at least one new dark theme
  (Material) and one new light theme (GitHub Light); confirm both the app
  chrome (CSS vars) and the xterm terminal colors change, and that the picker
  lists all 23 grouped correctly.

## Out of scope

- Bulk-importing the full base16 collection (200+ schemes) and the picker
  redesign that would require.
- User-defined / custom themes (palette editor, validation, storage).
- Live per-option preview swatches in the picker (it already previews the
  selected theme live).
- Reordering / alphabetizing the existing picker entries.
