import { useEffect, useState } from "react";
import { getTelemetryConsent, setTelemetryConsent, type ConsentValue } from "../lib/telemetry";
import { useStore } from "../state/store";

/**
 * First-run crash-reporting prompt (docs/superpowers/specs/2026-07-23-crash-reporting-design.md).
 * Shown only while consent is `unset`; either choice calls `set_telemetry_consent`
 * and the banner never reappears (backed by the Rust-owned consent file, not
 * localStorage -- so a corrupt/unreadable file also reads as `unset` and this
 * banner reappears, per the design doc's error-handling section).
 *
 * Same non-blocking bar pattern/placement as `UpdateBanner.tsx`.
 */
export function TelemetryBanner() {
  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const pushToast = useStore((s) => s.pushToast);

  useEffect(() => {
    let alive = true;
    void getTelemetryConsent()
      .then((info) => {
        if (alive) setConsent(info.consent);
      })
      .catch(() => {
        if (alive) setConsent("unset");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (consent !== "unset") return null;

  const choose = (value: "granted" | "denied") => {
    setConsent(value);
    setTelemetryConsent(value).catch((err) => {
      // Write failed: revert so the banner stays up rather than silently
      // claiming a choice was recorded when it wasn't (same pattern as
      // SettingsModal.tsx's onCrashReportsChange).
      setConsent("unset");
      pushToast(`Couldn't save crash-report preference: ${err}`, "error");
    });
  };

  return (
    <div className="telemetry-banner">
      <span className="telemetry-banner-text">
        Help improve AgentPanel — send anonymous crash reports?{" "}
        <a
          href="https://github.com/GrillerGeek/AgentPanel#telemetry"
          target="_blank"
          rel="noreferrer"
        >
          Learn what's collected.
        </a>
      </span>
      <button className="telemetry-banner-yes" onClick={() => choose("granted")}>
        Yes
      </button>
      <button className="telemetry-banner-no" onClick={() => choose("denied")}>
        No
      </button>
    </div>
  );
}
