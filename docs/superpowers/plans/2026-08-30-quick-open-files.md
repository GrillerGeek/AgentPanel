# Quick Open (files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Ctrl+P` fuzzy-finds any file in the active worktree and opens it in the configured editor.

**Architecture:** A new `git.rs` function shells out to `git ls-files --cached --others --exclude-standard`, exposed as an `async` + `spawn_blocking` Tauri command. `CommandPalette` gains a `mode` prop — `"commands"` (today's behaviour, unchanged) or `"files"` — sharing all of its input, keyboard, scroll, and row-rendering code. File paths live in separate component state, fetched on open and discarded on close.

**Tech Stack:** Rust + `std::process::Command`, Tauri commands, React 19, Zustand 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-quick-open-files-design.md`

## Global Constraints

- **The Rust command is `pub async fn` + `tauri::async_runtime::spawn_blocking`,** matching `worktree_status` (`commands.rs:202`), `worktree_pr` (`:215`), and `worktree_diff`. A synchronous Tauri command runs on the main UI thread and freezes the window. This is not optional and it is not stylistic — it is the exact defect that shipped and had to be fixed on the diff-review branch.
- **Every git invocation goes through the existing `run_git` helper in `src-tauri/src/git.rs`,** which already wraps `configure_no_window` — without it a console window flashes on Windows.
- **Never error on a missing file list.** A plain (non-git) folder, a repo with no commits, or a missing `git` returns an **empty vector**, never `Err`. No toast, ever.
- **Do not add file paths to `CommandPalette`'s `commands` array.** It builds every command in one `useMemo` and fuzzy-scores the whole array per keystroke; thousands of paths there would drown the commands and stall typing. File results are separate state.
- **Command mode must behave exactly as it does today.** Its command list, ordering, placeholder, and behaviour are unchanged.
- Caps: Rust returns at most **20,000** paths; the UI renders at most **200** rows. Both truncations must be visible to the user, never silent.
- A test touching the DOM or `localStorage` needs `// @vitest-environment jsdom` as its first line, and component tests in this repo call `afterEach(cleanup)` explicitly — there is no global setup file (see `src/components/NotesPanel.test.tsx`).

---

### Task 1: List a worktree's files (Rust)

**Files:**
- Modify: `src-tauri/src/git.rs` (add `list_files` + tests)
- Modify: `src-tauri/src/commands.rs` (add the `worktree_files` command)
- Modify: `src-tauri/src/lib.rs` (register it)

**Interfaces:**
- Consumes: the existing private `run_git` and `configure_no_window` in `git.rs`.
- Produces: `pub fn list_files(repo_path: &str) -> Vec<String>` in `git.rs`, and the Tauri command `worktree_files({ path: string }) -> string[]`. Task 3 invokes that exact name with that exact argument key.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/git.rs`'s existing `#[cfg(test)] mod tests` (it already has `run_raw` and `init_repo` helpers — reuse them, do not redefine):

```rust
    #[test]
    fn lists_tracked_and_unignored_untracked_files() {
        let base = std::env::temp_dir().join(format!("agentpanel_lsfiles_{}", std::process::id()));
        let repo = base.join("repo");
        init_repo(&repo); // creates + commits README.md

        fs::write(repo.join("untracked.txt"), "hi").unwrap();
        fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(repo.join("ignored.txt"), "nope").unwrap();

        let files = list_files(&repo.to_string_lossy());
        assert!(files.contains(&"README.md".to_string()), "tracked: {files:?}");
        assert!(files.contains(&"untracked.txt".to_string()), "untracked: {files:?}");
        assert!(files.contains(&".gitignore".to_string()), "gitignore itself: {files:?}");
        assert!(!files.contains(&"ignored.txt".to_string()), "ignored must be excluded: {files:?}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_plain_folder_lists_nothing_rather_than_erroring() {
        let base = std::env::temp_dir().join(format!("agentpanel_lsplain_{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("loose.txt"), "hi").unwrap();
        assert!(list_files(&base.to_string_lossy()).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn caps_the_returned_list() {
        let base = std::env::temp_dir().join(format!("agentpanel_lscap_{}", std::process::id()));
        let repo = base.join("repo");
        init_repo(&repo);
        // MAX_FILES + a few, so the cap is genuinely exercised.
        for i in 0..(MAX_FILES + 5) {
            fs::write(repo.join(format!("f{i}.txt")), "x").unwrap();
        }
        let files = list_files(&repo.to_string_lossy());
        assert_eq!(files.len(), MAX_FILES, "must truncate to the cap");
        let _ = fs::remove_dir_all(&base);
    }
```

> The cap test writes `MAX_FILES + 5` files. If that makes the suite slow, lower `MAX_FILES` **in the test only** is not an option — instead say so in your report and I will rule on the number.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::`
Expected: FAIL — `cannot find function 'list_files'`, `cannot find value 'MAX_FILES'`.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/git.rs`, near the other public functions:

```rust
/// Cap on how many paths a single worktree contributes to Quick Open.
///
/// Beyond this, per-keystroke fuzzy scoring in the palette gets janky no matter
/// what the UI does, so the honest move is to truncate here and say so.
pub const MAX_FILES: usize = 20_000;

/// Files in `repo_path` that git knows about: everything tracked, plus
/// untracked files that `.gitignore` does not exclude.
///
/// Returns an empty vector for a plain folder, a repo with no commits, or a
/// missing `git` — never an error. Quick Open having nothing to offer is a
/// normal state, not a failure to report.
pub fn list_files(repo_path: &str) -> Vec<String> {
    let Ok(out) = run_git(
        repo_path,
        &["ls-files", "--cached", "--others", "--exclude-standard"],
    ) else {
        return Vec::new();
    };
    out.lines()
        .filter(|l| !l.is_empty())
        .take(MAX_FILES)
        .map(str::to_string)
        .collect()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::`
Expected: all pass, including the three new ones.

- [ ] **Step 5: Add the Tauri command**

In `src-tauri/src/commands.rs`, add beside `worktree_diff`:

```rust
/// Every file git knows about in a worktree, for Quick Open.
///
/// Like `worktree_status`, this MUST stay off the main thread: it shells out to
/// `git` and a synchronous Tauri command would freeze the window while a large
/// repository is listed.
#[tauri::command]
pub async fn worktree_files(path: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || git::list_files(&path))
        .await
        .unwrap_or_default()
}
```

Note the return type is a bare `Vec<String>`, not `Result` — there is no error case (spec R5), and `unwrap_or_default()` turns even a panicked worker into an empty list. This mirrors `worktree_pr`, which returns `Option<PrInfo>` for the same reason.

- [ ] **Step 6: Register it**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]`, add after `commands::worktree_file_patch,`:

```rust
            commands::worktree_files,
```

- [ ] **Step 7: Verify the whole crate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass. The only warning should be the pre-existing `unused import: std::process::Command` in `pty.rs`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(quickopen): list a worktree's files via git ls-files"
```

---

### Task 2: Palette file mode

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Test: `src/components/CommandPalette.files.test.tsx` (new)

**Interfaces:**
- Consumes: `worktree_files` (Task 1), the existing `fuzzyScore` (`src/lib/fuzzy.ts`), `selectActiveWorktreeId` (already imported by this file), and `open_in_editor` + `settings.editorCommand` (both already shipped).
- Produces: `CommandPalette` accepting a new required prop `mode: "commands" | "files"`. Task 3 passes it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/CommandPalette.files.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);

const FILES = ["src/state/store.ts", "src/components/TabBar.tsx", "README.md"];

const noop = () => {};

function activate() {
  useStore.setState({
    worktrees: { r1: [{ id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(FILES);
  useStore.setState({ terminals: [], activeTabId: null });
});

describe("CommandPalette file mode", () => {
  it("requests the active worktree's files on open", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("worktree_files", { path: "/wt1" }));
  });

  it("lists the files it received", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    expect(await screen.findByText("src/state/store.ts")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("fuzzy-filters by path", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/state/store.ts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tabbar" } });
    expect(screen.getByText("src/components/TabBar.tsx")).toBeTruthy();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("opens the selected file in the configured editor and closes", async () => {
    activate();
    const onClose = vi.fn();
    render(<CommandPalette mode="files" onClose={onClose} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/state/store.ts");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tabbar" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_in_editor", {
        command: useStore.getState().settings.editorCommand,
        path: "/wt1/src/components/TabBar.tsx",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a calm empty state when the command fails, and pushes no toast", async () => {
    vi.mocked(invoke).mockRejectedValue("boom");
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeTruthy());
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("renders nothing from the command list while in file mode", async () => {
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("README.md");
    expect(screen.queryByText("Open settings…")).toBeNull();
  });

  it("caps the rendered rows and says so", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `src/f${i}.ts`);
    vi.mocked(invoke).mockResolvedValue(many);
    activate();
    render(<CommandPalette mode="files" onClose={noop} onOpenSettings={noop} onOpenPrDashboard={noop} />);
    await screen.findByText("src/f0.ts");
    expect(screen.queryByText("src/f200.ts")).toBeNull();
    expect(screen.getByText(/showing 200 of 250/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/CommandPalette.files.test.tsx`
Expected: FAIL — the `mode` prop does not exist, and no file fetching happens.

- [ ] **Step 3: Add the mode prop and file state**

In `src/components/CommandPalette.tsx`, extend the props (keep the existing three exactly as they are):

```tsx
export function CommandPalette({
  mode,
  onClose,
  onOpenSettings,
  onOpenPrDashboard,
}: {
  mode: "commands" | "files";
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenPrDashboard: () => void;
}) {
```

Add these imports at the top:

```tsx
import { invoke } from "@tauri-apps/api/core";
```

Add near the other `useState` declarations:

```tsx
  const [files, setFiles] = useState<string[]>([]);
  const editorCommand = useStore((s) => s.settings.editorCommand);
  const activeWorktree = useStore((s) =>
    Object.values(s.worktrees).flat().find((w) => w.id === selectActiveWorktreeId(s)) ?? null,
  );
```

- [ ] **Step 4: Fetch files on open**

Add after the existing `useMemo` for `commands`:

```tsx
  // Fetched on open and discarded on close — no cache. A palette open is a
  // deliberate, infrequent action, and caching would need invalidating against
  // the file-watcher event that fires constantly while an agent writes.
  useEffect(() => {
    if (mode !== "files" || !activeWorktree) return;
    let cancelled = false;
    void invoke<string[]>("worktree_files", { path: activeWorktree.path })
      .then((f) => {
        if (!cancelled) setFiles(f);
      })
      .catch(() => {
        if (!cancelled) setFiles([]); // spec R5 — never toast
      });
    return () => {
      cancelled = true;
    };
  }, [mode, activeWorktree]);
```

- [ ] **Step 5: Score files separately and cap the rows**

Add beside the existing `filtered` memo — do **not** merge files into `commands`:

```tsx
  const MAX_ROWS = 200;

  const filteredFiles = useMemo(() => {
    const scored = files
      .map((f) => ({ f, score: fuzzyScore(query, f) }))
      .filter((x): x is { f: string; score: number } => x.score !== null);
    if (query) scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.f);
  }, [files, query]);

  const shownFiles = filteredFiles.slice(0, MAX_ROWS);
  const truncated = filteredFiles.length - shownFiles.length;
```

- [ ] **Step 6: Open the selected file**

Replace `runSelected` with a version that branches on mode, keeping the command path byte-identical to today:

```tsx
  const runSelected = () => {
    if (mode === "files") {
      const file = shownFiles[selected];
      if (file && activeWorktree) {
        // Reuses the shipped open_in_editor command and editorCommand setting.
        void invoke("open_in_editor", {
          command: editorCommand,
          path: `${activeWorktree.path}/${file}`,
        }).catch(() => {
          /* the editor command is user-configured; a bad one is their setting to fix */
        });
      }
      onClose();
      return;
    }
    const cmd = filtered[selected];
    if (cmd) void cmd.run();
    onClose();
  };
```

- [ ] **Step 7: Render file rows in file mode**

Change the placeholder and the list body to branch on mode. Keep command-mode markup exactly as it is:

```tsx
          placeholder={mode === "files" ? "Find a file in this worktree…" : "Jump to a worktree or run a command…"}
```

and in the list:

```tsx
        <div className="palette-list" ref={listRef}>
          {mode === "files" ? (
            <>
              {shownFiles.length === 0 && <div className="palette-empty">No matches</div>}
              {shownFiles.map((file, i) => (
                <div
                  key={file}
                  data-idx={i}
                  className={`palette-item ${i === selected ? "active" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={runSelected}
                >
                  <span className="palette-title">{file}</span>
                </div>
              ))}
              {truncated > 0 && (
                <div className="palette-empty">
                  Showing {shownFiles.length} of {filteredFiles.length} — keep typing to narrow
                </div>
              )}
            </>
          ) : (
            <>
              {/* existing command rows, unchanged */}
            </>
          )}
        </div>
```

Move today's command-row JSX into the `else` branch **verbatim** — do not rewrite it.

- [ ] **Step 8: Bound the arrow keys to the active list**

The `ArrowDown` handler currently clamps to `filtered.length - 1`. Make it use the list actually being shown:

```tsx
            const listLength = mode === "files" ? shownFiles.length : filtered.length;
```

and use `listLength` in the `ArrowDown` clamp. Leave `ArrowUp`, `Enter`, and `Escape` as they are.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/components/CommandPalette.files.test.tsx`
Expected: 7 passed.

- [ ] **Step 10: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.files.test.tsx
git commit -m "feat(quickopen): file mode in the command palette"
```

---

### Task 3: The Ctrl+P hotkey

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.paletteMode.test.tsx` (new)

**Interfaces:**
- Consumes: `CommandPalette`'s `mode` prop (Task 2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `src/App.paletteMode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { paletteModeForKey } from "./App";

afterEach(() => vi.restoreAllMocks());

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: "p", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...over }) as KeyboardEvent;

describe("paletteModeForKey", () => {
  it("maps Ctrl+P to file mode", () => {
    expect(paletteModeForKey(ev({}))).toBe("files");
  });

  it("maps Ctrl+Shift+P to command mode", () => {
    expect(paletteModeForKey(ev({ shiftKey: true, key: "P" }))).toBe("commands");
  });

  it("ignores plain P", () => {
    expect(paletteModeForKey(ev({ ctrlKey: false }))).toBeNull();
  });

  it("ignores Ctrl+Alt+P so it can't shadow an OS or terminal binding", () => {
    expect(paletteModeForKey(ev({ altKey: true }))).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(paletteModeForKey(ev({ key: "P" }))).toBe("files");
    expect(paletteModeForKey(ev({ key: "p", shiftKey: true }))).toBe("commands");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/App.paletteMode.test.tsx`
Expected: FAIL — `paletteModeForKey` is not exported from `./App`.

- [ ] **Step 3: Extract and export the key mapping**

In `src/App.tsx`, add above the `App` component:

```tsx
/** Which palette a keystroke opens, or null if it isn't a palette hotkey.
 *
 *  Ctrl+P / Ctrl+Shift+P follow VS Code, which is where this app's users live.
 *  Alt is excluded so we never shadow an OS or terminal binding. */
export function paletteModeForKey(e: KeyboardEvent): "files" | "commands" | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key !== "p" && e.key !== "P") return null;
  return e.shiftKey ? "commands" : "files";
}
```

- [ ] **Step 4: Use it in the existing hotkey effect**

`App.tsx` already has a capture-phase effect for `Ctrl+Shift+P` that calls `setPaletteOpen((o) => !o)`. Replace `paletteOpen` with a mode state and route both hotkeys through the helper:

```tsx
  const [paletteMode, setPaletteMode] = useState<"files" | "commands" | null>(null);
```

In that effect's handler:

```tsx
      const mode = paletteModeForKey(e);
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      setPaletteMode((cur) => (cur === mode ? null : mode));
```

Keep `{ capture: true }` — it exists so the hotkey fires before xterm.js consumes the keystroke when a terminal is focused.

- [ ] **Step 5: Pass the mode through**

Update the render site — it currently reads `{paletteOpen && (...)}`:

```tsx
      {paletteMode && (
        <Suspense fallback={null}>
          <CommandPalette
            mode={paletteMode}
            onClose={() => setPaletteMode(null)}
            onOpenSettings={() => {
              setPaletteMode(null);
              setSettingsOpen(true);
            }}
            onOpenPrDashboard={() => {
              setPaletteMode(null);
              setPrDashOpen(true);
            }}
          />
        </Suspense>
      )}
```

Search `App.tsx` for any remaining `setPaletteOpen` or `paletteOpen` reference and update it. There is also a `document.querySelector(".palette-backdrop")` guard in the tab-shortcut effect — leave that alone; it keys off the DOM, not this state.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/App.paletteMode.test.tsx` — 5 passed.
Then `npx tsc --noEmit` — clean.
Then `npm test` — the full suite, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.paletteMode.test.tsx
git commit -m "feat(quickopen): Ctrl+P opens file mode, Ctrl+Shift+P commands"
```

---

### Task 4: Docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above. Produces nothing.

- [ ] **Step 1: Update the shortcuts bullet**

`README.md`'s Features list has a bullet naming the command palette and its shortcuts. Add `Ctrl+P` to it, keeping the file's existing voice, bullet style, and wrap width. It currently reads (check the live text before editing — match what is actually there):

> **Command palette** (`Ctrl+Shift+P`), keyboard shortcuts (`Ctrl+T/W/Tab/1–9`), session restore, …

Make it name both palettes — `Ctrl+P` to find a file in the active worktree, `Ctrl+Shift+P` for commands.

Write plain markdown directly into the file. Do not copy any ```markdown fence from this plan into `README.md`.

- [ ] **Step 2: Verify and commit**

Re-read the section you touched. Then:

```bash
npx tsc --noEmit
npm test
git add README.md
git commit -m "docs: document Ctrl+P quick open"
```

---

## Manual verification (a human must do this)

No automated test can see a rendered palette or a launched editor. After the branch is up:

1. `Ctrl+P` in a worktree with a real repo — files appear.
2. Type part of a filename — the right file ranks first.
3. Enter — it opens in your editor.
4. `Ctrl+Shift+P` still shows commands only, exactly as before.
5. `Ctrl+P` on a **plain (non-git) folder** — "No matches", no error toast.
6. `Ctrl+P` in a large repo — typing stays responsive.
7. Both palettes still open while a terminal has focus (the capture-phase handler).

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| R1 hotkey lists the active worktree's files | Task 1 (Rust), Task 3 (hotkey) |
| R2 fuzzy filter and rank | Task 2 Step 5 |
| R3 Enter opens in the configured editor | Task 2 Step 6 |
| R4 never blocks the UI, never stalls typing | Task 1 Step 5 (`spawn_blocking`), Task 2 Step 5 (caps) |
| R5 calm empty state, never a toast | Task 1 Step 3 (`Vec::new()`), Task 2 Step 4 (catch) |
| R6 command palette unchanged | Task 2 Steps 6–7 keep the command path verbatim |
| D7 files stay out of `commands` | Task 2 Step 5 |

**Known risk:** Task 2 restructures a component that currently has no test file of its own. Its command-mode behaviour is protected only by the new file-mode tests asserting commands do *not* appear, plus manual step 4. If the reviewer wants a command-mode regression test, that is a fair finding.
