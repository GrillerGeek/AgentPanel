import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredPlatforms = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"];

export function verifyUpdaterManifest(manifest, version, assets, verify) {
  if (manifest.version !== version || !manifest.platforms) {
    throw new Error("Updater manifest version must match the release tag");
  }
  for (const key of requiredPlatforms) {
    if (!Object.hasOwn(manifest.platforms, key)) throw new Error(`Missing updater platform: ${key}`);
  }
  const verified = new Map();
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (typeof entry?.url !== "string" || !entry.url || typeof entry.signature !== "string" || !entry.signature) {
      throw new Error(`Invalid updater artifact or signature for ${platform}`);
    }
    const matching = assets.filter(asset => entry.url === asset.url || entry.url === asset.browser_download_url);
    if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id)) {
      throw new Error(`Invalid updater artifact or signature for ${platform}`);
    }
    const asset = matching[0];
    if (verified.has(asset.id)) {
      if (verified.get(asset.id) !== entry.signature) throw new Error(`Conflicting signatures for ${platform}`);
    } else {
      verify(asset.id, entry.signature);
      verified.set(asset.id, entry.signature);
    }
    console.log(`Verified updater artifact for ${platform}`);
  }
}

export function draftUpdaterAssets(releases, tag) {
  const drafts = releases.filter(release => release.tag_name === tag);
  if (drafts.length !== 1 || !drafts[0].draft) throw new Error("Expected one unpublished draft for the release tag");
  const assets = drafts[0].assets;
  const manifests = assets.filter(asset => asset.name === "latest.json");
  if (manifests.length !== 1 || !Number.isSafeInteger(manifests[0].id)) throw new Error("Expected exactly one latest.json asset");
  return { assets, manifestId: manifests[0].id };
}

function verifyDraft() {
  const repo = process.env.GITHUB_REPOSITORY;
  const tag = process.env.RELEASE_TAG;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^v[\w.+-]+$/.test(tag)) throw new Error("Missing GitHub repository or release tag");
  const pages = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/releases`, "--paginate", "--slurp"], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  }));
  const { assets, manifestId } = draftUpdaterAssets(pages.flat(), tag);
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  if (config.plugins.updater.requireSignedVersion !== true) throw new Error("Updater must require signed versions");

  const work = mkdtempSync(join(tmpdir(), "agentpanel-verify-update-"));
  function download(id, output) {
    const fd = openSync(output, "w");
    try {
      execFileSync("gh", ["api", `repos/${repo}/releases/assets/${id}`, "-H", "Accept: application/octet-stream"], {
        stdio: ["ignore", fd, "inherit"], timeout: 300_000,
      });
    } finally {
      closeSync(fd);
    }
  }
  try {
    const latest = join(work, "latest.json");
    download(manifestId, latest);
    const manifest = JSON.parse(readFileSync(latest, "utf8"));
    const verifier = fileURLToPath(new URL("verify-updater-signature/Cargo.toml", import.meta.url));
    const version = tag.slice(1);
    verifyUpdaterManifest(manifest, version, assets, (id, signature) => {
      const artifact = join(work, "artifact");
      const signaturePath = join(work, "artifact.sig");
      download(id, artifact);
      writeFileSync(signaturePath, signature);
      execFileSync("cargo", ["run", "--quiet", "--locked", "--manifest-path", verifier, "--",
        version, config.plugins.updater.pubkey, signaturePath, artifact], { stdio: "inherit" });
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) verifyDraft();
