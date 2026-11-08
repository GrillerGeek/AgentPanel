import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generateUpdaterFixtures } from "./updater-test-fixtures.mjs";
import { draftUpdaterAssets, verifyUpdaterManifest } from "./verify-updater-release.mjs";

test("the release gate verifies real CLI signatures and artifact bytes", t => {
  const directory = mkdtempSync(join(tmpdir(), "agentpanel-signature-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  generateUpdaterFixtures(directory);
  const cargoManifest = fileURLToPath(new URL("verify-updater-signature/Cargo.toml", import.meta.url));
  const key = readFileSync(join(directory, "test.key.pub"), "utf8").trim();
  const payload = join(directory, "payload.bin");
  const corrupted = join(directory, "corrupted.bin");
  writeFileSync(corrupted, "changed bytes");
  const verify = (signature, artifact = payload, pubkey = key) => spawnSync("cargo", [
    "run", "--quiet", "--locked", "--manifest-path", cargoManifest, "--",
    "0.7.2", pubkey, join(directory, signature + ".sig"), artifact,
  ], { encoding: "utf8", timeout: 120_000 });
  assert.equal(verify("bound").status, 0);
  for (const name of ["old", "legacy"]) {
    assert.match(verify(name).stderr, /must bind the exact release version/);
  }
  for (const [name, artifact] of [["forged", payload], ["bound", corrupted]]) {
    const result = verify(name, artifact);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Signature/);
  }
  const otherKey = readFileSync(join(directory, "other.key.pub"), "utf8").trim();
  const wrongKey = verify("bound", payload, otherKey);
  assert.equal(wrongKey.status, 1);
  assert.match(wrongKey.stderr, /UnexpectedKeyId/);
});

test("the gate reads the sole latest.json from the matching unpublished draft", () => {
  const manifest = { id: 1, name: "latest.json" };
  const draft = { tag_name: "v0.7.2", draft: true, assets: [manifest] };
  assert.equal(draftUpdaterAssets([draft], "v0.7.2").manifestId, 1);
  assert.throws(() => draftUpdaterAssets([{ ...draft, draft: false }], "v0.7.2"), /unpublished draft/);
  for (const assets of [[], [manifest, { ...manifest, id: 2 }]]) {
    assert.throws(() => draftUpdaterAssets([{ ...draft, assets }], "v0.7.2"), /exactly one latest.json/);
  }
});

test("manifest checks every platform alias and associates assets with the draft", () => {
  const assets = [
    { id: 1, url: "https://api.github.com/assets/1" },
    { id: 2, url: "https://api.github.com/assets/2" },
  ];
  const base = { version: "0.7.2", platforms: Object.fromEntries([
    "darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64",
  ].map(key => [key, { url: assets[0].url, signature: "fixture-signature" }])) };
  base.platforms["linux-x86_64-deb"] = { url: assets[1].url, signature: "fixture-deb-signature" };
  const checks = [];
  verifyUpdaterManifest(base, "0.7.2", assets, (...args) => checks.push(args));
  assert.deepEqual(checks, [[1, "fixture-signature"], [2, "fixture-deb-signature"]]);
  assert.throws(() => verifyUpdaterManifest(base, "0.7.3", assets, () => {}), /version/);
  const withoutWindows = structuredClone(base);
  delete withoutWindows.platforms["windows-x86_64"];
  assert.throws(() => verifyUpdaterManifest(withoutWindows, "0.7.2", assets, () => {}), /Missing updater platform/);
  for (const patch of [{ url: "https://example.test/artifact" }, { signature: "" }]) {
    const manifest = structuredClone(base);
    Object.assign(manifest.platforms["linux-x86_64-deb"], patch);
    assert.throws(() => verifyUpdaterManifest(manifest, "0.7.2", assets, () => {}), /Invalid updater artifact or signature/);
  }
  const conflicting = structuredClone(base);
  conflicting.platforms["darwin-x86_64"].signature = "different";
  assert.throws(() => verifyUpdaterManifest(conflicting, "0.7.2", assets, () => {}), /Conflicting signatures/);
});
