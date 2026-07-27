# macOS code signing & notarization

The release workflow (`.github/workflows/release.yml`) signs and notarizes
macOS builds automatically via `tauri-action` when the secrets below are
present in the repo. If they're unset, the workflow falls back to the
previous unsigned build — nothing breaks.

## One-time setup (Apple Developer account required)

1. **Create a Developer ID Application certificate**
   - Xcode → Settings → Accounts → your Apple ID → Manage Certificates → `+` → "Developer ID Application"
   - Or via the [Apple Developer portal](https://developer.apple.com/account/resources/certificates/list) → Certificates → `+` → "Developer ID Application"
   - This is the certificate for distributing outside the Mac App Store (what GitHub Releases needs), not the App Store one.

2. **Export the certificate + private key as a `.p12`**
   - Xcode → Settings → Accounts → Manage Certificates → right-click the cert → Export
   - Or: Keychain Access → find the cert (it has a disclosure arrow with the private key nested under it) → select both → right-click → Export 2 items → save as `.p12` → set a password

3. **Base64-encode the `.p12`**
   ```sh
   base64 -i Certificates.p12 | pbcopy
   ```

4. **Generate an app-specific password** for notarization at
   [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
   App-Specific Passwords. Your normal Apple ID password won't work here.

5. **Find your Team ID** at
   [developer.apple.com/account](https://developer.apple.com/account) →
   Membership details.

## Add these as GitHub repo secrets

Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 output from step 3 |
| `APPLE_CERTIFICATE_PASSWORD` | password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Jason Robey (TEAMID)` — find the exact string with `security find-identity -v -p codesigning` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password from step 4 |
| `APPLE_TEAM_ID` | your Team ID from step 5 |

Once all six are set, the next `v*` tag push signs and notarizes the `.app`/`.dmg`
automatically — no workflow changes needed.

## Notes

- `src-tauri/tauri.conf.json` sets `bundle.macOS.hardenedRuntime: true`, required for notarization.
- No entitlements file is configured. AgentPanel isn't sandboxed and spawns
  subprocesses (git, gh, shells, coding agents) via `portable-pty`, which
  doesn't require special hardened-runtime entitlements. Add
  `bundle.macOS.entitlements` only if notarization or runtime testing surfaces
  a specific requirement.
- Windows builds are unaffected — the `APPLE_*` env vars are simply ignored on that leg.

## Expected release artifacts

A `v*` tag push produces a **draft** release containing:

| Platform | Artifact |
| --- | --- |
| Windows | `AgentPanel_<version>_x64-setup.exe` (+ `.sig`) |
| macOS, Apple Silicon | `AgentPanel_<version>_aarch64.dmg`, `AgentPanel_<version>_aarch64.app.tar.gz` (+ `.sig`) |
| macOS, Intel | `AgentPanel_<version>_x64.dmg`, `AgentPanel_<version>_x64.app.tar.gz` (+ `.sig`) |
| all | `latest.json` |

Before publishing the draft, confirm:

1. The `verify-manifest` job is green — it asserts `latest.json` carries
   `darwin-aarch64`, `darwin-x86_64` and `windows-x86_64`. The updater has no
   fallback for a missing key, so a platform absent here silently stops
   receiving updates.
2. **Both** macOS jobs logged a notarization status of `Accepted`.
   `tauri-action` exits green even when signing silently no-ops, so job success
   alone proves nothing — grep the log for the status line.
