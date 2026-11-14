import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const isDefaultName = (value: string) => value === "hc" || value === "herdr-core";
export function HerdrExecutableField({ value, onChange, label = "Herdr core executable" }: {
  value: string; onChange(value: string): void; label?: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const mounted = useRef(false); const generation = useRef(0); const edited = useRef(false);
  const current = useRef(value); current.current = value;
  const change = useRef(onChange); change.current = onChange;
  const initial = useRef(value);
  const find = async () => {
    const token = ++generation.current; const requested = current.current;
    setBusy(true); setStatus("Looking for Herdr core…");
    try {
      const found = await invoke<string>("herdr_detect_executable", { executable: isDefaultName(requested) ? requested : "hc" });
      if (!mounted.current || token !== generation.current || current.current !== requested) return;
      current.current = found; change.current(found); setStatus(`Found: ${found}`);
    } catch (error) {
      if (mounted.current && token === generation.current && current.current === requested) setStatus(String(error));
    } finally { if (mounted.current && token === generation.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    // Only a still-untouched initial default may be replaced automatically.
    // No inventory refresh, session connection or process launch participates.
    if (!edited.current && isDefaultName(initial.current)) void find();
    return () => { mounted.current = false; generation.current++; };
  }, []);
  const edit = (next: string) => {
    edited.current = true; generation.current++; current.current = next;
    setBusy(false); setStatus(""); change.current(next);
  };
  const browse = async () => {
    edited.current = true; const token = ++generation.current;
    setBusy(true); setStatus("");
    try {
      const selected = await open({ title: "Choose the Herdr core executable", directory: false, multiple: false });
      if (mounted.current && token === generation.current && typeof selected === "string") {
        current.current = selected; change.current(selected); setStatus(`Selected file: ${selected}`);
      }
    } catch (error) { if (mounted.current && token === generation.current) setStatus(`Could not browse for Herdr core: ${String(error)}`); }
    finally { if (mounted.current && token === generation.current) setBusy(false); }
  };
  return <div className="settings-field herdr-executable-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="settings-input" value={value} onChange={(event) => edit(event.currentTarget.value)} />
    <div className="herdr-executable-actions">
      <button type="button" disabled={busy} onClick={() => { edited.current = true; void find(); }}>Find automatically</button>
      <button type="button" disabled={busy} onClick={() => void browse()}>Browse…</button>
      <button type="button" onClick={() => { void openUrl("https://herdr.dev/core/").catch((error) => {
        if (mounted.current) setStatus(`Could not open installation instructions: ${String(error)}`);
      }); }}>Install Herdr core ↗</button>
    </div>
    <small>Enter an executable name or full path, without arguments. Discovery checks files only; it does not start Herdr or connect to a session.</small>
    <small role="status" aria-live="polite">{status}</small>
  </div>;
}
