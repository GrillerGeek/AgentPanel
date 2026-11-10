# Terminal renderer adapter implementation plan

Planning model: Astra. Implementation model: Sol 6.1, with coordinator review and native/browser validation.

Implement a bounded follow-up to the [historical spike](2026-11-07-ghostty-feasibility-spike.md). xterm remains the synchronous production factory. Ghostty 0.4.0 remains a development dependency imported only by the isolated experimental entry. Transport, settings, SSH routing and persistence formats stay in their current owners.

Assumptions: “continue” authorizes the adapter foundation and isolated candidate, rather than a product-wide renderer switch. The pinned wrapper's public API is the integration boundary; unsupported persistence and selection/search behavior remain rollout blockers. Work builds on the unmerged spike PR #63 and includes the latest main updater-signing changes.

1. Introduce a library-independent renderer boundary for writes/completion/idle, dimensions, fit/resize, input/title/error events, normalized keyboard handling, selection, search, ANSI history, appearance, visibility and disposal. Move xterm addons into its adapter and preserve clipboard, restore-before-spawn, reconnect and initial-command behavior.
2. Build an asynchronous Ghostty adapter with a shared retryable explicit-URL WASM load. Bound retained ingestion to 1 MiB, parse slices to 16 KiB and ordinary-task turns to 64 KiB or approximately 4 ms. Acknowledge each original chunk exactly once after successful parsing, independent of animation frames. Overflow/parser failure stops the queue, rejects idle, releases retained bytes and notifies the controller so it detaches the failed runtime, including errors before open resolves.
3. Bridge titles with a bounded streaming OSC 0/2 parser that handles raw UTF-8, BEL/ST and split chunks, ignores nested-looking OSC bytes inside other control strings, and never alters emulator input. Use public WASM grapheme APIs for screen/scrollback extraction and cell mappings. Inspect actual selection positions. Report limited/unsupported capabilities honestly; never substitute plain text for replayable styled history or use incompatible xterm addons on Ghostty.
4. Extend the isolated harness with adapter probes and new transport cases. Preserve historical raw probe evidence and label execution success separately from acceptance. Test ordering, exact credits, bounds, task yields, errors/disposal, title boundaries, graphemes, selection/search status, persistence gates and production isolation.
5. Run frontend tests (Node 25 uses `NODE_OPTIONS=--no-webstorage`), normal and experimental builds, updater tests and ordinary Rust tests when practical. Attempt the new native cases when prerequisites permit. Record current evidence and outstanding manual/platform gates in a separate implementation report.

Open acceptance gates include physical keyboard/IME, native clipboard/right-click/accessibility, real Codex/Claude permission flows, hidden/visible panes, outage/sleep/multiple sessions, Linux/Windows ConPTY, full selection/search parity, styled history and duplicate WASM packaging. No default change, release, real host provisioning or paid agent calls are authorized by this implementation.

## Selection and visible search increment

Continue the isolated candidate with an owned exclusive-end absolute selection model and a
bounded noninteractive overlay, using only public Canvas metrics and scrolling APIs. Own
ordinary left drag in capture after the wrapper's scrollbar handler; preserve mouse reporting
unless Shift overrides, modified links, wheel, right-click and paste. Support real one-cell,
reversed, multiline, viewport-edge and scrollback copy using complete grapheme boundaries.
Search must reveal and visibly highlight the actual selected occurrence; status alone is not
evidence. Clear selection/search before parsed output, reset or actual grid changes because
public buffer-generation/eviction identities are unavailable. Preserve historical evidence,
keep xterm default and styled history unsupported, and document physical-row/soft-wrap and
selection-during-output limits. Test model geometry, controller events/disposal/invalidation
and current real-browser/native selection/search behavior before publishing the increment.

Paint evidence extension: screenshot review found that the pinned Canvas renderer retrieved
complex graphemes using viewport rows even when its cells came from scrollback/shifted active
rows. Correct extraction and overlay geometry were insufficient. Add an original public
`CanvasRenderer.render()` decorator using an explicit bound `IRenderable` facade, integer
viewport mapping, per-frame history snapshot, scrolled redraw and alternate-screen isolation.
Restore the public method on disposal and prove actual `fillText()` cluster data at highlighted
history and active-screen cells. Preserve the before-correction screenshot and final corrected
paint evidence; do not reinterpret the preliminary geometry checks as pixel acceptance.
