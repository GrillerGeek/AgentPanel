# Auto Update — Design

**Date:** 2026-07-12
**Issue:** [#12](https://github.com/GrillerGeek/AgentPanel/issues/12) — Implement Auto Update
**Status:** Approved

## Problem

Users must manually download new versions. We want the app to detect a new
release, download it in the background, and prompt the user to restart into the
updated version.

## Decision summary

- **Mechanism:** Tauri v2 updater plugin, reading a signed `latest.json` from
  **GitHub Releases**. `tauri-action` (already in `release.yml`) auto-generates
  and uploads `latest.json` + signed artifacts once a Tauri signing key is
  present.
- **Feed:** `https://github.com/GrillerGeek/AgentPanel/releases/latest/download/latest.json`.
  Releases are published as **drafts**, so `latest.json` only goes live when the
  maintainer publishes the release — updates stay gated behind the manual
  publish step.
- **Platforms:** Windows **and** macOS. Apple signing/notarization is already
  configured in the project's GitHub Actions; this work adds the separate Tauri
  **updater** signing key (minisign) that the updater uses to verify downloads.
- **UX:** on startup (and every 6h, since the app stays open for long parallel
  sessions) silently check + download; when staged, show a slim, non-blocking
  bottom banner: *"AgentPanel vX.Y.Z is ready — Restart now / Later."* Plus a
  manual **Check for updates** button in Settings.

## Components

### 1. Rust plugins & permissions

- `Cargo.toml`: add `tauri-plugin-updater = "2"` and `tauri-plugin-process = "2"`.
- `lib.rs`: register `.plugin(tauri_plugin_updater::Builder::new().build())` and
  `.plugin(tauri_plugin_process::init())` alongside the existing plugins.
- `capabilities/default.json`: add `"updater:default"` and
  `"process:allow-restart"`.

### 2. Configuration (`src-tauri/tauri.conf.json`)

```jsonc
"bundle": { "createUpdaterArtifacts": true, /* …existing… */ },
"plugins": {
  "updater": {
    "pubkey": "<Tauri updater public key>",
    "endpoints": [
      "https://github.com/GrillerGeek/AgentPanel/releases/latest/download/latest.json"
    ]
  }
}
```

### 3. CI (`.github/workflows/release.yml`)

- Add two env vars to the existing `tauri-action` step (beside the `APPLE_*`
  block): `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  (from GitHub Actions secrets). With the key present, `tauri-action` signs the
  artifacts and generates + uploads `latest.json`. No other CI change; the
  existing `verify-version` job keeps all manifests in lockstep with the tag, so
  the updater's version comparison stays trustworthy.

### 4. One-time maintainer prerequisite (not code)

1. `npm run tauri signer generate -- -w ~/.tauri/agentpanel.key`.
2. Add secrets `TAURI_SIGNING_PRIVATE_KEY` (private key contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the GitHub repo.
3. Provide the **public** key for `tauri.conf.json` `pubkey`.

The private key never enters the repo — only CI secrets. Rotating it (if leaked)
means shipping a build with a new pubkey.

### 5. Frontend updater module (`src/lib/updater.ts`)

The only place that imports `@tauri-apps/plugin-updater` / `-process`.

- `runUpdateCheck(opts?: { manual?: boolean }): Promise<void>`
  - Sets `updateStatus` to `checking`; calls `check()`.
  - If an update is available: `downloadAndInstall()` (silent), then set
    `updateStatus = "ready"` and `updateVersion = <version>`.
  - If none: `manual` → info toast "You're on the latest version (vX.Y.Z)";
    auto → silent, back to `idle`.
  - On any thrown error (incl. "not a bundled app" in dev): `manual` → error
    toast `Couldn't check for updates — <reason>`; auto → console log only,
    `updateStatus = "idle"`. Never throws to the caller.
- `restartToUpdate(): Promise<void>` — `relaunch()` from `@tauri-apps/plugin-process`.

### 6. Store slice (`src/state/store.ts`)

```ts
updateStatus: "idle" | "checking" | "downloading" | "ready" | "error";
updateVersion: string | null;
setUpdate: (status: AppState["updateStatus"], version?: string | null) => void;
```

`setUpdate` is the single mutation the three triggers (startup, interval, manual)
funnel through.

### 7. UpdateBanner (`src/components/UpdateBanner.tsx`)

- Slim fixed bar at the bottom of the window, rendered only when
  `updateStatus === "ready"`.
- Content: `AgentPanel v<updateVersion> is ready.` + `Restart now` + `Later`.
- `Restart now` → `restartToUpdate()`. `Later` → local dismiss for this run (the
  update stays staged; the banner reappears on the next launch/interval check).
- Not a modal `ConfirmDialog` (non-blocking) and not an auto-dismissing `Toast`
  (must persist).

### 8. App wiring (`src/App.tsx`)

- One `useEffect`: call `runUpdateCheck()` ~5s after mount, then on a 6h
  `setInterval`; clear on unmount. Mirrors the existing status/PR poller effects.
- Render `<UpdateBanner />` (alongside `<Toasts />` / `<ConfirmDialog />`).

### 9. Settings "Check for updates" (`src/components/SettingsModal.tsx`)

- A row showing the current version (via `getVersion()` from
  `@tauri-apps/api/app`) and a **Check for updates** button →
  `runUpdateCheck({ manual: true })`.

## Error handling

- **Dev / non-bundled:** `runUpdateCheck` no-ops silently — no update errors
  during `npm run tauri dev` or in a plain browser.
- **Network / feed unreachable:** auto silent (log); manual error toast.
- **Signature/verification failure:** plugin rejects; nothing installs; treated
  as error. The minisign check is the security boundary.
- **Download/install failure:** `updateStatus = "error"`; no banner; old version
  keeps running; manual path toasts.
- **"Later":** update already staged; takes effect on the next relaunch.

## Testing

- **Unit (vitest, `@tauri-apps/plugin-updater` mocked):** `runUpdateCheck`
  transitions `updateStatus` for available / none / error; manual "up to date"
  toasts; auto stays silent on error.
- **Component (`UpdateBanner.test.tsx`):** renders only when `ready`, shows the
  version, buttons call `restartToUpdate` / dismiss.
- **Store slice:** `setUpdate` transitions.
- **Manual release-time verification (documented, not automatable):** publish a
  test release; install an older build; launch → confirm silent download →
  banner appears → Restart → confirm the new version runs. `check()`, download,
  install, and `relaunch()` cannot run in dev/unit/browser, so true end-to-end
  is verified at release time.

## Out of scope

- Apple Developer signing/notarization setup (already configured in CI).
- In-app release-notes display / changelog viewer (the banner shows version
  only; `update.body` is available for a later enhancement).
- Delta/differential updates, staged rollouts, or update channels
  (stable/beta).
- Mandatory/forced updates or blocking the app until updated.
- A download-progress bar (download is silent/background; banner appears only
  when ready).
