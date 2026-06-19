import { useStore } from "../state/store";
import type { Repository } from "../types";

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
            <button
              key={wt.id}
              className={`worktree ${activeWorktreeId === wt.id ? "selected" : ""}`}
              onClick={() => openWorktreeTerminal(wt)}
              title={wt.path}
            >
              <span className="wt-name">{wt.name}</span>
              {wt.isPrimary && <span className="badge subtle">main</span>}
            </button>
          ))}
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
