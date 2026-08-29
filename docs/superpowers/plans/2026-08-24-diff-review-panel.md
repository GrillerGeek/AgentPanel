# Diff Review Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read an agent's diff inside AgentPanel, comment on any line, and send every comment back to that agent as one prompt.

**Architecture:** A new Rust module `diff.rs` shells out to `git` (matching `git.rs`'s `run_git` pattern) and exposes two commands: a cheap file list and an on-demand per-file patch. The frontend parses the unified patch in a pure module, renders it in a right-side panel that reuses the notes-panel slot, and stores comments in the Zustand store with the same debounced-localStorage pattern as `notes`. Sending writes the composed prompt into the active pane's existing PTY via `pty_write`.

**Tech Stack:** Rust + `std::process::Command` (git), Tauri commands, React 19, Zustand 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-diff-review-panel-design.md`

## Global Constraints

- **Never error on a missing diff.** A plain folder, a repo with no commits, or a clean worktree returns an empty list — not `Err`. (Spec R8)
- Every git invocation must go through a `configure_no_window`-wrapped `Command`, exactly as `git.rs` does. On Windows a bare `Command::new("git")` flashes a console window on every refresh.
- All git diff calls pass `--no-renames`. (Spec D2)
- Rust structs crossing to TypeScript use `#[serde(rename_all = "camelCase")]`, matching every struct in `model.rs`.
- Comments are keyed by **worktree id**, which is the worktree's absolute path — the same key `notes` uses.
- `sendReviewToAgent` must **not** append `\r`. (Spec D6)
- Frontend tests are Vitest; a test touching the DOM or `localStorage` needs the `// @vitest-environment jsdom` first line, as in `src/state/store.notes.test.ts`.

---

### Task 1: Base-revision detection

The whole feature rests on picking the right revision to diff against. Getting this wrong shows either nothing (base too new) or the entire repo history (base too old).

**Files:**
- Create: `src-tauri/src/diff.rs`
- Modify: `src-tauri/src/lib.rs` (add the module declaration)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn detect_base_rev(worktree_path: &str) -> String` — returns a commit SHA, or the literal `"HEAD"` when no base can be resolved. Never fails. Also produces the private helpers `try_git`, `looks_binary`, `count_lines` used by Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/diff.rs` containing only the test module for now:

```rust
//! Diff computation for the review panel.
//!
//! Shells out to `git` like `git.rs` does, for the same reason: porcelain
//! output is stable across git versions, and worktree semantics are exact.
//!
//! The diff is always `git diff <merge-base>` with no second revision, so a
//! single command covers committed *and* uncommitted work — an agent that
//! commits mid-task must not make its own changes disappear from the panel.

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn run_raw(dir: &Path, args: &[&str]) {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(dir).args(args);
        configure_no_window(&mut cmd);
        let out = cmd.output().expect("git should be on PATH for tests");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        run_raw(dir, &["init", "-b", "main"]);
        run_raw(dir, &["config", "user.email", "test@example.com"]);
        run_raw(dir, &["config", "user.name", "Test"]);
        fs::write(dir.join("README.md"), "hi\n").unwrap();
        run_raw(dir, &["add", "."]);
        run_raw(dir, &["commit", "-m", "init"]);
    }

    fn head_sha(dir: &Path) -> String {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(dir).args(["rev-parse", "HEAD"]);
        configure_no_window(&mut cmd);
        let out = cmd.output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn scratch(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "agentpanel_diff_{tag}_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        base
    }

    #[test]
    fn base_is_the_fork_point_on_a_branch() {
        let base_dir = scratch("forkpoint");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        let fork = head_sha(&repo);

        run_raw(&repo, &["checkout", "-b", "feature"]);
        fs::write(repo.join("a.txt"), "one\n").unwrap();
        run_raw(&repo, &["add", "."]);
        run_raw(&repo, &["commit", "-m", "work"]);

        let got = detect_base_rev(&repo.to_string_lossy());
        assert_eq!(got, fork, "base must be where the branch left main");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn base_is_head_on_the_default_branch_itself() {
        let base_dir = scratch("onmain");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        let head = head_sha(&repo);
        // On main, merge-base(HEAD, main) == HEAD, so the diff is
        // uncommitted-only. That is the correct behaviour, not a bug.
        assert_eq!(detect_base_rev(&repo.to_string_lossy()), head);
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn base_falls_back_to_head_when_there_is_no_repo() {
        let base_dir = scratch("norepo");
        fs::create_dir_all(&base_dir).unwrap();
        assert_eq!(detect_base_rev(&base_dir.to_string_lossy()), "HEAD");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn counts_lines_with_and_without_a_trailing_newline() {
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"a\n"), 1);
        assert_eq!(count_lines(b"a\nb\n"), 2);
        assert_eq!(count_lines(b"a\nb"), 2, "last line without a newline counts");
    }

    #[test]
    fn detects_binary_by_nul_byte() {
        assert!(!looks_binary(b"plain text\n"));
        assert!(looks_binary(b"pre\0post"));
    }
}
```

- [ ] **Step 2: Register the module and run the tests to verify they fail**

In `src-tauri/src/lib.rs`, add `mod diff;` next to the existing `mod git;`
declaration.

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: FAIL — `cannot find function 'detect_base_rev' in this scope`
(and the same for `count_lines`, `looks_binary`, `configure_no_window`).

- [ ] **Step 3: Write the implementation**

Insert above the `#[cfg(test)] mod tests` block in `src-tauri/src/diff.rs`:

```rust
use std::process::Command;

/// On Windows, prevent a console window from flashing for each git subprocess.
/// The panel refreshes on every file-watcher event, so an unwrapped Command
/// here would strobe the screen while an agent writes files.
#[cfg(windows)]
fn configure_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn configure_no_window(_cmd: &mut Command) {}

/// Run `git -C <repo> <args...>`, returning trimmed stdout on success and
/// `None` on any failure (git missing, non-zero exit, non-UTF-8 path).
///
/// Deliberately not `Result`: every caller here treats "git said no" as
/// "there is nothing to show", never as an error to surface (spec R8).
fn try_git(repo: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    configure_no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// True when `repo` is inside a git working tree.
fn is_work_tree(repo: &str) -> bool {
    try_git(repo, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true")
}

/// The revision the review diff is taken against: the merge-base of HEAD and
/// the repository's default branch.
///
/// Resolution order is `origin/HEAD` -> the first existing of
/// `origin/main`, `origin/master`, `main`, `master` -> give up. Giving up
/// returns `"HEAD"`, which degrades the panel to uncommitted changes only
/// rather than failing.
pub fn detect_base_rev(worktree_path: &str) -> String {
    let candidate = try_git(
        worktree_path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .filter(|s| !s.is_empty())
    .or_else(|| {
        ["origin/main", "origin/master", "main", "master"]
            .into_iter()
            .find(|r| {
                try_git(worktree_path, &["rev-parse", "--verify", "--quiet", r])
                    .is_some_and(|s| !s.is_empty())
            })
            .map(str::to_string)
    });

    if let Some(base) = candidate {
        if let Some(mb) = try_git(worktree_path, &["merge-base", "HEAD", &base]) {
            if !mb.is_empty() {
                return mb;
            }
        }
    }
    "HEAD".to_string()
}

/// A file is treated as binary if a NUL byte appears in its first 8 KiB —
/// the same heuristic git itself uses.
fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|b| *b == 0)
}

/// Count lines the way a diff does: a final line without a trailing newline
/// still counts as a line.
fn count_lines(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    let mut n = bytes.iter().filter(|b| **b == b'\n').count();
    if !bytes.ends_with(b"\n") {
        n += 1;
    }
    n
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: 5 passed.

If `base_is_the_fork_point_on_a_branch` fails with the *feature* commit SHA
instead of the fork SHA, `merge-base` was skipped — check that the
`origin/main`/`main` candidate loop is actually finding `main`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/diff.rs src-tauri/src/lib.rs
git commit -m "feat(diff): resolve the review diff's base revision"
```

---

### Task 2: The changed-file list

**Files:**
- Modify: `src-tauri/src/model.rs` (add `DiffFile`)
- Modify: `src-tauri/src/diff.rs` (add `diff_files` + tests)

**Interfaces:**
- Consumes: `detect_base_rev`, `try_git`, `is_work_tree`, `looks_binary`, `count_lines` from Task 1.
- Produces: `pub fn diff_files(worktree_path: &str) -> Result<Vec<DiffFile>, String>` and the `DiffFile` struct with fields `path: String`, `status: String`, `added: usize`, `removed: usize`, `binary: bool`. Task 3 registers the command; Task 7 renders it.

- [ ] **Step 1: Add the model struct**

Append to `src-tauri/src/model.rs`:

```rust
/// One changed file in a worktree's review diff.
///
/// `status` is a lowercase word rather than git's letter code so the frontend
/// never has to know git's alphabet: `added` | `modified` | `deleted` |
/// `untracked`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub added: usize,
    pub removed: usize,
    pub binary: bool,
}
```

- [ ] **Step 2: Write the failing tests**

Add these tests inside `diff.rs`'s existing `mod tests`:

```rust
    #[test]
    fn lists_modified_committed_and_untracked_files_together() {
        let base_dir = scratch("filelist");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        run_raw(&repo, &["checkout", "-b", "feature"]);

        // (a) a committed change on the branch
        fs::write(repo.join("committed.txt"), "one\ntwo\n").unwrap();
        run_raw(&repo, &["add", "."]);
        run_raw(&repo, &["commit", "-m", "add committed.txt"]);

        // (b) an uncommitted edit to a tracked file
        fs::write(repo.join("README.md"), "hi\nthere\n").unwrap();

        // (c) an untracked new file
        fs::write(repo.join("brand-new.txt"), "x\ny\nz\n").unwrap();

        let files = diff_files(&repo.to_string_lossy()).unwrap();
        let by: std::collections::HashMap<_, _> =
            files.iter().map(|f| (f.path.as_str(), f)).collect();

        // The committed file must appear — an agent that commits mid-task
        // must not vanish from the panel.
        assert_eq!(by["committed.txt"].status, "added");
        assert_eq!(by["committed.txt"].added, 2);

        assert_eq!(by["README.md"].status, "modified");
        assert_eq!(by["README.md"].added, 1);

        assert_eq!(by["brand-new.txt"].status, "untracked");
        assert_eq!(by["brand-new.txt"].added, 3);

        assert!(files.windows(2).all(|w| w[0].path <= w[1].path), "sorted by path");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn reports_deleted_files() {
        let base_dir = scratch("deleted");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        fs::remove_file(repo.join("README.md")).unwrap();

        let files = diff_files(&repo.to_string_lossy()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "README.md");
        assert_eq!(files[0].status, "deleted");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn a_plain_folder_yields_an_empty_list_not_an_error() {
        let base_dir = scratch("plainfolder");
        fs::create_dir_all(&base_dir).unwrap();
        fs::write(base_dir.join("loose.txt"), "hi\n").unwrap();
        assert_eq!(diff_files(&base_dir.to_string_lossy()).unwrap().len(), 0);
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn a_clean_repo_yields_an_empty_list() {
        let base_dir = scratch("clean");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        assert_eq!(diff_files(&repo.to_string_lossy()).unwrap().len(), 0);
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn flags_untracked_binary_files_without_counting_lines() {
        let base_dir = scratch("binary");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        fs::write(repo.join("blob.bin"), [0x00, 0x01, 0x02, 0x00]).unwrap();

        let files = diff_files(&repo.to_string_lossy()).unwrap();
        let blob = files.iter().find(|f| f.path == "blob.bin").unwrap();
        assert!(blob.binary);
        assert_eq!(blob.added, 0);
        let _ = fs::remove_dir_all(&base_dir);
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: FAIL — `cannot find function 'diff_files' in this scope`.

- [ ] **Step 4: Write the implementation**

Add to `src-tauri/src/diff.rs`, after `count_lines` and before the test module.
Also add `use std::collections::HashMap;`, `use std::fs;`, `use std::path::Path;`
and `use crate::model::DiffFile;` to the file's imports.

```rust
/// Map git's `--name-status` letter to the word the frontend renders.
fn status_word(code: &str) -> &'static str {
    match code.chars().next() {
        Some('A') => "added",
        Some('D') => "deleted",
        _ => "modified",
    }
}

/// Every file changed in `worktree_path` relative to the review base, plus
/// untracked files (which `git diff` never reports).
///
/// A non-git folder, a repo with no commits, or a clean tree all yield an
/// empty list — never an error (spec R8).
pub fn diff_files(worktree_path: &str) -> Result<Vec<DiffFile>, String> {
    if !Path::new(worktree_path).is_dir() {
        return Err(format!("not a directory: {worktree_path}"));
    }
    if !is_work_tree(worktree_path) {
        return Ok(Vec::new());
    }

    let base = detect_base_rev(worktree_path);
    let mut out: Vec<DiffFile> = Vec::new();

    // Two passes over the same diff: --numstat carries the counts,
    // --name-status carries the add/modify/delete letter. Joined on path.
    let name_status = try_git(
        worktree_path,
        &["diff", "--no-renames", "--name-status", &base],
    )
    .unwrap_or_default();
    let mut status_by_path: HashMap<&str, &'static str> = HashMap::new();
    for line in name_status.lines() {
        let mut parts = line.splitn(2, '\t');
        if let (Some(code), Some(path)) = (parts.next(), parts.next()) {
            status_by_path.insert(path, status_word(code));
        }
    }

    let numstat = try_git(worktree_path, &["diff", "--no-renames", "--numstat", &base])
        .unwrap_or_default();
    for line in numstat.lines() {
        let mut parts = line.splitn(3, '\t');
        let (Some(a), Some(r), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        // git writes "-\t-\tpath" for a binary file.
        let binary = a == "-" || r == "-";
        out.push(DiffFile {
            path: path.to_string(),
            status: status_by_path.get(path).copied().unwrap_or("modified").to_string(),
            added: a.parse().unwrap_or(0),
            removed: r.parse().unwrap_or(0),
            binary,
        });
    }

    // Untracked files: an agent's brand-new file is exactly what you most want
    // to read, and `git diff` will not show it (spec D3).
    let untracked = try_git(
        worktree_path,
        &["ls-files", "--others", "--exclude-standard"],
    )
    .unwrap_or_default();
    for path in untracked.lines().filter(|l| !l.is_empty()) {
        let bytes = fs::read(Path::new(worktree_path).join(path)).unwrap_or_default();
        let binary = looks_binary(&bytes);
        out.push(DiffFile {
            path: path.to_string(),
            status: "untracked".to_string(),
            added: if binary { 0 } else { count_lines(&bytes) },
            removed: 0,
            binary,
        });
    }

    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: 10 passed.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/diff.rs src-tauri/src/model.rs
git commit -m "feat(diff): list a worktree's changed files"
```

---

### Task 3: The per-file patch, and both Tauri commands

**Files:**
- Modify: `src-tauri/src/diff.rs` (add `diff_file_patch` + tests)
- Modify: `src-tauri/src/commands.rs` (add the two `#[tauri::command]` wrappers)
- Modify: `src-tauri/src/lib.rs` (register both in `generate_handler!`)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: two invokable commands. `worktree_diff` takes `{ path: string }` and returns `DiffFile[]`. `worktree_file_patch` takes `{ path: string, file: string }` and returns the unified patch as a `string`. Tasks 4 and 7 depend on these exact names and argument names.

- [ ] **Step 1: Write the failing tests**

Add inside `diff.rs`'s `mod tests`:

```rust
    #[test]
    fn patches_a_tracked_modified_file() {
        let base_dir = scratch("patchtracked");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        fs::write(repo.join("README.md"), "hi\nthere\n").unwrap();

        let patch = diff_file_patch(&repo.to_string_lossy(), "README.md").unwrap();
        assert!(patch.contains("@@"), "has a hunk header: {patch}");
        assert!(patch.contains("+there"), "shows the added line: {patch}");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn synthesizes_an_all_added_patch_for_an_untracked_file() {
        let base_dir = scratch("patchuntracked");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        fs::write(repo.join("new.txt"), "alpha\nbeta\n").unwrap();

        let patch = diff_file_patch(&repo.to_string_lossy(), "new.txt").unwrap();
        assert!(patch.contains("--- /dev/null"));
        assert!(patch.contains("@@ -0,0 +1,2 @@"));
        assert!(patch.contains("+alpha"));
        assert!(patch.contains("+beta"));
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn reports_an_untracked_binary_file_without_dumping_bytes() {
        let base_dir = scratch("patchbinary");
        let repo = base_dir.join("repo");
        init_repo(&repo);
        fs::write(repo.join("blob.bin"), [0x00, 0xFF, 0x00]).unwrap();

        let patch = diff_file_patch(&repo.to_string_lossy(), "blob.bin").unwrap();
        assert!(patch.contains("Binary file"));
        assert!(!patch.contains('\u{0}'), "must not dump raw bytes");
        let _ = fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn a_plain_folder_yields_an_empty_patch_not_an_error() {
        let base_dir = scratch("patchplain");
        fs::create_dir_all(&base_dir).unwrap();
        fs::write(base_dir.join("loose.txt"), "hi\n").unwrap();
        assert_eq!(
            diff_file_patch(&base_dir.to_string_lossy(), "loose.txt").unwrap(),
            ""
        );
        let _ = fs::remove_dir_all(&base_dir);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: FAIL — `cannot find function 'diff_file_patch' in this scope`.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/diff.rs` after `diff_files`:

```rust
/// The unified patch for one file, relative to the review base.
///
/// Tracked files go through `git diff`. Untracked files are synthesized as a
/// single all-added hunk, because git will not diff a file it does not know
/// about (spec D3).
pub fn diff_file_patch(worktree_path: &str, file: &str) -> Result<String, String> {
    if !is_work_tree(worktree_path) {
        return Ok(String::new());
    }

    // `ls-files --error-unmatch` exits non-zero for a path git isn't tracking.
    // A tracked-but-deleted file still matches, so deletions take this branch.
    let tracked = try_git(worktree_path, &["ls-files", "--error-unmatch", "--", file]).is_some();
    if tracked {
        let base = detect_base_rev(worktree_path);
        return Ok(
            try_git(worktree_path, &["diff", "--no-renames", &base, "--", file])
                .unwrap_or_default(),
        );
    }

    let full = Path::new(worktree_path).join(file);
    let bytes = fs::read(&full).map_err(|e| format!("cannot read {file}: {e}"))?;
    if looks_binary(&bytes) {
        return Ok(format!(
            "diff --git a/{file} b/{file}\nnew file (untracked)\nBinary file — not shown\n"
        ));
    }

    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let mut patch = format!(
        "diff --git a/{file} b/{file}\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{} @@\n",
        lines.len()
    );
    for l in lines {
        patch.push('+');
        patch.push_str(l);
        patch.push('\n');
    }
    Ok(patch)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml diff::`
Expected: 14 passed.

- [ ] **Step 5: Add the Tauri command wrappers**

In `src-tauri/src/commands.rs`, add `use crate::diff;` beside the existing
`use crate::git;`, add `DiffFile` to the `use crate::model::{...}` list, and
append these two commands:

```rust
/// Every file changed in a worktree relative to the review base.
#[tauri::command]
pub fn worktree_diff(path: String) -> Result<Vec<DiffFile>, String> {
    diff::diff_files(&path)
}

/// The unified patch for one file in a worktree.
#[tauri::command]
pub fn worktree_file_patch(path: String, file: String) -> Result<String, String> {
    diff::diff_file_patch(&path, &file)
}
```

- [ ] **Step 6: Register both commands**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]`, add after
`commands::worktree_pr,`:

```rust
            commands::worktree_diff,
            commands::worktree_file_patch,
```

- [ ] **Step 7: Verify the whole crate builds and every test passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass, no warnings about unused functions.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/diff.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(diff): expose worktree_diff and worktree_file_patch commands"
```

---

### Task 4: Parse a unified diff in the frontend

Pure, no DOM, no Tauri — the easiest part of this feature to get subtly wrong (line-number drift) and the easiest to test exhaustively.

**Files:**
- Create: `src/lib/diffParse.ts`
- Test: `src/lib/diffParse.test.ts`

**Interfaces:**
- Consumes: the patch string produced by `worktree_file_patch` (Task 3).
- Produces: `parseUnifiedDiff(patch: string): DiffHunk[]`, plus the exported types `DiffLineKind = "context" | "add" | "del" | "meta"`, `DiffLine { kind, text, oldNo, newNo }`, and `DiffHunk { header, lines }`. Task 8 renders these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/diffParse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diffParse";

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,6 @@ function boot() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

describe("parseUnifiedDiff", () => {
  it("ignores the file header and returns one hunk", () => {
    const hunks = parseUnifiedDiff(PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("@@ -10,5 +10,6 @@ function boot() {");
  });

  it("classifies each line", () => {
    const kinds = parseUnifiedDiff(PATCH)[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(["context", "del", "add", "add", "context"]);
  });

  it("strips the leading marker from the text", () => {
    const texts = parseUnifiedDiff(PATCH)[0].lines.map((l) => l.text);
    expect(texts).toEqual(["const a = 1;", "const b = 2;", "const b = 3;", "const c = 4;", "const d = 5;"]);
  });

  it("numbers old and new sides independently", () => {
    const lines = parseUnifiedDiff(PATCH)[0].lines;
    expect(lines.map((l) => l.oldNo)).toEqual([10, 11, null, null, 12]);
    expect(lines.map((l) => l.newNo)).toEqual([10, null, 11, 12, 13]);
  });

  it("keeps blank context lines so numbering does not drift", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n \n b\n";
    const lines = parseUnifiedDiff(patch)[0].lines;
    expect(lines.map((l) => l.text)).toEqual(["a", "", "b"]);
    expect(lines.map((l) => l.newNo)).toEqual([1, 2, 3]);
  });

  it("handles a single-line hunk header with no comma", () => {
    const lines = parseUnifiedDiff("@@ -7 +7 @@\n-old\n+new\n")[0].lines;
    expect(lines[0].oldNo).toBe(7);
    expect(lines[1].newNo).toBe(7);
  });

  it("records the no-trailing-newline marker as meta without numbering it", () => {
    const lines = parseUnifiedDiff("@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n")[0].lines;
    expect(lines[2].kind).toBe("meta");
    expect(lines[2].oldNo).toBeNull();
    expect(lines[2].newNo).toBeNull();
  });

  it("splits multiple hunks", () => {
    const patch = "@@ -1,1 +1,1 @@\n-a\n+b\n@@ -50,1 +50,1 @@\n-c\n+d\n";
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines[1].newNo).toBe(50);
  });

  it("returns an empty array for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/diffParse.test.ts`
Expected: FAIL — `Failed to resolve import "./diffParse"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/diffParse.ts`:

```ts
/** What a diff line represents. `meta` is git's "\ No newline at end of file". */
export type DiffLineKind = "context" | "add" | "del" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** the line's content, with the leading +/-/space marker removed */
  text: string;
  /** 1-based line number on the old side, or null for an added line */
  oldNo: number | null;
  /** 1-based line number on the new side, or null for a deleted line */
  newNo: number | null;
}

export interface DiffHunk {
  /** the raw `@@ ... @@` line, shown as the hunk's caption */
  header: string;
  lines: DiffLine[];
}

// `@@ -old[,count] +new[,count] @@ optional trailing context`
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff into hunks with per-side line numbers.
 *
 * File headers (`diff --git`, `index`, `---`, `+++`) are skipped: they appear
 * before the first hunk, and anything unrecognized *after* a hunk ends it — so
 * a multi-file patch degrades safely instead of mis-numbering.
 *
 * Comments anchor to `newNo`, which is why the new side must stay exact. A
 * blank context line is a single space in a real patch, not an empty string,
 * so it is counted like any other context line.
 */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split(/\r?\n/)) {
    const m = HUNK.exec(raw);
    if (m) {
      cur = { header: raw, lines: [] };
      hunks.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      continue;
    }
    if (!cur) continue; // still in the file header

    if (raw.startsWith("+")) {
      cur.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith("\\")) {
      cur.lines.push({ kind: "meta", text: raw.slice(1).trim(), oldNo: null, newNo: null });
    } else if (raw.startsWith(" ")) {
      cur.lines.push({ kind: "context", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (raw !== "") {
      // Anything else (e.g. the next file's `diff --git`) ends this hunk.
      cur = null;
    }
  }

  return hunks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/diffParse.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diffParse.ts src/lib/diffParse.test.ts
git commit -m "feat(diff): parse unified diffs into numbered hunks"
```

---

### Task 5: Review comments in the store

**Files:**
- Modify: `src/types.ts` (add `DiffFile`, `DiffComment`)
- Modify: `src/state/store.ts` (state, actions, persistence, pruning)
- Test: `src/state/store.diff.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the `DiffFile` shape mirrors Task 2's Rust struct).
- Produces: store state `diffComments: Record<string, DiffComment[]>`, `diffOpen: boolean`, `selectedDiffFile: string | null`; actions `addDiffComment(worktreeId, draft)`, `removeDiffComment(worktreeId, id)`, `clearDiffComments(worktreeId)`, `toggleDiff()`, `setSelectedDiffFile(file)`. Tasks 6–9 use these exact names.

- [ ] **Step 1: Add the types**

Append to `src/types.ts`:

```ts
/** One changed file in a worktree's review diff (mirrors Rust `DiffFile`). */
export interface DiffFile {
  path: string;
  /** added | modified | deleted | untracked */
  status: string;
  added: number;
  removed: number;
  binary: boolean;
}

/** A review comment anchored to a line of a worktree's diff. */
export interface DiffComment {
  id: string;
  /** worktree-relative path, as reported by `worktree_diff` */
  file: string;
  /** the new-side line number, or null for a comment about the whole file */
  line: number | null;
  /** the source text at the time of commenting, so a stale anchor still reads */
  code: string;
  body: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/state/store.diff.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useStore.setState({
    diffComments: {},
    diffOpen: false,
    notesOpen: false,
    selectedDiffFile: null,
    repositories: [],
    worktrees: {},
    terminals: [],
    activeTabId: null,
    paneSessions: {},
    notes: {},
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

describe("diff review comments", () => {
  it("addDiffComment stores a comment with a generated id", () => {
    useStore.getState().addDiffComment("wtA", { file: "a.ts", line: 12, code: "const x = 1;", body: "rename this" });
    const list = useStore.getState().diffComments.wtA;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("rename this");
    expect(list[0].id).toBeTruthy();
  });

  it("gives each comment a distinct id", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "one" });
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "two" });
    const [first, second] = useStore.getState().diffComments.wtA;
    expect(first.id).not.toBe(second.id);
  });

  it("removeDiffComment drops only that comment", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "keep" });
    add("wtA", { file: "a.ts", line: 2, code: "b", body: "drop" });
    const dropId = useStore.getState().diffComments.wtA[1].id;
    useStore.getState().removeDiffComment("wtA", dropId);
    expect(useStore.getState().diffComments.wtA.map((c) => c.body)).toEqual(["keep"]);
  });

  it("clearDiffComments empties one worktree, leaving others", () => {
    const add = useStore.getState().addDiffComment;
    add("wtA", { file: "a.ts", line: 1, code: "a", body: "gone" });
    add("wtB", { file: "b.ts", line: 1, code: "b", body: "stays" });
    useStore.getState().clearDiffComments("wtA");
    expect(useStore.getState().diffComments.wtA ?? []).toEqual([]);
    expect(useStore.getState().diffComments.wtB).toHaveLength(1);
  });

  it("toggleDiff closes the notes panel, and toggleNotes closes the diff panel", () => {
    useStore.setState({ notesOpen: true, diffOpen: false });
    useStore.getState().toggleDiff();
    expect(useStore.getState().diffOpen).toBe(true);
    expect(useStore.getState().notesOpen).toBe(false);

    useStore.getState().toggleNotes();
    expect(useStore.getState().notesOpen).toBe(true);
    expect(useStore.getState().diffOpen).toBe(false);
  });

  it("persists comments to localStorage after the 300ms debounce", () => {
    useStore.getState().addDiffComment("wtA", { file: "a.ts", line: 3, code: "x", body: "note" });
    expect(localStorage.getItem("agentpanel.diffComments")).toBeNull();
    vi.advanceTimersByTime(300);
    const saved = JSON.parse(localStorage.getItem("agentpanel.diffComments")!);
    expect(saved.wtA[0].body).toBe("note");
  });

  it("removeRepository prunes comments for that repo's worktrees, keeping others", async () => {
    useStore.setState({
      repositories: [{ id: "r1", path: "/r1", name: "r1", isGit: true }],
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/r1", name: "main", branch: "main", isPrimary: true }] },
      diffComments: {
        wt1: [{ id: "c1", file: "a.ts", line: 1, code: "a", body: "will go" }],
        wtOther: [{ id: "c2", file: "b.ts", line: 1, code: "b", body: "stays" }],
      },
    });
    await useStore.getState().removeRepository("r1");
    expect(useStore.getState().diffComments.wt1).toBeUndefined();
    expect(useStore.getState().diffComments.wtOther).toHaveLength(1);
  });

  it("deleteWorktree prunes the removed worktree's comments", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "delete_worktree" ? [] : undefined));
    useStore.setState({
      worktrees: { r1: [{ id: "wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
      diffComments: {
        "/wt1": [{ id: "c1", file: "a.ts", line: 1, code: "a", body: "gone soon" }],
        wt2: [{ id: "c2", file: "b.ts", line: 1, code: "b", body: "stays" }],
      },
    });
    await useStore.getState().deleteWorktree("r1", "/wt1");
    expect(useStore.getState().diffComments["/wt1"]).toBeUndefined();
    expect(useStore.getState().diffComments.wt2).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.diff.test.ts`
Expected: FAIL — `addDiffComment is not a function`.

- [ ] **Step 4: Add the state, actions, and persistence**

In `src/state/store.ts`:

**(a)** Add `DiffComment` to the existing `import type { ... } from "../types";` list.

**(b)** Beside the `NOTES_KEY` / `NOTES_OPEN_KEY` constants, add:

```ts
const DIFF_COMMENTS_KEY = "agentpanel.diffComments";

function readDiffComments(): Record<string, DiffComment[]> {
  try {
    const raw = localStorage.getItem(DIFF_COMMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, DiffComment[]>) : {};
  } catch {
    return {};
  }
}

let commentSeq = 0;
const nextCommentId = () => `c${Date.now().toString(36)}${++commentSeq}`;
```

**(c)** In the `AppState` interface, after the `notesOpen` field, add:

```ts
  /** review comments keyed by worktree id, mirroring `notes` */
  diffComments: Record<string, DiffComment[]>;
  /** whether the diff review side panel is open (mutually exclusive with notes) */
  diffOpen: boolean;
  /** the diff file currently being read, or null for "none selected" */
  selectedDiffFile: string | null;
```

and after `toggleNotes`, add:

```ts
  /** attach a review comment to a line (or to a whole file when line is null) */
  addDiffComment: (worktreeId: string, draft: Omit<DiffComment, "id">) => void;
  removeDiffComment: (worktreeId: string, id: string) => void;
  clearDiffComments: (worktreeId: string) => void;
  /** open/close the diff review panel */
  toggleDiff: () => void;
  setSelectedDiffFile: (file: string | null) => void;
```

**(d)** In the `create<AppState>` initial state, after `notesOpen: readNotesOpen(),`:

```ts
  diffComments: readDiffComments(),
  diffOpen: false,
  selectedDiffFile: null,
```

`diffOpen` is intentionally **not** persisted: the panel is a review mode you
enter deliberately, unlike the always-on notes pane.

**(e)** After the existing `toggleNotes` implementation, add:

```ts
  addDiffComment: (worktreeId, draft) =>
    set((s) => ({
      diffComments: {
        ...s.diffComments,
        [worktreeId]: [...(s.diffComments[worktreeId] ?? []), { ...draft, id: nextCommentId() }],
      },
    })),

  removeDiffComment: (worktreeId, id) =>
    set((s) => ({
      diffComments: {
        ...s.diffComments,
        [worktreeId]: (s.diffComments[worktreeId] ?? []).filter((c) => c.id !== id),
      },
    })),

  clearDiffComments: (worktreeId) =>
    set((s) => ({ diffComments: { ...s.diffComments, [worktreeId]: [] } })),

  // Only one side panel at a time, so the terminal never loses two panels'
  // width (spec D8).
  toggleDiff: () => set((s) => ({ diffOpen: !s.diffOpen, notesOpen: false })),

  setSelectedDiffFile: (file) => set({ selectedDiffFile: file }),
```

**(f)** Change the existing `toggleNotes` to close the diff panel:

```ts
  toggleNotes: () => set((s) => ({ notesOpen: !s.notesOpen, diffOpen: false })),
```

- [ ] **Step 5: Prune comments alongside notes**

Find the two places in `store.ts` that prune `notes` — inside `removeRepository`
and inside `deleteWorktree` — and prune `diffComments` with the same keys in the
same `set` call. In `removeRepository`, wherever the existing code deletes the
repo's worktree ids from a copied `notes` object, add the identical loop for a
copied `diffComments` object and include it in the returned state. Do the same
for the single removed worktree id in `deleteWorktree`.

Both tests in Step 2 (`removeRepository prunes…`, `deleteWorktree prunes…`) are
what verify this; if either still fails, the prune was added to only one path.

- [ ] **Step 6: Add the debounced persistence subscriber**

At the bottom of `store.ts`, beside the notes subscriber, add:

```ts
// Persist review comments, debounced like notes (typing a comment body fires a
// store write per keystroke).
let lastDiffCommentsSnapshot = JSON.stringify(useStore.getState().diffComments);
let diffCommentsWriteTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s) => {
  const snapshot = JSON.stringify(s.diffComments);
  if (snapshot === lastDiffCommentsSnapshot) return;
  lastDiffCommentsSnapshot = snapshot;
  if (diffCommentsWriteTimer) clearTimeout(diffCommentsWriteTimer);
  diffCommentsWriteTimer = setTimeout(() => {
    diffCommentsWriteTimer = undefined;
    try {
      localStorage.setItem(DIFF_COMMENTS_KEY, snapshot);
    } catch (err) {
      console.error("diff comments persist failed", err);
    }
  }, 300);
});

/** Flush a pending comment write on hide/unload, like flushNotes. */
function flushDiffComments() {
  if (diffCommentsWriteTimer === undefined) return;
  clearTimeout(diffCommentsWriteTimer);
  diffCommentsWriteTimer = undefined;
  try {
    localStorage.setItem(DIFF_COMMENTS_KEY, lastDiffCommentsSnapshot);
  } catch (err) {
    console.error("diff comments flush failed", err);
  }
}
```

Then add `flushDiffComments();` beside the existing `flushNotes();` calls in
**both** the `beforeunload` listener and the `visibilitychange` listener.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.diff.test.ts src/state/store.notes.test.ts`
Expected: all pass. The notes suite is included deliberately — Step 4(f)
changed `toggleNotes`, and its existing test must still hold.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/state/store.ts src/state/store.diff.test.ts
git commit -m "feat(diff): store, persist, and prune review comments"
```

---

### Task 6: Compose the prompt sent to the agent

> **This is the one function worth writing in your own words.** The wording
> here decides whether the agent fixes what you meant. The implementation below
> is a complete, tested default — swap the phrasing for yours and keep the tests
> green. Trade-offs: an imperative opener ("Please address…") gets action but can
> make an agent over-correct; a neutral opener ("Review notes:") is safer but
> sometimes gets a discussion instead of a patch. Grouping by file helps the
> agent batch edits; a flat list preserves your reading order.

**Files:**
- Create: `src/lib/reviewPrompt.ts`
- Test: `src/lib/reviewPrompt.test.ts`

**Interfaces:**
- Consumes: `DiffComment` from Task 5.
- Produces: `composeReviewPrompt(comments: DiffComment[]): string`. Task 9 calls it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reviewPrompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { composeReviewPrompt } from "./reviewPrompt";
import type { DiffComment } from "../types";

const c = (over: Partial<DiffComment>): DiffComment => ({
  id: "x", file: "src/a.ts", line: 10, code: "const a = 1;", body: "rename a", ...over,
});

describe("composeReviewPrompt", () => {
  it("returns an empty string when there are no comments", () => {
    expect(composeReviewPrompt([])).toBe("");
  });

  it("includes every comment body", () => {
    const out = composeReviewPrompt([c({ body: "first" }), c({ body: "second", line: 20 })]);
    expect(out).toContain("first");
    expect(out).toContain("second");
  });

  it("names each file once, even with several comments in it", () => {
    const out = composeReviewPrompt([
      c({ file: "src/a.ts", line: 1, body: "one" }),
      c({ file: "src/a.ts", line: 2, body: "two" }),
    ]);
    expect(out.split("src/a.ts").length - 1).toBe(1);
  });

  it("groups comments by file", () => {
    const out = composeReviewPrompt([
      c({ file: "src/a.ts", body: "in a" }),
      c({ file: "src/b.ts", body: "in b" }),
      c({ file: "src/a.ts", line: 99, body: "also in a" }),
    ]);
    expect(out.indexOf("also in a")).toBeLessThan(out.indexOf("src/b.ts"));
  });

  it("cites the line number and the source line for an anchored comment", () => {
    const out = composeReviewPrompt([c({ line: 42, code: "  const total = 0;", body: "off by one" })]);
    expect(out).toContain("42");
    expect(out).toContain("const total = 0;");
  });

  it("marks a file-level comment instead of inventing a line number", () => {
    const out = composeReviewPrompt([c({ line: null, code: "", body: "split this module" })]);
    expect(out).toContain("whole file");
    expect(out).not.toMatch(/line \d/);
  });

  it("does not end with a newline, so the agent's input box gets no stray blank line", () => {
    expect(composeReviewPrompt([c({})]).endsWith("\n")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/reviewPrompt.test.ts`
Expected: FAIL — `Failed to resolve import "./reviewPrompt"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/reviewPrompt.ts`:

```ts
import type { DiffComment } from "../types";

/**
 * Turn a worktree's review comments into one prompt for the agent.
 *
 * Grouped by file so the agent can batch its edits per file rather than
 * re-opening the same file once per comment. Each anchored comment cites both
 * the line number and the source text: the number may be stale if the agent
 * has edited since, and the text is what makes the comment recoverable when it
 * is.
 *
 * No trailing newline — this is written straight into the agent's input box
 * (see the store's sendReviewToAgent), and a trailing newline there reads as a
 * blank line, or on some CLIs submits early.
 */
export function composeReviewPrompt(comments: DiffComment[]): string {
  if (comments.length === 0) return "";

  const byFile = new Map<string, DiffComment[]>();
  for (const comment of comments) {
    const list = byFile.get(comment.file) ?? [];
    list.push(comment);
    byFile.set(comment.file, list);
  }

  const plural = comments.length === 1 ? "" : "s";
  const parts: string[] = [
    `Please address the following ${comments.length} review comment${plural} on your changes.`,
    "",
  ];

  for (const [file, list] of byFile) {
    parts.push(`${file}:`);
    for (const comment of list) {
      parts.push(
        comment.line === null
          ? "  (whole file)"
          : `  line ${comment.line}: ${comment.code.trim()}`,
      );
      parts.push(`    -> ${comment.body.trim()}`);
    }
    parts.push("");
  }

  return parts.join("\n").trimEnd();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/reviewPrompt.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewPrompt.ts src/lib/reviewPrompt.test.ts
git commit -m "feat(diff): compose review comments into an agent prompt"
```

---

### Task 7: The diff panel container and file list

**Files:**
- Create: `src/components/DiffPanel.tsx`
- Test: `src/components/DiffPanel.test.tsx`

**Interfaces:**
- Consumes: `worktree_diff` (Task 3), store state from Task 5, `selectActiveWorktreeId` (already exported from `store.ts`).
- Produces: `export function DiffPanel()` — renders nothing when `diffOpen` is false or no worktree is active. Task 8's `DiffView` is mounted by it; Task 9 mounts `DiffPanel` in `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/DiffPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiffPanel } from "./DiffPanel";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";
import type { DiffFile } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const FILES: DiffFile[] = [
  { path: "src/a.ts", status: "modified", added: 3, removed: 1, binary: false },
  { path: "src/new.ts", status: "untracked", added: 9, removed: 0, binary: false },
];

function activateWorktree() {
  useStore.setState({
    diffOpen: true,
    diffComments: {},
    selectedDiffFile: null,
    worktrees: { r1: [{ id: "/wt1", repoId: "r1", path: "/wt1", name: "b", branch: "b", isPrimary: false }] },
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useStore.setState({ diffOpen: false, selectedDiffFile: null, terminals: [], activeTabId: null });
});

describe("DiffPanel", () => {
  it("renders nothing when the panel is closed", () => {
    const { container } = render(<DiffPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("lists changed files with their counts", async () => {
    vi.mocked(invoke).mockResolvedValue(FILES);
    activateWorktree();
    render(<DiffPanel />);
    expect(await screen.findByText("src/a.ts")).toBeTruthy();
    expect(await screen.findByText("src/new.ts")).toBeTruthy();
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("shows a calm empty state when nothing changed", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    activateWorktree();
    render(<DiffPanel />);
    expect(await screen.findByText(/no changes/i)).toBeTruthy();
  });

  it("shows a calm empty state when the command fails, and pushes no error toast", async () => {
    vi.mocked(invoke).mockRejectedValue("boom");
    activateWorktree();
    render(<DiffPanel />);
    await waitFor(() => expect(screen.getByText(/no changes/i)).toBeTruthy());
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("requests the diff for the active worktree's path", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    activateWorktree();
    render(<DiffPanel />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("worktree_diff", { path: "/wt1" }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/DiffPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./DiffPanel"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/DiffPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore, selectActiveWorktreeId } from "../state/store";
import type { DiffFile } from "../types";
import { DiffView } from "./DiffView";

/** Short marker shown before a file's path. */
const STATUS_MARK: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  untracked: "?",
};

/**
 * Right-side review panel: the list of files an agent changed in the active
 * worktree, plus the selected file's diff.
 *
 * Mirrors NotesPanel's shape — it selects the active worktree from the store,
 * so every session-switch path drives it for free, and renders nothing when
 * closed or when no worktree is active.
 *
 * Every failure path lands on the same empty state rather than a toast: an
 * unreadable diff is a normal condition (plain folder, no commits yet), and the
 * panel refreshes on every file-watcher event, so a toast here would spam.
 */
export function DiffPanel() {
  const diffOpen = useStore((s) => s.diffOpen);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const selectedDiffFile = useStore((s) => s.selectedDiffFile);
  const setSelectedDiffFile = useStore((s) => s.setSelectedDiffFile);
  const commentCount = useStore(
    (s) => (activeWorktreeId ? s.diffComments[activeWorktreeId]?.length ?? 0 : 0),
  );
  const sendReviewToAgent = useStore((s) => s.sendReviewToAgent);
  const clearDiffComments = useStore((s) => s.clearDiffComments);
  const [files, setFiles] = useState<DiffFile[]>([]);

  const refresh = useCallback(async () => {
    if (!activeWorktreeId) return;
    try {
      setFiles(await invoke<DiffFile[]>("worktree_diff", { path: activeWorktreeId }));
    } catch {
      setFiles([]); // spec R8 — an unreadable diff is "nothing to show"
    }
  }, [activeWorktreeId]);

  useEffect(() => {
    if (!diffOpen) return;
    void refresh();
  }, [diffOpen, refresh]);

  // Reuse the existing worktree file watcher (spec R7) rather than polling.
  useEffect(() => {
    if (!diffOpen) return;
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    let disposed = false;
    void listen("worktrees-changed", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 250);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [diffOpen, refresh]);

  if (!diffOpen || !activeWorktreeId) return null;

  return (
    <aside className="diff-panel">
      <header className="diff-panel-head">
        <span className="diff-panel-title">Review</span>
        <div className="diff-panel-actions">
          <button
            className="diff-send"
            disabled={commentCount === 0}
            title="Insert every comment into the active agent's terminal"
            onClick={() => void sendReviewToAgent(activeWorktreeId)}
          >
            Send {commentCount || ""} to agent
          </button>
          <button
            className="diff-clear"
            disabled={commentCount === 0}
            title="Delete every comment for this worktree"
            onClick={() => clearDiffComments(activeWorktreeId)}
          >
            Clear
          </button>
        </div>
      </header>

      {files.length === 0 ? (
        <p className="diff-empty">No changes in this worktree.</p>
      ) : (
        <ul className="diff-file-list">
          {files.map((f) => (
            <li key={f.path}>
              <button
                className={`diff-file${f.path === selectedDiffFile ? " selected" : ""}`}
                onClick={() => setSelectedDiffFile(f.path === selectedDiffFile ? null : f.path)}
                title={f.path}
              >
                <span className={`diff-status diff-status-${f.status}`}>
                  {STATUS_MARK[f.status] ?? "M"}
                </span>
                <span className="diff-file-path">{f.path}</span>
                {f.binary ? (
                  <span className="diff-binary">bin</span>
                ) : (
                  <>
                    <span className="diff-added">+{f.added}</span>
                    <span className="diff-removed">-{f.removed}</span>
                  </>
                )}
              </button>
              {f.path === selectedDiffFile && (
                <DiffView worktreeId={activeWorktreeId} file={f.path} />
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

> `sendReviewToAgent` is added to the store in Task 9. Until then this file will
> not typecheck — that is expected and is resolved by Task 9 Step 1. Run the
> Task 7 tests with the Task 8 and Task 9 work in place if you are executing
> tasks out of order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/DiffPanel.test.tsx`
Expected: 5 passed. (Requires Task 8's `DiffView` to exist — if you are running
tasks strictly in order, create `src/components/DiffView.tsx` as part of Task 8
first and then return to this step.)

- [ ] **Step 5: Commit**

```bash
git add src/components/DiffPanel.tsx src/components/DiffPanel.test.tsx
git commit -m "feat(diff): review panel with the changed-file list"
```

---

### Task 8: The per-file diff view with line comments

**Files:**
- Create: `src/components/DiffView.tsx`
- Test: `src/components/DiffView.test.tsx`

**Interfaces:**
- Consumes: `worktree_file_patch` (Task 3), `parseUnifiedDiff` (Task 4), `addDiffComment` / `removeDiffComment` / `diffComments` (Task 5).
- Produces: `export function DiffView({ worktreeId, file }: { worktreeId: string; file: string })`. Task 7 mounts it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/DiffView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { useStore } from "../state/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -10,2 +10,3 @@
 const a = 1;
+const b = 2;
`;

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(PATCH);
  useStore.setState({ diffComments: {} });
});

describe("DiffView", () => {
  it("requests the patch for its file", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("worktree_file_patch", { path: "/wt1", file: "src/a.ts" }),
    );
  });

  it("renders the diff lines with new-side line numbers", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const b = 2;")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy(); // the added line's new number
  });

  it("adds a comment anchored to the clicked line", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    const row = await screen.findByTestId("diff-line-11");
    fireEvent.click(row);
    fireEvent.change(screen.getByPlaceholderText(/comment/i), { target: { value: "too clever" } });
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));

    const stored = useStore.getState().diffComments["/wt1"];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ file: "src/a.ts", line: 11, code: "const b = 2;", body: "too clever" });
  });

  it("will not add an empty comment", async () => {
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    fireEvent.click(await screen.findByTestId("diff-line-11"));
    fireEvent.click(screen.getByRole("button", { name: /add comment/i }));
    expect(useStore.getState().diffComments["/wt1"] ?? []).toHaveLength(0);
  });

  it("shows existing comments for the file and can delete one", async () => {
    useStore.setState({
      diffComments: { "/wt1": [{ id: "c1", file: "src/a.ts", line: 11, code: "const b = 2;", body: "existing" }] },
    });
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText("existing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));
    expect(useStore.getState().diffComments["/wt1"]).toHaveLength(0);
  });

  it("shows a message instead of an empty pane when the patch is empty", async () => {
    vi.mocked(invoke).mockResolvedValue("");
    render(<DiffView worktreeId="/wt1" file="src/a.ts" />);
    expect(await screen.findByText(/nothing to show/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: FAIL — `Failed to resolve import "./DiffView"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/DiffView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../state/store";
import { parseUnifiedDiff, type DiffHunk } from "../lib/diffParse";

/**
 * One file's unified diff, with a comment affordance on every numbered line.
 *
 * Comments anchor to the **new-side** line number: that is the line that exists
 * in the agent's current file, so it is the one the agent can act on. Deleted
 * lines have no new-side number and are therefore not commentable — comment on
 * the surrounding context instead, or use the file-level comment.
 */
export function DiffView({ worktreeId, file }: { worktreeId: string; file: string }) {
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const comments = useStore((s) => s.diffComments[worktreeId] ?? []);
  const addDiffComment = useStore((s) => s.addDiffComment);
  const removeDiffComment = useStore((s) => s.removeDiffComment);

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("worktree_file_patch", { path: worktreeId, file })
      .then((patch) => {
        if (!cancelled) setHunks(parseUnifiedDiff(patch));
      })
      .catch(() => {
        if (!cancelled) setHunks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeId, file]);

  const fileComments = comments.filter((c) => c.file === file);

  const submit = (line: number | null, code: string) => {
    const body = draft.trim();
    if (!body) return;
    addDiffComment(worktreeId, { file, line, code, body });
    setDraft("");
    setOpenLine(null);
  };

  if (hunks === null) return <p className="diff-loading">Loading diff…</p>;
  if (hunks.length === 0) return <p className="diff-empty">Nothing to show for this file.</p>;

  return (
    <div className="diff-view">
      {hunks.map((hunk, hi) => (
        <div className="diff-hunk" key={`${hunk.header}-${hi}`}>
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => {
            const anchored = line.newNo;
            const lineComments = fileComments.filter((c) => c.line === anchored && anchored !== null);
            return (
              <div key={`${hi}-${li}`}>
                <div
                  className={`diff-row diff-row-${line.kind}`}
                  data-testid={anchored === null ? undefined : `diff-line-${anchored}`}
                  onClick={() => {
                    if (anchored === null) return;
                    setDraft("");
                    setOpenLine(openLine === anchored ? null : anchored);
                  }}
                >
                  <span className="diff-lineno diff-lineno-old">{line.oldNo ?? ""}</span>
                  <span className="diff-lineno diff-lineno-new">{line.newNo ?? ""}</span>
                  <code className="diff-text">{line.text}</code>
                </div>

                {lineComments.map((c) => (
                  <div className="diff-comment" key={c.id}>
                    <span className="diff-comment-body">{c.body}</span>
                    <button
                      className="diff-comment-delete"
                      aria-label="Delete comment"
                      onClick={() => removeDiffComment(worktreeId, c.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {openLine !== null && openLine === anchored && (
                  <div className="diff-comment-editor">
                    <textarea
                      autoFocus
                      value={draft}
                      placeholder="Comment on this line…"
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button onClick={() => submit(anchored, line.text)}>Add comment</button>
                    <button onClick={() => setOpenLine(null)}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/DiffView.test.tsx`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/DiffView.tsx src/components/DiffView.test.tsx
git commit -m "feat(diff): per-file diff view with line comments"
```

---

### Task 9: Send to agent, and wire the panel into the app

**Files:**
- Modify: `src/state/store.ts` (add `sendReviewToAgent`)
- Modify: `src/App.tsx` (mount `DiffPanel`, pass the toggle to `TabBar`)
- Modify: `src/components/TabBar.tsx` (add a Review toggle button)
- Modify: `src/components/CommandPalette.tsx` (add a "Toggle diff review" entry)
- Test: `src/state/store.sendReview.test.ts`

**Interfaces:**
- Consumes: `composeReviewPrompt` (Task 6), `paneSessions` and `diffComments` (Task 5), the existing `pty_write` command.
- Produces: `sendReviewToAgent(worktreeId: string): Promise<void>` on the store — the function `DiffPanel` (Task 7) already calls.

- [ ] **Step 1: Write the failing tests**

Create `src/state/store.sendReview.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  useStore.setState({
    diffComments: {},
    toasts: [],
    terminals: [{ id: "t1", worktreeId: "/wt1", cwd: "/wt1", title: "b", panes: [{ id: "p1" }] }],
    activeTabId: "t1",
    paneSessions: { p1: 7 },
  });
});

describe("sendReviewToAgent", () => {
  it("writes the composed prompt to the active pane's PTY", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");

    const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "pty_write");
    expect(call).toBeTruthy();
    const args = call![1] as { id: number; data: string };
    expect(args.id).toBe(7);
    expect(args.data).toContain("fix this");
  });

  it("does not append a carriage return, so the agent is not auto-submitted", async () => {
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    const args = vi.mocked(invoke).mock.calls.find(([c]) => c === "pty_write")![1] as { data: string };
    expect(args.data.endsWith("\r")).toBe(false);
    expect(args.data.endsWith("\n")).toBe(false);
  });

  it("writes nothing and says so when there are no comments", async () => {
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
    expect(useStore.getState().toasts[0].message).toMatch(/no review comments/i);
  });

  it("errors clearly when the worktree has no live terminal", async () => {
    useStore.setState({ paneSessions: {} });
    useStore.getState().addDiffComment("/wt1", { file: "a.ts", line: 4, code: "x", body: "fix this" });
    await useStore.getState().sendReviewToAgent("/wt1");
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "pty_write")).toBe(false);
    expect(useStore.getState().toasts[0].kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/state/store.sendReview.test.ts`
Expected: FAIL — `sendReviewToAgent is not a function`.

- [ ] **Step 3: Add `sendReviewToAgent` to the store**

In `src/state/store.ts`, add
`import { composeReviewPrompt } from "../lib/reviewPrompt";` to the imports,
declare in the `AppState` interface after `setSelectedDiffFile`:

```ts
  /** insert every review comment for a worktree into its active agent terminal */
  sendReviewToAgent: (worktreeId: string) => Promise<void>;
```

and implement it after `setSelectedDiffFile`:

```ts
  sendReviewToAgent: async (worktreeId) => {
    const s = get();
    const comments = s.diffComments[worktreeId] ?? [];
    if (comments.length === 0) {
      s.pushToast("No review comments to send.", "info");
      return;
    }
    const tab = s.terminals.find((t) => t.id === s.activeTabId);
    const paneId = tab?.panes[0]?.id;
    const sessionId = paneId ? s.paneSessions[paneId] : undefined;
    if (sessionId === undefined) {
      s.pushToast("Open a terminal in this worktree first.", "error");
      return;
    }
    // Inserted, not submitted (spec D6): the user reads it in the agent's own
    // input box and presses Enter. Auto-submitting could fire a large prompt at
    // an agent that is mid-task or waiting on a different question.
    try {
      await invoke("pty_write", { id: sessionId, data: composeReviewPrompt(comments) });
      s.pushToast(
        `Inserted ${comments.length} comment(s) — press Enter in the terminal to send.`,
        "info",
      );
    } catch (err) {
      s.pushToast(`Couldn't send review: ${err}`);
    }
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/state/store.sendReview.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Mount the panel in `App.tsx`**

In `src/App.tsx`:

Add the lazy import beside the other lazy components:

```tsx
const DiffPanel = lazy(() =>
  import("./components/DiffPanel").then((m) => ({ default: m.DiffPanel })),
);
```

Add the store selectors beside `notesOpen` / `toggleNotes`:

```tsx
  const diffOpen = useStore((s) => s.diffOpen);
  const toggleDiff = useStore((s) => s.toggleDiff);
```

Pass them to `TabBar`:

```tsx
              <TabBar
                onOpenSettings={() => setSettingsOpen(true)}
                onToggleNotes={toggleNotes}
                notesOpen={notesOpen}
                onToggleDiff={toggleDiff}
                diffOpen={diffOpen}
              />
```

And mount the panel as a sibling of `<NotesPanel />` inside `content-row`:

```tsx
                <NotesPanel />
                <Suspense fallback={null}>
                  <DiffPanel />
                </Suspense>
```

- [ ] **Step 6: Add the TabBar toggle**

`src/components/TabBar.tsx` declares its props inline at `TabBar(...)` around
line 49, with the notes pair optional:

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

Extend it the same way:

```tsx
export function TabBar({
  onOpenSettings,
  onToggleNotes,
  notesOpen = false,
  onToggleDiff,
  diffOpen = false,
}: {
  onOpenSettings: () => void;
  onToggleNotes?: () => void;
  notesOpen?: boolean;
  onToggleDiff?: () => void;
  diffOpen?: boolean;
}) {
```

Then add the button immediately **before** the existing notes toggle (the
`className={\`gear notes-toggle ...\`}` button near line 250), matching its
`gear` class convention and its optional-callback call style:

```tsx
      <button
        className={`gear diff-toggle ${diffOpen ? "active" : ""}`}
        title="Diff review — comment on this agent's changes"
        onClick={() => onToggleDiff?.()}
      >
        ⑂
      </button>
```

- [ ] **Step 7: Add the command-palette entry**

`src/components/CommandPalette.tsx` builds a `cmds` array whose entries are
`{ id, title, run }` — with an optional `subtitle` — for example:

```tsx
      { id: "settings", title: "Open settings…", run: onOpenSettings },
```

There is no notes entry today, so add both toggles beside the `settings` entry
in that same base list:

```tsx
      { id: "toggle-notes", title: "Toggle notes panel", run: () => useStore.getState().toggleNotes() },
      { id: "toggle-diff", title: "Toggle diff review panel", run: () => useStore.getState().toggleDiff() },
```

Use `title`, **not** `label` — the palette renders `title` and a `label` field
would show a blank row. The palette closes itself after running a command, so
`run` does not call `onClose`.

- [ ] **Step 8: Typecheck and run the whole suite**

Run:

```bash
npx tsc --noEmit && npm test
```

Expected: no type errors, all suites pass.

> If `tsc` reports a wall of `TS2307: Cannot find module` for packages that *are*
> in `package.json`, `node_modules` is stale. Fix with an incremental
> `npm install` — **not** `npm ci`, which risks the npm optional-dependency bug
> that skips this project's win32 native binaries.

- [ ] **Step 9: Commit**

```bash
git add src/state/store.ts src/state/store.sendReview.test.ts src/App.tsx src/components/TabBar.tsx src/components/CommandPalette.tsx
git commit -m "feat(diff): send review comments to the active agent"
```

---

### Task 10: Styles, real-app verification, and docs

Every prior task is verified by automated tests, which cannot see a rendered
pane. This project has been bitten before by code that typechecks and unit-tests
green but crashes or renders unusably on mount.

**Files:**
- Modify: `src/App.css` (panel and diff-row styles)
- Modify: `README.md` (Features list)

**Interfaces:**
- Consumes: the class names used in Tasks 7 and 8.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the styles**

In `src/App.css`, add a diff-panel block. Use only existing CSS custom
properties — the panel must follow all 12 themes, so no hard-coded colours:

```css
.diff-panel {
  display: flex;
  flex-direction: column;
  width: 460px;
  min-width: 320px;
  overflow: auto;
  border-left: 1px solid var(--border);
  background: var(--bg-alt);
  font-size: 12px;
}
.diff-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.diff-panel-actions { display: flex; gap: 6px; }
.diff-empty, .diff-loading { padding: 12px; color: var(--fg-dim); }
.diff-file-list { list-style: none; margin: 0; padding: 0; }
.diff-file {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 4px 8px; background: none; border: 0; cursor: pointer;
  color: var(--fg); text-align: left; font: inherit;
}
.diff-file:hover, .diff-file.selected { background: var(--bg-hover); }
.diff-file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-status { width: 1em; text-align: center; opacity: 0.8; }
.diff-added { color: var(--green); }
.diff-removed { color: var(--red); }
.diff-binary { color: var(--fg-dim); }
.diff-view { font-family: var(--mono, monospace); }
.diff-hunk-header { padding: 2px 8px; color: var(--fg-dim); background: var(--bg); }
.diff-row { display: flex; gap: 8px; padding: 0 8px; white-space: pre; cursor: pointer; }
.diff-row:hover { background: var(--bg-hover); }
.diff-row-add { background: color-mix(in srgb, var(--green) 14%, transparent); }
.diff-row-del { background: color-mix(in srgb, var(--red) 14%, transparent); }
.diff-row-meta { color: var(--fg-dim); font-style: italic; cursor: default; }
.diff-lineno { width: 3.5em; text-align: right; color: var(--fg-dim); user-select: none; }
.diff-text { flex: 1; overflow-x: auto; }
.diff-comment {
  display: flex; gap: 8px; align-items: flex-start;
  margin: 2px 8px 2px 7em; padding: 4px 6px;
  border-left: 2px solid var(--accent); background: var(--bg);
}
.diff-comment-body { flex: 1; white-space: pre-wrap; }
.diff-comment-editor { display: flex; gap: 6px; margin: 4px 8px 4px 7em; }
.diff-comment-editor textarea { flex: 1; min-height: 3em; font: inherit; }
```

> Check the variable names against the top of `App.css` before pasting — this
> file's `:root` block is the source of truth for which custom properties exist.
> Substitute the nearest existing variable for any of `--bg-alt`, `--bg-hover`,
> `--fg-dim`, `--green`, `--red`, `--accent`, `--mono` that is not defined there.

- [ ] **Step 2: Verify it actually renders in the running app**

Unit tests do not catch mount crashes or an unusable layout. Run the dev server
and drive it:

```bash
npm run tauri dev
```

Check by hand:
1. Open a worktree that has real uncommitted changes. Click **⑂ Review**.
2. The file list appears; counts look right against `git diff --stat` in the terminal.
3. Clicking a file expands its diff. Line numbers match the file.
4. Clicking an added line opens the comment box. Add a comment; it appears under the line.
5. Toggle **Notes** — the diff panel closes (spec D8). Toggle Review again — the comment is still there.
6. Restart the app. Reopen Review. The comment survived (spec R5).
7. With an agent running in the tab, click **Send N to agent**. The prompt appears in the agent's input box and is **not** submitted.
8. Edit a file in that worktree from the terminal. The file list refreshes within ~1s without any click (spec R7).
9. Switch to a **clean** worktree: "No changes in this worktree." No error toast.
10. Switch to a **plain (non-git) folder**: same calm empty state, no toast.
11. Switch theme in Settings. The panel follows the new palette.

- [ ] **Step 3: Update the README feature list**

In `README.md`, add to the Features bullet list, after the "Live git status" bullet:

```markdown
- **Diff review** — read every file an agent changed in a worktree (committed *and*
  uncommitted), drop comments on any line, and send them all back to the agent as
  one prompt.
```

- [ ] **Step 4: Full verification and commit**

```bash
npx tsc --noEmit
npm test
cargo test --manifest-path src-tauri/Cargo.toml
git add src/App.css README.md
git commit -m "feat(diff): panel styles and docs"
```

Expected: all three green.

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| R1 file list with counts + status | Task 2 (Rust), Task 7 (UI) |
| R2 committed + uncommitted | Task 1 (merge-base), Task 2 test `lists_modified_committed_and_untracked_files_together` |
| R3 unified diff with line numbers | Task 3 (patch), Task 4 (parse), Task 8 (render) |
| R4 line and file-level comments | Task 5 (`line: number \| null`), Task 8 |
| R5 persist + scope + prune | Task 5 Steps 5–6 |
| R6 one action composes and delivers | Task 6, Task 9 |
| R7 watcher-driven refresh | Task 7 Step 3 (`worktrees-changed` listener) |
| R8 calm empty state, never an error | Task 1 (`try_git` returns Option), Task 2/3 tests, Task 7 catch |
| D6 no auto-submit | Task 9 test `does not append a carriage return` |
| D7 prompt wording isolated | Task 6 |
| D8 one panel at a time | Task 5 Step 4(f), Task 5 test `toggleDiff closes the notes panel` |

No gaps.

**Type consistency:** `DiffFile` fields (`path`, `status`, `added`, `removed`,
`binary`) are identical in `model.rs` (Task 2) and `types.ts` (Task 5).
`DiffComment` fields (`id`, `file`, `line`, `code`, `body`) are used identically
in Tasks 5, 6, 8, and 9. Command names `worktree_diff` and
`worktree_file_patch`, and their argument names `path` / `file`, match between
Task 3's registration and Tasks 7/8's `invoke` calls.

**Known ordering wrinkle:** Task 7's `DiffPanel` imports `DiffView` (Task 8) and
calls `sendReviewToAgent` (Task 9), so `npx tsc --noEmit` is only clean once all
three land. This is called out inline in Task 7 Step 3 and Step 4. Executing
Tasks 7–9 as one review unit avoids it.
