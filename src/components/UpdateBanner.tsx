import { useState } from "react";
import { useStore } from "../state/store";
import { restartToUpdate } from "../lib/updater";

/**
 * Slim, non-blocking bar shown when an update has been downloaded and staged
 * (`updateStatus === "ready"`). "Later" hides it for this run; it reappears on
 * the next launch/interval check since the update stays staged. Deliberately
 * not a modal and not an auto-dismissing toast.
 */
export function UpdateBanner() {
  const status = useStore((s) => s.updateStatus);
  const version = useStore((s) => s.updateVersion);
  const [dismissed, setDismissed] = useState(false);

  if (status !== "ready" || dismissed) return null;

  return (
    <div className="update-banner">
      <span className="update-banner-text">AgentPanel v{version} is ready.</span>
      <button className="update-banner-restart" onClick={() => void restartToUpdate()}>
        Restart now
      </button>
      <button className="update-banner-later" onClick={() => setDismissed(true)}>
        Later
      </button>
    </div>
  );
}
