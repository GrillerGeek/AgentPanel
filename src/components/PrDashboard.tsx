import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore, worktreeLabels } from "../state/store";
import { useEscapeToClose } from "../lib/useEscapeToClose";

// Sort order: failing CI first (that's what needs you), then pending, none, passing.
const CHECK_RANK: Record<string, number> = { failing: 0, pending: 1, none: 2, passing: 3 };

/** A cross-repo roll-up of every open PR + its CI state — one triage list instead
 *  of scanning the sidebar row by row (the OSS-maintainer ask). */
export function PrDashboard({ onClose }: { onClose: () => void }) {
  const prs = useStore((s) => s.prs);
  const repositories = useStore((s) => s.repositories);
  const worktrees = useStore((s) => s.worktrees);
  const labels = useMemo(() => worktreeLabels(repositories, worktrees), [repositories, worktrees]);

  // Escape = close (same as clicking the backdrop).
  useEscapeToClose(onClose);

  const rows = Object.entries(prs)
    .flatMap(([wtId, pr]) => (pr ? [{ wtId, pr, label: labels[wtId] }] : []))
    .sort((a, b) => (CHECK_RANK[a.pr.checks] ?? 9) - (CHECK_RANK[b.pr.checks] ?? 9));

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="pr-dashboard" onClick={(e) => e.stopPropagation()}>
        <h2>Pull requests across all repos</h2>
        {rows.length === 0 && (
          <div className="palette-empty">No open PRs detected (needs the GitHub CLI `gh`).</div>
        )}
        <div className="pr-rows">
          {rows.map(({ wtId, pr, label }) => (
            <div
              key={wtId}
              className="pr-row"
              title={`${pr.title}\nchecks: ${pr.checks}`}
              onClick={() => void openUrl(pr.url).catch(() => {})}
            >
              <span className={`pr-dot pr-${pr.checks}`} aria-label={pr.checks} />
              <span className="pr-num">#{pr.number}</span>
              <span className="pr-branch">{label?.branch ?? wtId}</span>
              <span className="pr-repo">{label?.repo ?? ""}</span>
              <span className="pr-state">{pr.state}</span>
              <span className="pr-title">{pr.title}</span>
            </div>
          ))}
        </div>
        <div className="settings-actions">
          <button className="icon-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
