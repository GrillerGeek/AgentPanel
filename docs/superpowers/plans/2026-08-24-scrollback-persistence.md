# Scrollback Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When AgentPanel relaunches and restores your tabs, each terminal comes back with the text that was in it — not empty.

**Architecture:** Pane ids are made to survive a restart first (they currently do not), giving scrollback a stable key. `@xterm/addon-serialize` snapshots a pane's buffer; a new Rust module writes it to a capped file per pane under app data. A module-level registry of live serializers — the same pattern `agentRuntime.ts` uses — lets the existing hide/unload flush points snapshot every pane without touching React.

**Tech Stack:** `@xterm/addon-serialize`, Tauri commands, Rust `std::fs`, Zustand 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-scrollback-persistence-design.md`

## Global Constraints

- **Task 1 is a hard prerequisite.** `restoreSession` currently mints fresh pane ids (`src/state/store.ts`, `const panes: Pane[] = Array.from({ length: count }, () => ({ id: nextPaneId() }))`). Until ids survive a restart there is nothing to key scrollback on, and Tasks 2–6 are unimplementable.
- Serialization is expensive (it walks the whole buffer). It runs **only** on pane unmount, `visibilitychange` → hidden, and `beforeunload`. Never per output chunk. (Spec R4/D4)
- The per-pane cap is **256 KiB**, keeping the tail. (Spec D3)
- The terminal mount effect in `src/Terminal.tsx` must **not** gain `persistScrollback` as a dependency — that would remount every terminal (destroying its PTY) when the setting is toggled. Read it with `useStore.getState().settings.persistScrollback` instead.
- This feature writes terminal output **to disk in plain text**. It is local-only and never transmitted, but it must stay documented, toggleable, and purgeable. (Spec R6/D7)
- Frontend tests touching `localStorage` or the DOM need `// @vitest-environment jsdom` as the first line.

---

### Task 1: Make pane ids survive a restart

**Files:**
- Modify: `src/state/store.ts` (`restoreSession`, the session-persist subscriber, and a new `adoptPaneSeq` helper)
- Test: `src/state/store.paneIds.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the session snapshot now carries `paneIds: string[]` per tab (replacing `panes: number`, which is still *read* for backward compatibility). After `restoreSession`, `useStore.getState().terminals[i].panes[j].id` equals the id saved in the previous run. Tasks 2–5 key every scrollback file on that id.

- [ ] **Step 1: Write the failing tests**

Create `src/state/store.paneIds.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const WT = { id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({ terminals: [], activeTabId: null, worktrees: { r1: [WT] }, paneSessions: {} });
  vi.runOnlyPendingTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function saveSession(tabs: unknown[], activeIndex = 0) {
  localStorage.setItem("agentpanel.session", JSON.stringify({ tabs, activeIndex }));
}

describe("pane id stability across restore", () => {
  it("reuses the saved pane ids instead of minting new ones", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", paneIds: ["p7", "p8"] }]);
    useStore.getState().restoreSession();
    expect(useStore.getState().terminals[0].panes.map((p) => p.id)).toEqual(["p7", "p8"]);
  });

  it("never hands a restored id to a brand-new pane", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", paneIds: ["p7"] }]);
    useStore.getState().restoreSession();
    useStore.getState().openWorktreeTerminal({ ...WT, id: "/wt2", path: "/wt2" });
    const ids = useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("p7");
  });

  it("does not let a minted id collide with an id a later tab restores", () => {
    // Tab 1 predates paneIds (count only); tab 2 has a saved id the counter
    // would otherwise hand out.
    saveSession([
      { worktreeId: "/wt1", cwd: "/wt1", title: "old", panes: 1 },
      { worktreeId: "/wt1", cwd: "/wt1", title: "new", paneIds: ["p1"] },
    ]);
    useStore.getState().restoreSession();
    const ids = useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still restores a legacy session that stored only a pane count", () => {
    saveSession([{ worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: 2 }]);
    useStore.getState().restoreSession();
    expect(useStore.getState().terminals[0].panes).toHaveLength(2);
  });

  it("writes paneIds into the persisted session snapshot", () => {
    useStore.getState().restoreSession(); // sets hydrated so the subscriber writes
    useStore.getState().openWorktreeTerminal(WT);
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(localStorage.getItem("agentpanel.session")!);
    expect(Array.isArray(saved.tabs[0].paneIds)).toBe(true);
    expect(saved.tabs[0].paneIds).toEqual(useStore.getState().terminals[0].panes.map((p) => p.id));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.paneIds.test.ts`
Expected: FAIL — the first test reports ids like `["p1","p2"]` instead of
`["p7","p8"]`, and the snapshot test reports `paneIds` is `undefined`.

- [ ] **Step 3: Add the counter-adoption helper**

In `src/state/store.ts`, immediately after the `nextPaneId` declaration
(`let paneSeq = 0; const nextPaneId = () => 'p' + ++paneSeq;`), add:

```ts
/**
 * Advance the pane-id counter past every id restored from a saved session.
 *
 * Without this, `paneSeq` restarts at 0 each launch and would re-issue `p1` to
 * the next new pane while a restored `p1` is still open. The two panes would
 * then share a `paneSessions` entry and a scrollback file.
 */
function adoptPaneSeq(ids: string[]): void {
  for (const id of ids) {
    const n = Number(/^p(\d+)$/.exec(id)?.[1]);
    if (Number.isFinite(n) && n > paneSeq) paneSeq = n;
  }
}
```

- [ ] **Step 4: Reuse saved ids in `restoreSession`**

In `restoreSession`, widen the parsed shape to include `paneIds`:

```ts
            tabs: Array<{
              worktreeId: string;
              cwd: string;
              title: string;
              panes?: number;
              paneIds?: string[];
              color?: string;
            }>;
```

Then replace the pane-construction line. The current body is:

```ts
          const tabs: TerminalTab[] = valid.map((t) => {
            const count = Math.max(1, Math.min(2, t.panes ?? 1));
            const panes: Pane[] = Array.from({ length: count }, () => ({ id: nextPaneId() }));
```

Change it to:

```ts
          // Pre-pass: adopt every restored id BEFORE minting any, so a legacy
          // tab (count only) can't be handed an id a later tab is about to
          // restore.
          adoptPaneSeq(valid.flatMap((t) => t.paneIds ?? []));

          const tabs: TerminalTab[] = valid.map((t) => {
            const saved = t.paneIds?.slice(0, 2) ?? [];
            const count = Math.max(1, Math.min(2, t.panes ?? saved.length ?? 1));
            // Sessions written by v0.6.x stored only a count; mint ids for those.
            const panes: Pane[] =
              saved.length > 0
                ? saved.map((id) => ({ id }))
                : Array.from({ length: count }, () => ({ id: nextPaneId() }));
```

Leave the rest of the `map` body (the returned tab object) unchanged.

- [ ] **Step 5: Write ids into the session snapshot**

In the session-persist subscriber near the bottom of `store.ts`, change:

```ts
      panes: t.panes.length,
```

to:

```ts
      // Ids, not a count: scrollback is keyed on them and must survive a
      // restart. `panes` is still read on restore for v0.6.x sessions.
      paneIds: t.panes.map((p) => p.id),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.paneIds.test.ts src/state/store.notes.test.ts`
Expected: all pass. The notes suite is included because it also exercises
`restoreSession` indirectly through the store reset.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/store.paneIds.test.ts
git commit -m "fix: keep pane ids stable across session restore"
```

---

### Task 2: On-disk scrollback store (Rust)

**Files:**
- Create: `src-tauri/src/scrollback.rs`
- Modify: `src-tauri/src/lib.rs` (`mod scrollback;` + four command registrations)

**Interfaces:**
- Consumes: nothing.
- Produces: four commands. `scrollback_save({ paneId, data })`, `scrollback_load({ paneId }) -> string`, `scrollback_prune({ keep: string[] })`, `scrollback_clear()`. Tasks 3–5 call these exact names; Tauri converts the camelCase JS keys to the snake_case Rust parameters.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/scrollback.rs` containing only the test module:

```rust
//! Per-pane terminal scrollback, persisted under the app-data directory.
//!
//! One file per pane (`scrollback/<paneId>.txt`) rather than localStorage: a
//! busy agent pane serializes to hundreds of kilobytes, and localStorage is a
//! ~5 MB budget already shared with settings, notes, and the session. A quota
//! error there would take that other state down with it.
//!
//! This writes terminal output to disk in plain text. It never leaves the
//! machine, but the feature is toggleable and purgeable for exactly that
//! reason (see Settings).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_buffers_whole() {
        assert_eq!(trim_to_cap("hello\nworld\n"), "hello\nworld\n");
        assert_eq!(trim_to_cap(""), "");
    }

    #[test]
    fn keeps_the_tail_of_an_oversized_buffer() {
        let big = "x".repeat(MAX_BYTES) + "\nTHE END\n";
        let out = trim_to_cap(&big);
        assert!(out.len() <= MAX_BYTES);
        assert!(out.ends_with("THE END\n"), "the recent output is what survives");
    }

    #[test]
    fn cuts_at_a_line_boundary() {
        // Lines of 10 bytes each, well past the cap.
        let big: String = (0..(MAX_BYTES / 10 + 50)).map(|_| "123456789\n").collect();
        let out = trim_to_cap(&big);
        assert!(out.starts_with('1'), "must not start mid-line: {:?}", &out[..4.min(out.len())]);
    }

    #[test]
    fn never_splits_a_multibyte_character() {
        // A wall of 3-byte characters guarantees the naive cut point is not a
        // char boundary.
        let big: String = "☃".repeat(MAX_BYTES);
        let out = trim_to_cap(&big);
        assert!(out.chars().all(|c| c == '☃'), "no replacement or panic");
    }

    #[test]
    fn accepts_generated_pane_ids_and_rejects_path_traversal() {
        assert!(is_safe_pane_id("p1"));
        assert!(is_safe_pane_id("p12345"));
        assert!(is_safe_pane_id("pane_id-9"));

        assert!(!is_safe_pane_id(""));
        assert!(!is_safe_pane_id(".."));
        assert!(!is_safe_pane_id("../../etc/passwd"));
        assert!(!is_safe_pane_id("a/b"));
        assert!(!is_safe_pane_id("a\\b"));
        assert!(!is_safe_pane_id("a.txt"));
        assert!(!is_safe_pane_id(&"p".repeat(65)));
    }
}
```

- [ ] **Step 2: Register the module and run the tests to verify they fail**

Add `mod scrollback;` to `src-tauri/src/lib.rs` beside `mod store;`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml scrollback::`
Expected: FAIL — `cannot find function 'trim_to_cap'`, `cannot find value 'MAX_BYTES'`,
`cannot find function 'is_safe_pane_id'`.

- [ ] **Step 3: Write the implementation**

Insert above the test module in `src-tauri/src/scrollback.rs`:

```rust
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Keep the newest 256 KiB of a pane's buffer. Enough for a long agent run;
/// small enough that dozens of panes cannot fill a disk.
const MAX_BYTES: usize = 256 * 1024;

/// Pane ids are minted by the frontend (`p1`, `p2`, …) and become file names.
///
/// Validate rather than sanitize: an id outside this shape is either a bug or
/// an attempt at path traversal, and in both cases it must not reach the
/// filesystem. Rejecting is safe — the worst case is one pane without
/// persisted scrollback.
fn is_safe_pane_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `<app-data>/scrollback/`, created on demand.
fn scrollback_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?
        .join("scrollback");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Trim to the last `MAX_BYTES`, cutting at a line boundary so a restored
/// buffer never opens mid-escape-sequence — a half-written ANSI sequence would
/// corrupt the colours of everything printed after it.
fn trim_to_cap(data: &str) -> &str {
    if data.len() <= MAX_BYTES {
        return data;
    }
    // Slicing a &str at a non-char-boundary panics, so walk forward first.
    let mut start = data.len() - MAX_BYTES;
    while start < data.len() && !data.is_char_boundary(start) {
        start += 1;
    }
    let tail = &data[start..];
    match tail.find('\n') {
        Some(i) => &tail[i + 1..],
        None => tail,
    }
}

/// Persist one pane's serialized buffer, truncated to the cap.
#[tauri::command]
pub fn scrollback_save(app: AppHandle, pane_id: String, data: String) -> Result<(), String> {
    if !is_safe_pane_id(&pane_id) {
        return Err(format!("refusing unsafe pane id: {pane_id}"));
    }
    let path = scrollback_dir(&app)?.join(format!("{pane_id}.txt"));
    fs::write(path, trim_to_cap(&data)).map_err(|e| e.to_string())
}

/// Read a pane's saved buffer. A missing or unreadable file is an empty
/// string, never an error — a pane with no history is the normal case.
#[tauri::command]
pub fn scrollback_load(app: AppHandle, pane_id: String) -> Result<String, String> {
    if !is_safe_pane_id(&pane_id) {
        return Ok(String::new());
    }
    let path = scrollback_dir(&app)?.join(format!("{pane_id}.txt"));
    Ok(fs::read_to_string(path).unwrap_or_default())
}

/// Delete every saved buffer whose pane id is not in `keep`.
#[tauri::command]
pub fn scrollback_prune(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    let dir = scrollback_dir(&app)?;
    let keep: HashSet<String> = keep.into_iter().collect();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".txt") else {
            continue;
        };
        if !keep.contains(id) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Delete everything. Backs the Settings purge button, and runs when the
/// feature is switched off.
#[tauri::command]
pub fn scrollback_clear(app: AppHandle) -> Result<(), String> {
    let dir = scrollback_dir(&app)?;
    let _ = fs::remove_dir_all(&dir);
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scrollback::`
Expected: 5 passed.

- [ ] **Step 5: Register the four commands**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]`, add after
`telemetry::set_telemetry_consent,`:

```rust
            scrollback::scrollback_save,
            scrollback::scrollback_load,
            scrollback::scrollback_prune,
            scrollback::scrollback_clear,
```

- [ ] **Step 6: Verify the crate builds clean**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass with no dead-code warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scrollback.rs src-tauri/src/lib.rs
git commit -m "feat(scrollback): capped per-pane on-disk store"
```

---

### Task 3: The live-pane serializer registry

**Files:**
- Create: `src/lib/scrollbackRegistry.ts`
- Test: `src/lib/scrollbackRegistry.test.ts`

**Interfaces:**
- Consumes: `scrollback_save` (Task 2).
- Produces: `registerPane(paneId, serialize)`, `unregisterPane(paneId)`, `livePaneIds()`, `snapshotAll()`, and `saveAllScrollback(): Promise<void>`. Task 4 registers/unregisters; Task 5 calls `saveAllScrollback`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/scrollbackRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPane,
  unregisterPane,
  livePaneIds,
  snapshotAll,
  saveAllScrollback,
} from "./scrollbackRegistry";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  for (const id of livePaneIds()) unregisterPane(id);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("scrollbackRegistry", () => {
  it("tracks registered panes and forgets unregistered ones", () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    expect(livePaneIds().sort()).toEqual(["p1", "p2"]);
    unregisterPane("p1");
    expect(livePaneIds()).toEqual(["p2"]);
  });

  it("snapshots every live pane", () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    expect(snapshotAll().sort((a, b) => a.paneId.localeCompare(b.paneId))).toEqual([
      { paneId: "p1", data: "one" },
      { paneId: "p2", data: "two" },
    ]);
  });

  it("skips a pane whose serializer throws, without losing the others", () => {
    registerPane("bad", () => {
      throw new Error("disposed mid-serialize");
    });
    registerPane("good", () => "kept");
    expect(snapshotAll()).toEqual([{ paneId: "good", data: "kept" }]);
  });

  it("skips empty buffers so a fresh pane does not write a useless file", () => {
    registerPane("empty", () => "");
    registerPane("full", () => "text");
    expect(snapshotAll()).toEqual([{ paneId: "full", data: "text" }]);
  });

  it("saveAllScrollback invokes scrollback_save once per pane", async () => {
    registerPane("p1", () => "one");
    registerPane("p2", () => "two");
    await saveAllScrollback();
    const calls = vi.mocked(invoke).mock.calls.filter(([c]) => c === "scrollback_save");
    expect(calls).toHaveLength(2);
    expect(calls.map(([, a]) => (a as { paneId: string }).paneId).sort()).toEqual(["p1", "p2"]);
  });

  it("saveAllScrollback resolves even when a save is rejected", async () => {
    vi.mocked(invoke).mockRejectedValue("disk full");
    registerPane("p1", () => "one");
    await expect(saveAllScrollback()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scrollbackRegistry.test.ts`
Expected: FAIL — `Failed to resolve import "./scrollbackRegistry"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scrollbackRegistry.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

/**
 * Serializers for every live terminal pane, in a plain module-level Map — NOT
 * in the Zustand store — for the same reason `agentRuntime.ts` keeps its PTY
 * runtime out of the store: this is touched on mount, unmount, and every flush,
 * and must never trigger a React render.
 *
 * It also has to be reachable from `store.ts`'s hide/unload handlers, which
 * live outside React entirely.
 */
const serializers = new Map<string, () => string>();

export function registerPane(paneId: string, serialize: () => string): void {
  serializers.set(paneId, serialize);
}

export function unregisterPane(paneId: string): void {
  serializers.delete(paneId);
}

export function livePaneIds(): string[] {
  return [...serializers.keys()];
}

/**
 * Serialize every live pane.
 *
 * A pane whose serializer throws (disposed mid-flush) or returns an empty
 * buffer (nothing printed yet) is skipped — one bad pane must not cost the
 * others their history, and an empty file is worse than no file because it
 * would restore as a blank "restored" banner.
 */
export function snapshotAll(): Array<{ paneId: string; data: string }> {
  const out: Array<{ paneId: string; data: string }> = [];
  for (const [paneId, serialize] of serializers) {
    let data: string;
    try {
      data = serialize();
    } catch {
      continue;
    }
    if (data) out.push({ paneId, data });
  }
  return out;
}

/**
 * Persist every live pane's buffer. Best effort: a rejected write is swallowed
 * so a full disk cannot break app shutdown.
 */
export async function saveAllScrollback(): Promise<void> {
  await Promise.all(
    snapshotAll().map(({ paneId, data }) =>
      invoke("scrollback_save", { paneId, data }).catch(() => {}),
    ),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scrollbackRegistry.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrollbackRegistry.ts src/lib/scrollbackRegistry.test.ts
git commit -m "feat(scrollback): registry of live pane serializers"
```

---

### Task 4: Serialize, restore, and register in the terminal

**Files:**
- Modify: `package.json` (add `@xterm/addon-serialize`)
- Modify: `src/Terminal.tsx` (load the addon, restore before spawn, register, save on unmount)

**Interfaces:**
- Consumes: `scrollback_load` / `scrollback_save` (Task 2), `registerPane` / `unregisterPane` (Task 3), stable pane ids (Task 1).
- Produces: a terminal that restores its own buffer. Task 5 relies on `registerPane` having been called for every live pane.

- [ ] **Step 1: Install the addon**

```bash
npm install @xterm/addon-serialize@^0.13.0
```

Verify it resolved (`0.13.x` is the release line that pairs with `@xterm/xterm` 5.5):

```bash
node -e "console.log(require('./package.json').dependencies['@xterm/addon-serialize'])"
```

- [ ] **Step 2: Import the addon and the registry**

In `src/Terminal.tsx`, add beside the other addon imports:

```ts
import { SerializeAddon } from "@xterm/addon-serialize";
```

and beside the `agentRuntime` import:

```ts
import { registerPane, unregisterPane } from "./lib/scrollbackRegistry";
```

- [ ] **Step 3: Load the addon in the mount effect**

In the mount effect, immediately after the `SearchAddon` is loaded
(`term.loadAddon(search); searchRef.current = search;`), add:

```ts
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
```

- [ ] **Step 4: Restore before spawning the shell**

Replace the existing spawn chain — the block beginning
`void resolveSpawnEnv(shell, terminalEnv, syncLoginPath)` and ending
`.catch((err) => term.writeln(...))` — with:

```ts
    // Restore the saved buffer BEFORE the shell spawns, so the new prompt lands
    // after the restored text rather than racing it.
    //
    // The setting is read from the store here rather than taken as a hook
    // dependency on purpose: adding it to this effect's dep array would remount
    // every terminal — killing its PTY — whenever the toggle changes.
    const restoreThenSpawn = async () => {
      if (paneId && useStore.getState().settings.persistScrollback) {
        try {
          const saved = await invoke<string>("scrollback_load", { paneId });
          if (!disposed && saved) {
            term.write(saved);
            // Dim rule so a stale buffer is never mistaken for a live agent.
            term.write("\r\n\x1b[2m── restored from your last session ──\x1b[0m\r\n");
          }
        } catch {
          // No saved buffer, or the store is unreadable — start clean.
        }
      }
      if (disposed) return;
      if (paneId) registerPane(paneId, () => serialize.serialize());

      const env = await resolveSpawnEnv(shell, terminalEnv, syncLoginPath);
      const id = await invoke<number>("pty_spawn", {
        cwd: cwd ?? null,
        rows: term.rows,
        cols: term.cols,
        shell: shell || null,
        env,
        onOutput,
      });
      if (disposed) {
        void invoke("pty_close", { id });
        return;
      }
      sessionId = id;
      sessionRef.current = id;
      if (paneId) setPaneSession(paneId, id);
      // Agent quick-launch: run the command once the shell is up.
      if (initialCommand) void invoke("pty_write", { id, data: initialCommand + "\r" });
    };
    void restoreThenSpawn().catch((err) => term.writeln(`\r\n[pty_spawn error] ${err}`));
```

- [ ] **Step 5: Save on unmount**

In the mount effect's cleanup function, add this **before** the existing
`term.dispose();` line — the addon is disposed with the terminal, so
serializing after that point returns nothing:

```ts
      if (paneId) {
        if (useStore.getState().settings.persistScrollback) {
          try {
            void invoke("scrollback_save", { paneId, data: serialize.serialize() }).catch(() => {});
          } catch {
            // Serialization can throw if the buffer is already torn down.
          }
        }
        unregisterPane(paneId);
      }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

`persistScrollback` does not exist on `Settings` yet, so this step **will**
report `Property 'persistScrollback' does not exist on type 'Settings'`. That
is expected — Task 5 Step 1 adds it. Complete Task 5 Step 1, then re-run this
step before committing.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/Terminal.tsx
git commit -m "feat(scrollback): restore and save a pane's buffer"
```

---

### Task 5: The setting, the flush hooks, and pruning

**Files:**
- Modify: `src/types.ts` (`Settings.persistScrollback`)
- Modify: `src/state/store.ts` (default, flush hooks, prune on session write)
- Modify: `src/components/SettingsModal.tsx` (toggle + purge button)
- Test: `src/state/store.scrollback.test.ts`

**Interfaces:**
- Consumes: `saveAllScrollback` (Task 3), `scrollback_prune` / `scrollback_clear` (Task 2).
- Produces: `settings.persistScrollback: boolean` (default `true`). Task 4 reads it.

- [ ] **Step 1: Add the setting**

In `src/types.ts`, add to the `Settings` interface:

```ts
  /** keep each terminal's scrollback on disk so restored tabs come back with
   *  their text; stored locally in plain text, never transmitted */
  persistScrollback: boolean;
```

In `src/state/store.ts`, add to `DEFAULT_SETTINGS`:

```ts
  persistScrollback: true,
```

- [ ] **Step 2: Write the failing tests**

Create `src/state/store.scrollback.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { registerPane, unregisterPane, livePaneIds } from "../lib/scrollbackRegistry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const WT = { id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const id of livePaneIds()) unregisterPane(id);
  useStore.setState({ terminals: [], activeTabId: null, worktrees: { r1: [WT] }, paneSessions: {} });
  vi.runOnlyPendingTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("scrollback lifecycle", () => {
  it("defaults persistScrollback on", () => {
    expect(useStore.getState().settings.persistScrollback).toBe(true);
  });

  it("prunes saved buffers down to the panes that still exist", () => {
    useStore.getState().restoreSession(); // marks hydrated
    useStore.getState().openWorktreeTerminal(WT);
    vi.advanceTimersByTime(300);

    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_prune");
    expect(call).toBeTruthy();
    const keep = (call![1] as { keep: string[] }).keep;
    expect(keep).toEqual(useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id)));
  });

  it("saves every live pane when the window is hidden", () => {
    registerPane("p1", () => "buffer one");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_save");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ paneId: "p1", data: "buffer one" });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("saves every live pane on unload", () => {
    registerPane("p2", () => "buffer two");
    window.dispatchEvent(new Event("beforeunload"));
    const call = vi.mocked(invoke).mock.calls.find(([c]) => c === "scrollback_save");
    expect((call![1] as { paneId: string }).paneId).toBe("p2");
  });

  it("saves nothing when the setting is off", () => {
    useStore.getState().updateSettings({ persistScrollback: false });
    vi.mocked(invoke).mockClear();
    registerPane("p3", () => "buffer three");
    window.dispatchEvent(new Event("beforeunload"));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "scrollback_save")).toBe(false);
  });

  it("purges everything already saved when the setting is switched off", () => {
    useStore.getState().updateSettings({ persistScrollback: false });
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "scrollback_clear")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.scrollback.test.ts`
Expected: FAIL — no `scrollback_prune`, `scrollback_save`, or `scrollback_clear`
call is ever made.

- [ ] **Step 4: Add the flush hook**

In `src/state/store.ts`, add the import:

```ts
import { saveAllScrollback } from "../lib/scrollbackRegistry";
```

Add beside `flushNotes` / `flushSession`:

```ts
/** Snapshot every live terminal to disk. Called from the same hide/unload
 *  hooks as the notes and session flushes — the window going to the background
 *  is the last reliable signal before a crash or a force-quit. */
function flushScrollback() {
  if (!useStore.getState().settings.persistScrollback) return;
  void saveAllScrollback();
}
```

Then add `flushScrollback();` beside the existing `flushNotes(); flushSession();`
calls in **both** the `beforeunload` listener and the `visibilitychange`
listener.

- [ ] **Step 5: Prune on the session write**

In the session-persist subscriber, inside the `setTimeout` callback and after
the `localStorage.setItem(SESSION_KEY, snapshot)` call, add:

```ts
    // Drop saved buffers for panes that no longer exist (spec R3). Rides the
    // debounced session write, so closing a tab cleans up within ~300ms rather
    // than leaving an orphan file until the next launch.
    void invoke("scrollback_prune", {
      keep: useStore.getState().terminals.flatMap((t) => t.panes.map((p) => p.id)),
    }).catch(() => {});
```

- [ ] **Step 6: Purge when the setting is switched off**

In `updateSettings`, before applying the partial, add:

```ts
  updateSettings: (partial) => {
    // Turning the feature off must also delete what is already on disk —
    // an off switch that leaves the data behind is not an off switch.
    if (partial.persistScrollback === false && get().settings.persistScrollback) {
      void invoke("scrollback_clear").catch(() => {});
    }
```

Keep the rest of the existing `updateSettings` body unchanged.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.scrollback.test.ts`
Expected: 6 passed.

- [ ] **Step 8: Add the Settings UI**

In `src/components/SettingsModal.tsx`, add a row in the terminal section,
matching the markup of the existing `webgl` checkbox row:

```tsx
      <label className="settings-row">
        <input
          type="checkbox"
          checked={settings.persistScrollback}
          onChange={(e) => updateSettings({ persistScrollback: e.target.checked })}
        />
        <span>
          Remember terminal scrollback between launches
          <small>
            Saved locally in plain text under AgentPanel's app-data folder, capped at 256&nbsp;KB
            per terminal. Never transmitted. Turning this off deletes everything already saved.
          </small>
        </span>
      </label>
      <button
        className="settings-danger"
        onClick={() => {
          void invoke("scrollback_clear").catch(() => {});
          pushToast("Saved scrollback cleared.", "info");
        }}
      >
        Clear saved scrollback
      </button>
```

Match the file's own conventions for `settings`, `updateSettings`, `pushToast`,
and `invoke` — read the surrounding rows before pasting, and reuse whatever
class names and label structure they already use.

- [ ] **Step 9: Typecheck and run everything**

Run:

```bash
npx tsc --noEmit && npm test && cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all green. This is also the point at which Task 4 Step 6's expected
`persistScrollback` type error must be gone.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/state/store.ts src/state/store.scrollback.test.ts src/components/SettingsModal.tsx
git commit -m "feat(scrollback): setting, flush hooks, pruning, and purge"
```

---

### Task 6: Real-app verification and docs

Unit tests cannot see a terminal render, and this feature's whole payload is
what appears on screen after a restart.

**Files:**
- Modify: `README.md` (Features list and Telemetry section)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Verify in the running app**

```bash
npm run tauri dev
```

Check by hand:
1. Open a terminal on a worktree. Run something noisy (`git log`, or an agent).
2. Quit the app **normally**. Relaunch.
3. The tab reopens **with its text**, followed by the dim
   `── restored from your last session ──` rule, then a fresh prompt.
4. The restored text is scrollable and its colours are intact — no stray escape
   characters at the top (that would mean the truncation cut mid-sequence).
5. Type in the restored terminal. The shell responds — it is a live, fresh PTY.
6. Split a tab into two panes, put different output in each, quit, relaunch:
   **each pane** gets its own correct buffer back, not a shared or swapped one.
   This is the test that proves Task 1's stable ids actually work.
7. Close a tab, wait ~1s, and confirm its file is gone from
   `%APPDATA%\com.jason.agentpanel\scrollback\` (Windows) or
   `~/Library/Application Support/com.jason.agentpanel/scrollback/` (macOS).
8. Settings → uncheck "Remember terminal scrollback". The `scrollback` folder
   empties. Quit and relaunch: terminals come back empty, with no dim rule.
9. Re-check the setting, generate output, quit, relaunch: restoring works again.
10. Generate **more than 256 KB** of output (`yes | head -50000`), quit,
    relaunch: the pane restores the recent tail quickly, and startup is not
    visibly slower.

- [ ] **Step 2: Update the README**

Add to the Features list, after the "Parallel terminal tabs" bullet:

```markdown
- **Scrollback that survives a restart** — restored tabs come back with their text,
  not empty. Capped at 256 KB per terminal, stored locally, and switchable off in
  Settings.
```

And add to the Telemetry section's "What's never sent" list, so the new on-disk
file is not mistaken for a change in what leaves the machine:

```markdown
- Terminal scrollback saved for session restore — it is written only to
  AgentPanel's local app-data folder and is never transmitted (turn it off in
  Settings → "Remember terminal scrollback")
```

- [ ] **Step 3: Final verification and commit**

```bash
npx tsc --noEmit
npm test
cargo test --manifest-path src-tauri/Cargo.toml
git add README.md
git commit -m "docs: document scrollback persistence"
```

Expected: all three green.

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| R1 scrollback restored on relaunch | Task 4 Step 4; Task 6 Step 1 items 2–3 |
| R2 restored content is distinguishable | Task 4 Step 4 (dim rule); Task 6 Step 1 item 3 |
| R3 capped and pruned | Task 2 (`trim_to_cap`, `scrollback_prune`), Task 5 Step 5 |
| R4 never blocks, never per-chunk | Task 4 Steps 4–5, Task 5 Step 4 — three call sites only |
| R5 survives an unexpected quit | Task 5 Step 4 (`visibilitychange` → hidden) |
| R6 off switch + purge | Task 5 Steps 6, 8 |
| R7 restored ids stay unique | Task 1 Step 3 (`adoptPaneSeq`) + its two collision tests |
| D1 ids in the snapshot, legacy fallback | Task 1 Steps 4–5 |
| D2 files, not localStorage | Task 2 |
| D3 256 KiB, tail, line boundary | Task 2 Step 3 + `cuts_at_a_line_boundary` |
| D5 module-level registry | Task 3 |
| D7 documented as local plain text | Task 5 Step 8, Task 6 Step 2 |

No gaps.

**Type consistency:** the command names `scrollback_save`, `scrollback_load`,
`scrollback_prune`, `scrollback_clear` and their argument keys (`paneId`,
`data`, `keep`) match between Task 2's Rust signatures and every `invoke` call
in Tasks 3, 4, and 5. `registerPane` / `unregisterPane` / `saveAllScrollback` /
`livePaneIds` match between Task 3's exports and Tasks 4–5's imports.

**Known cross-task type gap:** Task 4 uses `settings.persistScrollback`, which
Task 5 Step 1 declares. Task 4 Step 6 names this explicitly and says to finish
Task 5 Step 1 before committing Task 4. Running Tasks 4 and 5 as one review unit
avoids it.
