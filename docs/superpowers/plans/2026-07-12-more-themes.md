# Support More Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 curated base16 color themes (issue #11) to AgentPanel.

**Architecture:** The theme system is data-driven: `src/themes/schemes.ts` holds an array of base16 `Scheme` palettes; `apply.ts` turns a palette into CSS vars + xterm theme; `SettingsModal` renders the list into a grouped `<select>`. Adding themes = appending palette entries to that array — no logic or UI changes.

**Tech Stack:** TypeScript, Vitest, React (unchanged).

## Global Constraints

- **Data-only change** — modify `src/themes/schemes.ts` and add one test file. Do **not** touch `apply.ts` or `SettingsModal.tsx`.
- **Each `Scheme`** is `{ slug, name, variant, base }` where `base` is exactly 16 `#rrggbb` strings (`base00..base0F`), lowercase, matching the existing entries' format.
- **Palettes are the exact tinted-theming values** given verbatim below — do not alter or "improve" any hex value.
- **9 themes, exact slugs/names/variants:** `material`/Material/dark, `github-dark`/GitHub Dark/dark, `ayu-dark`/Ayu Dark/dark, `ayu-mirage`/Ayu Mirage/dark, `material-palenight`/Material Palenight/dark, `kanagawa`/Kanagawa/dark, `github-light`/GitHub Light/light, `one-light`/One Light/light, `gruvbox-light`/Gruvbox Light/light.
- **Test command:** `npm test` (= `vitest run`). This is pure data — the test file needs **no** `// @vitest-environment jsdom` (default node env; `apply.ts` has no top-level DOM access).

---

### Task 1: Add the 9 palettes and a SCHEMES validation test

**Files:**
- Modify: `src/themes/schemes.ts` (append 9 entries before the closing `];` at schemes.ts:88)
- Test: `src/themes/schemes.test.ts` (create)

**Interfaces:**
- Consumes: `SCHEMES` (array of `Scheme`) from `./schemes`; `DEFAULT_THEME` and `schemeBySlug` from `./apply`.
- Produces: 9 new `Scheme` entries; `SCHEMES.length` becomes 21.

- [ ] **Step 1: Write the failing test**

Create `src/themes/schemes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SCHEMES } from "./schemes";
import { DEFAULT_THEME, schemeBySlug } from "./apply";

const HEX = /^#[0-9a-f]{6}$/;

const ADDED = [
  "material",
  "github-dark",
  "ayu-dark",
  "ayu-mirage",
  "material-palenight",
  "kanagawa",
  "github-light",
  "one-light",
  "gruvbox-light",
];

describe("SCHEMES palette data", () => {
  it("every scheme has exactly 16 valid lowercase hex colors", () => {
    for (const s of SCHEMES) {
      expect(s.base, `${s.slug} length`).toHaveLength(16);
      for (const c of s.base) expect(c, `${s.slug} color ${c}`).toMatch(HEX);
    }
  });

  it("every scheme slug is unique", () => {
    const slugs = SCHEMES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every scheme variant is dark or light", () => {
    for (const s of SCHEMES) expect(["dark", "light"]).toContain(s.variant);
  });

  it("DEFAULT_THEME resolves to a real scheme", () => {
    expect(schemeBySlug(DEFAULT_THEME).slug).toBe(DEFAULT_THEME);
  });

  it("includes the 9 added themes for a total of 21", () => {
    const slugs = new Set(SCHEMES.map((s) => s.slug));
    for (const slug of ADDED) expect(slugs.has(slug), `missing ${slug}`).toBe(true);
    expect(SCHEMES).toHaveLength(21);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schemes`
Expected: FAIL — the "includes the 9 added themes for a total of 21" test fails (`SCHEMES` has 12, the ADDED slugs are missing). The other four tests pass (the existing 12 are already well-formed).

- [ ] **Step 3: Add the 9 palettes**

In `src/themes/schemes.ts`, insert these 9 entries immediately after the `catppuccin-latte` entry (which ends at schemes.ts:87) and before the closing `];` (schemes.ts:88). Keep the exact same object format as the existing entries:

```ts
  {
    slug: "material",
    name: "Material",
    variant: "dark",
    base: ["#263238","#2e3c43","#314549","#546e7a","#b2ccd6","#eeffff","#eeffff","#ffffff","#f07178","#f78c6c","#ffcb6b","#c3e88d","#89ddff","#82aaff","#c792ea","#ff5370"],
  },
  {
    slug: "github-dark",
    name: "GitHub Dark",
    variant: "dark",
    base: ["#0d1117","#161b22","#484f58","#6e7681","#8b949e","#c9d1d9","#f0f6fc","#ffffff","#ffa657","#79c0ff","#bb8009","#a5d6ff","#7ee787","#d2a8ff","#ff7b72","#ffa198"],
  },
  {
    slug: "ayu-dark",
    name: "Ayu Dark",
    variant: "dark",
    base: ["#0b0e14","#131721","#202229","#3e4b59","#bfbdb6","#e6e1cf","#ece8db","#f2f0e7","#f07178","#ff8f40","#ffb454","#aad94c","#95e6cb","#59c2ff","#d2a6ff","#e6b450"],
  },
  {
    slug: "ayu-mirage",
    name: "Ayu Mirage",
    variant: "dark",
    base: ["#1f2430","#242936","#323844","#4a5059","#707a8c","#cccac2","#d9d7ce","#f3f4f5","#f28779","#ffad66","#ffd173","#d5ff80","#95e6cb","#73d0ff","#d4bfff","#f27983"],
  },
  {
    slug: "material-palenight",
    name: "Material Palenight",
    variant: "dark",
    base: ["#292d3e","#444267","#32374d","#676e95","#8796b0","#959dcb","#959dcb","#ffffff","#f07178","#f78c6c","#ffcb6b","#c3e88d","#89ddff","#82aaff","#c792ea","#ff5370"],
  },
  {
    slug: "kanagawa",
    name: "Kanagawa",
    variant: "dark",
    base: ["#1f1f28","#16161d","#223249","#54546d","#727169","#dcd7ba","#c8c093","#717c7c","#c34043","#ffa066","#c0a36e","#76946a","#6a9589","#7e9cd8","#957fb8","#d27e99"],
  },
  {
    slug: "github-light",
    name: "GitHub Light",
    variant: "light",
    base: ["#ffffff","#f6f8fa","#afb8c1","#8c959f","#6e7781","#424a53","#32383f","#1f2328","#953800","#0550ae","#bf8700","#0a3069","#116329","#8250df","#cf222e","#82071e"],
  },
  {
    slug: "one-light",
    name: "One Light",
    variant: "light",
    base: ["#fafafa","#f0f0f1","#e5e5e6","#a0a1a7","#696c77","#383a42","#202227","#090a0b","#ca1243","#d75f00","#c18401","#50a14f","#0184bc","#4078f2","#a626a4","#986801"],
  },
  {
    slug: "gruvbox-light",
    name: "Gruvbox Light",
    variant: "light",
    base: ["#fbf1c7","#ebdbb2","#d5c4a1","#bdae93","#665c54","#504945","#3c3836","#282828","#9d0006","#af3a03","#b57614","#79740e","#427b58","#076678","#8f3f71","#d65d0e"],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- schemes`
Expected: PASS (5/5 — all schemes well-formed, 21 total, 9 added slugs present).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS (all suites).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/themes/schemes.ts src/themes/schemes.test.ts
git commit -m "Add 9 curated base16 themes (#11)"
```

---

### Task 2: Live verification

**Files:** none (manual render pass — per repo practice, typecheck/unit tests don't prove the palettes render correctly in the app).

**Interfaces:** Consumes the finished theme list end-to-end.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: the window opens without errors. (If port 1420 is busy, a different AgentPanel instance is running — close it first.)

- [ ] **Step 2: Open the theme picker**

Open Settings (⚙ or Ctrl+Shift+P → Settings). The Theme dropdown should list **21** themes grouped into Dark and Light, including the 9 new ones (Material, GitHub Dark, Ayu Dark, Ayu Mirage, Material Palenight, Kanagawa in Dark; GitHub Light, One Light, Gruvbox Light in Light).

- [ ] **Step 3: Verify a new dark theme**

Select **Material**. Expected: the app chrome (sidebar, tab bar, backgrounds) and an open terminal's colors both switch to the Material palette immediately (live preview), with readable contrast.

- [ ] **Step 4: Verify a new light theme**

Select **GitHub Light**. Expected: chrome + terminal switch to a light palette with readable (dark-on-light) text — confirming the light variants render correctly, not just the darks.

- [ ] **Step 5: Confirm persistence**

Close and relaunch the app. Expected: the last-selected theme is still applied (existing `agentpanel.settings` persistence; no new work — just confirming the additions didn't break it).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-more-themes-design.md`):
- Add 9 base16 palettes (6 dark, 3 light), exact slugs/names/variants → Task 1 Step 3. ✓ (Night Owl → Material Palenight substitution reflected in both the spec and the plan's constraints/data.)
- No changes to `apply.ts` / `SettingsModal.tsx` → Global Constraints + Task 1 touches only schemes.ts + test. ✓
- Validation test (16 hex each, unique slugs, valid variant, DEFAULT_THEME resolves) → Task 1 Step 1. ✓
- Live verification of a new dark + new light theme → Task 2. ✓
- Out-of-scope items (bulk import, custom themes, per-option preview, reordering) → not implemented. ✓

**Placeholder scan:** none — every palette value is an explicit hex string; every run step has an exact command + expected result.

**Type/name consistency:** `Scheme` shape (`slug`/`name`/`variant`/`base`) matches the existing file and `apply.ts`. The 9 `ADDED` slugs in the test exactly match the 9 entries' slugs in Step 3. `schemeBySlug`/`DEFAULT_THEME` are imported from `./apply` where they're defined. Total count 21 = existing 12 + added 9.
