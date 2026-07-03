//! Tauri command surface for repositories and worktrees (the frontend's API
//! into the Rust core).

use std::path::Path;

use tauri::{AppHandle, State};

use crate::git;
use crate::gh;
use crate::model::{PrInfo, Repository, Worktree, WorktreeStatus};
use crate::store::{self, AppStore};

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
