import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../state/store";
import { useEscapeToClose } from "../lib/useEscapeToClose";
import type { HerdrEndpoint, HerdrInventory } from "../types";

export function MachineBrowser({ onClose }: { onClose: () => void }) {
  const [endpoint, setEndpoint] = useState<HerdrEndpoint>(() => {
    const s = useStore.getState().settings;
    return s.herdrBrowserEndpoint ?? { executable: s.herdrExecutable, session: s.herdrSession };
  });
  const [snapshot, setSnapshot] = useState<{ endpoint: HerdrEndpoint; inventory: HerdrInventory } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const attach = useStore((s) => s.attachHerdrTerminal);
  useEscapeToClose(onClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { generation.current++; previous?.focus(); };
  }, []);

  const refresh = async () => {
    const current = ++generation.current;
    const requested = { ...endpoint };
    setBusy(true);
    setError("");
    try {
      const inventory = await invoke<HerdrInventory>("herdr_inventory", { endpoint: requested });
      if (current === generation.current) {
        setSnapshot({ endpoint: requested, inventory });
        useStore.getState().updateSettings({ herdrBrowserEndpoint: requested });
      }
    } catch (e) {
      if (current === generation.current) setError(String(e));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const inventory = snapshot?.inventory;
  const stale = !!error || snapshot?.endpoint.executable !== endpoint.executable || snapshot?.endpoint.session !== endpoint.session;
  const groups = inventory ? [
    { name: "This computer", host: inventory.coreName, coreId: inventory.coreId,
      session: snapshot.endpoint.session, state: "connected", why: null, prefix: "" },
    ...inventory.machines.map((m) => ({ ...m, prefix: `${m.name}/` })),
  ] : [];

  return <div className="palette-backdrop" onClick={onClose}>
    <div className="settings machine-browser" role="dialog" aria-modal="true" aria-labelledby="machines-title"
      ref={dialog} tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, [tabindex='0']");
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}>
      <div className="machine-browser-heading"><h2 id="machines-title">Machines &amp; terminals</h2>
        <button onClick={onClose} aria-label="Close machine browser">✕</button></div>
      <p>Attach to a running terminal in a Herdr core session. Closing an attached tab leaves its program running.</p>
      <form onSubmit={(e) => { e.preventDefault(); void refresh(); }} className="machine-endpoint">
        <label>Herdr executable<input className="settings-input" value={endpoint.executable}
          onChange={(e) => setEndpoint({ ...endpoint, executable: e.target.value })} /></label>
        <label>Local core session<input className="settings-input" value={endpoint.session}
          onChange={(e) => setEndpoint({ ...endpoint, session: e.target.value })} /></label>
        <button className="add-btn" type="submit" disabled={busy}>{busy ? "Loading…" : "Refresh terminals"}</button>
      </form>
      <p className="machine-help">Configure machines and sign in through Herdr/OpenSSH, then refresh here. Remote files, worktrees, and editor actions are unavailable for attachments.</p>
      {error && <p role="alert">Could not refresh: {error}. Any inventory below is stale.</p>}
      {!snapshot && !busy && !error && <p>Choose the executable and local session, then refresh to browse its machines.</p>}
      {snapshot && <p className="machine-source">Inventory from {snapshot.endpoint.executable} · {snapshot.endpoint.session}
        {stale ? " · stale — refresh before attaching" : ""}</p>}
      <div aria-busy={busy}>
        {groups.map((machine) => {
          const terminals = inventory!.terminals.filter((t) => machine.prefix
            ? t.address.startsWith(machine.prefix) : !t.address.includes("/"));
          return <section className="machine-group" key={machine.prefix} aria-label={`${machine.name} terminals`}>
            <h3>{machine.name} <span>{machine.state === "needs_login" ? "needs login" : machine.state}</span></h3>
            <p>{machine.host || "Host not reported"} · session {machine.session ?? "default"}</p>
            {machine.why && <p role="status">{machine.why}</p>}
            {terminals.length === 0 && <p>{machine.state === "connected" ? "No running terminals." : "Terminal inventory unavailable while disconnected."}</p>}
            {terminals.map((terminal) => <div className="machine-terminal" key={terminal.address}>
              <div><strong>{terminal.title || terminal.address}</strong> {terminal.title && terminal.title !== terminal.address && <code>{terminal.address}</code>}
                <div className="machine-path">{terminal.cwd || "Path not reported"}</div>
                <small>{terminal.state} · {terminal.status ?? "status not reported"}</small></div>
              <button disabled={busy || stale || machine.state !== "connected" || terminal.state !== "live" || !terminal.cwd || !machine.coreId}
                aria-label={`Attach ${terminal.address}`} onClick={() => {
                  attach(snapshot!.endpoint, inventory!, terminal); onClose();
                }}>Attach</button>
            </div>)}
          </section>;
        })}
      </div>
    </div>
  </div>;
}
