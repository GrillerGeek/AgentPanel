//! Local persistence for the list of added repositories.
//!
//! Stored as JSON under the OS app-data dir (e.g. `%APPDATA%\com.jason.agentpanel`
//! on Windows). The in-memory `AppStore` is the source of truth at runtime and
//! is written through to disk on every mutation.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::model::Repository;

#[derive(Default)]
pub struct AppStore {
    pub repos: Mutex<Vec<Repository>>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("repositories.json"))
}

/// Load persisted repositories. Missing/corrupt file -> empty list (non-fatal).
pub fn load(app: &AppHandle) -> Vec<Repository> {
    let Ok(path) = store_path(app) else {
        return Vec::new();
    };
    let Ok(data) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Persist the current repository list.
pub fn save(app: &AppHandle, repos: &[Repository]) -> Result<(), String> {
    let path = store_path(app)?;
    let json = serde_json::to_string_pretty(repos).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
