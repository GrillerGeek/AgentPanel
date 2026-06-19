import { useState } from "react";
import { useStore } from "../state/store";
import { SCHEMES } from "../themes/schemes";

const SHELL_PRESETS = ["pwsh.exe", "powershell.exe", "cmd.exe"];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [shell, setShell] = useState(settings.shell);
  const [agents, setAgents] = useState(settings.agentCommands.join(", "));

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
          <input
            className="settings-input"
            value={shell}
            onChange={(e) => setShell(e.currentTarget.value)}
            list="shell-presets"
            placeholder="powershell.exe"
          />
          <datalist id="shell-presets">
            {SHELL_PRESETS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <small>New terminals use this shell. Existing terminals keep theirs.</small>
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
