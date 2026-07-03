# macOS Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentPanel build and run on macOS (dev + local bundle) and add GitHub Actions CI that builds Windows + macOS bundles.

**Architecture:** The Rust core is already cross-platform; the only behavioral gap is Unix process-tree cleanup on session close, fixed with a process-group `SIGKILL`. Everything else is configuration: bundle targets, an `npm install` fix, a CI workflow, and cosmetic wording.

**Tech Stack:** Tauri 2, Rust, `portable-pty`, `libc` (new, Unix-only), Node/Vite, GitHub Actions (`tauri-apps/tauri-action`).

## Global Constraints

- No Apple code signing / notarization in this plan (unsigned macOS builds are acceptable; they show a Gatekeeper warning).
- Windows behavior and Windows builds must remain unaffected by every change.
- New Unix dependency (`libc`) must be gated under `[target.'cfg(unix)'.dependencies]`.
- Session-close kill semantics are forceful `SIGKILL` to the process group (parity with Windows `taskkill /F`), not graceful `SIGTERM`.
- CI produces a **draft** GitHub Release with no signing secrets.
- Spec of record: `docs/dev/superpowers-specs-2026-06-26-macos-support-design.md`.

---

### Task 1: Unix process-tree kill

Replace the no-op `kill_process_tree` stub on Unix with a process-group `SIGKILL`, and add the `libc` dependency gated to Unix. This is the only behavioral change in the plan.

**Files:**
- Modify: `src-tauri/src/pty.rs:52-53` (the `#[cfg(not(windows))]` stub)
- Modify: `src-tauri/Cargo.toml` (add a `[target.'cfg(unix)'.dependencies]` section)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fn kill_process_tree(pid: u32)` keeps the same signature on all platforms; callers in `pty_close` are unchanged.

- [ ] **Step 1: Add the Unix `libc` dependency to `Cargo.toml`**

Append after the existing `[target.'cfg(windows)'.dependencies]` block (currently ends at line 36):

```toml
[target.'cfg(unix)'.dependencies]
# Process-group signalling for killing the agent's subprocess tree on close.
libc = "0.2"
```

- [ ] **Step 2: Replace the Unix stub in `pty.rs`**

Replace these two lines (`src-tauri/src/pty.rs:52-53`):

```rust
#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}
```

with:

```rust
/// On Unix the PTY child is a session leader (portable-pty calls `setsid`), so
/// its pid IS its process-group id. Negating it sends the signal to the whole
/// group — every subprocess the agent spawned — in a single call.
#[cfg(unix)]
fn kill_process_tree(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
```

- [ ] **Step 3: Verify the Windows build still compiles**

Run (from repo root):

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: finishes with `Finished` and no errors. (On this Windows dev machine the `#[cfg(unix)]` body is not compiled; its real compile happens in CI on macOS — Task 3.)

- [ ] **Step 4: Confirm the libc dep resolved**

Run:

```bash
cargo tree --manifest-path src-tauri/Cargo.toml -i libc 2>&1 | head -5
```

Expected: on Windows `libc` may not appear (it is Unix-gated) — that is fine; the goal is only that `cargo check` in Step 3 succeeded. Do not treat an empty result here as a failure.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/Cargo.toml
git commit -m "macOS: kill PTY process group with SIGKILL on Unix"
```

---

### Task 2: Bundle config, npm install fix, and cosmetic wording

Make the project bundle on macOS and install on macOS, plus drop Windows-only product copy. All edits are configuration/metadata; no behavior change.

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.targets`, `bundle.longDescription`)
- Modify: `package.json` (remove two Windows-only devDependencies)
- Modify: `src-tauri/Cargo.toml:4` (`description`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks (Task 3's CI consumes the repo as a whole).

- [ ] **Step 1: Widen the bundle targets**

In `src-tauri/tauri.conf.json`, change:

```json
    "targets": ["nsis"],
```

to:

```json
    "targets": ["nsis", "app", "dmg"],
```

(Tauri skips targets that don't apply to the host OS, so Windows still builds only the NSIS installer.)

- [ ] **Step 2: De-Windows the longDescription**

In `src-tauri/tauri.conf.json`, change the `longDescription` value from:

```
AgentPanel runs multiple AI coding agents in parallel, each isolated in its own git worktree with its own terminal — a native Windows command center.
```

to:

```
AgentPanel runs multiple AI coding agents in parallel, each isolated in its own git worktree with its own terminal — a cross-platform command center.
```

- [ ] **Step 3: Remove the Windows-only devDependencies from `package.json`**

Delete these two lines from `devDependencies`:

```json
    "@rollup/rollup-win32-x64-msvc": "^4.62.2",
    "@tauri-apps/cli-win32-x64-msvc": "^2.11.3",
```

Both carry `"os": ["win32"]` and break `npm install` on macOS with `EBADPLATFORM`. Their parents (`rollup`, `@tauri-apps/cli`) declare them as optional deps and auto-resolve the right per-platform binary.

- [ ] **Step 4: De-Windows the Cargo description**

In `src-tauri/Cargo.toml:4`, change:

```toml
description = "AgentPanel — a worktree command center for coding agents (Windows)"
```

to:

```toml
description = "AgentPanel — a worktree command center for coding agents"
```

- [ ] **Step 5: Verify Windows install + JSON validity still work**

Run (from repo root):

```bash
npm install
```

Expected: completes without error and `package-lock.json` updates to drop the two removed packages (or leaves them as transitive optional deps of rollup/tauri — both are acceptable). Then confirm the config files are valid JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('json ok')"
```

Expected: prints `json ok`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json package.json package-lock.json src-tauri/Cargo.toml
git commit -m "macOS: bundle dmg/app, fix npm install on macOS, neutral product copy"
```

---

### Task 3: GitHub Actions release workflow

Add a CI workflow that builds Windows + macOS bundles on a version-tag push and attaches them to a draft GitHub Release. This is also the first real compile of the `#[cfg(unix)]` code from Task 1.

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the repo (Tauri project at `src-tauri/`, frontend build via `npm run build` driven by `beforeBuildCommand`).
- Produces: a draft GitHub Release with `.nsis`/`.exe` (Windows) and `.dmg`/`.app` (macOS) artifacts.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/release.yml` with exactly:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: ""
          - platform: windows-latest
            args: ""

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: "./src-tauri -> target"

      - name: Install frontend dependencies
        run: npm ci

      - name: Build the app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "AgentPanel ${{ github.ref_name }}"
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Validate the workflow YAML**

Run (from repo root):

```bash
node -e "const f=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!/tauri-apps\/tauri-action/.test(f)||!/macos-latest/.test(f)||!/windows-latest/.test(f)) throw new Error('workflow missing required pieces'); console.log('workflow ok')"
```

Expected: prints `workflow ok`. (A `npm ci` step requires `package-lock.json` to be committed — it is, from Task 2 / the repo.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "macOS: add CI workflow building Windows + macOS bundles on tag"
```

- [ ] **Step 4: Note the real macOS verification path**

No local action. The macOS compile of the Task 1 `#[cfg(unix)]` code and the `.dmg`/`.app` bundling are verified the first time this workflow runs on a pushed `v*` tag (e.g. `git tag v0.2.1 && git push origin v0.2.1`). Do not claim the macOS build passes until that CI run is green. Pushing a tag is a user decision, not part of this plan's automated steps.

---

## Self-Review

**Spec coverage:**
- Spec §1 (Unix kill) → Task 1. ✓
- Spec §2 (libc dep) → Task 1, Step 1. ✓
- Spec §3 (bundle targets) → Task 2, Step 1. ✓
- Spec §4 (package.json un-pin) → Task 2, Step 3. ✓
- Spec §5 (CI workflow) → Task 3. ✓
- Spec §6 (cosmetic wording) → Task 2, Steps 2 & 4. ✓
- Spec "Verification" (cargo check on Windows; macOS via CI) → Task 1 Step 3, Task 3 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code/edit step shows exact content. ✓

**Type consistency:** `kill_process_tree(pid: u32)` signature identical across both `#[cfg]` arms and unchanged for callers. ✓

**Note on TDD:** This change is a platform syscall wrapper around real OS processes; a meaningful automated test would require spawning real subprocess trees on macOS, which cannot run on the Windows dev machine. Verification is therefore compile-check (Windows, local) plus the CI build (macOS) — stated honestly in the tasks rather than faked with a hollow unit test.
