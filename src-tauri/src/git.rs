//! Git worktree operations, implemented by shelling out to `git.exe`.
//!
//! `git` is a hard runtime requirement (worktrees need it), and the porcelain
//! output of `git worktree list` gives exact semantics that are stable across
//! git versions — more reliable here than libgit2's partial worktree API.

use std::path::Path;
use std::process::Command;

use crate::model::{Worktree, WorktreeStatus};

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

/// Repo-detection heuristic: a working tree has a `.git` entry
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

/// Create a new worktree on a new branch `branch` at `new_path`, started from
/// `base` (a local branch name) or, when `None`, from the primary checkout's
/// HEAD. If the branch already exists, check it out into the new worktree
/// instead (its history is what it is; `base` is ignored).
pub fn add_worktree(
    repo_path: &str,
    new_path: &str,
    branch: &str,
    base: Option<&str>,
) -> Result<(), String> {
    let mut args = vec!["worktree", "add", "-b", branch, new_path];
    if let Some(b) = base {
        args.push(b);
    }
    match run_git(repo_path, &args) {
        Ok(_) => Ok(()),
        Err(e) if e.contains("already exists") => {
            run_git(repo_path, &["worktree", "add", new_path, branch]).map(|_| ())
        }
        Err(e) => Err(e),
    }
}

/// Local branch names, sorted. Used to pick a base branch for new worktrees.
pub fn list_branches(repo_path: &str) -> Result<Vec<String>, String> {
    let out = run_git(
        repo_path,
        &["for-each-ref", "--sort=refname", "--format=%(refname:short)", "refs/heads"],
    )?;
    Ok(out.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}

/// Remove a worktree (does not delete the branch). Uses `--force` to handle
/// dirty/untracked files an agent may have left. If git fails (e.g. the
/// directory is briefly still locked on Windows), fall back to pruning the
/// registration and removing the leftover directory so we never orphan state.
pub fn remove_worktree(repo_path: &str, worktree_path: &str) -> Result<(), String> {
    match run_git(repo_path, &["worktree", "remove", "--force", worktree_path]) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = run_git(repo_path, &["worktree", "prune"]);
            let _ = std::fs::remove_dir_all(worktree_path);
            if std::path::Path::new(worktree_path).exists() {
                Err(e) // genuinely could not remove it
            } else {
                let _ = run_git(repo_path, &["worktree", "prune"]);
                Ok(())
            }
        }
    }
}

/// Commits ahead/behind the branch's upstream. (0, 0) when there is no upstream.
fn ahead_behind(path: &str) -> (usize, usize) {
    match run_git(path, &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) {
        Ok(out) => {
            // Output is "<behind>\t<ahead>" (left = upstream-only, right = HEAD-only).
            let mut it = out.split_whitespace();
            let behind = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let ahead = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            (ahead, behind)
        }
        Err(_) => (0, 0),
    }
}

/// Full live status for a worktree: branch, dirty count, ahead/behind, last commit.
pub fn worktree_status(path: &str) -> Result<WorktreeStatus, String> {
    let branch = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD");
    let status = run_git(path, &["status", "--porcelain"])?;
    let dirty = status.lines().filter(|l| !l.trim().is_empty()).count();
    let (ahead, behind) = ahead_behind(path);
    let last_commit = run_git(path, &["log", "-1", "--pretty=%h %s"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(WorktreeStatus {
        branch,
        dirty,
        ahead,
        behind,
        last_commit,
    })
}

/// Cap on how many paths a single worktree contributes to Quick Open.
///
/// Beyond this, per-keystroke fuzzy scoring in the palette gets janky no matter
/// what the UI does, so the honest move is to truncate here and say so.
pub const MAX_FILES: usize = 20_000;

/// Turns raw `git ls-files` output into a capped list of paths. Split out from
/// `list_files` so the cap can be tested against a synthetic listing instead
/// of writing tens of thousands of real files to disk.
fn parse_file_list(out: &str) -> Vec<String> {
    out.lines()
        .filter(|l| !l.is_empty())
        .take(MAX_FILES)
        .map(str::to_string)
        .collect()
}

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
    parse_file_list(&out)
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
    fn status_reports_dirty_count() {
        let base = std::env::temp_dir().join(format!("agentpanel_status_{}", std::process::id()));
        let repo = base.join("repo");
        init_repo(&repo);
        let repo_str = repo.to_string_lossy().to_string();

        let st = worktree_status(&repo_str).unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.dirty, 0, "clean repo");
        assert_eq!((st.ahead, st.behind), (0, 0), "no upstream");
        assert!(st.last_commit.is_some(), "has a commit");

        fs::write(repo.join("new.txt"), "x").unwrap();
        let st = worktree_status(&repo_str).unwrap();
        assert_eq!(st.dirty, 1, "one untracked file");

        let _ = fs::remove_dir_all(&base);
    }

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

    // Rewritten per controller ruling: the brief's version wrote MAX_FILES + 5
    // real files to disk (20,005 writes) on every `cargo test` run. Instead,
    // the truncation is exercised directly against `parse_file_list`, the pure
    // helper `list_files` delegates to, using a synthetic in-memory listing.
    // This still fails if `.take(MAX_FILES)` were removed from that helper.
    #[test]
    fn caps_the_returned_list() {
        let synthetic: String = (0..(MAX_FILES + 5)).map(|i| format!("f{i}.txt\n")).collect();
        let files = parse_file_list(&synthetic);
        assert_eq!(files.len(), MAX_FILES, "must truncate to the cap");
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
        add_worktree(&repo_str, &wt_str, "feature", None).unwrap();

        let wts = list_worktrees(&repo_str, &repo_str).unwrap();
        assert_eq!(wts.len(), 2, "added worktree should appear");
        assert!(wts.iter().any(|w| w.branch.as_deref() == Some("feature")));

        remove_worktree(&repo_str, &wt_str).unwrap();
        let wts = list_worktrees(&repo_str, &repo_str).unwrap();
        assert_eq!(wts.len(), 1, "removed worktree should be gone");

        let _ = fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod base_branch_tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) -> String {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(dir).args(args);
        configure_no_window(&mut cmd);
        let out = cmd.output().expect("git on PATH");
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// main + a second branch `other` with one extra commit, checked out.
    fn repo_on_other(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("agentpanel_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.email", "t@example.com"]);
        git(&repo, &["config", "user.name", "T"]);
        fs::write(repo.join("a.txt"), "a").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "init"]);
        git(&repo, &["checkout", "-b", "other"]);
        fs::write(repo.join("b.txt"), "b").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "other"]);
        (base, repo)
    }

    #[test]
    fn add_worktree_starts_from_the_given_base_not_head() {
        let (base, repo) = repo_on_other("wtbase");
        let repo_str = repo.to_string_lossy().to_string();
        let main_sha = git(&repo, &["rev-parse", "main"]);
        let other_sha = git(&repo, &["rev-parse", "other"]);
        assert_ne!(main_sha, other_sha);

        let wt = base.join("wt-feature");
        add_worktree(&repo_str, &wt.to_string_lossy(), "feature", Some("main")).unwrap();

        assert_eq!(git(&wt, &["rev-parse", "HEAD"]), main_sha, "must branch from main, not HEAD (other)");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn add_worktree_without_base_keeps_using_head() {
        let (base, repo) = repo_on_other("wthead");
        let repo_str = repo.to_string_lossy().to_string();
        let other_sha = git(&repo, &["rev-parse", "other"]);

        let wt = base.join("wt-feature");
        add_worktree(&repo_str, &wt.to_string_lossy(), "feature", None).unwrap();

        assert_eq!(git(&wt, &["rev-parse", "HEAD"]), other_sha);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn list_branches_returns_local_branch_names_sorted() {
        let (base, repo) = repo_on_other("wtlist");
        let branches = list_branches(&repo.to_string_lossy()).unwrap();
        assert_eq!(branches, vec!["main".to_string(), "other".to_string()]);
        let _ = fs::remove_dir_all(&base);
    }
}
