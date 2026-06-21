import { describe, it, expect } from "vitest";
import { displayLabels } from "./TabBar";

describe("displayLabels", () => {
  const branch = "feature/login";

  it("shows 'Terminal' for a single default tab (branch stripped)", () => {
    expect(displayLabels([branch], branch)).toEqual(["Terminal"]);
  });

  it("numbers several default terminals", () => {
    expect(displayLabels([branch, branch, branch], branch)).toEqual([
      "Terminal 1",
      "Terminal 2",
      "Terminal 3",
    ]);
  });

  it("strips the branch prefix from agent tabs and numbers duplicates", () => {
    const titles = [`${branch} · claude`, `${branch} · claude`, `${branch} · codex`];
    expect(displayLabels(titles, branch)).toEqual(["claude 1", "claude 2", "codex"]);
  });

  it("leaves custom names untouched (no numbering)", () => {
    const titles = [branch, "Server", "Server"];
    // The default 'Terminal' is unique so it isn't numbered; custom names are kept verbatim.
    expect(displayLabels(titles, branch)).toEqual(["Terminal", "Server", "Server"]);
  });

  it("falls back to raw titles without a branch", () => {
    expect(displayLabels(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
});
