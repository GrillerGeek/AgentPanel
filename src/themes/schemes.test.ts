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
