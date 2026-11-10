import { readFileSync } from "node:fs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const manifest = read("../package.json");
const installed = read("../node_modules/@tauri-apps/cli/package.json");
const config = read("../src-tauri/tauri.conf.json");
const [, minor, patch] = installed.version.split(".").map(Number);
if (installed.version !== manifest.devDependencies["@tauri-apps/cli"] ||
    !/^2\.\d+\.\d+$/.test(installed.version) || minor < 11 || (minor === 11 && patch < 5)) {
  throw new Error("Expected an exact Tauri CLI pin with updater version signing support");
}
if (config.plugins.updater.requireSignedVersion !== true) throw new Error("Updater must require signed versions");
