# Intel (x86_64) macOS Builds — Design

**Date:** 2026-07-27
**Issue:** none — raised directly
**Status:** Approved

## Problem

AgentPanel ships no build that runs on Intel Macs. The v0.5.1 release contains
`AgentPanel_0.5.1_aarch64.dmg` and nothing else for macOS, so an Intel user has
nothing to download.

This was never a deliberate choice. `release.yml` targets the `macos-latest`
runner label, which GitHub repointed to Apple Silicon hardware; the runner
picked the architecture, not us.

A second, sharper problem sits behind the first. The updater client builds its
manifest lookup key as `{os}-{arch}` and looks it up in `latest.json`'s
`platforms` map — see `tauri-plugin-updater-2.10.1/src/updater.rs:578-597`.
There is **no `darwin-universal` fallback in the client**. The live manifest
today carries `darwin-aarch64`, `darwin-aarch64-app`, `windows-x86_64` and
`windows-x86_64-nsis`. An Intel Mac would ask for `darwin-x86_64`, miss, and
fail with `TargetNotFound` — so even a sideloaded Intel build could never
auto-update.

## Decision summary

- **Two separate macOS artifacts** (Apple Silicon `.dmg` + Intel `.dmg`), not a
  universal binary. The two legs build in parallel so wall-clock barely moves,
  the updater platform keys fall out of Tauri's own artifact naming with no
  manual `latest.json` surgery, and the existing working arm64 path is left
  untouched.
- **Universal binary rejected.** It compiles both slices sequentially on one
  runner (~2x Mac build time), roughly doubles binary size, and — given the
  client has no `darwin-universal` fallback — risks emitting a manifest that
  breaks auto-update for *every* Mac user, arm64 included. That is a regression
  on a currently-working path in exchange for one fewer download link.
- **No application code changes.** A grep for `target_arch` / `aarch64` /
  `x86_64` across `src/`, `src-tauri/src/` and `Cargo.toml` returns zero hits.
  The only `cfg` gates in the tree are `cfg(windows)` (winreg) and `cfg(unix)`
  (libc `SIGKILL`) — OS gates, not CPU gates. This is a build-and-distribution
  change, not a port.
- **The dependency graph cross-compiles as-is.** `portable-pty`, `notify`,
  `libc` and `regex` are pure Rust; `sentry`/`reqwest` use `native-tls`, which
  on macOS binds the system Security.framework rather than OpenSSL, so there is
  no C library to cross-build.

## Components

### 1. Build matrix (`.github/workflows/release.yml`)

Add one matrix entry, leaving the existing arm64 leg byte-for-byte unchanged so
the currently-working path cannot regress:

```yaml
- platform: macos-latest
  args: ""                              # arm64, unchanged
- platform: macos-latest
  args: "--target x86_64-apple-darwin"  # new
  rust-target: "x86_64-apple-darwin"
```

The `args` field already exists on every matrix entry (currently `""` for both
platforms) and is already threaded to `tauri-action`'s `args:` input, so no new
plumbing is needed for it.

Two supporting changes:

- **Toolchain:** pass `targets: ${{ matrix.rust-target }}` to the
  `dtolnay/rust-toolchain` step so the x86_64 std lib is installed. Legs
  without a `rust-target` pass an empty string, which is safe: the action's
  implementation is `for t in ${targets//,/ }; do echo -n ' --target' $t; done`,
  so an empty value yields zero iterations and adds no flag. Verified against
  the action source — no conditional guard is needed.
- **Cache:** give `swatinem/rust-cache` a per-leg `key` (e.g. keyed on
  `matrix.args`). Both macOS legs share a job id and runner OS, so without this
  they collide on one cache entry and thrash it.

Artifact name is `AgentPanel_<version>_x64.dmg`. No collision with the Windows
`AgentPanel_<version>_x64-setup.exe` — different extension.

Signing and notarization need no changes: one Developer ID cert covers both
slices. The cost is paying the notary queue twice.

### 2. Updater manifest verification

Three jobs now merge into a single `latest.json`. The merge demonstrably works
(v0.5.1's manifest contains both `darwin-aarch64` and `windows-x86_64` from
separate jobs), but two macOS jobs finishing near-simultaneously raises the race
risk over the current two-job layout.

Add a `verify-manifest` job with `needs: build` that downloads `latest.json`
from the draft release and asserts all three platform keys are present:

- `darwin-aarch64`
- `darwin-x86_64`
- `windows-x86_64`

Fail the job loudly if any is missing. Because releases are published manually
from a draft, this turns a silent bad release into a red X before any user can
download it.

### 3. Documentation

- `README.md:26` — "macOS 11+ (Apple Silicon)" becomes "macOS 11+ (Apple
  Silicon or Intel)".
- `README.md:38` — the single `aarch64.dmg` bullet becomes two bullets naming
  both DMGs, with a one-line hint on which to pick.
- `docs/dev/` release checklist — add the extra artifact to the expected
  release output.

## Error handling

The only new runtime failure mode is a user downloading the wrong DMG. The
failure is asymmetric and acceptable in both directions: an arm64 app on an
Intel Mac refuses to launch with a clear macOS error, and an Intel app on an
Apple Silicon Mac runs correctly under Rosetta 2, just slower. Neither
corrupts state. The README hint is the mitigation.

Build-time failures (missing Rust target, cache collision, absent manifest key)
all surface as red CI jobs before publication.

## Testing

No unit tests apply — no application code changes. Verification is:

1. CI produces both `AgentPanel_<version>_aarch64.dmg` and
   `AgentPanel_<version>_x64.dmg`.
2. Both macOS jobs log notarization **Accepted**. This log line is the real
   check — `tauri-action` exits green even when signing silently no-ops, so job
   success alone proves nothing.
3. `verify-manifest` passes, i.e. `latest.json` carries all three platform keys.
4. Manual smoke test of the Intel `.dmg` on Apple Silicon under Rosetta 2:
   launch from Finder (**not** a terminal), spawn a shell, confirm colored
   output. Launching from Finder is what exercises the bare `launchd`
   environment — the bug class behind both the login-shell PATH import and the
   v0.3.2 `TERM`/`COLORTERM` seeding fix.

## Out of scope

- Universal binaries.
- Any change to Rust or TypeScript source.
- Any `MACOSX_DEPLOYMENT_TARGET` change — Tauri's default already covers every
  Intel Mac ever shipped.
- Intel CI smoke tests on a GitHub-hosted Intel runner. Rosetta 2 on the
  maintainer's Apple Silicon hardware covers the same ground without depending
  on a runner label that is being retired.
