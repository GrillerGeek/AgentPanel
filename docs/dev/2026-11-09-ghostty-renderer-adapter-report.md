# Terminal renderer adapter implementation

xterm remains the production renderer. `TerminalPane` now depends on a library-independent
[renderer contract](../../src/lib/terminalRenderer/types.ts), with xterm addons owned by its
[synchronous adapter](../../src/lib/terminalRenderer/xtermRenderer.ts). The asynchronous
[Ghostty adapter](../../src/lib/terminalRenderer/ghosttyRenderer.ts) is imported only by the
isolated experimental harness. This is a bounded implementation of the
[implementation plan](2026-11-09-ghostty-renderer-adapter-plan.md), not a default-switch decision.
The [November 7 spike](2026-11-07-ghostty-feasibility-spike.md) remains historical evidence.
The current increment adds owned selection and visible literal search using public APIs;
xterm remains the default, and styled Ghostty history remains unsupported.

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
| Selection/copy | Existing xterm API | Owned exclusive absolute ranges, full graphemes, mouse drag and visible overlay; broad capability limited by physical-row semantics and output invalidation |
| Programmatic selection after resize | Existing xterm API | Owned ranges support new selections after resize; grid changes invalidate the previous range |
| One-cell/edge/offscreen copy | Existing xterm API | Nonempty exclusive ranges copy retained text, including scrollback; an ordinary click leaves no selection |
| Search | Existing SearchAddon | Literal physical-row search supports next/previous/wrap, scroll navigation and owned highlight; individual presentation reports supported only with visible geometry |
| Styled ANSI history/replay | Existing SerializeAddon and on-disk format | Unsupported; never substituted with plain text |
| Live font/theme | Supported, no new renderer/attachment | Public options updates |
| Hidden-pane rendering | WebGL detaches; not a total render pause | Unsupported render suspension; parsing remains task-budgeted |

The adapter now owns endpoints and highlight rectangles in
[`ghosttySelection.ts`](../../src/lib/terminalRenderer/ghosttySelection.ts), rather than relying
on the wrapper's clipped `getSelectionPosition()` or defective `select()` coordinates. The
shared range uses exclusive ends. Normalization reads at most two public endpoint rows and
snaps intersected wide cells to complete graphemes. Copy preserves interior spaces and complete
clusters and trims terminal padding at physical row ends; it does not join soft-wrapped rows.
The owned state contains only endpoints/origin and visible rectangles, never a history snapshot.

The overlay is noninteractive, contains no text, and draws only visible complete cell rectangles.
It updates on public scroll, fit, resize, font/appearance and visibility changes. Navigation uses
the pinned wrapper's actual distance-from-bottom `scrollToLine()` semantics, and deterministic
scrolling disables smooth interpolation. Search sets a real owned range, reveals its row and
checks visible geometry. Hidden, clipped or zero-sized presentation is explicitly unsupported.
Clearing or missing a search removes its highlight while preserving a later manual selection.

Ordinary left drags are captured after the wrapper's scrollbar handler, preventing its canvas
selection/autocopy path from starting. Document move/up listeners and bounded 50 ms/two-row
edge-scroll tasks exist only during a drag and are cleaned up on release, cancellation, blur,
hiding, mutation and disposal. Right/context clicks, modified links, wheel and scrollbar
handling remain separate. Shift overrides tracking for owned selection. Unmodified tracking
mode passes through to the wrapper; its native selection/autocopy behavior remains a manual
acceptance limit. Double-click word selection is not implemented; its wrapper handler is
suppressed for owned gestures to avoid a second clipboard path.

Every parsed output slice, reset and actual grid change invalidates ranges/search offsets
because the public API has no buffer generation, eviction identity or stable line anchors.
This prevents stale/alternate-screen text copy; selection is intentionally not preserved while
output or reflow changes the buffer. No-selection output skips geometry work entirely.
Broad selection/search capabilities remain `limited` for these semantics even when individual
owned `select()` and visible literal `search()` operations return `supported`.

Styled history cannot be faithfully reconstructed from the pinned public API: default/palette
versus RGB color provenance, scrollback wrapping, the inactive normal buffer while in alternate
screen, overline and hyperlink URIs are missing. No xterm addon is loaded into Ghostty, no shadow
xterm is maintained, and no unbounded raw-output log is retained.

## Selection and visible search increment validation

- `NODE_OPTIONS=--no-webstorage npm test`: **319 tests passed** across 51 files.
- `npx tsc --noEmit`, `npm run build` and `npm run build:ghostty-spike`: passed.
- The new controller tests cover exclusive/one-cell/click/reversed/wide endpoints, bounded
  endpoint reads, clipped/visible row geometry, distance-from-bottom navigation, scroll/font
  geometry, visibility, drag ownership, tracking override, modified/right events, earlier
  scrollbar capture, wheel, bounded autoscroll, blur/mutation/disposal cleanup and search origin.
- Adapter tests cover actual selected text, hidden/zero-sized presentation, output/reset/grid
  invalidation, new selection after resize and preservation of a later manual range on clear
  or no-match. A 100 KiB no-selection output test performs no Canvas geometry reads.
- The isolated harness adds eight selection/search/paint checks and strengthens the original search
  check with actual selected text, owned cell coordinates and nonzero DOM rectangle geometry.
  Interactive controls load 120 controlled Unicode/scrollback rows and expose query, next,
  previous, clear and selection inspection. They are disabled while connected/busy. Interactive
  panes fit their visible bounds; benchmark factories retain their fixed dimensions.

Interactive Chromium checks used real browser input: an interior drag copied `fixtur`
from absolute row 2, columns 0–6; an ordinary click left empty text/no range. Wheel scrolling
moved viewport top 0→32, and a scrollbar-gutter click moved 32→93 without an owned selection.
Edge autoscroll reached top 0 and stopped on release. These are browser checks, not physical
IME/native clipboard or tracking-mode acceptance.

The same browser showed tiny/bottom-aligned xterm WebGL text. Untouched raw xterm reproduced
mixed canvas backing/CSS sizes (752×368/752×368 and 1504×736/752×368), while the browser reported
DPR 1 and a ResizeObserver device-pixel content width 1504 versus content width 752. This
characterizes an inherited/inconsistent browser DPR observation; it does not establish the
root cause or justify a production renderer change. Ghostty's visible highlight was inspected
separately. This visual xterm limitation remains recorded rather than hidden by weaker checks.

Initial selection/copy/geometry probes reported 16 passing Ghostty checks and one unsupported
styled-history check. Screenshot review then found a paint defect: correct copied graphemes
and correctly positioned rectangles could still cover wrong Canvas glyphs. That preliminary
result was insufficient to establish visible correctness. The
[before-correction screenshot](runtime-spike/2026-11-09-ghostty-selection-search-before-paint-fix.png)
shows wrong clusters in scrolled rows, including the highlighted query.

The pinned public Canvas renderer selects cells from scrollback or a shifted active row, then
asks `getGraphemeString()` using the viewport row. The adapter now decorates only the public
`CanvasRenderer.render()` boundary with an explicit `IRenderable` facade. Other public methods
retain their original receivers. Grapheme lookup maps the viewport to the corresponding public
scrollback/active API. The decorator captures history length once per synchronous frame, passes
an integer viewport to the original renderer, forces the existing scrolled redraw to bypass an
incorrect active-cursor prepass, and uses distance zero in alternate screen. It forwards unrelated
renderables unchanged, restores the method on disposal and creates no second render loop.
No private fields, package fork, copied renderer implementation or WASM method mutation is used.

Five facade tests cover mixed history/active rows, fractional boundary normalization, alternate
entry/exit, bottom, resize, receiver binding, provider absence, unrelated buffers and restoration.
The strengthened harness patches the public Canvas 2D `fillText()` only during a bounded probe,
records at most 16 draws for the expected highlighted cell, and restores the method afterward.
It verifies the actual full cluster painted at old-history and active-screen cells, rather than
trusting extraction or search status. A one-shot public repaint ensures deterministic evidence;
normal rendering continues through the wrapper's existing loop.

Final Chromium probes after the public render correction passed **17 Ghostty checks**, with
**1 unsupported styled-history check and 0 failures**. The bounded Canvas probe recorded the
complete `👩🏽‍💻` string actually passed to `fillText()` at both highlighted history matches and
the active-screen emoji cell; its call cap was not reached. The corrected screenshot confirms
consistent visible history clusters and the highlighted emoji. The browser console reported no
errors. xterm retained its 7 pass/3 inherited strict Unicode failures and raw/adapter equality.
Evidence: [current Chromium probes and interaction timing](runtime-spike/2026-11-09-ghostty-selection-search-chromium.json),
[corrected visible highlight](runtime-spike/2026-11-09-ghostty-selection-search-highlight.png).
The trusted mouse checks preceded the paint correction; the controller was unchanged, and their
timing is explicitly recorded in the current JSON rather than presented as newly repeated input.

Final native Tauri/WebKit validation also passed **17 Ghostty checks**, with only styled history
explicitly unsupported and no failures. Actual Canvas draw arguments contained the full cluster
at both highlighted history matches and the active-screen cell. All **15 transport cases**
(6 adapter and 9 legacy), credit accounting, resize and same-PID reattach checks passed;
**15 independent process/cleanup checks** completed, and the disposable Docker fixture filter
was empty afterward. xterm's strict Unicode failures remained inherited, with raw equality true.
All eight adapter benchmark samples retained their final line. Evidence:
[current native selection/search/paint and transport report](runtime-spike/2026-11-09-ghostty-selection-search-native.json).

Current adapter benchmark medians were **60.5 ms xterm** and **52.5 ms Ghostty**, four alternating
warm samples each for 660,890 bytes, with the same bounded queue/credit-window and final-frame
method. These observations are bounded synthetic emulator timings, not a general speedup,
real-agent response time or SSH throughput result.

Final normal and experimental builds passed. The current normal build emits **26 files**
(including 10 source maps before native bundling strips them), **10 JavaScript files**, and
no Ghostty/WASM filenames or JS/HTML markers. The experimental main JavaScript is
**1,316,354 bytes** (**370,115 gzip**), plus a 33-byte external-module shim, the unchanged
423,045-byte explicit WASM and 3,778-byte CSS. This is the combined two-engine review harness,
not a production migration estimate; duplicate embedded WASM remains unresolved.

Earlier adapter JSON and measurements below remain historical; new evidence does not overwrite
them. Fixture execution success is separate from candidate/product acceptance.

## Initial adapter validation (historical)

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

Initial Chromium adapter probes: Ghostty **7 pass, 3 unsupported, 0 fail**; xterm **7 pass,
3 fail** on the stricter ZWJ fixture and its consequent alternate-screen text comparison.
The exact raw/adapter xterm screen and title outputs match (`adapterMatchesRaw: true`);
those inherited failures remain visible. The browser console reported no errors. Evidence:
[Chromium adapter report](runtime-spike/2026-11-09-ghostty-adapter-chromium.json).

Initial native Tauri/WebKit execution passed **15 transport cases**: the nine historical raw-engine
cases and six new adapter cases (xterm and Ghostty across local PTY, local Herdr and SSH
Herdr). Adapter output uses each original `write(data, consumed)` callback, not a global-idle
proxy. All cases passed credit accounting, output beyond initial credit, actual resize and
same-PID reattach where applicable. Independent checks verified all 15 process outcomes before
cleanup; the disposable SSH fixture and core cleaned up. All eight adapter benchmark samples
retained their final line. Evidence:
[native adapter report and cleanup](runtime-spike/2026-11-09-ghostty-adapter-native.json).

Initial native compatibility matched Chromium: Ghostty **7 pass, 3 unsupported, 0 fail**; xterm
**7 pass, 3 inherited strict Unicode failures**, with raw/adapter equality confirmed. Native
adapter-only warm medians were **69.5 ms xterm** and **58.5 ms Ghostty** across four alternating
samples each. These timings include a synthetic emulator workload, bounded queue scheduling,
a 64 KiB credit window and two final frames; they establish neither universal speedup nor
real-agent latency. The historical and new benchmark payloads differ, so their timings must
not be compared as the same workload.

A successful fixture execution is not candidate acceptance. Adapter checks use fresh instances
so preceding transport floods cannot contaminate compatibility via wrapper reset/history
semantics.

The initial isolated native build also passed `npm run build:ghostty-spike`. Its combined
React/two-engine/legacy-and-adapter harness JavaScript is **1,300,186 bytes** (**365,317 gzip**),
plus a **423,045-byte WASM** asset (**123,975 gzip**) and 3,778-byte CSS. Those are experimental
bundle costs, not a production migration estimate. The normal build was separately inspected:
16 emitted files, 10 JavaScript files, no Ghostty/WASM filenames or Ghostty package markers.
The embedded base64 fallback still duplicates the WASM payload; removing it remains a gate.

## Reproduce and remaining gates

Use `npm run dev:ghostty-spike`, then “Load Unicode and scrollback fixture” and search
`needle 👩🏽‍💻` with the per-engine previous/next/clear controls. Drag/copy directly in the
terminal and use “Inspect selection” to record selected text and presentation geometry.
“Run adapter capability probes” uses fresh surfaces; “Run adapter benchmark” retains its
separate synthetic timing workload.
Those normal experimental controls use only adapters and compatible addons. Historical raw
addon-failure probes run separately after transport/benchmark cases in native acceptance.
The native runner additionally exercises six adapter cases across local PTY, local Herdr and
SSH Herdr with per-original-chunk credits, alongside the nine historical raw engine cases.
It checks flood output beyond initial credit, actual PTY resize, same-PID detach/reattach,
independent process state and fixture cleanup. It never provisions real hosts or calls agents.

Keep Ghostty experimental until manual native Codex/Claude full-screen and permission flows,
physical keyboard/IME, clipboard/right-click/accessibility, hidden/visible transitions,
outage/sleep/multiple sessions, Linux/Windows ConPTY, soft-wrap copy/search, selection preservation
during output/reflow, double-click words, tracking-mode clipboard behavior, faithful styled
history and packaging have passed. The package still embeds a base64 WASM fallback in addition
to the explicit WASM asset. No default change, release or broad performance claim follows from
this work. Synthetic emulator timings are not real-agent latency or parser-only throughput.
