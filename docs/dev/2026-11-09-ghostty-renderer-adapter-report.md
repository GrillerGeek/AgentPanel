# Terminal renderer adapter implementation

xterm remains the production renderer. `TerminalPane` now depends on a library-independent
[renderer contract](../../src/lib/terminalRenderer/types.ts), with xterm addons owned by its
[synchronous adapter](../../src/lib/terminalRenderer/xtermRenderer.ts). The asynchronous
[Ghostty adapter](../../src/lib/terminalRenderer/ghosttyRenderer.ts) is imported only by the
isolated experimental harness. This is a bounded implementation of the
[implementation plan](2026-11-09-ghostty-renderer-adapter-plan.md), not a default-switch decision.
The [November 7 spike](2026-11-07-ghostty-feasibility-spike.md) remains historical evidence.

## Implemented behavior

The shared interface owns parsed-write completion, idle, dimensions, fit/resize, focus/paste,
input/title/error subscriptions, normalized key handling (false suppresses), selection,
search, styled history, appearance, visibility and disposal. No library objects or addons
cross it. `TerminalPane` retains transport and lifecycle ownership: single paste pipeline,
right-button guard, restore-before-spawn, ANSI capture, live font/theme, no 0×0 fit,
visible-only WebGL, reconnect and initial-command rules. Restore now explicitly awaits parsed
writes before registering capture or spawning. Unsupported history is never registered or
saved as empty/plain text. Fatal renderer errors detach the attachment, including errors
emitted before `openTerminal()` resolves; no replacement shell is created.

Ghostty loads pinned `ghostty-web@0.4.0` from an explicit WASM URL through a shared retryable
promise. Its write queue retains at most 1 MiB and 4,096 chunk records. Inputs are copied into
owned bounded buffers; obviously oversized strings are rejected before encoding. Each ordinary
`setTimeout` turn parses at most 64 KiB in 16 KiB slices, or yields after approximately 4 ms.
A single synchronous WASM call cannot be preempted; the time budget is checked between slices.
Each original chunk is acknowledged once after its last slice parses, with no rAF callback.
Overflow/parser failure stops ingestion, frees queued bytes, rejects idle and emits a fatal
error. Disposal cancels pending tasks and callbacks. Hidden panes keep bounded parsing;
Ghostty's public API provides no render-suspension mechanism.

A bounded 4 KiB streaming parser emits OSC 0/2 titles from the original bytes, including
split UTF-8, BEL and ST. DCS/SOS/PM/APC payloads are opaque. Ghostty's own title event is
not subscribed, preventing duplicate events. Original data still goes unchanged to the parser.
Text extraction uses public `wasmTerm` grapheme APIs for both screen and scrollback, preserves
spaces and wide-cell continuations, and maps UTF-16 offsets to cell positions. Extraction is
bounded to two million cells; it is diagnostic/search data, never persistence.

## Capability gates

| Operation | xterm adapter | Ghostty adapter |
| --- | --- | --- |
| Raw bytes, ANSI/alternate screen, dimensions, input/paste | Existing behavior retained | Supported by the controlled adapter probes and transport checks |
| Titles from bytes and chunk splits | Existing xterm event behavior | Streaming OSC bridge; exact single emission |
| Full emoji graphemes in diagnostic extraction | Existing facade has a stricter newly exposed ZWJ gap | Public full-cluster APIs used for screen and scrollback |
| Selection/copy | Existing xterm API | Limited: copies unambiguous interior active selections using public viewport endpoints mapped to absolute rows |
| Programmatic selection after resize | Existing xterm API | Explicitly unsupported: public `select()` clamps to viewport rows and constructs inconsistent coordinates |
| One-cell/edge/offscreen copy | Existing xterm API | Unsupported: identical endpoints also mean ordinary click; public endpoints clip at viewport boundaries or disappear offscreen |
| Search | Existing SearchAddon | Limited literal forward/backward Unicode search with cell mapping and wrap; no reliable public navigation/highlight presentation |
| Styled ANSI history/replay | Existing SerializeAddon and on-disk format | Unsupported; never substituted with plain text |
| Live font/theme | Supported, no new renderer/attachment | Public options updates |
| Hidden-pane rendering | WebGL detaches; not a total render pause | Unsupported render suspension; parsing remains task-budgeted |

The public selection positions come from `normalizeSelection()`, which explicitly returns
viewport coordinates clipped to visible rows. Fully offscreen endpoints disappear. The wrapper's
`hasSelection()` also treats identical endpoints as no selection; the same public state occurs
on an ordinary click. The adapter neither invents endpoints nor accesses private fields.
Edge/fractional-scroll selections return an explicit unsupported result. Full mouse selection,
one-cell copy and clear behavior remain acceptance gates.

Styled history cannot be faithfully reconstructed from the pinned public API: default/palette
versus RGB color provenance, scrollback wrapping, the inactive normal buffer while in alternate
screen, overline and hyperlink URIs are missing. No xterm addon is loaded into Ghostty, no shadow
xterm is maintained, and no unbounded raw-output log is retained.

## Current validation

- `NODE_OPTIONS=--no-webstorage npm test`: 302 tests passed, including 31 new renderer/lifecycle
  tests. The flag avoids the local Node 25/jsdom web-storage issue.
- `npx tsc --noEmit` and `npm run build`: passed. Production assets contain no Ghostty/WASM;
  the production module graph never imports the experimental adapter.
- `node --test scripts/test-updater-release.mjs`: 3 passed after synchronizing installed
  dependencies with the lockfile (parent verification).
- Rust: 74 unit and 1 updater integration tests passed, 4 live tests intentionally ignored
  (parent verification). The integration test first hit sandbox localhost `EPERM`, then passed
  with the same test outside that restriction.

Focused coverage includes queue FIFO/ownership/slices/budgets/metadata cap/overflow/errors/
disposal and exact acknowledgements; every OSC byte split, UTF-8, BEL/ST, oversized/incomplete
and opaque controls; full grapheme/space/wide-cell mappings; forward/backward wrap; honest
selection/search/history status; xterm clipboard hooks, title/input, serialization,
appearance/WebGL/0×0 fit and disposal; and production restore ordering, unsupported capture,
no reconnect on appearance, original output callbacks and failure-before-open detachment.

The stricter one-byte Unicode fixture exposed inherited xterm behavior: `👩🏽‍💻` is extracted
as `👩🏽💻`, including a title event. The harness now records exact expected/raw/adapter
screen and title output in `xtermUnicodeBaseline`; equality characterizes inheritance and
does not turn strict compatibility failures into passes. Ghostty's corresponding fixture
retains the full cluster. The old 15 raw probes remain separate from the new adapter checks.

Chromium adapter probes: Ghostty **7 pass, 3 unsupported, 0 fail**; xterm **7 pass,
3 fail** on the stricter ZWJ fixture and its consequent alternate-screen text comparison.
The exact raw/adapter xterm screen and title outputs match (`adapterMatchesRaw: true`);
those inherited failures remain visible. The browser console reported no errors. Evidence:
[Chromium adapter report](runtime-spike/2026-11-09-ghostty-adapter-chromium.json).

Native Tauri/WebKit execution passed **15 transport cases**: the nine historical raw-engine
cases and six new adapter cases (xterm and Ghostty across local PTY, local Herdr and SSH
Herdr). Adapter output uses each original `write(data, consumed)` callback, not a global-idle
proxy. All cases passed credit accounting, output beyond initial credit, actual resize and
same-PID reattach where applicable. Independent checks verified all 15 process outcomes before
cleanup; the disposable SSH fixture and core cleaned up. All eight adapter benchmark samples
retained their final line. Evidence:
[native adapter report and cleanup](runtime-spike/2026-11-09-ghostty-adapter-native.json).

Native compatibility matched Chromium: Ghostty **7 pass, 3 unsupported, 0 fail**; xterm
**7 pass, 3 inherited strict Unicode failures**, with raw/adapter equality confirmed. Native
adapter-only warm medians were **69.5 ms xterm** and **58.5 ms Ghostty** across four alternating
samples each. These timings include a synthetic emulator workload, bounded queue scheduling,
a 64 KiB credit window and two final frames; they establish neither universal speedup nor
real-agent latency. The historical and new benchmark payloads differ, so their timings must
not be compared as the same workload.

A successful fixture execution is not candidate acceptance. Adapter checks use fresh instances
so preceding transport floods cannot contaminate compatibility via wrapper reset/history
semantics.

The final isolated native build also passed `npm run build:ghostty-spike`. Its combined
React/two-engine/legacy-and-adapter harness JavaScript is **1,300,186 bytes** (**365,317 gzip**),
plus a **423,045-byte WASM** asset (**123,975 gzip**) and 3,778-byte CSS. Those are experimental
bundle costs, not a production migration estimate. The normal build was separately inspected:
16 emitted files, 10 JavaScript files, no Ghostty/WASM filenames or Ghostty package markers.
The embedded base64 fallback still duplicates the WASM payload; removing it remains a gate.

## Reproduce and remaining gates

Use `npm run dev:ghostty-spike`, then “Run adapter capability probes” or “Run adapter benchmark”.
Those normal experimental controls use only adapters and compatible addons. Historical raw
addon-failure probes run separately after transport/benchmark cases in native acceptance.
The native runner additionally exercises six adapter cases across local PTY, local Herdr and
SSH Herdr with per-original-chunk credits, alongside the nine historical raw engine cases.
It checks flood output beyond initial credit, actual PTY resize, same-PID detach/reattach,
independent process state and fixture cleanup. It never provisions real hosts or calls agents.

Keep Ghostty experimental until manual native Codex/Claude full-screen and permission flows,
physical keyboard/IME, clipboard/right-click/accessibility, hidden/visible transitions,
outage/sleep/multiple sessions, Linux/Windows ConPTY, full selection/search, faithful styled
history and packaging have passed. The package still embeds a base64 WASM fallback in addition
to the explicit WASM asset. No default change, release or broad performance claim follows from
this work. Synthetic emulator timings are not real-agent latency or parser-only throughput.
