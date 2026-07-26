import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Put the running version in the window title ("AgentPanel v0.5.0") so it is
 * always visible (issue #32). Settings keeps the detailed version row.
 * Never throws — a failed lookup just leaves the static title from
 * tauri.conf.json in place.
 */
export async function applyVersionWindowTitle(): Promise<void> {
  try {
    const version = await getVersion();
    await getCurrentWindow().setTitle(`AgentPanel v${version}`);
  } catch {
    // Title stays "AgentPanel" — not worth surfacing anything to the user.
  }
}
