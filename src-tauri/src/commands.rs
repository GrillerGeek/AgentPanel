//! Tauri command surface for repositories and worktrees (the frontend's API
//! into the Rust core).

use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, State};

use crate::git;
use crate::gh;
use crate::model::{PrInfo, Repository, Worktree, WorktreeStatus};
use crate::store::{self, AppStore};

/// On Windows, prevent a console window from flashing for the editor subprocess.
#[cfg(windows)]
fn configure_no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn configure_no_window(_cmd: &mut Command) {}

/// Launch an external editor CLI (e.g. `code`, `cursor`) on `path`. Spawns and
/// returns immediately — never waits on the child, so a slow-starting editor
/// (or one that stays open) can't block the UI.
///
/// Windows spawns `command` directly (with a `.cmd`/`.bat` fallback) instead of
/// going through `cmd /C`: hand-rolled `cmd /C` requires manual escaping, and
/// `cmd.exe`'s parsing of `&`/`|`/etc. differs from `CommandLineToArgvW`, so a
/// space-free path containing a shell metacharacter (e.g. `...\main&calc`) could
/// reach `cmd` unquoted and run the suffix as a second command. A direct spawn
/// also fails immediately when the editor CLI is missing or misspelled — with
/// `cmd /C`, `cmd.exe` itself always spawns successfully, so a typo'd command
/// silently did nothing (no toast, no editor, no signal). Rust >= 1.77 spawns
/// `.cmd`/`.bat` shims (like `code.cmd`) with safe, automatic argument escaping,
/// so this still covers npm-style CLI shims without shelling out.
#[tauri::command]
pub fn open_in_editor(command: String, path: String) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("editor command is empty".into());
    }

    #[cfg(windows)]
    {
        let mut cmd = Command::new(&command);
        cmd.arg(&path);
        configure_no_window(&mut cmd);
        let mut last_err = match cmd.spawn() {
            Ok(_) => return Ok(()),
            Err(e) => e,
        };

        // Fallback: retry as a `.cmd`/`.bat` shim, but only when `command`
        // doesn't already carry an extension on its final segment (so we don't
        // turn `code.exe` into `code.exe.cmd`, or misfire on a path-qualified
        // command that simply couldn't be found).
        let final_segment = command.rsplit(['\\', '/']).next().unwrap_or(&command);
        let has_extension = final_segment.rsplit_once('.').is_some();
        if !has_extension {
            let mut fallback = Command::new(format!("{command}.cmd"));
            fallback.arg(&path);
            configure_no_window(&mut fallback);
            match fallback.spawn() {
                Ok(_) => return Ok(()),
                Err(e) => last_err = e,
            }
        }

        Err(format!("failed to launch \"{command}\": {last_err}"))
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new(&command);
        cmd.arg(&path);
        cmd.spawn().map_err(|e| format!("failed to launch \"{command}\": {e}"))?;
        Ok(())
    }
}

/// Add a folder as a repository: detect git vs plain folder, dedupe by path,
/// and persist.
#[tauri::command]
pub fn add_repository(
    app: AppHandle,
    store: State<'_, AppStore>,
    path: String,
) -> Result<Repository, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let repo = Repository {
        id: path.clone(),
        path: path.clone(),
        name,
        is_git: git::is_git_repository(p),
    };

    let mut repos = store.repos.lock().map_err(|e| e.to_string())?;
    if !repos.iter().any(|r| r.id == repo.id) {
        repos.push(repo.clone());
        store::save(&app, &repos)?;
    }
    Ok(repo)
}

#[tauri::command]
pub fn list_repositories(store: State<'_, AppStore>) -> Result<Vec<Repository>, String> {
    Ok(store.repos.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn remove_repository(
    app: AppHandle,
    store: State<'_, AppStore>,
    id: String,
) -> Result<(), String> {
    let mut repos = store.repos.lock().map_err(|e| e.to_string())?;
    repos.retain(|r| r.id != id);
    store::save(&app, &repos)
}

/// List a repository's worktrees. Plain folders get one synthesized "main"
/// worktree so the UI treats them uniformly with git repos.
#[tauri::command]
pub async fn list_worktrees(
    store: State<'_, AppStore>,
    repo_id: String,
) -> Result<Vec<Worktree>, String> {
    let (path, id, is_git) = repo_handle(&store, &repo_id)?;
    if is_git {
        // git subprocess — keep it off the main/UI thread (see worktree_status).
        let (p, i) = (path.clone(), id.clone());
        tauri::async_runtime::spawn_blocking(move || git::list_worktrees(&p, &i))
            .await
            .map_err(|e| e.to_string())?
    } else {
        Ok(vec![Worktree {
            id: format!("folder:{path}"),
            repo_id: id,
            path,
            name: "main".to_string(),
            branch: None,
            is_primary: true,
        }])
    }
}

/// Look up a repository's (path, id, is_git) without holding the store lock
/// across the git subprocess call.
fn repo_handle(store: &State<'_, AppStore>, repo_id: &str) -> Result<(String, String, bool), String> {
    let repos = store.repos.lock().map_err(|e| e.to_string())?;
    let repo = repos.iter().find(|r| r.id == repo_id).ok_or("repository not found")?;
    Ok((repo.path.clone(), repo.id.clone(), repo.is_git))
}

/// Create a new worktree on a new branch. The worktree is placed in a sibling
/// `<repo>-worktrees/<branch>` directory so it stays out of the main tree.
/// Returns the refreshed worktree list.
#[tauri::command]
pub fn create_worktree(
    store: State<'_, AppStore>,
    repo_id: String,
    branch: String,
) -> Result<Vec<Worktree>, String> {
    let (repo_path, id, is_git) = repo_handle(&store, &repo_id)?;
    if !is_git {
        return Err("not a git repository".into());
    }
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("branch name is required".into());
    }

    let repo = Path::new(&repo_path);
    let parent = repo.parent().ok_or("repository has no parent directory")?;
    let repo_name = repo
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());
    let safe_branch = branch.replace(['/', '\\', ':'], "-");
    let wt_dir = parent.join(format!("{repo_name}-worktrees")).join(&safe_branch);

    git::add_worktree(&repo_path, &wt_dir.to_string_lossy(), branch)?;
    git::list_worktrees(&repo_path, &id)
}

/// Live status for a worktree path (branch/dirty/ahead/behind/last-commit),
/// polled by the UI.
///
/// `async` + `spawn_blocking` is load-bearing: this shells out to several `git`
/// subprocesses, and a *synchronous* Tauri command runs on the main (UI) thread,
/// which would freeze the window during a status poll. Running the blocking work
/// on a background thread keeps window move/resize smooth.
#[tauri::command]
pub async fn worktree_status(path: String) -> Result<WorktreeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || git::worktree_status(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// PR + CI status for the branch checked out at `path` (via gh). None if gh is
/// unavailable or there's no PR — the UI just shows nothing.
///
/// Like `worktree_status`, this MUST stay off the main thread: `gh` makes a
/// network round-trip (~1–2s), and blocking the UI thread on it freezes the
/// whole window (and, mid-drag, stalls desktop input behind it).
#[tauri::command]
pub async fn worktree_pr(path: String) -> Option<PrInfo> {
    tauri::async_runtime::spawn_blocking(move || gh::pr_info(&path))
        .await
        .unwrap_or(None)
}

/// Remove a worktree (does not delete its branch). Returns the refreshed list.
#[tauri::command]
pub fn delete_worktree(
    store: State<'_, AppStore>,
    repo_id: String,
    worktree_path: String,
) -> Result<Vec<Worktree>, String> {
    let (repo_path, id, _) = repo_handle(&store, &repo_id)?;
    git::remove_worktree(&repo_path, &worktree_path)?;
    git::list_worktrees(&repo_path, &id)
}
