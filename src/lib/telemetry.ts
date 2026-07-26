import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import type * as Sentry from "@sentry/browser";

/**
 * Opt-in crash reporting (docs/superpowers/specs/2026-07-23-crash-reporting-design.md).
 * Consent is Rust-owned (see src-tauri/src/telemetry.rs) -- the frontend never
 * touches the consent file directly and does not mirror it into localStorage.
 */

export type ConsentValue = "unset" | "granted" | "denied";

export interface TelemetryConsentInfo {
  consent: ConsentValue;
  /** Captured at Rust startup: whether the Rust SDK actually initialized this
   *  session. Gates the JS SDK too, so a mid-session grant can't start
   *  reporting while the Rust SDK stays inactive (design doc, "Frontend side"). */
  active_this_session: boolean;
}

export async function getTelemetryConsent(): Promise<TelemetryConsentInfo> {
  return invoke<TelemetryConsentInfo>("get_telemetry_consent");
}

export async function setTelemetryConsent(consent: ConsentValue): Promise<void> {
  await invoke("set_telemetry_consent", { consent });
}

// --- path scrubbing -----------------------------------------------------
//
// Mirrors src-tauri/src/telemetry.rs::scrub_paths -- keep both in sync. The
// spec does not pin down the exact replacement token (here "~"), only that
// the username/home directory must not survive and that messages are "kept
// but path-scrubbed" (not dropped).

const HOME_PATH_RE =
  /(?:\/Users\/|\/home\/|\/Volumes\/|\/root\b|[A-Za-z]:[\\/]Users[\\/]|\\\\[^\\/\s]+\\[^\\/\s]+)[^\s]*/g;
const UNSCRUBBED_MARKER_RE =
  /(?:\/Users\/|\/home\/|\/Volumes\/|\/root\b|[A-Za-z]:[\\/]Users[\\/]|\\\\[^\\/\s]+\\[^\\/\s]+)/;
const PROJECT_MARKERS = new Set(["agentpanel", "AgentPanel", "src-tauri", "src"]);

/** How many leading segments (already split on the token's separator) make up
 *  the home/mount prefix to fold into "~". Mirrors telemetry.rs's
 *  `home_prefix_fold_len`. */
function homePrefixFoldLen(segments: string[]): number | null {
  const idx = segments.findIndex((s) => s === "Users" || s === "home" || s === "Volumes");
  if (idx !== -1) return Math.min(idx + 2, segments.length);

  const rootIdx = segments.indexOf("root");
  if (rootIdx !== -1) return rootIdx + 1;

  if (segments.length >= 4 && segments[0] === "" && segments[1] === "") {
    // Leading "\\server\share" splits (on "\\") into ["", "", server, share, ...].
    return 4;
  }
  return null;
}

function redactPathToken(token: string): string {
  const sep = token.includes("\\") ? "\\" : "/";
  const segments = token.split(sep);

  const markerIdx = segments.findIndex((s) => PROJECT_MARKERS.has(s));
  if (markerIdx !== -1) {
    return segments.slice(markerIdx).join(sep);
  }

  const foldLen = homePrefixFoldLen(segments);
  if (foldLen !== null) {
    const rest = segments.slice(foldLen);
    return rest.length === 0 ? "~" : `~${sep}${rest.join(sep)}`;
  }

  return token;
}

/**
 * Redact home-directory/mount-point segments from Windows-, macOS- and
 * Linux-style absolute paths appearing anywhere in `input`. Non-path text is
 * left intact. If, after redaction, one of the recognized prefixes still
 * survives (i.e. the text can't be scrubbed with confidence), it is
 * truncated at that point rather than sent with a username/host attached.
 */
export function scrubPaths(input: string): string {
  const out = input.replace(HOME_PATH_RE, redactPathToken);
  const m = out.match(UNSCRUBBED_MARKER_RE);
  return m && m.index !== undefined ? out.slice(0, m.index) : out;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrubPaths(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubPaths(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = scrubPaths(frame.filename);
    }
  }
  // Defense-in-depth: the Breadcrumbs integration is dropped entirely below
  // (no automatic breadcrumb source runs), but scrub any that show up anyway
  // (e.g. a future manually-added breadcrumb) rather than assume none ever will.
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubPaths(crumb.message);
    if (crumb.data) {
      for (const key of Object.keys(crumb.data)) {
        const value = crumb.data[key];
        if (typeof value === "string") crumb.data[key] = scrubPaths(value);
      }
    }
  }
  return event;
}

let sdk: typeof Sentry | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the JS Sentry SDK, gated on the Rust SDK actually having
 * initialized this session (`active_this_session`) -- never on the raw
 * consent file value (see `TelemetryConsentInfo`). Envelopes are handed to
 * the `sentry-tauri` plugin transport, which routes them to the Rust SDK
 * over Tauri IPC; nothing is sent directly from the WebView.
 *
 * `@sentry/browser` and the plugin's JS helpers are loaded via dynamic
 * `import()` only once `active_this_session` is confirmed -- a
 * never-consented user never pays to bundle/parse them.
 *
 * Never throws -- telemetry failing to start must not block the app.
 */
export async function initTelemetry(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let info: TelemetryConsentInfo;
    try {
      info = await getTelemetryConsent();
    } catch {
      return;
    }
    if (!info.active_this_session) return;

    const [SentryModule, pluginApi] = await Promise.all([
      import("@sentry/browser"),
      import("tauri-plugin-sentry-api"),
    ]);
    sdk = SentryModule;

    let release: string | undefined;
    try {
      release = `agentpanel@${await getVersion()}`;
    } catch {
      release = undefined;
    }

    sdk.init({
      ...pluginApi.defaultOptions,
      release,
      // Every automatic breadcrumb source (DOM clicks, console, fetch/xhr,
      // history navigation, Sentry's own internal breadcrumbs) is dropped
      // outright -- the spec allowlist is "exception type/message/stack, app
      // version, OS/arch" only. DOM breadcrumbs in particular serialize
      // element title/aria-label attributes, and this app's TabBar/Sidebar
      // put absolute cwd/repo paths, commit messages and command lines in
      // those attributes.
      integrations: (integrations) =>
        integrations.filter((i) => i.name !== "BrowserSession" && i.name !== "Breadcrumbs"),
      beforeBreadcrumb: undefined,
      beforeSend: scrubEvent,
    });
  })();
  return initPromise;
}

/**
 * Reports an error to Sentry if (and only if) the SDK has been loaded (see
 * `initTelemetry`) -- a silent no-op otherwise, so callers (e.g.
 * `PaneErrorBoundary`) never need to know whether telemetry is active.
 * Deliberately takes no extra context (e.g. a component stack): that's
 * outside the spec allowlist ("exception type/message/stack, version,
 * OS/arch" only), so there's nothing to scrub-or-drop -- it's just never
 * attached.
 */
export function captureError(error: Error): void {
  sdk?.captureException(error);
}
