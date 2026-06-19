//! Tauri command surface for repositories and worktrees (the frontend's API
//! into the Rust core). These are the analog of Supacode's `RepositoriesFeature`
//! actions.

use std::path::Path;

use tauri::{AppHandle, State};

use crate::git;
use crate::model::{Repository, Worktree};
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
