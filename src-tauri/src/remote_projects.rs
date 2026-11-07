//! Read-only remote Git queries. Paths stay opaque on the client; every query
//! pins the destination and verifies worktree membership there. No local Git,
//! shell interpolation, remote checkout mutation, or fallback execution.
use crate::{herdr::{RemoteGit, RemoteTarget}, model::{Repository, Worktree, WorktreeStatus, DiffFile}, store::{self, AppStore}};
use tauri::{AppHandle, State};

pub fn repository(store: &AppStore, id: &str) -> Result<Repository, String> {
    store.repos.lock().map_err(|e| e.to_string())?.iter().find(|r| r.id == id).cloned().ok_or("Repository not found".into())
}

fn target(repo: &Repository) -> Result<&RemoteTarget, String> {
    repo.remote.as_ref().ok_or("Select a remote repository".into())
}

fn identity(target: &RemoteTarget, path: &str) -> String {
    format!("remote:{}", serde_json::to_string(&(target, path)).unwrap())
}

fn parse_worktrees(out: &str, repo: &Repository) -> Result<Vec<Worktree>, String> {
    let mut result = Vec::new();
    for record in out.split("\0\0").filter(|s| !s.is_empty()) {
        let mut path = None;
        let mut branch = None;
        for field in record.split('\0') {
            if let Some(value) = field.strip_prefix("worktree ") { path = Some(value.to_string()); }
            if let Some(value) = field.strip_prefix("branch refs/heads/") { branch = Some(value.to_string()); }
        }
        if let Some(path) = path {
            result.push(Worktree { id: identity(target(repo)?, &path), repo_id: repo.id.clone(),
                name: branch.clone().unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or(&path).into()),
                branch, is_primary: result.is_empty(), path, remote: repo.remote.clone() });
        }
        if result.len() > 256 { return Err("Remote repository exceeds the 256-worktree limit".into()); }
    }
    if result.is_empty() { return Err("Remote Git returned no worktrees".into()); }
    Ok(result)
}

async fn list(peer: &mut RemoteGit, repo: &Repository) -> Result<Vec<Worktree>, String> {
    parse_worktrees(&peer.git(&repo.path, &["worktree", "list", "--porcelain", "-z"]).await?, repo)
}

pub async fn worktrees(repo: &Repository) -> Result<Vec<Worktree>, String> {
    let mut peer = RemoteGit::connect(target(repo)?).await?;
    list(&mut peer, repo).await
}

async fn checked(store: &AppStore, repo_id: &str, path: &str) -> Result<RemoteGit, String> {
    let repo = repository(store, repo_id)?;
    let mut peer = RemoteGit::connect(target(&repo)?).await?;
    if !list(&mut peer, &repo).await?.iter().any(|wt| wt.path == path) {
        return Err("Directory is not a registered worktree of this remote repository".into());
    }
    Ok(peer)
}

#[tauri::command]
pub async fn add_remote_repository(app: AppHandle, store: State<'_, AppStore>, remote: RemoteTarget, path: String) -> Result<Repository, String> {
    let repo = inspect(remote, &path).await?;
    let mut repos = store.repos.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = repos.iter().find(|r| r.id == repo.id) { return Ok(existing.clone()); }
    let mut next = repos.clone(); next.push(repo.clone());
    store::save(&app, &next)?; *repos = next;
    Ok(repo)
}

pub(crate) async fn inspect(remote: RemoteTarget, path: &str) -> Result<Repository, String> {
    if !path.starts_with('/') || path.contains('\0') { return Err("Remote projects currently require an absolute Unix path; Windows project support is not enabled".into()); }
    let mut peer = RemoteGit::connect(&remote).await?;
    if peer.git(&path, &["rev-parse", "--is-inside-work-tree"]).await?.trim() != "true" {
        return Err("Select a Git working tree, not a bare repository".into());
    }
    let root = peer.git(&path, &["rev-parse", "--show-toplevel"]).await?;
    let path = root.strip_suffix('\n').unwrap_or(&root).to_string();
    let repo = Repository { id: identity(&remote, &path), name: path.rsplit(['/', '\\']).next().unwrap_or(&path).into(),
        path, is_git: true, default_branch: None, remote: Some(remote) };
    list(&mut peer, &repo).await?;
    Ok(repo)
}

fn parse_status(out: &str) -> (WorktreeStatus, bool) {
    let mut status = WorktreeStatus { branch: None, dirty: 0, ahead: 0, behind: 0, last_commit: None };
    let mut initial = false;
    let mut fields = out.split('\0');
    while let Some(field) = fields.next() {
        if let Some(value) = field.strip_prefix("# branch.head ") {
            if value != "(detached)" { status.branch = Some(value.into()); }
        } else if field == "# branch.oid (initial)" { initial = true; }
        else if let Some(value) = field.strip_prefix("# branch.ab +") {
            if let Some((a, b)) = value.split_once(" -") {
                status.ahead = a.parse().unwrap_or(0); status.behind = b.parse().unwrap_or(0);
            }
        } else if ["1 ", "2 ", "u ", "? "].iter().any(|prefix| field.starts_with(prefix)) {
            status.dirty += 1;
            if field.starts_with("2 ") { fields.next(); } // Original rename path is a separate NUL field.
        }
    }
    (status, initial)
}

#[tauri::command]
pub async fn remote_worktree_status(store: State<'_, AppStore>, repo_id: String, path: String) -> Result<WorktreeStatus, String> {
    status(&store, &repo_id, &path).await
}

pub(crate) async fn status(store: &AppStore, repo_id: &str, path: &str) -> Result<WorktreeStatus, String> {
    let mut peer = checked(store, repo_id, path).await?;
    let (mut status, initial) = parse_status(&peer.git(path, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]).await?);
    if !initial { status.last_commit = Some(peer.git(path, &["log", "-1", "--no-show-signature", "--format=%h %s"]).await?.trim_end().into()); }
    Ok(status)
}

async fn base(peer: &mut RemoteGit, path: &str) -> Result<Option<String>, String> {
    let status = peer.git(path, &["status", "--porcelain=v2", "--branch", "-z"]).await?;
    if parse_status(&status).1 { return Err("Remote review diff requires an initial commit; Git status is still available".into()); }
    let refs = peer.git(path, &["for-each-ref", "--format=%(refname)", "refs/remotes/origin", "refs/heads"]).await?;
    let symbolic = peer.output(path, &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).await?;
    let selected = if symbolic.0 == 0 { Some(symbolic.1.trim().to_string()) } else {
        ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"].iter()
            .find(|candidate| refs.lines().any(|r| r == **candidate)).map(|s| s.to_string())
    };
    if let Some(selected) = selected {
        let result = peer.output(path, &["merge-base", "HEAD", &selected]).await?;
        if result.0 == 0 { return Ok(Some(result.1.trim().into())); }
        if result.0 != 1 { return Err(format!("Remote merge-base failed: {}", result.2.trim())); }
    }
    Ok(Some("HEAD".into()))
}

fn parse_numstat(out: &str) -> Result<Vec<DiffFile>, String> {
    out.split('\0').filter(|s| !s.is_empty()).map(|entry| {
        let mut parts = entry.splitn(3, '\t');
        let a = parts.next().ok_or("Invalid remote diff")?;
        let b = parts.next().ok_or("Invalid remote diff")?;
        let path = parts.next().ok_or("Invalid remote diff")?;
        Ok(DiffFile { path: path.into(), status: "modified".into(), added: a.parse().unwrap_or(0),
            removed: b.parse().unwrap_or(0), binary: a == "-" || b == "-" })
    }).collect()
}

async fn changed(peer: &mut RemoteGit, path: &str, base: Option<&str>) -> Result<Vec<DiffFile>, String> {
    let mut files = if let Some(base) = base {
        let mut files = parse_numstat(&peer.git(path, &["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z", base, "--"]).await?)?;
        let names = peer.git(path, &["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-status", "-z", base, "--"]).await?;
        let fields: Vec<_> = names.split('\0').collect();
        for pair in fields.chunks_exact(2) {
            if let Some(file) = files.iter_mut().find(|f| f.path == pair[1]) {
                file.status = match pair[0] { "A" => "added", "D" => "deleted", _ => "modified" }.into();
            }
        }
        files
    } else { Vec::new() };
    for file in peer.git(path, &["ls-files", "-z", "--others", "--exclude-standard"]).await?.split('\0').filter(|s| !s.is_empty()) {
        if !files.iter().any(|f| f.path == file) {
            files.push(DiffFile { path: file.into(), status: "untracked".into(), added: 0, removed: 0, binary: false });
        }
    }
    if files.len() > 2000 { return Err("Remote diff exceeds the 2,000-file limit".into()); }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[tauri::command]
pub async fn remote_worktree_diff(store: State<'_, AppStore>, repo_id: String, path: String) -> Result<Vec<DiffFile>, String> {
    diff(&store, &repo_id, &path).await
}

pub(crate) async fn diff(store: &AppStore, repo_id: &str, path: &str) -> Result<Vec<DiffFile>, String> {
    let mut peer = checked(store, repo_id, path).await?;
    let base = base(&mut peer, path).await?;
    changed(&mut peer, path, base.as_deref()).await
}

#[tauri::command]
pub async fn remote_worktree_file_patch(store: State<'_, AppStore>, repo_id: String, path: String, file: String) -> Result<String, String> {
    patch(&store, &repo_id, &path, &file).await
}

pub(crate) async fn patch(store: &AppStore, repo_id: &str, path: &str, file: &str) -> Result<String, String> {
    if file.is_empty() || file.starts_with('/') || file.contains('\0') || file.split('/').any(|s| s == "..") {
        return Err("Select a worktree-relative file from the remote diff".into());
    }
    let mut peer = checked(store, repo_id, path).await?;
    let base = base(&mut peer, path).await?;
    let files = changed(&mut peer, path, base.as_deref()).await?;
    let selected = files.iter().find(|f| f.path == file).ok_or("File is not present in the current remote diff")?;
    let patch = if selected.status == "untracked" {
        let (code, out, error) = peer.output(path, &["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", file]).await?;
        if code > 1 { return Err(format!("Remote file diff failed: {}", error.trim())); }
        out
    } else { peer.git(path, &["diff", "--no-ext-diff", "--no-textconv", "--no-renames", base.as_deref().unwrap_or("HEAD"), "--", file]).await? };
    if patch.len() > 512 * 1024 { return Err("Remote patch exceeds the 512 KiB display limit".into()); }
    Ok(patch)
}

#[cfg(test)]
#[path = "remote_projects_tests.rs"]
mod tests;
