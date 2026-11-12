#!/usr/bin/env python3
"""Rebuild the pinned experimental distribution from verified archives and source patches.
Only explicit scratch/cache/output paths are written. Dependencies are fetched separately,
then native compilation runs with Docker networking disabled. No global tool installation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

REPO = Path(__file__).resolve().parents[2]
VENDOR = REPO / "vendor/ghostty-history"
MANIFEST = json.loads((VENDOR / "manifest.json").read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(args, cwd=None):
    print("Running: " + " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, check=True)

def verified_archive(kind, cache, supplied=None):
    item = MANIFEST[kind]
    path = supplied or cache / (kind + (".tar.xz" if kind == "compiler" else ".tar.gz"))
    if not path.exists():
        print("Downloading pinned " + kind, flush=True)
        with urllib.request.urlopen(item["url"]) as response, path.open("wb") as output:
            shutil.copyfileobj(response, output)
    if sha(path) != item["sha256"] or path.stat().st_size != item["bytes"]:
        raise RuntimeError("Archive hash/size mismatch: " + str(path))
    return path.resolve()

def unpack(archive, target):
    target.mkdir(parents=True)
    run(["tar", "-xf", archive, "--strip-components=1", "-C", target])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True, help="New scratch directory; must not already exist")
    parser.add_argument("--cache-dir", type=Path, required=True, help="Explicit isolated Zig/package/archive cache")
    parser.add_argument("--output-dir", type=Path, required=True, help="Separate generated output; never rewrites committed artifacts")
    for kind in ("wrapper", "native", "compiler"):
        parser.add_argument("--" + kind + "-archive", type=Path)
    parser.add_argument("--ca-file", type=Path, help="Read-only trusted CA bundle for dependency fetching; host default is discovered")
    parser.add_argument("--require-empty-cache", action="store_true", help="Fail unless the cache is initially absent/empty")
    parser.add_argument("--offline", action="store_true", help="Require all compiler packages already cached; no fetch pass")
    args = parser.parse_args()
    work = args.work_dir.resolve(); cache = args.cache_dir.resolve(); output = args.output_dir.resolve()
    if work.exists() or output.exists():
        raise RuntimeError("Work/output paths must be new; nothing is deleted automatically")
    for relative, digest in MANIFEST["inputs"].items():
        if sha(VENDOR / relative) != digest:
            raise RuntimeError("Vendored input hash mismatch: " + relative)
    cache_empty = not cache.exists() or not any(cache.iterdir())
    if args.require_empty_cache and not cache_empty:
        raise RuntimeError("An initially empty cache was required")
    cache.mkdir(parents=True, exist_ok=True)
    archives = {kind: verified_archive(kind, cache, getattr(args, kind + "_archive")) for kind in ("wrapper", "native", "compiler")}
    work.mkdir(); unpack(archives["native"], work / "native"); unpack(archives["wrapper"], work / "wrapper"); unpack(archives["compiler"], work / "compiler")
    run(["git", "apply", "--whitespace=nowarn", VENDOR / "patches/upstream-wasm-api.patch"], work / "native")
    run(["git", "apply", "--whitespace=nowarn", VENDOR / "patches/agentpanel-native.patch"], work / "native")
    shutil.copyfile(VENDOR / "native/agentpanel_metadata.zig", work / "native/src/terminal/c/agentpanel_metadata.zig")
    run(["git", "apply", "--whitespace=nowarn", VENDOR / "patches/agentpanel-wrapper.patch"], work / "wrapper")
    shutil.copyfile(VENDOR / "extension/metadata.ts", work / "wrapper/lib/metadata.ts")
    image = MANIFEST["builder"]["image"]
    def docker(network, command, ca=None):
        cmd = ["docker", "run", "--rm", "--platform", "linux/arm64", "--network", network,
               "-v", f"{work / 'native'}:/src", "-v", f"{work / 'compiler'}:/tool:ro", "-v", f"{cache}:/cache", "-w", "/src"]
        if ca:
            cmd += ["-v", f"{ca}:/etc/ssl/certs/ca-certificates.crt:ro"]
        return cmd + [image, "/tool/zig"] + command
    common = ["build", "lib-vt", "-Dtarget=wasm32-freestanding", "-Doptimize=ReleaseSmall", "--global-cache-dir", "/cache", "--cache-dir", "/cache/ap-clean-local"]
    run(docker("none", ["version"]))
    if not args.offline:
        ca = args.ca_file or next((p for p in (Path("/etc/ssl/cert.pem"), Path("/etc/ssl/certs/ca-certificates.crt")) if p.exists()), None)
        if ca is None:
            raise RuntimeError("Supply --ca-file for trusted HTTPS dependency fetching")
        run(docker("default", common + ["--list-steps"], ca.resolve()))
    run(docker("none", common))
    output.mkdir(parents=True)
    shutil.copyfile(work / "native/zig-out/bin/ghostty-vt.wasm", output / "ghostty-history.wasm")
    run([REPO / "node_modules/.bin/esbuild", work / "wrapper/lib/index.ts", "--bundle", "--format=esm", "--platform=browser", "--target=es2022", "--minify", '--tsconfig-raw={"compilerOptions":{"useDefineForClassFields":true}}', "--legal-comments=none", f"--outfile={output / 'ghostty-history.js'}"])
    run([REPO / "node_modules/.bin/tsc", "--declaration", "--emitDeclarationOnly", "--module", "ESNext", "--moduleResolution", "bundler", "--target", "ES2022", "--lib", "ES2022,DOM", "--skipLibCheck", "--outDir", output, work / "wrapper/lib/index.ts"])
    (output / "ghostty-history.d.ts").write_text('export * from "./index";\n')
    actual = {str(path.relative_to(output)): {"sha256": sha(path), "bytes": path.stat().st_size} for path in sorted(output.rglob("*")) if path.is_file()}
    expected = {str(Path(path).relative_to("dist")): item for path, item in MANIFEST["artifacts"].items()}
    report = {"compiler": MANIFEST["compiler"], "builder": MANIFEST["builder"], "artifacts": actual, "matchesCommitted": actual == expected,
              "cacheWasRequiredEmpty": args.require_empty_cache, "cacheWasInitiallyEmpty": cache_empty, "networkDisabledForCompilation": True, "buildScriptSha256": sha(Path(__file__))}
    (work / "rebuild-result.json").write_text(json.dumps(report, indent=2) + "\n")
    if actual != expected:
        raise RuntimeError("Generated artifacts differ from committed manifest; inspect " + str(work / "rebuild-result.json"))
    print("Verified exact rebuild: " + str(work / "rebuild-result.json"), flush=True)

if __name__ == "__main__":
    main()
