import { useEffect, useRef } from "react";

/**
 * Close a modal on Escape. Modals have no guaranteed focus target (unlike the
 * command palette, whose autofocused input hears its own keydown), so this
 * listens at the window level for the modal's lifetime. The callback rides in a
 * ref so the listener never re-subscribes when the parent re-renders with a
 * fresh closure.
 */
export function useEscapeToClose(onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
