#!/usr/bin/env node
// Wired as tauri.conf.json's `build.beforeBundleCommand`: runs after the
// frontend + Rust build, right before Tauri packages `dist/` into the
// installer. Source maps must reach Sentry (uploaded separately by CI, see
// .github/workflows/release.yml) but must never ship inside the app --
// this is the one point in `tauri build` guaranteed to run after Vite
// (re-)emits them and before bundling embeds `dist/`, regardless of how many
// times the frontend gets rebuilt earlier in the process.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist", import.meta.url).pathname;

function removeMapsRecursive(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // Only a missing dist/ (e.g. the frontend build step never ran) is
    // expected and safe to skip. Anything else (permissions, I/O errors) must
    // fail the build loudly rather than silently ship source maps -- a
    // swallowed error here defeats the whole ship-no-maps guarantee.
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      removeMapsRecursive(full);
    } else if (entry.endsWith(".map")) {
      rmSync(full, { force: true });
    }
  }
}

removeMapsRecursive(distDir);
