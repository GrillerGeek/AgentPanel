import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../state/store";
import { SCHEMES } from "../themes/schemes";
import type { ShellInfo } from "../types";

const CUSTOM = "__custom__";

/** A saved shell matches a detected one by full path or by bare exe name (so a
 *  legacy "powershell.exe" still resolves to the detected "Windows PowerShell"). */
function shellMatches(detectedPath: string, saved: string): boolean {
  const norm = (s: string) => s.toLowerCase();
  if (norm(detectedPath) === norm(saved)) return true;
  const base = detectedPath.split(/[\\/]/).pop() ?? detectedPath;
  return norm(base) === norm(saved);
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [shell, setShell] = useState(settings.shell);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [customShell, setCustomShell] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [agents, setAgents] = useState(settings.agentCommands.join(", "));

  // Detect installed shells + fonts once when Settings opens.
  useEffect(() => {
    let alive = true;
    void invoke<ShellInfo[]>("list_shells")
      .then((list) => {
        if (!alive) return;
        setShells(list);
        // If the saved shell isn't one we detected, surface it as a custom entry.
        setCustomShell(!list.some((s) => shellMatches(s.path, settings.shell)));
      })
      .catch(() => {});
    void invoke<string[]>("list_fonts")
      .then((list) => alive && setFonts(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.shell]);

  const onPickShell = (value: string) => {
    if (value === CUSTOM) {
      setCustomShell(true);
    } else {
      setCustomShell(false);
      setShell(value);
    }
  };

  const shellSelectValue = customShell
    ? CUSTOM
    : (shells.find((s) => shellMatches(s.path, shell))?.path ?? CUSTOM);

  const save = () => {
    updateSettings({
      shell: shell.trim() || "powershell.exe",
      agentCommands: agents
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    });
    onClose();
  };

  // Theme applies live on change (so the picker previews instantly).
  const setTheme = (slug: string) => updateSettings({ theme: slug });

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label className="settings-field">
          <span>Theme</span>
          <select
            className="settings-input"
            value={settings.theme}
            onChange={(e) => setTheme(e.currentTarget.value)}
          >
            <optgroup label="Dark">
              {SCHEMES.filter((s) => s.variant === "dark").map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Light">
              {SCHEMES.filter((s) => s.variant === "light").map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          </select>
          <small>Applies instantly to the whole app and all terminals.</small>
        </label>

        <label className="settings-field">
          <span>Shell</span>
          <select
            className="settings-input"
            value={shellSelectValue}
            onChange={(e) => onPickShell(e.currentTarget.value)}
          >
            {shells.map((s) => (
              <option key={s.path} value={s.path}>
                {s.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {customShell && (
            <input
              className="settings-input"
              style={{ marginTop: 6 }}
              value={shell}
              onChange={(e) => setShell(e.currentTarget.value)}
              placeholder="full path to a shell executable"
            />
          )}
          <small>
            Detected shells on this machine. New terminals use this shell; existing terminals keep
            theirs.
          </small>
        </label>

        <label className="settings-field">
          <span>Terminal font</span>
          <input
            className="settings-input"
            value={settings.fontFamily}
            onChange={(e) => updateSettings({ fontFamily: e.currentTarget.value })}
            list="font-list"
            placeholder="Cascadia Code"
          />
          <datalist id="font-list">
            {fonts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <small>
            Pick a Nerd Font (e.g. <code>FiraCode Nerd Font</code>, <code>CaskaydiaCove Nerd Font</code>)
            for powerline / icon glyphs. Applies instantly. Ligatures aren&apos;t supported by the
            terminal engine in a desktop webview.
          </small>
        </label>

        <label className="settings-field">
          <span>Font size</span>
          <input
            className="settings-input"
            type="number"
            min={8}
            max={32}
            value={settings.fontSize}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n) && n >= 8 && n <= 32) updateSettings({ fontSize: n });
            }}
          />
          <small>Terminal text size, 8–32 px. Applies instantly.</small>
        </label>

        <label className="settings-field">
          <span>Agent commands</span>
          <input
            className="settings-input"
            value={agents}
            onChange={(e) => setAgents(e.currentTarget.value)}
            placeholder="claude, codex"
          />
          <small>Comma-separated. Shown as quick-launch buttons on the tab bar.</small>
        </label>

        <div className="settings-field">
          <label className="settings-check">
            <input
              type="checkbox"
              checked={settings.webgl}
              onChange={(e) => updateSettings({ webgl: e.currentTarget.checked })}
            />
            <span>GPU acceleration (WebGL)</span>
          </label>
          <small>On = fastest locally. Turn off for smoother remote desktop (RustDesk / RDP).</small>
        </div>

        <div className="settings-actions">
          <button className="add-btn" onClick={save}>
            Save
          </button>
          <button className="icon-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
