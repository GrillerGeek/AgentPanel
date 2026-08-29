# Linux Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an x86_64 Linux AppImage and `.deb` from the existing tagged-release workflow, with working auto-update.

**Architecture:** No application code changes. Every `#[cfg]` gate in `src-tauri/src/` already has a `not(windows)` / `unix` / `not(macos)` arm that Linux takes, and `telemetry.rs` already has an XDG data-dir arm. The work is: (a) a new PR-time Linux check workflow so a compile break is a red PR instead of a broken release, (b) two new `bundle.targets`, (c) a fourth `release.yml` build leg, (d) one more required key in `verify-manifest`.

**Tech Stack:** GitHub Actions, Tauri 2 bundler (AppImage + deb), `tauri-plugin-updater`, WebKitGTK 4.1.

**Spec:** `docs/superpowers/specs/2026-08-24-linux-build-design.md`

## Global Constraints

- Runner for every Linux job is **`ubuntu-22.04`**, pinned. Never `ubuntu-latest`. An AppImage inherits its builder's glibc floor; 24.04 would raise it to glibc 2.39 and lock out Debian 12, Ubuntu 22.04, and Mint 21. (Spec R4/D3)
- **Do not change** the `platform`, `args`, or `rust-target` values of the three existing matrix legs. Their artifact names and updater keys must stay byte-for-byte identical or auto-update breaks for existing Windows and macOS users. (Spec R5)
- `strategy.max-parallel: 1` on the build matrix **must stay**. Build legs read-modify-write one shared `latest.json`; the v0.6.0 race produced two assets both named `latest.json` with disjoint platform sets. (Spec R6)
- The Linux updater platform key is exactly **`linux-x86_64`**. (Spec R2)
- Third-party GitHub Actions are **SHA-pinned** in this repo. Any new action must be pinned to a full commit SHA with a `# vX.Y.Z` trailing comment, matching the existing style.
- Linux system packages required for any Tauri build or `cargo check` here:
  `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libxdo-dev libssl-dev`

---

### Task 1: PR-time Linux check workflow

Proves the Rust core and frontend build on Linux **before** any tag is pushed. Today `release.yml` is the only workflow and it runs on tags only, so a Linux regression would first surface halfway through a release. (Spec R7/D4)

**Files:**
- Create: `.github/workflows/check.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a required-status job named `check / linux`. Tasks 2 and 3 rely on this job going green on their PRs as the evidence that Linux compiles.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/check.yml`:

```yaml
name: Check

on:
  pull_request:
  push:
    branches: [main]

jobs:
  # Linux is the newest build target and the one no maintainer runs locally, so
  # it is the one most likely to break silently. release.yml only runs on tags,
  # which would surface a Linux regression halfway through a release. This job
  # makes that a red PR instead.
  linux:
    runs-on: ubuntu-22.04
    env:
      CARGO_NET_RETRY: "10"
      CARGO_NET_GIT_FETCH_WITH_CLI: "true"
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Setup Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 20

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable

      - name: Rust cache
        uses: swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2
        with:
          workspaces: "./src-tauri -> target"
          key: linux-check

      # webkit2gtk-sys and friends run pkg-config at build time, so these are
      # needed even for `cargo check` — not just for bundling.
      - name: Install Linux system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            build-essential \
            curl \
            wget \
            file \
            libxdo-dev \
            libssl-dev

      - name: Install frontend dependencies
        run: npm ci

      # `npm run build` is `tsc && vite build`, so this covers the typecheck and
      # produces ../dist — which tauri-build expects to exist.
      - name: Build frontend (typecheck + dist)
        run: npm run build

      - name: Frontend tests
        run: npm test

      - name: Rust check
        run: cargo check --manifest-path src-tauri/Cargo.toml --all-targets

      - name: Rust tests
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Validate the YAML parses**

Run:

```bash
npx --yes js-yaml .github/workflows/check.yml > /dev/null && echo "YAML OK"
```

Expected: `YAML OK`. A parse error prints a `YAMLException` with a line number.

- [ ] **Step 3: Commit and push on a branch**

```bash
git checkout -b feat/linux-build
git add .github/workflows/check.yml
git commit -m "ci: add PR-time Linux check workflow"
git push -u origin feat/linux-build
```

> Pushing `.github/workflows/*` over HTTPS to this repo needs the `workflow`
> token scope. If the push is rejected, run
> `gh auth refresh -h github.com -s workflow` then `gh auth setup-git`.

- [ ] **Step 4: Open a PR and confirm the job goes green**

```bash
gh pr create --fill --title "Linux build support" --body "Adds a Linux check workflow, AppImage + deb bundle targets, and a Linux release leg."
gh pr checks --watch
```

Expected: the `linux` job passes. **This green run is the proof that the Rust
core compiles for Linux** — if `cargo check` fails here, stop and fix the
compile error before continuing; do not proceed to Task 2.

---

### Task 2: Add AppImage and deb bundle targets

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.targets`, and a new `bundle.linux` block)

**Interfaces:**
- Consumes: the green `linux` check job from Task 1.
- Produces: `bundle.targets` containing `"appimage"` and `"deb"`. Task 3's build leg produces artifacts only because of this; Task 4's `verify-manifest` key exists only because `appimage` is present.

- [ ] **Step 1: Add the two targets**

In `src-tauri/tauri.conf.json`, change:

```json
    "targets": ["nsis", "app", "dmg"],
```

to:

```json
    "targets": ["nsis", "app", "dmg", "appimage", "deb"],
```

This stays one global list on purpose. The bundler skips targets unsupported on
the host platform — which is why `["nsis", "app", "dmg"]` already builds
cleanly on both the Windows and macOS legs today. `appimage` is required (it is
the only Linux format `tauri-plugin-updater` can update in place); `deb` is the
convenience package. `rpm` is deliberately excluded.

- [ ] **Step 2: Add the `bundle.linux` block**

In the same file, add a `linux` key alongside the existing `windows` and
`macOS` bundle blocks:

```json
    "linux": {
      "deb": {
        "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"]
      }
    },
```

Place it immediately after the `"windows": { ... }` block and before
`"macOS": { ... }`. Without `depends`, the `.deb` installs on a machine with no
WebKitGTK and then fails to launch with an unhelpful dynamic-linker error.

- [ ] **Step 3: Verify the JSON is still valid and reads back as expected**

Run:

```bash
node -e "const c=require('./src-tauri/tauri.conf.json'); console.log(c.bundle.targets.join(',')); console.log(JSON.stringify(c.bundle.linux));"
```

Expected output:

```
nsis,app,dmg,appimage,deb
{"deb":{"depends":["libwebkit2gtk-4.1-0","libgtk-3-0"]}}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: add appimage and deb bundle targets"
```

---

### Task 3: Add the Linux release build leg

**Files:**
- Modify: `.github/workflows/release.yml` (the `build` job's `strategy.matrix.include`, plus one new conditional step)

**Interfaces:**
- Consumes: `bundle.targets` from Task 2.
- Produces: a `linux-x86_64` entry inside the release's `latest.json`, plus `.AppImage` and `.deb` assets on the draft release. Task 4 asserts on that key.

- [ ] **Step 1: Add the fourth matrix leg**

In `.github/workflows/release.yml`, inside `build.strategy.matrix.include`,
append after the existing `windows-latest` entry:

```yaml
          # Linux x86_64. Pinned to 22.04 deliberately — DO NOT move to
          # ubuntu-latest. An AppImage inherits its builder's glibc floor, so
          # building on 24.04 would raise the floor to glibc 2.39 and lock out
          # Debian 12, Ubuntu 22.04, and Mint 21.
          - platform: ubuntu-22.04
            args: ""
            rust-target: ""
```

Leave the three existing legs untouched. `rust-target: ""` is correct here for
the same reason it is on the native Windows and Apple Silicon legs: the
toolchain action's `for t in ${targets//,/ }` loop simply does not iterate, so
no `--target` flag is added and the artifact names stay default.

The shared `swatinem/rust-cache` `key: ${{ matrix.rust-target }}` needs no
change — that key exists to separate the *two macOS legs*, which share a runner
OS. Cache keys already include the runner OS, so this leg cannot collide with
the Windows or macOS entries despite also using `""`.

- [ ] **Step 2: Add the system-dependency install step**

In the same `build` job, insert this step **after** the `Rust cache` step and
**before** `Install frontend dependencies`:

```yaml
      # WebKitGTK and friends aren't on the runner image. Linux-only: the
      # `if` keeps this a no-op on the Windows and macOS legs.
      - name: Install Linux system dependencies
        if: ${{ runner.os == 'Linux' }}
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            build-essential \
            curl \
            wget \
            file \
            libxdo-dev \
            libssl-dev
```

- [ ] **Step 3: Verify the YAML parses and the matrix has four legs**

Run:

```bash
npx --yes js-yaml .github/workflows/release.yml | node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  const wf=JSON.parse(s);
  const b=wf.jobs.build;
  console.log('max-parallel:', b.strategy['max-parallel']);
  for (const leg of b.strategy.matrix.include) console.log(leg.platform, '|', JSON.stringify(leg.args), '|', JSON.stringify(leg['rust-target']));
});"
```

Expected:

```
max-parallel: 1
macos-latest | "" | ""
macos-latest | "--target x86_64-apple-darwin" | "x86_64-apple-darwin"
windows-latest | "" | ""
ubuntu-22.04 | "" | ""
```

If `max-parallel` is not `1`, stop — the release will race on `latest.json`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build a Linux AppImage and deb on release"
```

---

### Task 4: Require `linux-x86_64` in the update manifest

Without this, a release that silently failed to publish the Linux updater
artifact would still pass CI, and every Linux user would stop receiving
updates with no signal.

**Files:**
- Modify: `.github/workflows/release.yml` (the `verify-manifest` job's key loop)

**Interfaces:**
- Consumes: the `linux-x86_64` key produced by Task 3's build leg.
- Produces: a hard release gate. Nothing depends on it.

- [ ] **Step 1: Add the key to the loop**

In `.github/workflows/release.yml`, in the `verify-manifest` job, change:

```bash
          for key in darwin-aarch64 darwin-x86_64 windows-x86_64; do
```

to:

```bash
          for key in darwin-aarch64 darwin-x86_64 windows-x86_64 linux-x86_64; do
```

- [ ] **Step 2: Update the job's closing message**

In the same script, change:

```bash
          echo "latest.json covers all three platforms."
```

to:

```bash
          echo "latest.json covers all four platform keys."
```

- [ ] **Step 3: Test the assertion logic locally against a fixture**

The technique this repo already uses: extract the `run:` block and execute the
assertion against a hand-made `latest.json`. Run from a scratch directory:

```bash
mkdir -p /tmp/manifest-fixture && cd /tmp/manifest-fixture
cat > latest.json <<'EOF'
{"platforms":{"darwin-aarch64":{"url":"a"},"darwin-x86_64":{"url":"b"},"windows-x86_64":{"url":"c"}}}
EOF
fail=0
for key in darwin-aarch64 darwin-x86_64 windows-x86_64 linux-x86_64; do
  if ! jq -e --arg k "$key" '.platforms[$k].url' latest.json >/dev/null; then
    echo "MISSING: $key"; fail=1
  fi
done
echo "fail=$fail"
```

Expected: `MISSING: linux-x86_64` then `fail=1`. This proves the new key is
actually being checked rather than silently passing.

> No local `jq`? This repo's convention is a small node-backed `jq` shim. For
> this one assertion the simpler equivalent is:
> `node -e "const m=require('./latest.json'); for (const k of ['darwin-aarch64','darwin-x86_64','windows-x86_64','linux-x86_64']) if(!m.platforms?.[k]?.url) console.log('MISSING:',k)"`

- [ ] **Step 4: Add the missing key to the fixture and confirm it passes**

```bash
cd /tmp/manifest-fixture
cat > latest.json <<'EOF'
{"platforms":{"darwin-aarch64":{"url":"a"},"darwin-x86_64":{"url":"b"},"windows-x86_64":{"url":"c"},"linux-x86_64":{"url":"d"}}}
EOF
fail=0
for key in darwin-aarch64 darwin-x86_64 windows-x86_64 linux-x86_64; do
  if ! jq -e --arg k "$key" '.platforms[$k].url' latest.json >/dev/null; then
    echo "MISSING: $key"; fail=1
  fi
done
echo "fail=$fail"
```

Expected: no `MISSING` lines, `fail=0`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: fail the release if latest.json omits linux-x86_64"
```

---

### Task 5: Document Linux install and the release ritual

**Files:**
- Modify: `README.md` (the "Runtime requirements", "Install", and "Build from source" sections)
- Modify: `docs/dev/` release notes — add the Linux leg to the release checklist if one exists there; otherwise skip this file and note it in the PR body.

**Interfaces:**
- Consumes: the artifact names produced by Task 3.
- Produces: user-facing docs. Nothing depends on it.

- [ ] **Step 1: Update "Runtime requirements"**

In `README.md`, change:

```markdown
- **Windows 10 1809+ / Windows 11**, or **macOS 11+** (Apple Silicon or Intel).
- **WebView2 runtime** (Windows only) — preinstalled on Windows 11; the installer fetches it if
  missing. macOS uses the system WebKit.
```

to:

```markdown
- **Windows 10 1809+ / Windows 11**, **macOS 11+** (Apple Silicon or Intel), or **Linux**
  (x86_64, glibc 2.35+ — Ubuntu 22.04, Debian 12, Fedora 36 and newer).
- **WebView2 runtime** (Windows only) — preinstalled on Windows 11; the installer fetches it if
  missing. macOS uses the system WebKit. Linux uses **WebKitGTK 4.1**
  (`libwebkit2gtk-4.1-0`); the `.deb` declares it as a dependency, and the AppImage
  expects it to be present.
```

- [ ] **Step 2: Add Linux to the "Install" list**

After the two macOS bullets, add:

```markdown
- **Linux (x86_64)** — `AgentPanel_<version>_amd64.AppImage` (portable — `chmod +x` and run),
  or `AgentPanel_<version>_amd64.deb` for Debian/Ubuntu. Auto-update works on the
  AppImage only.
```

- [ ] **Step 3: Add the Linux troubleshooting note**

Immediately after the macOS shell PATH tip section, add:

```markdown
### Linux blank-window tip

On some NVIDIA proprietary drivers, WebKitGTK renders a blank or corrupted
window. Launch with the DMABUF renderer disabled:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./AgentPanel_<version>_amd64.AppImage
```

AgentPanel does not set this itself — it turns off hardware acceleration, which
the majority of Linux users do not need.
```

- [ ] **Step 4: Update "Build from source" prerequisites**

Change:

```markdown
toolchain, VS C++ Build Tools, and WebView2; on macOS: the Xcode Command Line Tools.
```

to:

```markdown
toolchain, VS C++ Build Tools, and WebView2; on macOS: the Xcode Command Line Tools; on
Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
patchelf build-essential libxdo-dev libssl-dev`.
```

And change:

```markdown
Bundles are written under `src-tauri/target/release/bundle/` — `nsis/` on Windows, `dmg/` and
`macos/` on macOS.
```

to:

```markdown
Bundles are written under `src-tauri/target/release/bundle/` — `nsis/` on Windows, `dmg/` and
`macos/` on macOS, `appimage/` and `deb/` on Linux.
```

- [ ] **Step 5: Commit and push**

```bash
git add README.md
git commit -m "docs: document Linux install, requirements, and troubleshooting"
git push
```

- [ ] **Step 6: Confirm CI is green, then merge**

```bash
gh pr checks --watch
gh pr merge --squash
```

Expected: the `linux` check job passes.

---

### Task 6: Cut a release and verify the Linux channel end to end

This is the only step that actually exercises the AppImage bundler, the deb
bundler, and the updater manifest merge. Do not skip it — Tasks 1–5 prove the
code compiles, not that it packages.

**Files:**
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (the standard six-file version bump)

**Interfaces:**
- Consumes: everything above.
- Produces: a published release carrying Linux artifacts.

- [ ] **Step 1: Bump the version on `main`**

Set the new version (example: `0.7.0`) in `package.json`,
`src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` by hand, then refresh
both lockfiles rather than editing them:

```bash
git checkout main && git pull
npm install --package-lock-only
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Confirm all six manifests agree before tagging**

```bash
node -e "
const fs=require('fs');
const pkg=require('./package.json');
const lock=require('./package-lock.json');
const conf=require('./src-tauri/tauri.conf.json');
const toml=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version *= *\"(.*)\"/m)[1];
const clock=fs.readFileSync('src-tauri/Cargo.lock','utf8').split(/\r?\n/);
const i=clock.findIndex(l=>l==='name = \"agentpanel\"');
const cl=clock.slice(i).find(l=>l.startsWith('version = ')).match(/\"(.*)\"/)[1];
console.log({pkg:pkg.version,lock:lock.version,lockpkg:lock.packages[''].version,conf:conf.version,toml,cargolock:cl});
"
```

Expected: all six values identical. A mismatch fails `verify-version` and
wastes a tag.

- [ ] **Step 3: Commit, push, and tag**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Bump version to 0.7.0 for release"
git push
git tag v0.7.0
git push origin v0.7.0
```

- [ ] **Step 4: Watch the release run**

```bash
gh run watch
```

Expected: `verify-version` passes, four build legs run **one at a time**
(~35 min total now, up from ~25), then `verify-manifest` passes. If
`verify-manifest` reports more than one asset named `latest.json`, the legs
raced — `strategy.max-parallel` has regressed. Delete the draft and the tag,
fix it, and re-tag.

- [ ] **Step 5: Inspect the draft release's assets**

```bash
gh release view v0.7.0 --json assets --jq '.assets[].name'
```

Expected to include an `.AppImage`, an `.AppImage.sig` (or
`.AppImage.tar.gz` + `.tar.gz.sig`, depending on the bundler's updater format),
a `.deb`, and exactly **one** `latest.json`.

> The exact Linux updater artifact naming is the one thing this plan does not
> assert from first principles. `verify-manifest` is the authority: if the
> `linux-x86_64` key is present with a `url`, the channel works. If that key is
> missing, read the build leg's log for the bundler's actual output names
> before changing anything.

- [ ] **Step 6: Smoke-test the AppImage**

On a Linux machine or VM (Ubuntu 22.04 or Debian 12):

```bash
chmod +x AgentPanel_0.7.0_amd64.AppImage
./AgentPanel_0.7.0_amd64.AppImage
```

Verify by hand — CI cannot check any of these:
1. The window opens and is not blank.
2. Add a git repo from the sidebar; its worktrees list.
3. Open a terminal on a worktree; the shell is `$SHELL`, not PowerShell.
4. Run an agent CLI; output is **coloured** (this proves `pty.rs`'s
   `TERM=xterm-256color` seeding works off macOS too).
5. Close a tab and confirm the shell's process tree dies (`ps aux | grep`
   should show no orphan) — this exercises the `cfg(unix)`
   `libc::kill(-pid, SIGKILL)` path.
6. Settings → the shell dropdown lists Bash/Zsh/sh from `shells.rs`.

- [ ] **Step 7: Publish the draft**

Publish from the GitHub releases UI once the smoke test passes.

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| R1 AppImage + deb | Task 2 (targets), Task 3 (build leg) |
| R2 `linux-x86_64` in `latest.json` | Task 3 (produces), Task 6 Step 5 (verifies) |
| R3 `verify-manifest` fails without it | Task 4 |
| R4 `ubuntu-22.04` pin | Global Constraints, Task 1, Task 3 |
| R5 existing keys unchanged | Global Constraints, Task 3 Step 1 |
| R6 serial release | Global Constraints, Task 3 Step 3 assertion |
| R7 PR-time Linux check | Task 1 |
| D5 DMABUF documented not coded | Task 5 Step 3 |

No gaps.

**Known residual risk:** the exact Linux updater artifact filename (`.AppImage.sig`
vs `.AppImage.tar.gz`) is not asserted from first principles. Task 6 Step 5
names this explicitly and points at `verify-manifest` as the authority rather
than guessing.
