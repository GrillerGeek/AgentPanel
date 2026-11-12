# AgentPanel experimental Ghostty history ABI1 distribution

This directory is a maintained experimental source extension. Production AgentPanel continues
using xterm. The raw comparison harness still imports the unmodified `ghostty-web@0.4.0` npm
package and its original WASM. Only the experimental adapter imports this distribution.

The [manifest](manifest.json) pins source archive URLs, sizes and SHA256 hashes, exact source
revisions, compiler archive, public Linux builder digest, JS tool versions/options, vendored
input hashes and all 18 generated artifact hashes. Both upstream MIT licenses are retained in
[upstream](upstream/). The wrapper archive's package manifest says0.3.0 at the pinned revision;
`upstreamPackage` identifies the separate npm reference, not a claim that this source extension
is an unmodified0.4.0 release.

- Wrapper source: `9e4e126d89ac3537d2b2ebec075849851566de9f`.
- Ghostty native source: `5714ed07a1012573261b7b7e3ed2add9c1504496`.
- Zig 0.15.2, linux/aarch64; WASM target `wasm32-freestanding`, `ReleaseSmall`.
- JS: ESM/ES2022/browser, minified, explicit `useDefineForClassFields=true`; no embedded WASM.
- Entry: [dist/ghostty-history.js](dist/ghostty-history.js), matching declarations and
  [dist/ghostty-history.wasm](dist/ghostty-history.wasm). Pass an explicit asset URL to
  `Ghostty.load()` and pass that instance to `Terminal`; no implicit loader/init fallback.

The original upstream WASM patch is preserved verbatim. The additional native patch adds
exports/delegation, enables allocator-backed OSC color parsing with64 KiB dynamic OSC strings,
implements the pinned native SET/RESET handler, checks grapheme overflow and enforces zeroed
WASM page allocations. That last change fixes independently reproduced stale text/style/link
state across create/free/reuse in the unmodified npm build. The metadata implementation in
[native/agentpanel_metadata.zig](native/agentpanel_metadata.zig) is original glue. The
color-operation handler is derived from the exact pinned Ghostty `stream_readonly.zig`; its
license is included. The wrapper patch adds the public source-level metadata methods/ABI
check, bounded grapheme lookup/freeing and correct resolved-black Canvas backgrounds.

Metadata ABI1 is separate from the unchanged 16-byte render-cell ABI. `getRowMetadata()`
returns compact active row wrap/continuation/wide/text-presence data without styled cells.
`captureSnapshot()` defaults to primary history/displayed rows even during alternate screen.
It includes dimensions, both cursor identities for read-only evidence, semantic default/
palette/RGB color tags, rendition, text presence, full graphemes and hyperlink URI/explicit ID.
Negative native errors discard partial output. JS validates limits, obtains fresh memory views
after export/allocation and copies bytes before freeing them. The private native handle stays
inside the extended source class; application code uses public methods only.

Default limits:4096 rows,524288 cells,4 MiB aggregate UTF8 strings;2 MiB row-only or32 MiB styled
output. Hard caller limits:8192 rows,1048576 cells,8 MiB strings,64 MiB output. Graphemes are
bounded to 1024 codepoints and 4096 UTF8 bytes; overflow fails explicitly. The adapter freezes
rendering and aborts ingestion on a Canvas grapheme failure, notifying the existing controller
for detachment. Metadata is not captured during ordinary parsing/rendering or pointer movement.

## Rebuild

Run `npm ci` first for the pinned JS tools. Docker must support `linux/arm64`. This command
uses new scratch/output directories and verifies an initially empty package cache:

```sh
python3 scripts/ghostty-history/rebuild.py \
  --work-dir /private/tmp/ghostty-history-work \
  --cache-dir /private/tmp/ghostty-history-cache \
  --output-dir /private/tmp/ghostty-history-dist \
  --require-empty-cache
```

Optional `--wrapper-archive`, `--native-archive` and `--compiler-archive` accept already-downloaded
verified archives. No existing directory is deleted automatically. The script validates vendored
inputs, extracts exact archives, applies patches, verifies the compiler, resolves the required
build graph/dependencies in a network-enabled pinned container with a read-only trusted CA
bundle, then compiles with networking disabled. A separate output directory receives JS/types/
WASM and is compared byte-for-byte with the committed manifest. `--offline` skips dependency
resolution only when an explicitly supplied cache is already prepared. No global install occurs.

On the development macOS host, Zig 0.15.2's build runner could not link the installed SDK's
libSystem targets. The verified official Linux compiler/public Debian image avoids host SDK
modification. This is a bounded host-toolchain observation, not a general macOS support claim.

The [clean-cache proof](../../docs/dev/runtime-spike/2026-11-11-ghostty-history-rebuild.json)
records exact reproduction of all 18 artifacts. Native semantic integration tests run in the
normal `npm test` suite; scope and product limits are in the
[implementation report](../../docs/dev/2026-11-10-ghostty-history-wrap-report.md).
