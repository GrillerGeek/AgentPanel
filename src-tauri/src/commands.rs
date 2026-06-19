//! Tauri command surface for repositories and worktrees (the frontend's API
//! into the Rust core). These are the analog of Supacode's `RepositoriesFeature`
//! actions.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::git;
use crate::model::{Repository, Worktree, WorktreeStatus};
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
pub fn list_worktrees(store: State<'_, AppStore>, repo_id: String) -> Result<Vec<Worktree>, String> {
    let repos = store.repos.lock().map_err(|e| e.to_string())?;
    let repo = repos
        .iter()
        .find(|r| r.id == repo_id)
        .ok_or("repository not found")?;

    if repo.is_git {
        git::list_worktrees(&repo.path, &repo.id)
    } else {
        Ok(vec![Worktree {
            id: format!("folder:{}", repo.path),
            repo_id: repo.id.clone(),
            path: repo.path.clone(),
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
#[tauri::command]
pub fn worktree_status(path: String) -> Result<WorktreeStatus, String> {
    git::worktree_status(&path)
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
