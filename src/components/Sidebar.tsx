import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore, selectActiveWorktreeId } from "../state/store";
import { sortWorktrees } from "../state/activity";
import { ActiveSessions } from "./ActiveSessions";
import type { Repository } from "../types";

function NewWorktreeForm({ repo }: { repo: Repository }) {
  const createWorktree = useStore((s) => s.createWorktree);
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="new-worktree-toggle"
        title="A worktree is a separate working copy of this repo on its own branch, so an agent can work in isolation."
        onClick={() => setOpen(true)}
      >
        ＋ new worktree
      </button>
    );
  }

  const safeBranch = branch.trim().replace(/[/\\:]/g, "-");
  // Mirrors the Rust placement: a sibling "<repo>-worktrees/<branch>" directory.
  const pathPreview = `${repo.name}-worktrees\\${safeBranch || "<branch>"}`;

  const submit = async () => {
    const name = branch.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await createWorktree(repo.id, name);
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
      <p className="wt-explainer">
        A <strong>worktree</strong> is a separate checkout of this repo on a new branch — an agent
        can work here without touching your main checkout. Removing it later deletes only this folder,
        never your branch or commits.
      </p>
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
      <div className="wt-path-preview" title="Where this worktree will be created on disk">
        ↳ {pathPreview}
      </div>
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
  const prs = useStore((s) => s.prs);
  const terminals = useStore((s) => s.terminals);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openWorktreeTerminal = useStore((s) => s.openWorktreeTerminal);
  const removeRepository = useStore((s) => s.removeRepository);
  const deleteWorktree = useStore((s) => s.deleteWorktree);
  const requestConfirm = useStore((s) => s.requestConfirm);

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
        <button
          className="icon-btn"
          title="Remove repository"
          onClick={async () => {
            if (
              await requestConfirm({
                message: `Remove "${repo.name}" from AgentPanel?`,
                detail:
                  "This only removes it from the app's list. Your folder, code, and git history are untouched.",
                confirmLabel: "Remove",
                danger: true,
                dontAskKey: "remove-repo",
              })
            )
              removeRepository(repo.id);
          }}
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="worktrees">
          {sorted === undefined && <div className="muted">loading…</div>}
          {sorted?.length === 0 && <div className="muted">no worktrees</div>}
          {sorted?.map((wt) => (
            <div
              key={wt.id}
              className={`worktree-row ${activeWorktreeId === wt.id ? "selected active-worktree" : ""}`}
            >
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
              {prs[wt.id] && (
                <span
                  className={`pr pr-${prs[wt.id]!.checks}`}
                  title={`PR #${prs[wt.id]!.number} · ${prs[wt.id]!.state} · checks: ${prs[wt.id]!.checks}\n${prs[wt.id]!.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openUrl(prs[wt.id]!.url).catch(() => {});
                  }}
                >
                  #{prs[wt.id]!.number}
                </span>
              )}
              {!wt.isPrimary && (
                <button
                  className="icon-btn"
                  title="Remove worktree"
                  onClick={async () => {
                    if (
                      await requestConfirm({
                        message: `Remove worktree "${wt.name}"?`,
                        detail: `Deletes this worktree's working directory on disk. The branch "${wt.branch ?? wt.name}" itself is kept; your commits are safe.`,
                        confirmLabel: "Remove worktree",
                        danger: true,
                        dontAskKey: "remove-worktree",
                      })
                    )
                      deleteWorktree(repo.id, wt.path);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {repo.isGit && <NewWorktreeForm repo={repo} />}
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
      <ActiveSessions />
      <div className="sidebar-header">
        <span>Repositories</span>
        <span className="header-actions">
          <span
            className="legend-help"
            title={
              "Status legend:\n↑ commits ahead of upstream\n↓ commits behind upstream\n● changed (uncommitted) files\n\nPR badge color:\ngreen = checks passing · red = failing · yellow = pending"
            }
          >
            ?
          </span>
          <button className="add-btn" onClick={() => addRepository()}>
            + Add
          </button>
        </span>
      </div>
      <div className="repo-list">
        {repositories.length === 0 && (
          <div className="first-run">
            <p className="first-run-title">Run AI coding agents in parallel.</p>
            <p className="first-run-sub">
              Each agent gets its own git worktree (an isolated branch + folder) and its own
              terminal. To get started:
            </p>
            <ol className="first-run-steps">
              <li>
                <strong>+ Add</strong> a repository or folder.
              </li>
              <li>
                Create a <strong>worktree</strong> (a new branch to work in) or click it to open a
                terminal.
              </li>
              <li>
                Launch an agent with the <strong>▶ claude</strong> / <strong>▶ codex</strong> buttons.
              </li>
            </ol>
            <button className="add-btn" onClick={() => addRepository()}>
              + Add your first repository
            </button>
          </div>
        )}
        {repositories.map((repo) => (
          <RepoRow key={repo.id} repo={repo} />
        ))}
      </div>
    </aside>
  );
}
