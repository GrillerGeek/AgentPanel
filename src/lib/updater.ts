import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../state/store";

/** True only inside a bundled Tauri webview (not dev-server browser / jsdom
 *  without the flag). Keeps the update path a silent no-op during development. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The downloaded-but-not-yet-installed update, held from the check that staged
 * it until the user clicks Restart. It wraps a Rust-side resource handle, so it
 * can't live in the zustand store (which is JSON-serialized to localStorage);
 * the store only carries the status + version the banner renders.
 *
 * Cleared on process exit, not persisted: a relaunch re-checks and re-downloads.
 */
let staged: Update | null = null;

/**
 * Check for an update; if found, download it and mark the store `ready` so the
 * banner can prompt a restart. Never throws, and never installs.
 * - manual (Settings button): toast "up to date" / error.
 * - automatic (startup/interval): silent; errors are logged only.
 *
 * IMPORTANT: this must only ever `download()`, never `install()` or
 * `downloadAndInstall()`. On Windows the install step hands off to the NSIS
 * installer and then terminates this process (`std::process::exit(0)` in
 * tauri-plugin-updater's src/updater.rs). Installing from the silent startup
 * check therefore made the window vanish a few seconds after launch, which is
 * indistinguishable from a crash. macOS swaps the bundle in place and keeps
 * running, which is why this only ever bit Windows users.
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
        await update.download();
      } catch (dlErr) {
        st.setUpdate("error");
        if (manual) st.pushToast(`Update download failed — ${dlErr}`, "error");
        else console.error("update download failed", dlErr);
        return;
      }
      staged = update;
      st.setUpdate("ready", update.version);
    } else {
      staged = null;
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

/**
 * Install the staged update and restart into it. User-initiated only (the
 * banner's "Restart now") — this is the step that closes the app.
 *
 * On Windows `install()` launches the NSIS installer and never returns: the
 * plugin calls `std::process::exit(0)` right after handing off, and the
 * installer's `/R` flag relaunches the new build. So the `relaunch()` below is
 * only reached on macOS, where `install()` swaps the bundle and returns
 * normally. Never throws.
 */
export async function restartToUpdate(): Promise<void> {
  if (staged) {
    try {
      await staged.install();
    } catch (err) {
      const st = useStore.getState();
      st.setUpdate("error");
      st.pushToast(`Update install failed — ${err}`, "error");
      return;
    }
  }
  await relaunch();
}
