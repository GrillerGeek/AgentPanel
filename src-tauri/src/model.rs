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

/// Pull-request info for a worktree's branch, from the `gh` CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub state: String, // OPEN | MERGED | CLOSED
    pub title: String,
    pub url: String,
    pub checks: String, // passing | failing | pending | none
}

/// Live status of a worktree: current branch, dirty-file count, ahead/behind
/// vs upstream, and the last commit summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    pub branch: Option<String>,
    pub dirty: usize,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit: Option<String>,
}
