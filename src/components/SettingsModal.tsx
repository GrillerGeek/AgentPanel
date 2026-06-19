import { useState } from "react";
import { useStore } from "../state/store";

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

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

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
