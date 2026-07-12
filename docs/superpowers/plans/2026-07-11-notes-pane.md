# Session Notes Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable, per-session notes pane (issue #13) that persists across restarts.

**Architecture:** A collapsible right-side panel showing a plain textarea bound to the active worktree's note. State (`notes`, `notesOpen`) lives in the existing Zustand store and persists to `localStorage`, mirroring the store's existing `agentpanel.session` / `agentpanel.settings` persistence. No Rust changes.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest + @testing-library/react (jsdom), Vite.

## Global Constraints

- **No Rust / Tauri backend changes** — frontend only.
- **localStorage keys:** notes under `agentpanel.notes` (JSON `Record<worktreeId, string>`); panel open state under `agentpanel.notesOpen` (`"true"`/`"false"`).
- **Notes are scoped to the worktree (session)**, keyed by `worktreeId`. All of a worktree's tabs share one note.
- **Notes writes are debounced ~300ms**; `notesOpen` writes immediately.
- **Panel is fixed-width 300px**, no resize handle (v1).
- **Plain textarea only** — no markdown parsing, no task-item model.
- **Test runner:** `npm test` (= `vitest run`). Component/persistence tests need the DOM — put `// @vitest-environment jsdom` as the file's first line.
- Follow existing patterns: defensive `try/catch` around all localStorage access (see `readSettings`, store.ts:47-54); subscribe-driven persistence (store.ts:588-627).

---

### Task 1: Store state, actions, persistence, and orphan pruning

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.notes.test.ts` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - State: `notes: Record<string, string>`, `notesOpen: boolean`
  - Actions: `setNote(worktreeId: string, text: string): void`, `toggleNotes(): void`
  - localStorage keys `agentpanel.notes`, `agentpanel.notesOpen`
  - Existing exported selector `selectActiveWorktreeId(s): string | null` (store.ts:549) is reused by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/state/store.notes.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

// store.ts shells out via invoke in removeRepository/deleteWorktree.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

// Fake timers so the debounced notes write is deterministic (no real-timer leak
// across tests). beforeEach flushes any write scheduled by the state reset.
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({
    notes: {},
    notesOpen: false,
    repositories: [],
    worktrees: {},
    terminals: [],
    activeTabId: null,
    paneSessions: {},
  });
  vi.runOnlyPendingTimers();
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("notes store", () => {
  it("setNote stores text under the worktree id", () => {
    useStore.getState().setNote("wtA", "hello");
    expect(useStore.getState().notes.wtA).toBe("hello");
  });

  it("toggleNotes flips notesOpen", () => {
    expect(useStore.getState().notesOpen).toBe(false);
    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(true);
    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(false);
  });

  it("persists notes to localStorage after the 300ms debounce", () => {
    useStore.getState().setNote("wtA", "draft");
    expect(localStorage.getItem("agentpanel.notes")).toBeNull(); // not yet
    vi.advanceTimersByTime(300);
    expect(JSON.parse(localStorage.getItem("agentpanel.notes")!)).toEqual({ wtA: "draft" });
  });

  it("persists notesOpen immediately", () => {
    useStore.getState().toggleNotes();
    expect(localStorage.getItem("agentpanel.notesOpen")).toBe("true");
  });

  it("removeRepository prunes notes for that repo's worktrees, keeping others", async () => {
    useStore.setState({
      repositories: [{ id: "r1", path: "/r1", name: "r1", isGit: true }],
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/r1", name: "main", branch: "main", isPrimary: true }] },
      notes: { wt1: "will go", wtOther: "stays" },
    });
    await useStore.getState().removeRepository("r1");
    expect(useStore.getState().notes.wt1).toBeUndefined();
    expect(useStore.getState().notes.wtOther).toBe("stays");
  });

  it("deleteWorktree prunes the removed worktree's note, keeping others", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "delete_worktree") return []; // wt1 removed; none remain
      return undefined; // pty_close etc.
    });
    useStore.setState({
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
      notes: { wt1: "gone soon", wt2: "stays" },
    });
    await useStore.getState().deleteWorktree("r1", "/wt1");
    expect(useStore.getState().notes.wt1).toBeUndefined();
    expect(useStore.getState().notes.wt2).toBe("stays");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store.notes`
Expected: FAIL — `setNote`/`toggleNotes` are not functions; `notes`/`notesOpen` undefined.

- [ ] **Step 3: Add init helpers and localStorage keys**

In `src/state/store.ts`, right after the `readSettings` function (store.ts:47-54), add:

```ts
const NOTES_KEY = "agentpanel.notes";
const NOTES_OPEN_KEY = "agentpanel.notesOpen";

function readNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function readNotesOpen(): boolean {
  try {
    return localStorage.getItem(NOTES_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Extend the AppState interface**

In the `interface AppState` block, add these fields near the other UI state (e.g. after `worktreeMru`, store.ts:80):

```ts
  /** per-session notes, keyed by worktree id (= path); shared by a worktree's tabs */
  notes: Record<string, string>;
  /** whether the notes side panel is open (global toggle) */
  notesOpen: boolean;
```

And add these action signatures near the other setters (e.g. after `setActiveWorktree`, store.ts:116):

```ts
  /** set (replace) the note text for a worktree */
  setNote: (worktreeId: string, text: string) => void;
  /** open/close the notes side panel */
  toggleNotes: () => void;
```

- [ ] **Step 5: Add initial state and action implementations**

In the `create<AppState>(...)` initial object, after `worktreeMru: {},` (store.ts:80) add:

```ts
  notes: readNotes(),
  notesOpen: readNotesOpen(),
```

Then add the two actions (place them right after `setActiveWorktree`, store.ts:439):

```ts
  setNote: (worktreeId, text) =>
    set((s) => ({ notes: { ...s.notes, [worktreeId]: text } })),

  toggleNotes: () => set((s) => ({ notesOpen: !s.notesOpen })),
```

- [ ] **Step 6: Prune notes in removeRepository**

In `removeRepository` (store.ts:186-215), the reducer already computes `wtIds` (the set of the repo's worktree ids). Add note pruning and include `notes` in the returned object:

```ts
    set((s) => {
      const wtIds = new Set((s.worktrees[id] ?? []).map((w) => w.id));
      const worktrees = { ...s.worktrees };
      delete worktrees[id];
      // Drop terminals belonging to this repo's worktrees (their panes unmount
      // and fire pty_close).
      const removed = s.terminals.filter((t) => wtIds.has(t.worktreeId));
      const terminals = s.terminals.filter((t) => !wtIds.has(t.worktreeId));
      const paneSessions = { ...s.paneSessions };
      for (const t of removed) for (const p of t.panes) delete paneSessions[p.id];
      const notes = { ...s.notes };
      for (const wtId of wtIds) delete notes[wtId];
      const activeTabId =
        s.activeTabId && terminals.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (terminals.at(-1)?.id ?? null);
      return {
        repositories: s.repositories.filter((r) => r.id !== id),
        worktrees,
        terminals,
        paneSessions,
        notes,
        activeTabId,
      };
    });
```

- [ ] **Step 7: Prune notes in deleteWorktree**

Replace the body of `deleteWorktree` (store.ts:339-349) so it diffs the worktree list before/after and prunes notes for whatever ids disappeared (robust whether or not `id === path`):

```ts
  deleteWorktree: async (repoId, worktreePath) => {
    // Kill the worktree's terminals FIRST so the OS releases the directory
    // (on Windows a shell's cwd locks the dir and blocks `git worktree remove`).
    await get().closeWorktreeTerminals(worktreePath);
    const prev = get().worktrees[repoId] ?? [];
    try {
      const list = await invoke<Worktree[]>("delete_worktree", { repoId, worktreePath });
      set((s) => {
        const stillThere = new Set(list.map((w) => w.id));
        const removedIds = prev.filter((w) => !stillThere.has(w.id)).map((w) => w.id);
        const notes = { ...s.notes };
        for (const wtId of removedIds) delete notes[wtId];
        return { worktrees: { ...s.worktrees, [repoId]: list }, notes };
      });
    } catch (err) {
      get().pushToast(`Couldn't remove worktree: ${err}`);
    }
  },
```

- [ ] **Step 8: Add the persistence subscribe blocks**

At the very end of `src/state/store.ts` (after the watched-paths subscribe, store.ts:627), add:

```ts
// Persist per-session notes to localStorage, debounced so a burst of keystrokes
// collapses into one write. Gated by a snapshot string like the other subscribers.
let lastNotesSnapshot = JSON.stringify(useStore.getState().notes);
let notesWriteTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => {
  const snapshot = JSON.stringify(s.notes);
  if (snapshot === lastNotesSnapshot) return;
  lastNotesSnapshot = snapshot;
  if (notesWriteTimer) clearTimeout(notesWriteTimer);
  notesWriteTimer = setTimeout(() => {
    try {
      localStorage.setItem(NOTES_KEY, snapshot);
    } catch (err) {
      console.error("notes persist failed", err);
    }
  }, 300);
});

// Persist the notes panel open/closed flag immediately (single boolean).
let lastNotesOpen = useStore.getState().notesOpen;
useStore.subscribe((s) => {
  if (s.notesOpen === lastNotesOpen) return;
  lastNotesOpen = s.notesOpen;
  try {
    localStorage.setItem(NOTES_OPEN_KEY, JSON.stringify(s.notesOpen));
  } catch (err) {
    console.error("notesOpen persist failed", err);
  }
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- store.notes`
Expected: PASS (6 tests).

- [ ] **Step 10: Commit**

```bash
git add src/state/store.ts src/state/store.notes.test.ts
git commit -m "Add notes store state, actions, persistence & pruning (#13)"
```

---

### Task 2: NotesPanel component

**Files:**
- Create: `src/components/NotesPanel.tsx`
- Test: `src/components/NotesPanel.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `useStore` state `notes`, `notesOpen`; action `setNote`; selector `selectActiveWorktreeId`.
- Produces: `export function NotesPanel(): JSX.Element | null` — takes no props; renders an `<aside className="notes-panel">` with a single `<textarea className="notes-textarea">` when open and a worktree is active, else `null`.

- [ ] **Step 1: Write the failing test**

Create `src/components/NotesPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import { useStore } from "../state/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
afterEach(cleanup);

function seed(open: boolean, notes: Record<string, string> = {}) {
  useStore.setState({
    notes,
    notesOpen: open,
    worktrees: {
      r1: [{ id: "wtA", repoId: "r1", path: "wtA", name: "alpha", branch: "alpha", isPrimary: true }],
    },
    terminals: [{ id: "tA", worktreeId: "wtA", cwd: ".", title: "Terminal", panes: [{ id: "pA" }] }],
    activeTabId: "tA",
  });
}

describe("NotesPanel", () => {
  it("renders nothing when closed", () => {
    seed(false);
    const { container } = render(<NotesPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the active session's note when open", () => {
    seed(true, { wtA: "remember the migration" });
    render(<NotesPanel />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("remember the migration");
  });

  it("writes edits back to the active session's note", () => {
    seed(true, {});
    render(<NotesPanel />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new note" } });
    expect(useStore.getState().notes.wtA).toBe("new note");
  });

  it("renders nothing when there is no active worktree", () => {
    useStore.setState({ notesOpen: true, terminals: [], activeTabId: null });
    const { container } = render(<NotesPanel />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- NotesPanel`
Expected: FAIL — cannot find module `./NotesPanel`.

- [ ] **Step 3: Write the component**

Create `src/components/NotesPanel.tsx`:

```tsx
import { useStore, selectActiveWorktreeId } from "../state/store";

/**
 * Right-side notes pane (issue #13). Shows a single freeform textarea bound to
 * the active worktree's note. Holds no local state — it selects the active
 * worktree and its note from the store, so every session-switch path (tab
 * click, session click, keyboard nav, MRU) drives it for free. Renders nothing
 * when closed or when no worktree is active.
 */
export function NotesPanel() {
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const notesOpen = useStore((s) => s.notesOpen);
  const note = useStore((s) => (activeWorktreeId ? s.notes[activeWorktreeId] ?? "" : ""));
  const setNote = useStore((s) => s.setNote);

  if (!notesOpen || !activeWorktreeId) return null;

  return (
    <aside className="notes-panel">
      <textarea
        className="notes-textarea"
        value={note}
        placeholder="Notes & tasks for this session…"
        spellCheck={false}
        onChange={(e) => setNote(activeWorktreeId, e.target.value)}
      />
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- NotesPanel`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/NotesPanel.tsx src/components/NotesPanel.test.tsx
git commit -m "Add NotesPanel component (#13)"
```

---

### Task 3: Wire the toggle button, layout, and styling

**Files:**
- Modify: `src/components/TabBar.tsx` (add 📝 toggle button + two optional props)
- Modify: `src/components/TabBar.test.tsx` (add a toggle test)
- Modify: `src/App.tsx` (render NotesPanel; wrap terminal stack in `.content-row`; pass props to TabBar)
- Modify: `src/App.css` (add `.content-row`, `.notes-panel`, `.notes-textarea`; give `.terminal-stack` a `min-width`)

**Interfaces:**
- Consumes (from Task 1 & 2): store `notesOpen` + `toggleNotes`; `NotesPanel` component.
- Produces: `TabBar` now accepts optional `onToggleNotes?: () => void` and `notesOpen?: boolean` in addition to `onOpenSettings`. Existing callers/tests that pass only `onOpenSettings` keep compiling.

- [ ] **Step 1: Write the failing test**

In `src/components/TabBar.test.tsx`, add this describe block after the existing ones (before the final closing lines):

```tsx
describe("TabBar notes toggle (issue #13)", () => {
  it("shows a notes button and calls onToggleNotes on click", () => {
    seedOneTerminal();
    const onToggleNotes = vi.fn();
    render(<TabBar onOpenSettings={vi.fn()} onToggleNotes={onToggleNotes} notesOpen={false} />);
    fireEvent.click(screen.getByTitle(/notes for this session/i));
    expect(onToggleNotes).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- TabBar`
Expected: FAIL — no element with title "Notes for this session"; TS error on unknown props `onToggleNotes`/`notesOpen`.

- [ ] **Step 3: Add props + button to TabBar**

In `src/components/TabBar.tsx`, change the component signature (TabBar.tsx:49) to accept the two optional props with defaults:

```tsx
export function TabBar({
  onOpenSettings,
  onToggleNotes,
  notesOpen = false,
}: {
  onOpenSettings: () => void;
  onToggleNotes?: () => void;
  notesOpen?: boolean;
}) {
```

Then add the notes toggle button immediately BEFORE the settings `gear` button (TabBar.tsx:242):

```tsx
      <button
        className={`gear notes-toggle ${notesOpen ? "active" : ""}`}
        title="Notes for this session"
        onClick={() => onToggleNotes?.()}
      >
        📝
      </button>
```

- [ ] **Step 4: Run TabBar tests to verify they pass**

Run: `npm test -- TabBar`
Expected: PASS (existing gear/editor tests still green + the new toggle test).

- [ ] **Step 5: Wire App.tsx**

In `src/App.tsx`:

Add the import near the other component imports (after App.tsx:9):

```tsx
import { NotesPanel } from "./components/NotesPanel";
```

Add store selectors next to the other `useStore` calls (after App.tsx:67):

```tsx
  const notesOpen = useStore((s) => s.notesOpen);
  const toggleNotes = useStore((s) => s.toggleNotes);
```

Change the `<TabBar .../>` element (App.tsx:328) to pass the new props:

```tsx
              <TabBar
                onOpenSettings={() => setSettingsOpen(true)}
                onToggleNotes={toggleNotes}
                notesOpen={notesOpen}
              />
```

Wrap the existing `.terminal-stack` div and the new `NotesPanel` in a `.content-row`. Replace the whole `<div className="terminal-stack"> … </div>` block (App.tsx:329-377) so it is nested inside a new flex row:

```tsx
              <div className="content-row">
                <div className="terminal-stack">
                  {/* All tabs (and their panes) stay mounted so PTYs keep running
                      in parallel; only the active tab is visible. The xterm chunk
                      loads on first terminal (Suspense). */}
                  <Suspense fallback={null}>
                  {terminals.map((t) => (
                    <div
                      key={t.id}
                      className="terminal-host"
                      style={{ display: t.id === activeTabId ? "flex" : "none" }}
                    >
                      {t.panes.map((pane, paneIndex) => {
                        const ratio = t.splitRatio ?? 0.5;
                        const split = t.panes.length === 2;
                        return (
                          <Fragment key={pane.id}>
                            {paneIndex === 1 && (
                              <PaneDivider onResize={(r) => setSplitRatio(t.id, r)} />
                            )}
                            <div
                              className="pane-wrap"
                              style={split ? { flexGrow: paneIndex === 0 ? ratio : 1 - ratio } : undefined}
                            >
                              {t.panes.length > 1 && (
                                <button
                                  className="pane-close"
                                  title="Close pane"
                                  onClick={() => closePane(t.id, pane.id)}
                                >
                                  ✕
                                </button>
                              )}
                              <PaneErrorBoundary>
                                <TerminalPane
                                  cwd={t.cwd}
                                  paneId={pane.id}
                                  initialCommand={pane.initialCommand}
                                  active={t.id === activeTabId}
                                  autoFocus={t.id === activeTabId && paneIndex === 0}
                                />
                              </PaneErrorBoundary>
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  ))}
                  </Suspense>
                </div>
                <NotesPanel />
              </div>
```

(Only structural change: the former `terminal-stack` div is now wrapped by `<div className="content-row"> … <NotesPanel /> </div>`. Inner content is unchanged.)

- [ ] **Step 6: Add styling**

In `src/App.css`, modify the `.terminal-stack` rule (App.css:1063-1068) to add a horizontal min so it can shrink beside the panel — add one line:

```css
.terminal-stack {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  position: relative;
  padding: 4px;
}
```

Then append the new rules (e.g. right after the `.terminal-stack` block):

```css
.content-row {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.notes-panel {
  flex: 0 0 300px;
  width: 300px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
}

.notes-textarea {
  flex: 1 1 auto;
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 12px;
}
```

- [ ] **Step 7: Run the full test suite + typecheck**

Run: `npm test`
Expected: PASS (all suites, including store.notes, NotesPanel, TabBar).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/TabBar.tsx src/components/TabBar.test.tsx src/App.tsx src/App.css
git commit -m "Wire notes pane toggle, layout & styling (#13)"
```

---

### Task 4: Live verification

**Files:** none (manual verification pass; tsc/unit tests miss render crashes and real persistence).

**Interfaces:** Consumes the finished feature end-to-end.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev`
Expected: app builds and the window opens without a blank screen / console errors.

- [ ] **Step 2: Toggle and edit**

- Open a worktree terminal so the tab bar shows.
- Click the 📝 button. Expected: a ~300px panel appears on the right with the "Notes & tasks for this session…" placeholder; the button shows its active style.
- Type several lines including a `- [ ] task` line. Expected: text stays as typed (plain text, no reformatting).

- [ ] **Step 3: Verify per-session scoping**

- Open a second worktree (a different session) and switch to it (session click or Ctrl+Shift+↓).
- Expected: the panel now shows that session's (empty) note, not the first one's. Type something different.
- Switch back. Expected: the first session's note is intact.

- [ ] **Step 4: Verify persistence across restart**

- Close the app and relaunch (`npm run tauri dev`).
- Expected: the panel is still open (open state persisted) and each session's note text is restored.

- [ ] **Step 5: Update memory / verify note**

Per the repo memory note *"verify UI renders before claiming tested"*, confirm the above was actually observed in the running app (not just via unit tests) before declaring the feature done.

- [ ] **Step 6: (Optional) commit any tweaks**

If verification surfaced a CSS/behavior tweak, fix it and commit:

```bash
git add -A
git commit -m "Polish notes pane after live verification (#13)"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-11-notes-pane-design.md`):
- Per-session scope, keyed by worktreeId → Task 1 (state) + Task 2 (selector use). ✓
- Right side panel, fixed 300px, below tab bar → Task 3 (App.tsx `.content-row`, App.css). ✓
- 📝 toggle in tab bar, global open/close → Task 3 (TabBar button) + Task 1 (`toggleNotes`). ✓
- localStorage `agentpanel.notes` / `agentpanel.notesOpen` → Task 1 (helpers + subscribes). ✓
- Plain textarea, autosave → Task 2 (component) + Task 1 (debounced persist). ✓
- Debounced ~300ms notes write; immediate notesOpen write → Task 1 Step 8 + tests Step 1. ✓
- Orphan pruning on removeRepository + deleteWorktree → Task 1 Steps 6-7 + tests. ✓
- Error handling (try/catch reads & writes; null render with no worktree; toggle only when TabBar shown) → Task 1 helpers/subscribes, Task 2 null guard. ✓
- Testing (store unit, persistence, component, live) → Tasks 1, 2, 4. ✓
- Out of scope items (checkboxes, task model, resize, per-session open memory, repo storage) → not implemented. ✓

**Placeholder scan:** none — every code step contains full code; every run step has an exact command + expected result.

**Type consistency:** `setNote(worktreeId, text)` and `toggleNotes()` used identically across store, component, and tests. `notes: Record<string,string>` and `notesOpen: boolean` consistent. `selectActiveWorktreeId` reused from store.ts:549 (already exported). localStorage keys are the exact strings `agentpanel.notes` / `agentpanel.notesOpen` everywhere.
