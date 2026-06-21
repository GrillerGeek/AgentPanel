import { useEffect, useState } from "react";
import { useStore } from "../state/store";

/**
 * The single confirmation dialog, driven by `confirmState` in the store and the
 * promise-based `requestConfirm` action. Renders nothing until a confirm is
 * requested. Offers an optional "don't ask again" that persists per action.
 */
export function ConfirmDialog() {
  const req = useStore((s) => s.confirmState);
  const resolve = useStore((s) => s.resolveConfirm);
  const [dontAsk, setDontAsk] = useState(false);

  // Reset the checkbox whenever a new dialog opens.
  useEffect(() => {
    setDontAsk(false);
  }, [req]);

  if (!req) return null;

  return (
    <div className="palette-backdrop" onClick={() => resolve(false)}>
      <div className="confirm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{req.message}</p>
        {req.detail && <p className="confirm-detail">{req.detail}</p>}
        {req.dontAskKey && (
          <label className="settings-check confirm-dontask">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.currentTarget.checked)}
            />
            <span>Don&apos;t ask again</span>
          </label>
        )}
        <div className="settings-actions">
          <button
            className={req.danger ? "danger-btn" : "add-btn"}
            onClick={() => resolve(true, dontAsk)}
            autoFocus
          >
            {req.confirmLabel ?? "Confirm"}
          </button>
          <button className="icon-btn" onClick={() => resolve(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
