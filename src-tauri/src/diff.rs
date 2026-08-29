//! Diff computation for the review panel.
//!
//! Shells out to `git` like `git.rs` does, for the same reason: porcelain
//! output is stable across git versions, and worktree semantics are exact.
//!
//! The diff is always `git diff <merge-base>` with no second revision, so a
//! single command covers committed *and* uncommitted work — an agent that
//! commits mid-task must not make its own changes disappear from the panel.

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
