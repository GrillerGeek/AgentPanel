import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, selectActiveWorktreeId, worktreeLabels } from "../state/store";
import { fuzzyScore } from "../lib/fuzzy";
import { SCHEMES } from "../themes/schemes";

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const repositories = useStore((s) => s.repositories);
  const worktrees = useStore((s) => s.worktrees);
  const terminals = useStore((s) => s.terminals);
  const activeTabId = useStore((s) => s.activeTabId);
  const activeWorktreeId = useStore(selectActiveWorktreeId);
  const agentCommands = useStore((s) => s.settings.agentCommands);
  const addRepository = useStore((s) => s.addRepository);
  const openWorktreeTerminal = useStore((s) => s.openWorktreeTerminal);
  const duplicateActiveTerminal = useStore((s) => s.duplicateActiveTerminal);
  const splitActiveTab = useStore((s) => s.splitActiveTab);
  const runAgentInActive = useStore((s) => s.runAgentInActive);
  const setActiveWorktree = useStore((s) => s.setActiveWorktree);
  const closeWorktreeTerminals = useStore((s) => s.closeWorktreeTerminals);
  const updateSettings = useStore((s) => s.updateSettings);
  const closeTab = useStore((s) => s.closeTab);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: "add-repo", title: "Add repository…", run: addRepository },
      { id: "settings", title: "Open settings…", run: onOpenSettings },
    ];
    if (activeTabId) {
      cmds.push({ id: "new-term", title: "New terminal (current worktree)", run: duplicateActiveTerminal });
      cmds.push({ id: "split", title: "Split: second terminal beside this one", run: splitActiveTab });
      for (const cmd of agentCommands) {
        cmds.push({ id: `agent:${cmd}`, title: `Run ▶ ${cmd} in a new terminal`, run: () => runAgentInActive(cmd) });
      }
      cmds.push({ id: "close-term", title: "Close active terminal", run: () => closeTab(activeTabId) });
      if (activeWorktreeId) {
        cmds.push({
          id: "close-session",
          title: "Close current session (all its terminals)",
          run: () => void closeWorktreeTerminals(activeWorktreeId),
        });
      }
    }
    // Jump to an active session (worktree with terminals).
    const labels = worktreeLabels(repositories, worktrees);
    for (const wtId of [...new Set(terminals.map((t) => t.worktreeId))]) {
      const l = labels[wtId];
      cmds.push({
        id: `session:${wtId}`,
        title: `Go to ${l?.branch ?? "session"}`,
        subtitle: l?.repo ? `session · ${l.repo}` : "session",
        run: () => setActiveWorktree(wtId),
      });
    }
    // Switch theme.
    for (const sc of SCHEMES) {
      cmds.push({ id: `theme:${sc.slug}`, title: `Theme: ${sc.name}`, subtitle: sc.variant, run: () => updateSettings({ theme: sc.slug }) });
    }
    // Open any worktree (creates/focuses a terminal).
    for (const repo of repositories) {
      for (const wt of worktrees[repo.id] ?? []) {
        cmds.push({ id: `wt:${wt.id}`, title: `Open ${wt.name}`, subtitle: repo.name, run: () => openWorktreeTerminal(wt) });
      }
    }
    return cmds;
  }, [
    repositories,
    worktrees,
    terminals,
    activeTabId,
    activeWorktreeId,
    agentCommands,
    addRepository,
    onOpenSettings,
    duplicateActiveTerminal,
    splitActiveTab,
    runAgentInActive,
    setActiveWorktree,
    closeWorktreeTerminals,
    updateSettings,
    closeTab,
    openWorktreeTerminal,
  ]);

  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, `${c.title} ${c.subtitle ?? ""}`) }))
      .filter((x): x is { c: Command; score: number } => x.score !== null);
    if (query) scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.c);
  }, [commands, query]);

  // Reset selection when the result set changes.
  useEffect(() => setSelected(0), [query]);

  // Keep the selected row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const runSelected = () => {
    const cmd = filtered[selected];
    if (cmd) void cmd.run();
    onClose();
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Jump to a worktree or run a command…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runSelected();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">No matches</div>}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              data-idx={i}
              className={`palette-item ${i === selected ? "active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={runSelected}
            >
              <span className="palette-title">{cmd.title}</span>
              {cmd.subtitle && <span className="palette-subtitle">{cmd.subtitle}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
