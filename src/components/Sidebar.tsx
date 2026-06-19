import { useState } from "react";
import { useStore } from "../state/store";
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
  const activeWorktreeId = useStore((s) => {
    const active = s.terminals.find((t) => t.id === s.activeTabId);
    return active?.worktreeId ?? null;
  });
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openWorktreeTerminal = useStore((s) => s.openWorktreeTerminal);
  const removeRepository = useStore((s) => s.removeRepository);
  const deleteWorktree = useStore((s) => s.deleteWorktree);

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
          {worktrees === undefined && <div className="muted">loading…</div>}
          {worktrees?.length === 0 && <div className="muted">no worktrees</div>}
          {worktrees?.map((wt) => (
            <div key={wt.id} className={`worktree-row ${activeWorktreeId === wt.id ? "selected" : ""}`}>
              <button className="worktree" onClick={() => openWorktreeTerminal(wt)} title={wt.path}>
                <span className="wt-name">{wt.name}</span>
                {wt.isPrimary && <span className="badge subtle">main</span>}
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
