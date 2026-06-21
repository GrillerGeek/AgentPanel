import { useStore } from "../state/store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const setActiveTab = useStore((s) => s.setActiveTab);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind} ${t.focusTabId ? "toast-action" : ""}`}
          title={t.focusTabId ? "Go to this terminal" : "Dismiss"}
          onClick={() => {
            // A jump-to-session toast (e.g. "agent needs input") activates that
            // tab; otherwise the click just dismisses.
            if (t.focusTabId) setActiveTab(t.focusTabId);
            dismiss(t.id);
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
