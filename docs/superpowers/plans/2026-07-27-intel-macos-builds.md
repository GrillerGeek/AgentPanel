# Intel (x86_64) macOS Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a second macOS release artifact built for Intel (`x86_64-apple-darwin`) so Intel Macs have something to download and can auto-update.

**Architecture:** Purely a CI and documentation change. `.github/workflows/release.yml` gains a third matrix leg that cross-compiles for `x86_64-apple-darwin` on the (arm64) `macos-latest` runner, plus a post-build job that asserts the generated `latest.json` covers all three shipped platforms. No Rust or TypeScript source is touched.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action`, `dtolnay/rust-toolchain`, `swatinem/rust-cache`, `gh` CLI + `jq` (both preinstalled on GitHub runners).

**Spec:** `docs/superpowers/specs/2026-07-27-intel-macos-builds-design.md`

## Global Constraints

- **Do not modify the existing arm64 macOS leg.** It stays `args: ""` with no explicit `--target`, so artifact names and updater keys remain byte-for-byte what v0.5.1 shipped.
- **No changes to any file under `src/` or `src-tauri/src/`.** There is no architecture-specific code in the tree; this is a build/distribution change only.
- **Third-party actions stay SHA-pinned** with a trailing `# vX` comment. Dependabot tracks these. Never replace a pinned SHA with a floating tag.
- **Pushing `.github/workflows/*` needs the `workflow` token scope.** If the push is rejected: `gh auth refresh -h github.com -s workflow && gh auth setup-git`. HTTPS + the gh credential helper is the working path in this environment; SSH is not configured.
- **Branch:** `intel-macos-builds`. The design doc is already committed there as `1a949d7`.
- **Local YAML checks run from the repo root** (`C:\Users\jason\source\AgentPanel`) in the Bash tool, not PowerShell — the assertion commands use POSIX pipes.

---

### Task 1: Add the Intel build leg to the release matrix

**Files:**
- Modify: `.github/workflows/release.yml:44-51` (matrix), `:74-80` (Setup Rust + Rust cache steps)
- Test: no test file — verified by a runnable assertion over the parsed workflow YAML (below)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `matrix.rust-target` field consumed by the `Setup Rust` and `Rust cache` steps. Values: `""` for the two native legs, `"x86_64-apple-darwin"` for the new cross-compiled leg. Task 2 relies on this leg producing a `darwin-x86_64` key in `latest.json`.

**Background the implementer needs:**

`macos-latest` is an Apple Silicon runner, which is why today's release only contains `AgentPanel_<version>_aarch64.dmg`. Passing `--target x86_64-apple-darwin` to `tauri-action` cross-compiles the Intel slice on that same arm64 host — Xcode ships both SDKs, and the entire Rust dependency graph is pure Rust or binds system frameworks (`native-tls` → Security.framework), so there is no C library to cross-build.

`dtolnay/rust-toolchain`'s `targets` input is safe to pass as an empty string. Its implementation is `for t in ${targets//,/ }; do echo -n ' --target' $t; done` — an empty value produces zero loop iterations and adds no flag. This was verified against the action source; do not add a conditional guard around it.

- [ ] **Step 1: Write the failing assertion**

Run this from the repo root. It parses the workflow and asserts the end state. Right now it must fail.

```bash
npx --yes js-yaml .github/workflows/release.yml | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const wf = JSON.parse(s);
  const inc = wf.jobs.build.strategy.matrix.include;
  const fail = m => { console.error("FAIL: " + m); process.exitCode = 1; };
  if (inc.length !== 3) fail("expected 3 matrix legs, got " + inc.length);
  const macs = inc.filter(e => e.platform === "macos-latest");
  if (macs.length !== 2) fail("expected 2 macos legs, got " + macs.length);
  if (!macs.some(e => e.args === "" && e["rust-target"] === ""))
    fail("arm64 leg must stay args:\"\" rust-target:\"\"");
  if (!macs.some(e => e.args === "--target x86_64-apple-darwin"
                   && e["rust-target"] === "x86_64-apple-darwin"))
    fail("missing the x86_64 leg");
  const win = inc.find(e => e.platform === "windows-latest");
  if (!win || win["rust-target"] !== "") fail("windows leg needs rust-target:\"\"");
  const step = n => wf.jobs.build.steps.find(x => x.name === n);
  if (step("Setup Rust").with?.targets !== "${{ matrix.rust-target }}")
    fail("Setup Rust must pass targets: ${{ matrix.rust-target }}");
  if (step("Rust cache").with?.key !== "${{ matrix.rust-target }}")
    fail("Rust cache must set key: ${{ matrix.rust-target }}");
  if (process.exitCode !== 1) console.log("PASS: matrix wired for 3 legs");
});'
```

- [ ] **Step 2: Run it to confirm it fails**

Expected output: `FAIL: expected 3 matrix legs, got 2` (and further FAIL lines), exit code 1.

- [ ] **Step 3: Edit the matrix**

Replace `.github/workflows/release.yml:44-51` with:

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          # Apple Silicon. Deliberately left without an explicit --target so the
          # artifact names and updater keys stay byte-for-byte what v0.5.1 shipped.
          - platform: macos-latest
            args: ""
            rust-target: ""
          # Intel. `macos-latest` is an arm64 runner, so this leg cross-compiles.
          - platform: macos-latest
            args: "--target x86_64-apple-darwin"
            rust-target: "x86_64-apple-darwin"
          - platform: windows-latest
            args: ""
            rust-target: ""
```

- [ ] **Step 4: Wire `rust-target` into the toolchain and cache steps**

Replace `.github/workflows/release.yml:74-80` with:

```yaml
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
        with:
          # Empty on the native legs: the action's `for t in ${targets//,/ }` loop
          # simply doesn't iterate, so no --target flag is added.
          targets: ${{ matrix.rust-target }}

      - name: Rust cache
        uses: swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
        with:
          workspaces: "./src-tauri -> target"
          # Both macOS legs share a job id and runner OS. Without a distinct key
          # they collide on one cache entry and thrash it every run.
          key: ${{ matrix.rust-target }}
```

- [ ] **Step 5: Re-run the assertion from Step 1**

Expected output: `PASS: matrix wired for 3 legs`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Build an Intel (x86_64) macOS artifact alongside Apple Silicon

macos-latest is an arm64 runner, so releases have shipped aarch64 only.
Cross-compile a second leg for x86_64-apple-darwin; the arm64 leg is
untouched so its artifact names and updater keys don't move."
```

---

### Task 2: Fail the release if `latest.json` misses a platform

**Files:**
- Modify: `.github/workflows/release.yml` (append a new top-level job after `build`)
- Test: no test file — verified by the assertion below

**Interfaces:**
- Consumes: the three-leg matrix from Task 1; specifically that the build jobs produce `darwin-aarch64`, `darwin-x86_64` and `windows-x86_64` keys in the release's `latest.json`.
- Produces: a `verify-manifest` job. Nothing depends on it.

**Background the implementer needs:**

The updater client builds its lookup key as `{os}-{arch}` and looks it up in `latest.json`'s `platforms` map (`tauri-plugin-updater-2.10.1/src/updater.rs:578-597`). A missing key means that platform's users get `TargetNotFound` instead of an update — silently, forever, until someone notices.

All three build jobs merge into one `latest.json` on the release. That merge works today (v0.5.1's manifest carries keys from both the macOS and Windows jobs), but two macOS jobs now finish near-simultaneously, which raises the race risk. Releases are created as drafts and published by hand, so a loud red job is enough to prevent a bad release reaching users.

**Do not use `gh release download` here.** GitHub's "get release by tag" REST endpoint does not return drafts. List the releases and match the tag instead, which does include drafts for an authorized token.

- [ ] **Step 1: Write the failing assertion**

```bash
npx --yes js-yaml .github/workflows/release.yml | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const wf = JSON.parse(s);
  const fail = m => { console.error("FAIL: " + m); process.exitCode = 1; };
  const j = wf.jobs["verify-manifest"];
  if (!j) return fail("no verify-manifest job");
  if (j.needs !== "build") fail("verify-manifest must need: build");
  const run = j.steps.map(x => x.run || "").join("\n");
  for (const k of ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"])
    if (!run.includes(k)) fail("verify-manifest never checks " + k);
  if (run.includes("gh release download"))
    fail("gh release download does not resolve draft releases by tag");
  if (process.exitCode !== 1) console.log("PASS: verify-manifest guards all 3 platforms");
});'
```

- [ ] **Step 2: Run it to confirm it fails**

Expected: `FAIL: no verify-manifest job`, exit code 1.

- [ ] **Step 3: Append the job**

Add at the end of `.github/workflows/release.yml`, at the same indentation as `build:`:

```yaml
  # The updater looks up an exact `{os}-{arch}` key in latest.json and has no
  # fallback (tauri-plugin-updater's updater.rs). A key missing from the merged
  # manifest means that platform silently stops receiving updates, so fail the
  # release loudly while it is still an unpublished draft.
  verify-manifest:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Check latest.json covers every shipped platform
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # `GET /releases/tags/{tag}` omits drafts, so list and match instead.
          asset=$(gh api "repos/${GITHUB_REPOSITORY}/releases" --paginate --jq \
            ".[] | select(.tag_name == \"${GITHUB_REF_NAME}\") | .assets[] | select(.name == \"latest.json\") | .url")
          if [ -z "$asset" ]; then
            echo "::error::no latest.json asset on the ${GITHUB_REF_NAME} release"
            exit 1
          fi
          curl -sSL -H "Authorization: Bearer ${GH_TOKEN}" \
                    -H "Accept: application/octet-stream" "$asset" -o latest.json
          cat latest.json
          fail=0
          for key in darwin-aarch64 darwin-x86_64 windows-x86_64; do
            if ! jq -e --arg k "$key" '.platforms[$k].url' latest.json >/dev/null; then
              echo "::error::latest.json is missing the '$key' platform entry"
              fail=1
            fi
          done
          if [ "$fail" -ne 0 ]; then
            echo "Do not publish this draft — those users would never see an update."
            exit 1
          fi
          echo "latest.json covers all three platforms."
```

- [ ] **Step 4: Re-run the assertion from Step 1**

Expected: `PASS: verify-manifest guards all 3 platforms`, exit code 0.

- [ ] **Step 5: Re-run Task 1's assertion too**

The file changed; confirm Task 1's invariants still hold. Expected: `PASS: matrix wired for 3 legs`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Fail the release when latest.json misses a platform key

The updater has no fallback for a missing {os}-{arch} key, so a lost
merge would silently strand that platform on its installed version."
```

---

### Task 3: Document the second macOS download

**Files:**
- Modify: `README.md:26`, `README.md:38-39`, `docs/dev/code-signing.md` (append a section)

**Interfaces:**
- Consumes: the artifact name produced by Task 1's Intel leg, `AgentPanel_<version>_x64.dmg`.
- Produces: nothing consumed by later tasks.

**Note on the spec:** the design doc says to update "the `docs/dev/` release checklist". No such file exists — the closest thing is `docs/dev/code-signing.md`, which already documents what a `v*` tag push produces. Add the artifact list there rather than creating a new doc.

- [ ] **Step 1: Update the runtime requirement**

`README.md:26` currently reads:

```markdown
- **Windows 10 1809+ / Windows 11**, or **macOS 11+** (Apple Silicon).
```

Change to:

```markdown
- **Windows 10 1809+ / Windows 11**, or **macOS 11+** (Apple Silicon or Intel).
```

- [ ] **Step 2: Update the install section**

`README.md:38-39` currently reads:

```markdown
- **macOS** — `AgentPanel_<version>_aarch64.dmg` (Apple Silicon). Signed and notarized by Apple —
  open the `.dmg` and drag the app to Applications; no security workarounds needed.
```

Change to:

```markdown
- **macOS (Apple Silicon)** — `AgentPanel_<version>_aarch64.dmg`. This is every Mac from 2020 on;
  check the Apple menu → About This Mac if unsure.
- **macOS (Intel)** — `AgentPanel_<version>_x64.dmg`.

  Both are signed and notarized by Apple — open the `.dmg` and drag the app to Applications; no
  security workarounds needed.
```

- [ ] **Step 3: Document the expected release artifacts**

Append to `docs/dev/code-signing.md`:

```markdown
## Expected release artifacts

A `v*` tag push produces a **draft** release containing:

| Platform | Artifact |
| --- | --- |
| Windows | `AgentPanel_<version>_x64-setup.exe` (+ `.sig`) |
| macOS, Apple Silicon | `AgentPanel_<version>_aarch64.dmg`, `AgentPanel_<version>_aarch64.app.tar.gz` (+ `.sig`) |
| macOS, Intel | `AgentPanel_<version>_x64.dmg`, `AgentPanel_<version>_x64.app.tar.gz` (+ `.sig`) |
| all | `latest.json` |

Before publishing the draft, confirm:

1. The `verify-manifest` job is green — it asserts `latest.json` carries
   `darwin-aarch64`, `darwin-x86_64` and `windows-x86_64`. The updater has no
   fallback for a missing key, so a platform absent here silently stops
   receiving updates.
2. **Both** macOS jobs logged a notarization status of `Accepted`.
   `tauri-action` exits green even when signing silently no-ops, so job success
   alone proves nothing — grep the log for the status line.
```

- [ ] **Step 4: Verify the README renders the changed section correctly**

```bash
sed -n '24,46p' README.md
```

Expected: the requirements line mentions "Apple Silicon or Intel", and the install list shows three bullets (Windows, macOS Apple Silicon, macOS Intel) with the shared signing note indented under the last one.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/dev/code-signing.md
git commit -m "Document the Intel macOS download and expected release artifacts"
```

---

### Task 4: Verify against a real release

**Files:** none — this task runs against CI output, not the working tree.

**Interfaces:**
- Consumes: everything from Tasks 1-3, merged to `main`.
- Produces: the go/no-go decision for publishing the draft release.

This cannot run before merge. The workflow only triggers on a `v*` tag push, and the `verify-version` job requires the tag to equal the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` — so there is no way to dry-run it from a branch without doing a real version bump. Merging first is safe: a broken build fails loudly, and the release is a draft nobody can download until published by hand.

- [ ] **Step 1: Open the PR and merge to `main`**

```bash
git push -u origin intel-macos-builds
gh pr create --fill --base main
```

If the push is rejected for the workflow file: `gh auth refresh -h github.com -s workflow && gh auth setup-git`, then retry.

- [ ] **Step 2: Cut the next release**

Follow the existing process: bump the version in `package.json`, `src-tauri/Cargo.toml`, the `agentpanel` entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`; commit on `main`; push; tag `vX.Y.Z`; push the tag.

- [ ] **Step 3: Confirm both macOS jobs notarized**

```bash
gh run view --log | grep -i -E "notariz|status: (Accepted|Invalid)"
```

Expected: an `Accepted` status from each macOS job. An `Invalid` status, or no status line at all, means signing silently no-opped — do not publish.

- [ ] **Step 4: Confirm the artifacts and manifest**

```bash
gh release view vX.Y.Z --json assets -q '.assets[].name'
```

Expected to include `AgentPanel_X.Y.Z_aarch64.dmg`, `AgentPanel_X.Y.Z_x64.dmg`, `AgentPanel_X.Y.Z_x64-setup.exe`, and `latest.json`. The `verify-manifest` job must be green.

- [ ] **Step 5: Smoke-test the Intel build under Rosetta 2**

On an Apple Silicon Mac, download `AgentPanel_X.Y.Z_x64.dmg`, drag to Applications, and **launch it from Finder — not from a terminal.** Launching from Finder is the whole point: it reproduces the bare `launchd` environment (no `PATH`, no `TERM`) that caused both the login-shell PATH import work and the v0.3.2 `TERM`/`COLORTERM` seeding fix.

Confirm:
1. The app opens without a Gatekeeper warning (proves notarization of the x86_64 slice).
2. Adding a repo and opening a terminal spawns a working shell.
3. Terminal output is **colored** — run `ls -G` and start an agent CLI. Monochrome output means the `TERM` seeding regressed on this slice.

- [ ] **Step 6: Publish the draft release**

Only after Steps 3-5 pass.

---

## Rollback

If the Intel leg breaks a release, remove the second macOS matrix entry and the `verify-manifest` job's `darwin-x86_64` check. The arm64 and Windows legs are untouched by this plan, so reverting the two workflow commits restores the exact v0.5.1 release behavior.
