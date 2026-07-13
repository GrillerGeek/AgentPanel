import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../state/store";

/** True only inside a bundled Tauri webview (not dev-server browser / jsdom
 *  without the flag). Keeps the update path a silent no-op during development. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Check for an update; if found, download+install it silently and mark the
 * store `ready` so the banner can prompt a restart. Never throws.
 * - manual (Settings button): toast "up to date" / error.
 * - automatic (startup/interval): silent; errors are logged only.
 */
export async function runUpdateCheck(opts: { manual?: boolean } = {}): Promise<void> {
  const { manual = false } = opts;
  if (!inTauri()) return;
  const st = useStore.getState();
  const prevStatus = st.updateStatus;
  const prevVersion = st.updateVersion;
  try {
    st.setUpdate("checking");
    const update = await check();
    if (update?.available) {
      // Already downloaded & staged this exact version — don't re-download.
      if (prevStatus === "ready" && prevVersion === update.version) {
        st.setUpdate("ready", update.version);
        return;
      }
      st.setUpdate("downloading", update.version);
      try {
        await update.downloadAndInstall();
      } catch (dlErr) {
        st.setUpdate("error");
        if (manual) st.pushToast(`Update download failed — ${dlErr}`, "error");
        else console.error("update download failed", dlErr);
        return;
      }
      st.setUpdate("ready", update.version);
    } else {
      st.setUpdate("idle");
      if (manual) {
        let v = "";
        try {
          v = await getVersion();
        } catch {
          /* version is best-effort */
        }
        st.pushToast(
          v ? `You're on the latest version (v${v}).` : "You're on the latest version.",
          "info",
        );
      }
    }
  } catch (err) {
    st.setUpdate("error");
    if (manual) st.pushToast(`Couldn't check for updates — ${err}`, "error");
    else console.error("update check failed", err);
  }
}

/** Relaunch into the staged update. */
export async function restartToUpdate(): Promise<void> {
  await relaunch();
}
