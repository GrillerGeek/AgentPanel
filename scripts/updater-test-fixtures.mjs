import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));

export function generateUpdaterFixtures(directory) {
  const key = join(directory, "test.key");
  const otherKey = join(directory, "other.key");
  const payload = join(directory, "payload.bin");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^TAURI_(?:SIGNING_|PRIVATE_KEY(?:_|$))/i.test(name)));
  const signer = (...args) => execFileSync(process.execPath, [cli, "signer", ...args], {
    env, stdio: "ignore", timeout: 30_000,
  });
  writeFileSync(payload, "inert AgentPanel updater fixture\n");
  try {
    signer("generate", "--ci", "--write-keys", key, "--password", "");
    signer("generate", "--ci", "--write-keys", otherKey, "--password", "");
    for (const [name, version] of [["bound", "0.7.2"], ["old", "0.7.0"], ["next", "0.7.3"], ["legacy"]]) {
      signer("sign", "--private-key-path", key, "--password", "", ...(version ? ["--app-version", version] : []), payload);
      writeFileSync(join(directory, name + ".sig"), readFileSync(payload + ".sig"));
    }
    const signed = readFileSync(join(directory, "old.sig"), "utf8");
    const forged = Buffer.from(signed, "base64").toString("utf8").replace("version:0.7.0", "version:0.7.2");
    writeFileSync(join(directory, "forged.sig"), Buffer.from(forged).toString("base64"));
  } finally {
    for (const privateKey of [key, otherKey]) {
      try {
        unlinkSync(privateKey);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) generateUpdaterFixtures(process.argv[2]);
