//! Explicit, non-forcing remote checkout operations. No local path resolution,
//! automatic retry, recursive deletion, branch reset/deletion, or process kill.
use crate::{herdr::{RemoteGit, REMOTE_OPERATIONS}, model::{Repository, Worktree}, remote_projects, store::AppStore};
use serde_json::Value;
use tauri::State;

async fn connect(repo: &Repository) -> Result<RemoteGit, String> {
    RemoteGit::connect(repo.remote.as_ref().ok_or("Select a remote repository")?).await
}

pub(crate) async fn branches(repo: &Repository) -> Result<Vec<String>, String> {
    let mut peer = connect(repo).await?;
    Ok(peer.git(&repo.path, &["for-each-ref", "--sort=refname", "--format=%(refname:strip=2)", "refs/heads"]).await?
        .lines().map(str::to_string).collect())
}

#[tauri::command]
pub async fn remote_list_branches(store: State<'_, AppStore>, repo_id: String) -> Result<Vec<String>, String> {
    branches(&remote_projects::repository(&store, &repo_id)?).await
}

fn destination(repo: &Repository, branch: &str) -> Result<(String, String), String> {
    let (parent, name) = repo.path.rsplit_once('/').ok_or("Remote repository has no parent")?;
    if name.is_empty() || branch.is_empty() || branch.starts_with('-') || branch.contains('\0') {
        return Err("Enter a new branch name".into());
    }
    let parent = format!("{parent}/{name}-worktrees");
    let safe = branch.replace(['/', '\\', ':'], "-");
    Ok((parent.clone(), format!("{parent}/{safe}")))
}

pub(crate) async fn create(repo: &Repository, branch: &str, base: Option<&str>) -> Result<Vec<Worktree>, String> {
    let _guard = REMOTE_OPERATIONS.lock().await;
    let branch = branch.trim();
    let (parent, path) = destination(repo, branch)?;
    let mut peer = connect(repo).await?;
    let reference = format!("refs/heads/{branch}");
    peer.git(&repo.path, &["check-ref-format", &reference]).await?;
    let existing = peer.output(&repo.path, &["show-ref", "--verify", "--quiet", &reference]).await?;
    if existing.0 == 0 { return Err("Remote branch already exists; choose a new branch name".into()); }
    if existing.0 != 1 { return Err("Could not verify remote branch availability".into()); }
    let base = base.filter(|s| !s.is_empty());
    let selected = if let Some(base) = base {
        let reference = format!("refs/heads/{base}");
        peer.git(&repo.path, &["check-ref-format", &reference]).await?;
        peer.git(&repo.path, &["rev-parse", "--verify", &format!("{reference}^{{commit}}")]).await?
    } else { peer.git(&repo.path, &["rev-parse", "--verify", "HEAD^{commit}"]).await? };
    // Reserve a new directory atomically. Git itself accepts existing empty
    // directories, which we must not mistake for a destination we own.
    peer.command(&["mkdir", "-p", "--", &parent]).await?;
    peer.command(&["mkdir", "--", &path]).await?;
    peer.mutate(&repo.path, &["worktree", "add", "-b", branch, "--", &path, selected.trim()]).await?;
    drop(peer);
    remote_projects::worktrees(repo).await.map_err(|error| format!("Worktree creation completed, but refresh failed: {error}. Refresh before retrying."))
}

#[tauri::command]
pub async fn remote_create_worktree(store: State<'_, AppStore>, repo_id: String, branch: String, base: Option<String>) -> Result<Vec<Worktree>, String> {
    create(&remote_projects::repository(&store, &repo_id)?, &branch, base.as_deref()).await
}

fn require_quiet(inventory: &Value, machine: &str) -> Result<(), String> {
    let terminals = inventory["terminals"].as_array().ok_or("Remote terminal inventory unavailable")?;
    let prefix = format!("{machine}/");
    for terminal in terminals {
        let address = terminal["address"].as_str().ok_or("Terminal identity unavailable; removal blocked")?;
        if address.starts_with(&prefix) && terminal["state"] != "finished" {
            return Err("Exit all programs in this machine's selected Herdr session before removing a worktree. Closing a tab only detaches; AgentPanel will not stop programs for removal.".into());
        }
    }
    Ok(())
}

async fn check(peer: &mut RemoteGit, repo: &Repository, path: &str) -> Result<(), String> {
    let list = peer.git(&repo.path, &["worktree", "list", "--porcelain", "-z"]).await?;
    let records: Vec<_> = list.split("\0\0").filter(|r| !r.is_empty()).collect();
    let (index, record) = records.iter().enumerate().find(|(_, record)|
        record.split('\0').any(|field| field.strip_prefix("worktree ") == Some(path)))
        .ok_or("This directory is not a registered remote worktree")?;
    if index == 0 { return Err("The primary checkout cannot be removed".into()); }
    if !record.split('\0').any(|field| field.starts_with("branch refs/heads/")) {
        return Err("Detached remote worktrees cannot be removed from AgentPanel; create a branch to preserve their history first".into());
    }
    if record.split('\0').any(|field| field == "locked" || field.starts_with("locked ") || field == "prunable" || field.starts_with("prunable ")) {
        return Err("Locked or missing remote worktrees cannot be removed from AgentPanel".into());
    }
    let changes = peer.git(path, &["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored"]).await?;
    if !changes.is_empty() {
        return Err("Remote worktree contains modified, untracked, or ignored files. Commit, stash (including ignored files if needed), or move them before removal.".into());
    }
    require_quiet(&peer.terminals().await?, &repo.remote.as_ref().ok_or("Missing machine identity")?.machine)
}

pub(crate) async fn preflight(repo: &Repository, path: &str) -> Result<(), String> {
    let mut peer = connect(repo).await?;
    check(&mut peer, repo, path).await
}

#[tauri::command]
pub async fn remote_check_worktree_removal(store: State<'_, AppStore>, repo_id: String, worktree_path: String) -> Result<(), String> {
    preflight(&remote_projects::repository(&store, &repo_id)?, &worktree_path).await
}

pub(crate) async fn remove(repo: &Repository, path: &str) -> Result<Vec<Worktree>, String> {
    let _guard = REMOTE_OPERATIONS.lock().await;
    let mut peer = connect(repo).await?;
    check(&mut peer, repo, path).await?;
    peer.mutate(&repo.path, &["worktree", "remove", "--", path]).await?;
    drop(peer);
    remote_projects::worktrees(repo).await.map_err(|error| format!("Removal completed, but refresh failed: {error}. Refresh before retrying."))
}

#[tauri::command]
pub async fn remote_delete_worktree(store: State<'_, AppStore>, repo_id: String, worktree_path: String) -> Result<Vec<Worktree>, String> {
    remove(&remote_projects::repository(&store, &repo_id)?, &worktree_path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicitly_finished_programs_allow_removal() {
        assert!(require_quiet(&serde_json::json!({"terminals":[{"address":"other/t1","state":"live"},{"address":"linux/t1","state":"finished"}]}), "linux").is_ok());
        for state in ["live", "unknown", "disconnected", ""] {
            assert!(require_quiet(&serde_json::json!({"terminals":[{"address":"linux/t1","state":state}]}), "linux").is_err());
        }
        assert!(require_quiet(&serde_json::json!({}), "linux").is_err());
        assert!(require_quiet(&serde_json::json!({"terminals":[{}]}), "linux").is_err());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::herdr::{self, RemoteTarget, Options, Control};
    #[tokio::test]
    #[ignore = "run through run_herdr_ssh_test.py --worktrees in disposable SSH/Git guests"]
    async fn live_remote_worktree_creation_and_safe_removal() {
        let target = RemoteTarget { endpoint: herdr::Endpoint { executable: std::env::var("AGENTPANEL_HC_TEST_BINARY").unwrap(), session: "agentpanel-adapter-test".into() },
            core_id: std::env::var("AGENTPANEL_HC_REMOTE_CORE").unwrap(), machine: "linux".into(),
            machine_id: std::env::var("AGENTPANEL_HC_REMOTE_MACHINE").unwrap(), session: Some("adapter-peer-test".into()) };
        let repo = remote_projects::inspect(target.clone(), "/home/agentpanel/project").await.unwrap();
        assert!(branches(&repo).await.unwrap().contains(&"main".into()));
        let mut peer = connect(&repo).await.unwrap();
        // Install a forbidden hook only in the disposable guest repository.
        peer.command(&["sh", "-c", "printf '#!/bin/sh\n: > /home/agentpanel/unexpected-hook\n' > /home/agentpanel/project/.git/hooks/post-checkout; chmod 755 /home/agentpanel/project/.git/hooks/post-checkout"]).await.unwrap();
        drop(peer);
        let list = create(&repo, "new/remote-feature", Some("main")).await.unwrap();
        let path = "/home/agentpanel/project-worktrees/new-remote-feature";
        assert!(list.iter().any(|w| w.path == path && w.branch.as_deref() == Some("new/remote-feature")));
        let mut peer = connect(&repo).await.unwrap();
        peer.command(&["test", "!", "-e", "/home/agentpanel/unexpected-hook"]).await.unwrap();
        drop(peer);
        assert!(create(&repo, "new/remote-feature", None).await.unwrap_err().contains("already exists"));
        assert!(create(&repo, "new-remote-feature", None).await.is_err());
        assert!(create(&repo, "../escape", None).await.is_err());
        assert!(create(&repo, "--force", None).await.is_err());
        assert!(create(&repo, "bad-base", Some("--detach")).await.is_err());
        let mut peer = connect(&repo).await.unwrap();
        peer.command(&["mkdir", "/home/agentpanel/project-worktrees/existing"]).await.unwrap();
        drop(peer);
        assert!(create(&repo, "existing", None).await.is_err());
        assert!(preflight(&repo, &repo.path).await.unwrap_err().contains("primary"));
        assert!(preflight(&repo, "/home/agentpanel/outside.txt").await.is_err());
        let mut wrong = repo.clone(); wrong.remote.as_mut().unwrap().machine_id = "replacement-core".into();
        assert!(create(&wrong, "wrong-core", None).await.unwrap_err().contains("another machine"));
        let mut peer = connect(&repo).await.unwrap();
        peer.mutate(path, &["checkout", "--detach"]).await.unwrap(); drop(peer);
        assert!(remove(&repo, path).await.unwrap_err().contains("Detached"));
        let mut peer = connect(&repo).await.unwrap();
        peer.mutate(path, &["checkout", "new/remote-feature"]).await.unwrap();
        peer.command(&["mv", path, &format!("{path}.missing")]).await.unwrap(); drop(peer);
        assert!(remove(&repo, path).await.unwrap_err().contains("missing"));
        let mut peer = connect(&repo).await.unwrap();
        peer.command(&["mv", &format!("{path}.missing"), path]).await.unwrap(); drop(peer);
        for script in [
            "printf change >> tracked.txt",
            "printf staged >> tracked.txt; git -c core.fsmonitor=false add tracked.txt",
            "printf untracked > loose.txt",
            "printf ignored > local.tmp; printf local.tmp > .git/info/exclude",
        ] {
            let mut peer = connect(&repo).await.unwrap();
            // Worktree .git is a file: use shared exclude via Git's path query.
            let script = script.replace(".git/info/exclude", "$(git rev-parse --git-path info/exclude)");
            peer.command(&["sh", "-c", &format!("cd '{path}'; {script}")]).await.unwrap();
            drop(peer);
            assert!(preflight(&repo, path).await.unwrap_err().contains("modified, untracked, or ignored"));
            assert!(remove(&repo, path).await.is_err());
            let mut peer = connect(&repo).await.unwrap();
            // Fixture cleanup only. Product removal never resets or cleans.
            peer.command(&["sh", "-c", &format!("cd '{path}'; git -c core.fsmonitor=false reset --hard; rm -f loose.txt local.tmp; : > \"$(git rev-parse --git-path info/exclude)\"")]).await.unwrap();
        }
        let mut peer = connect(&repo).await.unwrap();
        peer.git(&repo.path, &["worktree", "lock", path]).await.unwrap(); drop(peer);
        assert!(remove(&repo, path).await.unwrap_err().contains("Locked"));
        let mut peer = connect(&repo).await.unwrap(); peer.git(&repo.path, &["worktree", "unlock", path]).await.unwrap(); drop(peer);
        let opened = herdr::open(Options { executable: target.endpoint.executable.clone(), session: target.endpoint.session.clone(), key: "e".repeat(32),
            cwd: repo.path.clone(), shell: String::new(), env: Default::default(), binding: None, attach_only: false,
            target: Some(target.clone()), existing_only: false }, 24, 80, |_| true).await.unwrap();
        assert!(preflight(&repo, path).await.unwrap_err().contains("Exit all programs"));
        // Detaching cannot authorize removal, even for a program in another checkout.
        opened.connection.send(Control::Detach).unwrap();
        assert!(remove(&repo, path).await.unwrap_err().contains("Exit all programs"));
        let resumed = herdr::open(Options { executable: target.endpoint.executable.clone(), session: target.endpoint.session.clone(), key: "e".repeat(32),
            cwd: repo.path.clone(), shell: String::new(), env: Default::default(), binding: Some(opened.binding), attach_only: false,
            target: Some(target), existing_only: true }, 24, 80, |_| true).await.unwrap();
        resumed.connection.sender.send(Control::Input("exit\r".into())).await.unwrap();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if preflight(&repo, path).await.is_ok() { break; }
            assert!(tokio::time::Instant::now() < deadline, "program exit must become visible");
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        // Recheck detects writes made after a successful preflight.
        let mut peer = connect(&repo).await.unwrap(); peer.command(&["touch", &format!("{path}/late.txt")]).await.unwrap(); drop(peer);
        assert!(remove(&repo, path).await.is_err());
        let mut peer = connect(&repo).await.unwrap(); peer.command(&["rm", &format!("{path}/late.txt")]).await.unwrap(); drop(peer);
        let list = remove(&repo, path).await.unwrap();
        assert!(!list.iter().any(|w| w.path == path));
        assert!(branches(&repo).await.unwrap().contains(&"new/remote-feature".into()));
        let mut peer = connect(&repo).await.unwrap();
        peer.command(&["test", "!", "-e", path]).await.unwrap();
        peer.command(&["test", "!", "-e", "/home/agentpanel/unexpected-hook"]).await.unwrap();
        peer.command(&["test", "!", "-e", "/home/agentpanel/unexpected-helper"]).await.unwrap();
    }
}
