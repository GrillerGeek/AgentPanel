# Scrollback Persistence — Design

**Status:** ready to implement
**Author:** Jason Robey (with Claude)
**Date:** 2026-08-24

## Problem

AgentPanel already restores your open tabs on relaunch (`restoreSession` in
`src/state/store.ts`), but each restored tab opens an **empty** terminal. Every
line the agent printed before you quit is gone.

That is the difference between "my session came back" and "my session came
back empty". Orca persists scrollback across restarts; users expect it.

## The blocker found while designing this

`restoreSession` does **not** preserve pane identity:

```ts
// src/state/store.ts, in restoreSession
const panes: Pane[] = Array.from({ length: count }, () => ({ id: nextPaneId() }));
```

The session snapshot stores only `panes: t.panes.length` — a *count*. On
restore, brand-new ids are minted from the `paneSeq` counter, which itself
restarts at 0 every launch.

So there is nothing stable to key saved scrollback on. **Making pane ids
survive a restart is a prerequisite, not an optional extra**, and it is the
first task in the plan.

## Requirements

1. **R1** — A pane's visible scrollback is restored when the app relaunches and
   `restoreSession` reopens its tab.
2. **R2** — Restored content must be visually distinguishable from live output,
   so nobody mistakes a stale buffer for a running agent.
3. **R3** — Saved scrollback is capped per pane and pruned when its pane goes
   away, so the app-data directory cannot grow without bound.
4. **R4** — Saving must never block the UI thread noticeably, and must never
   run on every output chunk.
5. **R5** — The last screenful before an unexpected quit should survive, not
   just an orderly close.
6. **R6** — The user can turn the whole feature off, and can delete everything
   already saved.
7. **R7** — Pane ids must remain unique after a restore: a restored id must not
   be handed out again to a new pane.

## Decisions

### D1 — Pane ids are persisted in the session snapshot

The snapshot's `panes: number` becomes `paneIds: string[]`, and `restoreSession`
reuses those ids instead of minting new ones. The old `panes` count is still
read as a fallback so an existing saved session from v0.6.x restores rather
than being discarded.

Per R7, after restoring, `paneSeq` is advanced past the highest numeric suffix
seen among restored ids. Without that, the counter at 0 would re-issue `p1` to
the next new pane while a restored `p1` is still open, and the two would share
a PTY session entry and a scrollback file.

### D2 — Storage is a file per pane under app data, not localStorage

`localStorage` is a ~5 MB budget shared with settings, notes, session, and
review comments. A single busy agent pane serializes to hundreds of kilobytes.
A `QuotaExceededError` here would take the *other* persisted state down with it.

Scrollback goes to `<app-data>/scrollback/<paneId>.txt` via a new Rust module,
reusing `store.rs`'s `app_data_dir()` approach.

### D3 — Cap at 256 KB per pane, keeping the tail

Truncation keeps the **end** of the buffer — the recent output is what you came
back for. The cut is made at the next line boundary so a restored buffer never
opens mid-escape-sequence.

### D4 — Serialize at three moments, never continuously

Per R4, `@xterm/addon-serialize` walks the whole buffer, so it must not run per
chunk. It runs on:
1. pane unmount (tab or pane closed),
2. `visibilitychange` to hidden,
3. `beforeunload`.

(2) and (3) mirror exactly where `flushNotes` and `flushSession` already hook
in, and (2) is what satisfies R5 — the window going to the background is the
last reliable signal before a crash or a force-quit.

### D5 — A module-level registry, not React state

`Terminal.tsx` owns the `Terminal` instance, but the flush points in
`store.ts` are outside React. A module-level `Map<paneId, () => string>` —
the same pattern `agentRuntime.ts` already uses, and for the same stated reason
(it must not trigger a render) — lets any caller serialize every live pane.

### D6 — A dim separator marks restored content

Per R2, restored output is followed by a dimmed rule
(`── restored from <when> ──`) written with ANSI dim, before the shell spawns
and prints its first prompt.

### D7 — On by default, with an off switch and a purge button

Per R6. A new `persistScrollback` setting, default `true`, plus a
"Clear saved scrollback" button in Settings.

This matters more here than for a typical feature: the README's telemetry
section is explicit that terminal contents never leave the machine. This
feature writes those contents **to disk in plain text**, locally. That is a
reasonable default for a developer tool, but it must be visible, documented,
and reversible — turning the setting off also deletes what is already saved.

## Out of scope

- Restoring the live PTY process. Restored panes get a fresh shell, exactly as
  they do today; only the *text* comes back.
- Restoring scrollback beyond what xterm's own buffer holds at save time.
- Compression. A 256 KB cap makes it unnecessary.
- Syncing scrollback between machines.
