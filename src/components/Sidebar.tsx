import { useState } from "react";
import { useStore } from "../state/store";
import { sortWorktrees } from "../state/activity";
import type { Repository } from "../types";

function NewWorktreeForm({ repoId }: { repoId: string }) {
  const createWorktree = useStore((s) => s.createWorktree);
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="new-worktree-toggle" onClick={() => setOpen(true)}>
        ＋ new worktree
      </button>
    );
  }

  const submit = async () => {
    const name = branch.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await createWorktree(repoId, name);
      setBranch("");
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="new-worktree">
      <input
        autoFocus
        className="wt-input"
        placeholder="new branch name"
        value={branch}
        disabled={busy}
        onChange={(e) => setBranch(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="new-worktree-actions">
        <button className="add-btn" disabled={busy} onClick={() => void submit()}>
          {busy ? "…" : "Create"}
        </button>
        <button className="icon-btn" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <div className="wt-error">{error}</div>}
    </div>
  );
}

function RepoRow({ repo }: { repo: Repository }) {
  const expanded = useStore((s) => s.expanded[repo.id] ?? false);
  const worktrees = useStore((s) => s.worktrees[repo.id]);
  const statuses = useStore((s) => s.statuses);
  const terminals = useStore((s) => s.terminals);
  const activeWorktreeId = useStore((s) => {
    const active = s.terminals.find((t) => t.id === s.activeTabId);
    return active?.worktreeId ?? null;
  });
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openWorktreeTerminal = useStore((s) => s.openWorktreeTerminal);
  const removeRepository = useStore((s) => s.removeRepository);
  const deleteWorktree = useStore((s) => s.deleteWorktree);

  const openWorktreeIds = new Set(terminals.map((t) => t.worktreeId));
  const sorted = worktrees ? sortWorktrees(worktrees, openWorktreeIds, statuses) : worktrees;

  return (
    <div className="repo">
      <div className="repo-header">
        <button className="disclosure" onClick={() => toggleExpand(repo.id)} title={repo.path}>
          <span className={`chevron ${expanded ? "open" : ""}`}>▶</span>
          <span className="repo-name">{repo.name}</span>
          {!repo.isGit && <span className="badge">folder</span>}
        </button>
        <button className="icon-btn" title="Remove repository" onClick={() => removeRepository(repo.id)}>
          ✕
        </button>
      </div>

      {expanded && (
        <div className="worktrees">
          {sorted === undefined && <div className="muted">loading…</div>}
          {sorted?.length === 0 && <div className="muted">no worktrees</div>}
          {sorted?.map((wt) => (
            <div key={wt.id} className={`worktree-row ${activeWorktreeId === wt.id ? "selected" : ""}`}>
              <button
                className="worktree"
                onClick={() => openWorktreeTerminal(wt)}
                title={[wt.path, statuses[wt.id]?.lastCommit].filter(Boolean).join("\n")}
              >
                <span className="wt-name">{wt.name}</span>
                {wt.isPrimary && <span className="badge subtle">main</span>}
                <span className="wt-status">
                  {(statuses[wt.id]?.ahead ?? 0) > 0 && (
                    <span className="ahead" title={`${statuses[wt.id].ahead} ahead of upstream`}>
                      ↑{statuses[wt.id].ahead}
                    </span>
                  )}
                  {(statuses[wt.id]?.behind ?? 0) > 0 && (
                    <span className="behind" title={`${statuses[wt.id].behind} behind upstream`}>
                      ↓{statuses[wt.id].behind}
                    </span>
                  )}
                  {(statuses[wt.id]?.dirty ?? 0) > 0 && (
                    <span className="dirty" title={`${statuses[wt.id].dirty} changed file(s)`}>
                      ●{statuses[wt.id].dirty}
                    </span>
                  )}
                </span>
              </button>
              {!wt.isPrimary && (
                <button
                  className="icon-btn"
                  title="Remove worktree"
                  onClick={() => deleteWorktree(repo.id, wt.path)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {repo.isGit && <NewWorktreeForm repoId={repo.id} />}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const repositories = useStore((s) => s.repositories);
  const addRepository = useStore((s) => s.addRepository);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Repositories</span>
        <button className="add-btn" onClick={() => addRepository()}>
          + Add
        </button>
      </div>
      <div className="repo-list">
        {repositories.length === 0 && (
          <div className="empty">No repositories yet. Click <strong>+ Add</strong> to pick a folder.</div>
        )}
        {repositories.map((repo) => (
          <RepoRow key={repo.id} repo={repo} />
        ))}
      </div>
    </aside>
  );
}
