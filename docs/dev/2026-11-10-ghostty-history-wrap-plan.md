# Ghostty primary history and logical-wrap extension plan

Implement the approved experimental source extension, pinned to wrapper revision
`9e4e126d89ac3537d2b2ebec075849851566de9f`, Ghostty revision
`5714ed07a1012573261b7b7e3ed2add9c1504496`, and Zig 0.15.2. Production xterm,
settings, transport and the Rust scrollback store remain unchanged. Keep the unmodified npm
package for historical raw comparisons; import the named extended distribution only in the
experimental adapter.

1. Vendor licenses, exact provenance/input hashes, the original upstream WASM patch and our
   extension patch, plus a reproducible build workflow. Preserve the 16-byte render-cell ABI.
   Add/check a separate versioned, bounded metadata ABI at the source wrapper/export boundary;
   never read runtime private handles or switch screens to capture primary history.
2. Export authoritative active/primary dimensions, screen identity, retained rows, wrap and
   continuation flags, cell text/wide classifications, semantic colors/rendition, links and
   palette/default colors. Bound caller output/rows/cells/strings, copy before free and refresh
   views after memory growth. Keep metadata capture outside render/ingestion hot paths.
3. Use continuation metadata for logical copy/search while preserving real spaces, hard breaks,
   full graphemes, wide-spacer rules and physical-cell mappings/visible overlay. Continue
   invalidating ranges on buffer mutation/reflow; isolate alternate-screen selection.
4. Capture primary retained history/displayed rows even during alternate screen. Serialize
   canonical semantic ANSI text/styles/links and palette/default-color changes; replay finishes
   on normal screen with neutral style and closed link. This is history, not a process/mode/
   cursor/alternate-app checkpoint. Implement pinned color-operation SET/RESET behavior too.
5. Keep snapshots within the existing 256 KiB storage boundary by choosing complete logical
   records and regenerating prelude/closures. Never split a grapheme/control/record; explicit
   oversize/failure preserves prior history. Report truncation diagnostics experimentally.
6. Verify native-semantic roundtrips (color tags, modified defaults/palette, rendition, styled
   blanks, links, Unicode, wraps, resize and primary capture during alternate screen), bounds,
   repeated capture/memory growth/ABI failures, logical copy/search and actual visible paint.
   Parent owns browser/native fixture execution after source-ready notification. Preserve old
   evidence and record current implementation commands, hashes, limits and remaining gates.

If the pinned build exposes broad incompatibility, deliver complete tested metadata and logical
wrap support first, while keeping styled history unsupported until semantic roundtrips pass.


## Explicit restore contract refinement

Strict width-change fixtures exposed that dimension-sensitive no-text/background cells cannot
be replayed as generic raw ANSI at arbitrary current widths. Canonical archives therefore add
a short beginning-only ignored OSC777 dimensions header, counted within256KiB. Both adapters
interpret it only through explicit `restoreStyledHistory()`: validate before mutation, await
prior writes, reset versioned replay to a clean normal state, resize to saved dimensions, parse
fully, then apply the latest desired current grid/fit. Legacy ANSI stays backward-compatible;
raw program writes never trigger restoration. Invalid/replay failures block shell spawn and
all persistence saves while preserving the original archive. The failure path exposes Retry.
Canonical replay enables autowrap and grapheme clustering without claiming a mode checkpoint.
Tests include narrower/wider/different-height/moved-cursor and already-used/reflowed/alternate
cores, actual native prefix eviction, and complete multi-row record retention.
