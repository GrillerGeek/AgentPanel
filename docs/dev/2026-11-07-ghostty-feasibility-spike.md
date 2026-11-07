# Ghostty terminal feasibility spike

## Recommendation

Proceed with a bounded renderer-adapter project before expanding terminal layouts. Keep
xterm.js as the product default until the adapter restores feature parity and passes manual
agent/platform acceptance. The existing PTY and Herdr transports can carry Ghostty terminals;
rebuilding process persistence or SSH routing is unnecessary for this route.

This spike evaluates **ghostty-web 0.4.0**, Coder's Canvas/WebAssembly integration, against
**xterm.js 5.5.0 with WebGL**. It does not evaluate a native Ghostty GPU surface or every
version of libghostty. Results for this wrapper must not be generalized to the underlying
Ghostty project. No production renderer or terminal preference has changed.

## Candidate and isolation

- Published package: `ghostty-web@0.4.0`, MIT, npm source revision
  [`9e4e126`](https://github.com/coder/ghostty-web/tree/9e4e126d89ac3537d2b2ebec075849851566de9f).
  The exact npm archive integrity is pinned in `package-lock.json`.
- Separate [HTML entry](../../ghostty-spike.html), [Vite configuration](../../vite.ghostty.config.ts),
  [spike implementation](../../src/spikes/ghostty/GhosttySpike.tsx), and
  [native profile](../../src-tauri/tauri.ghostty-spike.conf.json).
- Normal `npm run build` imports no spike module and emits no Ghostty/WASM assets.
  The candidate is a development dependency. The spike uses the existing
  [`openTerminal`](../../src/lib/terminalRuntime.ts) transport, without changing it.
- Native checks use `com.jason.agentpanel.ghostty-spike`, scratch directories, a dedicated
  core, and two disposable Linux SSH guests. Normal app preferences, real repositories,
  existing SSH keys/hosts, and paid agent calls are not used.
- Automated native execution requires both an explicit `auto=1` URL and
  `AGENTPANEL_BENCH=1`. Opening the manual spike profile does not start programs automatically.

Native building exposed an existing version mismatch on main: locked Rust Tauri 2.12.5 and
updater 2.14.1 were paired with JavaScript API 2.11.1 and updater 2.10.1. This branch aligns
the two JavaScript lock entries to API 2.12.4 and updater 2.14.1 within the existing manifest
ranges. The native build then passed the version check without suppressing it. No Rust
lockfile, production terminal renderer, or default runtime was changed for the experiment.

## Transport and persistence results

All **nine** automated native Tauri/WebKit cases passed: xterm with its existing callback,
Ghostty with its library callback, and Ghostty with experimental parse-return consumption,
each over Local PTY, local Herdr, and SSH Herdr.

Each case opened a real shell, sent input through the emulator's paste/onData path, received
raw bytes, read the resulting PID from the emulator buffer, streamed at least 300 KiB beyond
the initial Herdr credit window, accounted for every consumed byte, and resized the actual
PTY to 37×101. Herdr cases detached and reattached without creating a replacement; each
returned the original shell PID. Independent core queries confirmed those programs remained
live after detach, then fixture cleanup stopped them. Local PTY PIDs were independently
absent after disposal. Both SSH guests, the core, and ephemeral SSH material were cleaned up
before the runner published success.

The parent SSH fixture also tests transport interruption/recovery and independent host
health. Ghostty's own cases here test detach/reattach; they do not establish its behavior
through an interactive WAN outage or host sleep.

Evidence: [native results, PID checks, cleanup, and SSH fixture result](runtime-spike/2026-11-07-ghostty-native.json).

## Compatibility results

The same 15 probes ran in Chromium and native WebKit. xterm passed **15/15**; Ghostty passed
**9/15**. These are compatibility findings, not an assertion that the candidate is ready.

| Capability | Result and migration work |
| --- | --- |
| Split UTF-8 bytes, ANSI colors, alternate screen entry/exit, normal-screen restoration | Both passed the controlled fixtures. |
| Bracketed paste, terminal status response, dimensions, scrollback retention | Both passed. The paste probe emitted exactly one bracketed payload. |
| Titles from raw bytes | Ghostty emitted no title event; AgentPanel supplies raw byte chunks. Add a streaming title bridge or use a corrected upstream wrapper. |
| Title sequence split across chunks | Ghostty missed the event even with strings. Decoding bytes to strings alone would not fix this. |
| Existing SearchAddon | Ghostty failed because `onWriteParsed` is absent. Implement compatible search or expose Ghostty's appropriate search surface. |
| Existing SerializeAddon | Ghostty failed because a cell lacks `isOverline`. Preserve styled history/replay through a supported serialization contract; plain text is insufficient. |
| Programmatic selection after resize | Ghostty returned an empty string in this fixture. Investigate coordinate/render-state semantics and verify copy behavior before migration. This does not establish that every mouse selection is broken. |
| Emoji grapheme buffer extraction | Ghostty's buffer facade returned the base woman codepoint rather than the full skin-tone/ZWJ/laptop sequence. Its visual rendering appeared more coherent in the captured Chromium fixture, so rendering and text extraction need separate checks. |

A further source-level difference is already adapted in the spike: xterm's custom key hook
returns false to suppress processing, while ghostty-web 0.4.0 treats true as handled. The
existing clipboard helper therefore needs an inverted return value. This is not an assertion
that native keyboard, physical IME, or clipboard interaction has passed manual acceptance.

One exploratory benchmark following incompatible add-on probes reported a WASM memory access
error. Clean-page benchmarks and the isolated native runs passed. Its cause is unresolved;
unsupported add-ons must not be loaded into production as a compatibility shortcut.

Evidence: [Chromium probe output](runtime-spike/2026-11-07-ghostty-chromium-compatibility.json),
[native probe output](runtime-spike/2026-11-07-ghostty-native.json), and
[controlled visual fixture](runtime-spike/2026-11-07-ghostty-controlled-fixture.png).
The pictured approval menu is synthetic and did not request a real tool action.

## Performance results

Median completion times below cover four alternating rounds per case on one macOS 27.0.1
Apple Silicon host. The workload is 816,000 bytes of colored build-like output, 80×24 cells,
2,000 scrollback lines, 16 KiB chunks, a 64 KiB consumed-callback window, warmup, and two final
animation frames. Comparison surfaces are disposed before samples, leaving one measured
emulator active. Detailed sample timings, timer delays, user agents, and parameters are in
the linked JSON.

| Engine and consumption policy | Chromium 155 median | Native WebKit median |
| --- | ---: | ---: |
| xterm WebGL, existing write callback | 65.8 ms | 76.0 ms |
| Ghostty Canvas, library write callback | 124.3 ms | 250.0 ms |
| Ghostty Canvas, experimental parse-return acknowledgement | 12.8 ms | 27.5 ms |

The pinned wrapper parses synchronously inside `write()` but schedules its optional callback
through `requestAnimationFrame`. Returning runtime credits through that callback couples input
throughput to frame scheduling. The experimental adapter acknowledges after synchronous
parsing returns. It improved this workload and passed the actual PTY/Herdr/SSH credit tests;
it is confined to the spike. A production adapter still needs explicit processing budgets,
queue limits, hidden-pane behavior, and slow-viewer tests.

These are emulator integration timings, **not parser-only benchmarks, real-agent response
time, SSH throughput, cold startup, fleet-scale latency, or a universal performance claim**.
The benchmark includes different renderers and callback policies. WASM/native/GPU memory,
10/25/50-session performance, physical keyboard latency, and platform-wide stability remain
unmeasured. Initial factory timings are warm-state observations and should not be treated as
cold launch comparisons.

Evidence: [Chromium timings](runtime-spike/2026-11-07-ghostty-chromium-benchmark.json) and
[native timings](runtime-spike/2026-11-07-ghostty-native.json).

## Packaging and acceptance limits

The pinned package includes a 423,045-byte WASM file and an identical base64-embedded fallback
inside its JavaScript. The isolated combined benchmark bundle is about 1.28 MB JavaScript
plus that WASM, before compression, and includes React, both terminal engines, and the
harness. It is not a production migration-size estimate. A migration should remove the
unused embedded fallback or choose a distribution that avoids shipping it twice. The normal
AgentPanel build contains neither asset.

Native UI automation could not start: the computer-use service returned
`Sky Computer Use native pipe startup failed` twice. Native results therefore come from an
automated real Tauri/WebKit → IPC → Rust → PTY/core/SSH test, not manual desktop interaction.
The browser fixture was visually inspected through Playwright. Real Codex/Claude approval
screens, physical IME and keyboard shortcuts, right-click clipboard behavior, accessibility,
native Linux/Windows rendering, and Windows ConPTY acceptance are still open. No claims from
the earlier xterm-based agent walkthroughs transfer automatically to Ghostty.

## Validation

The normal frontend suite passed **271 tests**, and the regular Rust suite passed **74 tests**
with four live tests intentionally ignored there. The explicit SSH runner and the native
spike supplied the transport evidence above. Normal frontend build, isolated spike build,
and native macOS debug bundle passed. Report links and whitespace checks passed. CI now
builds the separate spike bundle alongside ordinary application checks on each platform;
that does not count as native Linux/Windows rendering acceptance.

## Reproduce

Install the repository's pinned dependencies with `npm ci`. For browser-only probes:

```sh
npm run dev:ghostty-spike
# Open http://127.0.0.1:1422/ghostty-spike.html
```

Run compatibility probes, inspect the displayed JSON, then **reload before benchmarking**.
The benchmark disposes interactive emulators; reload again before connecting a runtime.
Browser controls cannot open PTYs; connection controls require the native Tauri build and an
existing scratch directory. The manual profile can be built separately:

```sh
npm run tauri build -- --debug --bundles app --config src-tauri/tauri.ghostty-spike.conf.json
```

For reproducible macOS native transport/benchmark acceptance, prepare Tauri prerequisites,
Docker/OpenSSH, and a separately downloaded, checksum-verified official hc 0.1.16 executable.
The runner does not install core or alter real SSH configuration. Cache Rust dependencies
first, then run one native benchmark instance at a time:

```sh
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
python3 scripts/spikes/run_ghostty_native.py /absolute/path/to/herdr-core /private/tmp/ghostty-results.json
```

The runner builds a separate test profile, checks nine real transports and twelve benchmark
samples, independently verifies program continuity, cleans its fixtures, and writes the
report only after cleanup. Compatibility failures remain visible in that successful execution
report; they are not converted into passing candidate acceptance. Native auto execution needs
both its nonce-bearing URL and the benchmark environment flag. Existing temporary benchmark
output is restored after collection.

## Next implementation gate

1. Define a renderer interface around byte ingestion/consumption, input, resize, selection,
   title events, search, and styled history. Keep the current xterm implementation available.
2. Build a Ghostty adapter that resolves the six probe failures, preserves clipboard semantics,
   and gives the fast acknowledgement path bounded processing and memory behavior.
3. Verify actual Codex/Claude full-screen and permission flows, shortcuts, physical IME,
   detach/reconnect, and visible/hidden panes in the native platform matrix.
4. Measure multiple active/background sessions and packaging costs. Enable Ghostty optionally
   only after feature parity; make a default change a separate reviewed decision.

The spike supports starting this bounded migration work now. It does not justify replacing
xterm immediately or postponing every other roadmap item until Ghostty is finished. Public
API and durable task design can continue against the existing runtime boundary.
