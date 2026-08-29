//! Diff computation for the review panel.
//!
//! Shells out to `git` like `git.rs` does, for the same reason: porcelain
//! output is stable across git versions, and worktree semantics are exact.
//!
//! The diff is always `git diff <merge-base>` with no second revision, so a
//! single command covers committed *and* uncommitted work — an agent that
//! commits mid-task must not make its own changes disappear from the panel.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::model::DiffFile;

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

        // Advance main past the fork point too, so main's tip and the fork
        // point genuinely differ -- otherwise an implementation that skips
        // merge-base entirely (just returning main's resolved SHA) would
        // still pass.
        run_raw(&repo, &["checkout", "main"]);
        fs::write(repo.join("b.txt"), "two\n").unwrap();
        run_raw(&repo, &["add", "."]);
        run_raw(&repo, &["commit", "-m", "main moved on"]);
        let main_tip = head_sha(&repo);

        run_raw(&repo, &["checkout", "feature"]);
        let got = detect_base_rev(&repo.to_string_lossy());
        assert_eq!(got, fork, "base must be where the branch left main");
        assert_ne!(got, main_tip, "must be the merge-base, not main's tip");
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
}
