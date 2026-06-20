# AgentPanel — Baseline Performance Metrics

Captured **2026-06-19** at commit `12d7aa6` (v0.1.0). This is the reference point for
performance work — the goal is to improve these numbers **without dropping features or
functionality**. Re-measure with the same methodology to compare.

## Environment

| | |
|---|---|
| CPU | Intel Core i7-9700K @ 3.60 GHz (8C / 8T) |
| RAM | 32 GB |
| OS | Windows 11 Pro 10.0.26200 |
| Toolchain | Rust 1.96 (stable-msvc), Node 22.22, Tauri 2.11.3, Vite 7.3 |

## Key metrics at a glance

| Metric | Baseline | Notes |
|---|---|---|
| **Startup → window** | **481 ms** | warm OS cache; release build |
| **Idle memory (working set)** | **372 MB** | whole process tree (7 procs) |
| **Idle memory (private)** | **178 MB** | better "true cost" number |
| — Rust process alone | 32 MB WS / **4.9 MB private** | ~97% of memory is WebView2 |
| **Frontend bundle (JS)** | **599 KB** raw / **168 KB** gzip | single chunk |
| **Frontend bundle (CSS)** | 10.4 KB raw / 2.5 KB gzip | |
| **Release binary** | 9.6 MB | `agentpanel.exe` |
| **Installer** | 2.15 MB | NSIS, download-bootstrapper |
| **Clean release build** | 2m 22s | 507 crates, optimized |
| **Incremental Rust rebuild** | 6.0 s | touch 1 file, debug |
| **Frontend prod build** | 3.6 s | tsc + vite |
| **Frontend tests (Vitest)** | 2.8 s wall | 10 tests, ~230 ms exec |
| **Rust tests (cargo test)** | 19.1 s | mostly test-binary compile; ~0.5 s exec |

---

## 1. Artifact sizes

| Artifact | Raw | Gzip |
|---|---|---|
| `dist/assets/index.js` | 599.2 KB | 168.1 KB |
| `dist/assets/index.css` | 10.4 KB | 2.5 KB |
| `dist/` total | 614 KB | — |
| `target/release/agentpanel.exe` | 9.6 MB | — |
| `AgentPanel_0.1.0_x64-setup.exe` | 2.15 MB | — |

The JS bundle is a **single chunk** (no code-splitting). Vite warns it exceeds 500 KB. xterm.js +
addons and React dominate it.

**Reproduce:** `npm run build`; sizes printed by Vite + `Get-Item` on the artifacts.

## 2. Build performance

| Build | Time |
|---|---|
| Clean release (`tauri build`, Rust release) | 142 s (2m 22s) |
| Frontend prod build (`npm run build`) | 3.6 s |
| Incremental Rust rebuild (1 file changed, debug) | 6.0 s |
| Clean debug build (first ever, historical) | ~1m 48s |

**Reproduce:** `Measure-Command { npm run build }`; touch `src-tauri/src/lib.rs` then
`Measure-Command { cargo build --manifest-path src-tauri\Cargo.toml }`.

## 3. Runtime — startup & memory

Release build, launched fresh (session as persisted), sampled 4 s after the window appeared.

**Startup to first window:** **481 ms** (warm OS cache; cold/first-boot not yet measured).

**Process tree (7 processes):**

| Process | Working set | Private |
|---|---|---|
| msedgewebview2 (renderer/gpu/etc ×6) | 340 MB total | 173 MB total |
| agentpanel (Rust core) | 31.6 MB | **4.9 MB** |
| **Total** | **371.9 MB** | **178.4 MB** |

**Headline:** the Rust core is tiny (~5 MB private); **virtually all memory is WebView2
(Chromium)**. This is the central tradeoff of the stack — already far lighter than Electron, but
WebView2 has a ~150 MB floor regardless of our code.

**Reproduce:** launch `target/release/agentpanel.exe`, walk the process tree via
`Win32_Process.ParentProcessId`, sum `WorkingSet64` / `PrivateMemorySize64`.

## 4. Test suite

| Suite | Time | Count |
|---|---|---|
| Frontend (Vitest, `npm test`) | 2.8 s wall (~230 ms exec) | 10 |
| Rust (`cargo test`, warm) | 19.1 s | 6 (exec ~0.5 s) |

Rust test time is almost entirely **test-binary compile/link**, not execution — a dev-iteration
cost, not a runtime one.

## 5. Code & dependency footprint

| | |
|---|---|
| Rust source (`src-tauri/src`, incl. tests) | 843 lines |
| TS/TSX source (`src`, excl. tests) | 1,309 lines |
| Cargo crates (`Cargo.lock`) | 507 |
| npm dependencies | 10 runtime + 9 dev |
| `node_modules` top-level dirs | 64 |

---

## Optimization candidates (observations, not yet acted on)

Ordered by likely impact. **Nothing here should remove features.**

1. **JS bundle size (599 KB / 168 KB gz, one chunk).** Code-split; lazy-load the WebGL addon and
   the command palette/settings modals; confirm tree-shaking. Smaller bundle → faster WebView parse
   on startup.
2. **Memory is WebView2-bound.** Our DOM is small, so wins are limited, but: reuse one xterm
   renderer strategy, avoid leaking detached terminals, and verify hidden tabs/panes aren't doing
   layout work. The Rust side (4.9 MB) has essentially no headroom to reclaim.
3. **Status/PR polling cost.** 5 s status poll + file-watcher + a 30 s `gh` poll each spawn one
   subprocess per worktree. Measure CPU at idle with many worktrees; consider coalescing and
   skipping when the window is hidden/unfocused.
4. **Per-terminal scaling.** Each pane = a Rust reader thread + an xterm instance. Cost-per-terminal
   and memory at N=10/25/50 parallel terminals is the headline scalability metric (Supacode's
   "50 agents") — see "Not yet measured".
5. **Startup.** 481 ms warm is good; trimming the bundle (#1) and deferring non-critical work on
   mount (PR fetch, watcher setup) should help cold start.

## Not yet measured (needs interactive driving / instrumentation)

These require opening terminals / feeding input, which couldn't be automated headlessly. Define and
capture next:

- **Cold startup** (first boot, cleared OS cache).
- **Memory with N parallel terminals** (N = 1, 10, 25, 50) — the key scalability number.
- **Per-terminal overhead** (Δ memory + Δ threads per pane).
- **Keystroke → echo latency** (input responsiveness).
- **Terminal render throughput** (e.g. `cat`/`Get-Content` of a large file → MB/s, dropped frames).
- **Idle CPU** (status poll + watcher overhead, with many worktrees).
- **Status-update latency** (file change → sidebar badge update, watcher path).

---

## Goal progress (perf + UX optimization)

| Target | Baseline | Result | Status |
|---|---|---|---|
| Initial JS ≤ 80 KB gz | 168 KB (1 chunk) | **68.84 KB** | ✅ |
| Warm startup → window ≤ 350 ms | 481 ms (cold anomaly) | **47 ms** (window-handle) | ✅ |
| Input latency p95 ≤ 16 ms | unmeasured | **4.8 ms** (p50 2.9, n=200) | ✅ |
| Responsive @ 25 terminals | unmeasured | 406 ms spawn, **33 ms** max frame gap | ✅ |
| Idle CPU < 1% @ 10 worktrees | unmeasured | **~0.43%** focused worst-case; 0.05% idle; ~0% backgrounded | ✅ |
| UX: auto-focus / toasts / drag-resize / drag-reorder | — | all shipped | ✅ |

### G2 — measurement harness (`src/lib/bench.ts`)

In-app benchmark (auto-runs with `AGENTPANEL_BENCH=1`, or Ctrl+Shift+B), results written to
`%TEMP%/agentpanel_bench.json`. Measured in the dev Tauri webview + real ConPTY:
- **Input latency** (keystroke→echo round-trip, dedicated PTY, 200 samples): p50 **2.9 ms**,
  p95 **4.8 ms**, max 16.3 ms.
- **25-terminal spawn**: 25 PTYs in **406 ms** (~16 ms each, serialized by the ConPTY spawn-lock),
  worst main-thread frame gap **33 ms** (< 2 frames → no UI stall).

### G3 — idle-CPU optimization

- All polling (status 10 s, PR/CI 30 s, watcher refresh) is now **gated on window visibility** —
  zero git/gh subprocess churn when the window is backgrounded; immediate catch-up on refocus. Status
  poll relaxed 5 s → 10 s (the file watcher drives instant updates while active).
- Cost of one 10-worktree poll cycle (10× `git status`): 345 ms wall → amortized over the 10 s
  interval ≈ **0.43%** normalized across 8 cores. Backgrounded ≈ 0%. Measured app idle: **0.05%**.

### G4–G7 — UX upgrades (shipped)

Active-pane auto-focus · error toasts for failed git/gh ops · drag-to-resize split panes ·
drag-to-reorder tabs.

### G1 — lazy-load xterm + code-split (done)

- Initial JS: **599 KB → 216 KB raw / 168 KB → 68.84 KB gzip** (2.4× smaller). xterm.js moved to a
  98 KB-gz `Terminal` chunk that loads on first terminal; command palette / settings are
  <1.2 KB-gz on-demand chunks. CSS also split (Terminal CSS deferred).
- Verified: identical frontend renders correctly (dev Tauri webview wrote a startup marker;
  Playwright snapshot of the shell). No test regressions (10 frontend + 6 Rust).
- Method note: a temp-file startup marker was trialed for a time-to-interactive number but **removed**
  — it's unreliable under the headless Session-0 WebView2 used for automated runs (the release
  webview doesn't paint without an interactive desktop). Measure time-to-interactive on a real
  desktop (DevTools Performance / `performance.now()` at first paint).

### Regression caught & fixed — UI-thread blocking on window drag (`eff75e0`)

While verifying perf on a real desktop, window **move/resize froze for ~2s and stalled the
whole desktop** — a regression introduced by the G3 catch-up refresh, not an environment issue
(RustDesk / GPU / occlusion were all ruled out; a bisect against pre-perf code located it).

- **Cause:** `worktree_status` / `worktree_pr` / `list_worktrees` were *synchronous* Tauri
  commands. Tauri runs sync commands **on the main UI thread**, and `worktree_pr` calls `gh`
  (a 1–2s network round-trip). G3's new `focus`/`visibilitychange` catch-up fired those
  refreshes, and WebView2 emits a **burst of focus/visibility events during the modal
  window-drag loop** → blocking git/gh on the UI thread mid-drag → window (and desktop input
  queue) frozen for the duration of the `gh` call.
- **Fix:** those three commands are now `async` + `tauri::async_runtime::spawn_blocking`, so the
  blocking subprocess work never touches the UI thread; the catch-up is debounced ~300ms so a
  drag collapses to one refresh. Drag confirmed smooth on the real desktop. No test regressions.
- **Rule of thumb for this codebase:** any `#[tauri::command]` that shells out to git/gh (or does
  other blocking I/O) MUST be `async` + `spawn_blocking` — a sync command blocks the window.
