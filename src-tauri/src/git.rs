//! Git worktree operations, implemented by shelling out to `git.exe`.
//!
//! `git` is a hard runtime requirement (worktrees need it), and the porcelain
//! output of `git worktree list` gives exact semantics that are stable across
//! git versions — more reliable here than libgit2's partial worktree API.

use std::path::Path;
use std::process::Command;

use crate::model::Worktree;

/// On Windows, prevent a console window from flashing for each git subprocess.
#[cfg(windows)]
fn configure_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn configure_no_window(_cmd: &mut Command) {}

/// Run `git -C <repo> <args...>` and return stdout, or stderr as the error.
fn run_git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    configure_no_window(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run git (is it on PATH?): {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Supacode's repo-detection heuristic: a working tree has a `.git` entry
/// (dir, or a file for linked worktrees/submodules); a bare repo has the
/// HEAD/objects/refs trio at the top level.
pub fn is_git_repository(path: &Path) -> bool {
    if path.join(".git").exists() {
        return true;
    }
    path.join("HEAD").exists() && path.join("objects").exists() && path.join("refs").exists()
}

fn make_worktree(repo_id: &str, path: String, branch: Option<String>, is_primary: bool) -> Worktree {
    let name = branch.clone().unwrap_or_else(|| {
        Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone())
    });
    Worktree {
        id: path.clone(),
        repo_id: repo_id.to_string(),
        path,
        name,
        branch,
        is_primary,
    }
}

/// List a repository's worktrees. The first entry is always the primary
/// (main) working tree.
pub fn list_worktrees(repo_path: &str, repo_id: &str) -> Result<Vec<Worktree>, String> {
    let out = run_git(repo_path, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = Vec::new();
    let mut cur_path: Option<String> = None;
    let mut cur_branch: Option<String> = None;
    let mut first = true;

    // Porcelain format: blocks separated by blank lines, each with a
    // `worktree <path>` line and optionally a `branch refs/heads/<name>` line
    // (absent when detached).
    let flush = |path: &mut Option<String>, branch: &mut Option<String>, first: &mut bool, out: &mut Vec<Worktree>| {
        if let Some(p) = path.take() {
            out.push(make_worktree(repo_id, p, branch.take(), *first));
            *first = false;
        }
    };

    for line in out.lines() {
        if line.is_empty() {
            flush(&mut cur_path, &mut cur_branch, &mut first, &mut worktrees);
        } else if let Some(rest) = line.strip_prefix("worktree ") {
            cur_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            cur_branch = Some(rest.trim_start_matches("refs/heads/").to_string());
        }
    }
    // Final block may not be followed by a blank line.
    flush(&mut cur_path, &mut cur_branch, &mut first, &mut worktrees);

    Ok(worktrees)
}

/// Create a new worktree on a new branch `branch` at `new_path`. If the branch
/// already exists, check it out into the new worktree instead.
#[allow(dead_code)] // wired into a command in P1.4 (worktree create/remove)
pub fn add_worktree(repo_path: &str, new_path: &str, branch: &str) -> Result<(), String> {
    match run_git(repo_path, &["worktree", "add", "-b", branch, new_path]) {
        Ok(_) => Ok(()),
        Err(e) if e.contains("already exists") => {
            run_git(repo_path, &["worktree", "add", new_path, branch]).map(|_| ())
        }
        Err(e) => Err(e),
    }
}

/// Remove a worktree (does not delete the branch).
#[allow(dead_code)] // wired into a command in P1.4 (worktree create/remove)
pub fn remove_worktree(repo_path: &str, worktree_path: &str) -> Result<(), String> {
    run_git(repo_path, &["worktree", "remove", worktree_path]).map(|_| ())
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
        fs::write(dir.join("README.md"), "hi").unwrap();
        run_raw(dir, &["add", "."]);
        run_raw(dir, &["commit", "-m", "init"]);
    }

    #[test]
    fn detects_git_repo() {
        let base = std::env::temp_dir().join(format!("agentpanel_isgit_{}", std::process::id()));
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        assert!(!is_git_repository(&repo));
        init_repo(&repo);
        assert!(is_git_repository(&repo));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn worktree_lifecycle() {
        let base = std::env::temp_dir().join(format!("agentpanel_wt_{}", std::process::id()));
        let repo = base.join("repo");
        init_repo(&repo);
        let repo_str = repo.to_string_lossy().to_string();

        let wts = list_worktrees(&repo_str, &repo_str).unwrap();
        assert_eq!(wts.len(), 1, "fresh repo has one (primary) worktree");
        assert!(wts[0].is_primary);

        let wt_path = base.join("wt-feature");
        let wt_str = wt_path.to_string_lossy().to_string();
        add_worktree(&repo_str, &wt_str, "feature").unwrap();

        let wts = list_worktrees(&repo_str, &repo_str).unwrap();
        assert_eq!(wts.len(), 2, "added worktree should appear");
        assert!(wts.iter().any(|w| w.branch.as_deref() == Some("feature")));

        remove_worktree(&repo_str, &wt_str).unwrap();
        let wts = list_worktrees(&repo_str, &repo_str).unwrap();
        assert_eq!(wts.len(), 1, "removed worktree should be gone");

        let _ = fs::remove_dir_all(&base);
    }
}
