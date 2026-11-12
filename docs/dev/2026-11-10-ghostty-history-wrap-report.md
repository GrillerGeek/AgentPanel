# Ghostty primary history and logical-wrap extension

Started November 10 and validated through November 12, 2026. The experimental Ghostty adapter
now has authoritative logical-wrap metadata and bounded primary styled-history capture/replay.
Production xterm remains the default; settings, transports and the Rust256 KiB scrollback store
are unchanged. Shared explicit restore supports a strict optional dimensions header while old
ANSI archives retain their existing behavior. This is history restoration, not a process,
terminal-mode, cursor or alternate-application checkpoint.

The [plan](2026-11-10-ghostty-history-wrap-plan.md) implements a source extension, not a blind
package upgrade. The [November 9 adapter report](2026-11-09-ghostty-renderer-adapter-report.md)
and its evidence remain historical. The unmodified npm package remains available for raw
comparisons; current candidate evidence identifies `agentpanel-ghostty-history-abi1` separately.

## Reproducible distribution

The [vendored distribution](../../vendor/ghostty-history/README.md) includes both upstream MIT
licenses, unmodified wrapper source, the original upstream WASM patch, our source patches and
metadata implementation, public JS/declarations/WASM and the
[hash manifest](../../vendor/ghostty-history/manifest.json). The generated distribution is
committed intentionally through narrow ignore exceptions; normal production artifacts stay ignored.

| Input | Exact pin |
| --- | --- |
| Wrapper source | `9e4e126d89ac3537d2b2ebec075849851566de9f` |
| Ghostty source | `5714ed07a1012573261b7b7e3ed2add9c1504496` |
| Compiler | Official Zig 0.15.2 linux/aarch64; archive SHA256 `958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f` |
| Builder | Public Debian bookworm-slim, digest `734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc` |
| Extended WASM |430598 bytes; SHA256 `683298ebb0bbd9c0e4cb4c2029eac6afb264d3e3755517ebc6b4724be55d99c8` |
| Extended JS |69352 bytes; SHA256 `c296e5b299baba188f9df5b66942f07df2ceaee6ae5afa1e4a9ba66ca9f301d6` |

The [rebuild script](../../scripts/ghostty-history/rebuild.py) verifies archive/input hashes,
resolves needed lazy dependencies by executing the build graph with `--list-steps`, then compiles
WASM with networking disabled. A simple `--fetch=needed` pass was insufficient and was replaced;
this failure was not labeled reproducibility. JS output pins `useDefineForClassFields=true`
explicitly, because inheriting the upstream versus root tsconfig otherwise changed generated
class initialization. A final entirely new scratch/cache/output workflow reproduced **all 18
artifact hashes/sizes exactly**, with the cache initially absent/empty. Evidence:
[clean rebuild proof](runtime-spike/2026-11-11-ghostty-history-rebuild.json).

The official macOS compiler's build runner hit missing libSystem symbols with the installed
SDKs. The verified Linux compiler/public container provided a working path without modifying
host SDK/compiler files or installing a global tool. No Bun dependency is required by this build.

## Authoritative metadata and native correctness

Metadata ABI1 is separate from the preserved 16-byte hot render-cell ABI. At the source C/WASM
boundary it exposes selected primary/active dimensions, retained rows, screen identities, both
cursor identities, wrap/continuation, wide-base/tail/edge-head classes, text presence, complete
graphemes, default/palette/RGB foreground/background/underline colors, rendition and hyperlink
URI/explicit ID. Primary capture reads `screens.get(.primary)` and never switches the live
screen, moves either cursor or writes input. Palette/default effective colors accompany styled
snapshots; semantic provenance is retained even when different tags resolve to identical RGB.

Row-only capture omits styles/links and returns compact wide/text-presence strings. Full styled
capture runs only for explicit archive operations. Default limits are 4096 rows,524288 cells,
4 MiB UTF8 strings and32 MiB styled output (2 MiB row-only). Hard caller limits are 8192 rows,
1048576 cells,8 MiB strings and64 MiB output. Per-grapheme limits are1024 codepoints and 4096
UTF8 bytes. Native negative errors never become partial successful snapshots; JS copies before
free and recreates views after allocation/export/memory growth. Missing/mismatched metadata ABI
or render-cell size fails clearly. Application code never reads private handles.

Real-core tests exposed and fixed two inherited wrapper/native integration problems:

- Native page creation assumed mmap-zeroed memory. WASM reused freed heap pages, so a new
  terminal inherited old text/style/links; unmodified npm 0.4.0 reproduced this independently.
  WASM page creation now enforces zeroed buffers. Repeated same-module create/free/reflow,
  metadata capture and memory-growth tests verify empty fresh terminals and stable allocation.
- The wrapper's color handler was a no-op and its stream was initialized without the allocator
  required to parse color operations. The extension enables bounded allocator-backed parsing
  and copies the exact pinned native SET/RESET handler. Tests assert actual palette/default
  changes and resets, including the equal-RGB color-tag fixture's premise. Dynamic OSC strings
  are capped at64 KiB. Color queries remain ignored.

Public grapheme APIs now reject overflow instead of silently truncating and free their bounded
lookup buffer on disposal. A Canvas failure freezes subsequent draws, aborts queued ingestion,
rejects idle and emits the existing fatal renderer event so the controller detaches. Successfully
parsed earlier credits remain valid; pending/unparsed chunks are not acknowledged.

## Logical copy/search and Canvas evidence

Copy/search joins a physical row only when authoritative continuation says it belongs to the
previous logical record. Hard newlines remain distinct. It preserves real spaces, omits wide
spacer artifacts and unwritten hard-end padding, and maps logical UTF16 offsets back to physical
cells for the existing owned selection/highlight. This covers cross-row and history/active
boundaries, combining/CJK/skin-tone/ZWJ text and core resize. Alternate-screen text stays isolated.
Selections/search offsets still invalidate on parsed output or grid changes; stable anchors
across ongoing output are not supplied.

Semantic preservation is broader than the Canvas decoration API. The unchanged 16-byte render
ABI exposes only boolean underline and omits overline/underline-color/variant details. Those
fields survive archive roundtrips but are **not claimed visually faithful** in the current
Canvas. That visual gate remains open. Resolved default/RGB/palette foreground/background and
Unicode paint are checked separately. The inherited black-background sentinel was removed:
explicit RGB/palette black is now painted over a nonblack default rather than skipped.

## Stored history contract

Canonical output captures primary retained history plus meaningful displayed rows even while
alternate screen is active. It emits semantic SGR, palette/default SETs, per-cell OSC8 transitions,
full graphemes and background-only blank cells, finishing on normal screen with neutral style
and a closed link. Its canonical mode baseline enables autowrap and grapheme clustering; this
is not preservation of the previous process mode state. It emits no title, clipboard, query or notification commands.

Unwritten/background-only cells use ECH/cursor movement instead of printed spaces, preserving
`hasText` and subsequent logical copy. Unsupported erased-wrap boundary combinations fail
explicitly rather than overwriting a column. Tests compare native cell tags, wide classes,
text presence, rendition, links and colors strictly; only entirely default/unwritten trailing
viewport rows are normalized away. Styled blanks, explicit spaces and links are never dropped
as padding. A meaningful newest oversized record cannot be replaced by trailing empty rows.

The beginning-only header is `ESC ]777;AgentPanelHistory;1;<cols>;<rows> ESC backslash`. It is
ignored by raw terminal parsing, interpreted only by explicit `restoreStyledHistory()`, and
counts inside the existing 256 KiB limit. Header decimals are canonical positive integers,
dimensions are at most 4096 with a 1048576-cell grid, and the header is at most 96 bytes.
Malformed/incomplete/reserved unknown versions fail before mutation; absent metadata is legacy
ANSI. Embedded program markers are never scanned or interpreted as restore requests.

Explicit versioned restore waits for prior writes, resets to a clean normal state, temporarily
restores the saved grid, and parses the body,
then applies the latest desired current grid/fit. Resize/fit requests during replay are deferred;
hidden0×0 fits are skipped. Both adapters honor this contract. It fixes the observed8→6 BG-blank
reflow discrepancy; wider/narrower/different-height and moved-source-cursor fixtures compare
against independently resized originals. Cursor/mode checkpoint restoration is not implied.

Runtime replay failures perform best-effort reset/current-grid recovery and report partial-state
failure, without claiming rollback. `TerminalPane` then blocks shell spawn, initial command,
persistence registration and cleanup saves, leaves the archive untouched and shows Retry.
The restored banner appears only after successful replay; transport opens once at final dimensions.

Snapshots retain a suffix of complete logical records within 256 KiB including regenerated color
prelude, header and closing controls. Native eviction can leave an incomplete first record;
that prefix is skipped diagnostically, or capture fails when no complete record remains.
Oversized newest required records fail explicitly and preserve prior saved history. No raw-output
log, shadow emulator, plaintext persistence fallback or Rust storage change was introduced.

## Validation

- `NODE_OPTIONS=--no-webstorage npm test`: **362 tests passed** across 55 files, including 22 real
  rebuilt-WASM integration cases in ordinary CI discovery.
- `npx tsc --noEmit`, normal build and isolated spike build passed.
- Real-core cases include equal-RGB distinct tags, palette/default SET/RESET, rendition and all
  underline variants/colors, styled real/no-text blanks with logical-text equality, links/IDs,
  Unicode/wide edge wrapping, history-active matches, resize, primary-in-alt immutability,
  complete single/multi-row retention, actual native prefix eviction, oversized meaningful
  records, ABI/bounds errors, repeated captures, memory growth and same-instance reuse.
- Restore helper/pane tests cover strict/legacy/raw headers, no raw-marker resize, concurrent
  geometry/fit requests, hidden fits, disposal/failure recovery, no spawn/save on failure and
  final spawn dimensions. Public Canvas tests verify black fills, and fatal-render tests verify
  the ingestion/controller event boundary.

The [Chromium evidence](runtime-spike/2026-11-11-ghostty-history-wrap-chromium.json) identifies the
extended candidate and its manifest/WASM hash: **24 Ghostty checks passed, zero failed**. It
includes actual cross-wrap selection/copy, fresh-core semantic replay, primary capture during
alternate-screen use, and explicit saved-grid replay into an already-used adapter followed by
current-grid resize. The latter exposed stale row state with clear-screen controls alone;
resetting before versioned replay fixes it, and the bounded semantic first-difference is now
null. Actual Canvas calls also paint RGB/palette black over the nonblack default background.
The [18×10 replay screenshot](runtime-spike/2026-11-11-ghostty-history-wrap-replay.png) shows the
logical Unicode match highlighted across two physical rows.

The comparison xterm adapter passed seven checks and retained three inherited strict
single-byte Unicode failures; its result equals the unmodified raw xterm baseline. These are
not new adapter regressions. Historical November 9 counts/timings are not transferred to the
extended distribution.

The [native diagnostic evidence](runtime-spike/2026-11-12-ghostty-history-wrap-native.json)
is **not a completed native acceptance run**. The first attempt reached the 300s overall
limit. The final diagnostic attempt stalled at round0 of the unmodified xterm benchmark's
write/render stage, before the extended adapter matrix; even the browser-side timer did not
report a deadline. The agent interrupted it, and verified the runner/app exited and no owned
fixture containers remained. The root cause is unconfirmed. The runner now records per-case
progress, explicit browser-side deadline failures with visibility/focus diagnostics, and a
separate host-side 45s stage deadline so suspended browser timers cannot hide a stall.

Repeat native transport/compatibility acceptance in an active desktop session before accepting
this increment for production rollout. Historical native passes do not validate this candidate.
The combined comparison bundle intentionally carries both original and extended engines/WASM.
The normal production build passed and contains no Ghostty engine or WASM; its shared
history-header parser is intentional.

## Remaining gates

This remains experimental. Keep full alternate-application/cursor/mode checkpoints, selection
preservation during output/reflow, double-click words, tracking-mode clipboard interactions,
physical keyboard/IME, native clipboard/accessibility, real Codex/Claude permission flows,
outage/sleep/multi-session load and Linux/Windows/ConPTY acceptance separate. Rich rendition
Canvas fidelity remains open even when semantic replay is green. The pinned native scrollback
budget is bytes despite the wrapper option's naming; metadata reports actual retention instead
of assuming a promised line count. Source-extension maintenance/rebuild costs are explicit;
there is no default switch, merge or release in this implementation work.
