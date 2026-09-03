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
    /// Local branch new worktrees start from. `None` = the primary checkout's
    /// current HEAD (the pre-0.8 behaviour). Absent in older saved files.
    #[serde(default)]
    pub default_branch: Option<String>,
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

/// One changed file in a worktree's review diff.
///
/// `status` is a lowercase word rather than git's letter code so the frontend
/// never has to know git's alphabet: `added` | `modified` | `deleted` |
/// `untracked`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub added: usize,
    pub removed: usize,
    pub binary: bool,
}

#[cfg(test)]
mod default_branch_tests {
    use super::*;

    #[test]
    fn repository_saved_before_default_branch_existed_still_loads() {
        let json = r#"{"id":"C:\r","path":"C:\r","name":"r","isGit":true}"#;
        let repo: Repository = serde_json::from_str(json).unwrap();
        assert_eq!(repo.default_branch, None);
    }

    #[test]
    fn default_branch_round_trips_as_camel_case() {
        let repo = Repository {
            id: "x".into(),
            path: "x".into(),
            name: "x".into(),
            is_git: true,
            default_branch: Some("main".into()),
        };
        let json = serde_json::to_string(&repo).unwrap();
        assert!(json.contains(r#""defaultBranch":"main""#), "{json}");
    }
}
