# Opt-in Crash Reporting via Sentry — Design

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan

## Goal

Now that AgentPanel has external users, we need to know when the app crashes or errors
in the wild — automatically, without relying on users to file issues. Scope is crash and
error reporting only: no usage analytics, no feature tracking.

## Decisions (agreed in brainstorming)

- **What:** Automatic capture of Rust panics and frontend (WebView) exceptions.
- **Consent:** Strictly opt-in via a first-run prompt. No data leaves the machine until
  the user says yes.
- **Backend:** Hosted Sentry (sentry.io free tier). The DSN is embedded in the source —
  DSNs are write-only public keys, safe in an OSS repo.

## Architecture

### Consent storage (Rust-owned, not localStorage)

Frontend settings currently persist to `localStorage` (`agentpanel.settings` in
`src/state/store.ts`), which Rust cannot read before the WebView exists. Crash reporting
must be decided at process start (the panic hook has to be installed before anything can
panic), so consent lives in a small Rust-owned JSON file in the app config directory
(sibling of the existing `store.rs` data), e.g. `telemetry.json`:

```json
{ "consent": "unset" | "granted" | "denied" }
```

- `main.rs` reads this file **synchronously, before `tauri::Builder` runs**. Missing or
  unparsable file ⇒ `unset` ⇒ no telemetry.
- Sentry initializes **only** when consent is `granted`.
- Two new Tauri commands expose it to the frontend: `get_telemetry_consent()` returns
  both the current file value **and** `active_this_session` (the value captured at
  startup — whether the Rust SDK actually initialized); `set_telemetry_consent(consent)`
  updates the file. The frontend never touches the file directly and does **not** mirror
  consent into `localStorage` — the file is the single source of truth.
- A change of consent takes effect **on next launch**. Granting mid-session does not
  start reporting; revoking mid-session does not stop the already-initialized SDK. The
  UI states this ("takes effect after restart"). This keeps the init path a single
  read-once guard with no runtime toggling.

### Rust side

- `sentry` crate initialized in `main.rs` behind the consent guard. Default panic
  integration captures panics with stack traces.
- `sentry-tauri` plugin registered with the builder so WebView events route through the
  Rust SDK over Tauri IPC. One DSN, one init point, no direct network calls from the
  WebView (CSP unchanged).
- `release` set to the app version (from `tauri.conf.json`, currently `0.4.x`) so events
  map to specific builds.

### Frontend side

- Sentry JS SDK configured to hand envelopes to the `sentry-tauri` plugin transport
  (per that plugin's documented setup) — initialized only when
  `get_telemetry_consent()` reports `active_this_session: true`, never from the current
  file value. This keeps both crash surfaces gated by the same startup snapshot: a
  mid-session grant cannot start the JS SDK while the Rust SDK is inactive.
- Global error/unhandledrejection capture, plus an explicit `captureException` in
  `PaneErrorBoundary.tsx` (`componentDidCatch`), so React crashes that today only render
  the error pane are also reported.

### Privacy scrubbing

AgentPanel sees users' terminals, repos, and environment. Reported events must contain
only: exception type/message/stack, app version, OS + arch. Specifically:

- `send_default_pii` stays off (default); no IP address stored (Sentry project setting).
- `server_name` (hostname) stripped via SDK option.
- Console breadcrumbs disabled on the JS side; no breadcrumbs that could carry terminal
  output or command lines.
- A `before_send` hook (both SDKs) redacts absolute filesystem paths in exception
  values and messages — home directories leak usernames; stack-frame paths are rewritten
  to strip everything before the project/app root. Error **messages** are kept but
  path-scrubbed; if a message cannot be scrubbed confidently it is truncated rather than
  dropped.
- Terminal buffer contents, PTY I/O, env vars, and repo paths are never attached.

### First-run prompt

- When the frontend loads and consent is `unset`, show a non-blocking banner (same
  pattern/placement as `UpdateBanner.tsx`): "Help improve AgentPanel — send anonymous
  crash reports? Learn what's collected. [Yes] [No]".
- Either choice calls `set_telemetry_consent` and the banner never reappears.
- "Learn what's collected" links to the README telemetry section.

### Settings toggle

- New row in `SettingsModal.tsx`: checkbox "Send anonymous crash reports", reflecting
  the file-backed consent, with helper text "Takes effect after restart."

### Release plumbing (CI)

- Extend `.github/workflows/release.yml` with a source-map upload step (Sentry CLI)
  keyed by a `SENTRY_AUTH_TOKEN` repo secret, associating maps with the release version
  so minified JS traces are readable. Build must emit source maps to a non-shipped
  location (maps are uploaded to Sentry, not bundled into the installer).
- Step is conditional on the secret existing, so forks' release builds don't fail.

### Disclosure

- README gains a "Telemetry" section: opt-in only, exactly what is sent (exception +
  version + OS/arch), what is never sent (terminal contents, paths, env), how to
  disable, link to the Sentry project region.

## Error handling

- Consent file unreadable/corrupt ⇒ treated as `unset` (fail closed, no telemetry);
  the first-run banner reappears.
- `set_telemetry_consent` write failure ⇒ surfaced to the frontend as a toast (existing
  `Toasts.tsx`); consent remains unchanged.
- Sentry unreachable ⇒ SDK drops events silently; the app must never block, slow
  startup, or surface errors because telemetry failed.

## Testing

- **Vitest:** banner renders only when consent is `unset`; Yes/No each call
  `set_telemetry_consent` and dismiss permanently; Settings toggle reflects and updates
  consent (Tauri commands mocked, consistent with existing `SettingsModal.*.test.tsx`).
- **Rust:** unit tests for the consent file read/write round-trip and the
  corrupt-file ⇒ `unset` path.
- **Path scrubber:** unit tests (both sides where applicable) proving home-directory
  and username redaction on representative Windows and macOS paths.
- **End-to-end (manual):** a debug-build-only hidden command triggers a test Rust panic
  and a test JS error; verify both appear in Sentry with scrubbed paths and correct
  release tag, and that nothing is sent when consent is `denied`/`unset` (verify via
  Sentry ingest + no outbound requests).

## Out of scope

- Usage analytics of any kind.
- In-app "Report Issue" button / log-file export (possible follow-up).
- Runtime (no-restart) consent toggling.
- Self-hosted backends.
