import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Cache the permission decision so we only prompt once.
let decided: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (decided !== null) return decided;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    decided = granted;
    return granted;
  } catch {
    decided = false; // non-Tauri / unsupported environment
    return false;
  }
}

/** Fire an OS notification (best-effort; silently no-ops if unavailable). */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (await ensurePermission()) sendNotification({ title, body });
  } catch {
    /* ignore — the in-app toast still shows */
  }
}
