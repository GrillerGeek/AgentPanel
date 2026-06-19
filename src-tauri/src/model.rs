//! Core data model shared across the Rust core and the frontend.
//!
//! Serialized with camelCase field names so the TypeScript side gets idiomatic
//! `repoId` / `isGit` / `isPrimary` keys.

use serde::{Deserialize, Serialize};

/// A top-level container the user has added: either a git repository or a plain
/// folder. Its `id` is its absolute path (stable + unique).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub path: String,
    pub name: String,
    pub is_git: bool,
}

/// An isolated work unit. For git repos this is a real git worktree; for plain
/// folders a single synthesized "main" worktree (`id = "folder:" + path`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub repo_id: String,
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub is_primary: bool,
}
