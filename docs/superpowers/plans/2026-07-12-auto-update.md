# Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-update AgentPanel (issue #12): detect a new signed release, download it silently, and prompt the user to restart into it.

**Architecture:** Tauri v2 `updater` + `process` plugins read a signed `latest.json` from GitHub Releases. A frontend module (`updater.ts`) funnels three triggers (startup, 6h interval, manual Settings check) through one store state machine (`updateStatus`); a slim bottom `UpdateBanner` shows "Restart now / Later" when an update is staged. The Rust/config/CI plumbing signs artifacts and generates `latest.json` in the existing release workflow.

**Tech Stack:** Tauri v2, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`, `@tauri-apps/api/app`, React, Zustand, Vitest.

## Global Constraints

- **Platforms:** Windows + macOS (Apple notarization already configured in CI; this adds the Tauri minisign updater key).
- **Feed:** exactly `https://github.com/GrillerGeek/AgentPanel/releases/latest/download/latest.json`.
- **Signing key is a maintainer prerequisite** (Task 6 / pause): `pubkey` in `tauri.conf.json` is supplied by the maintainer; the private key + password are GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Never commit the private key.
- **Dev/browser safety:** the update path must be a silent no-op when not running inside a bundled Tauri app (guard on `window.__TAURI_INTERNALS__`).
- **Auto vs manual:** the automatic check is silent on "up to date" and on errors (console log only); the manual Settings check surfaces a toast in both cases.
- **Test command:** `npm test` (= `vitest run`). Component/DOM tests use `// @vitest-environment jsdom`.
- **`updateStatus` enum (exact):** `"idle" | "checking" | "downloading" | "ready" | "error"`.

---

### Task 1: Plugin npm deps + store update slice

**Files:**
- Modify: `package.json` (add two deps via npm)
- Modify: `src/state/store.ts` (add update state + action)
- Test: `src/state/store.update.test.ts` (create)

**Interfaces:**
- Produces:
  - State `updateStatus: "idle" | "checking" | "downloading" | "ready" | "error"`, `updateVersion: string | null`.
  - Action `setUpdate(status: AppState["updateStatus"], version?: string | null): void` — sets status; sets version only when the `version` arg is provided (keeps the existing version when omitted).

- [ ] **Step 1: Install the plugin packages**

Run: `npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process`
Expected: both added to `package.json` dependencies; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

Create `src/state/store.update.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  useStore.setState({ updateStatus: "idle", updateVersion: null });
});

describe("update store slice", () => {
  it("setUpdate sets status and version", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("setUpdate keeps the existing version when the version arg is omitted", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    useStore.getState().setUpdate("checking");
    expect(useStore.getState().updateStatus).toBe("checking");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("setUpdate can clear the version with null", () => {
    useStore.getState().setUpdate("ready", "0.4.0");
    useStore.getState().setUpdate("idle", null);
    expect(useStore.getState().updateVersion).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- store.update`
Expected: FAIL — `setUpdate` is not a function.

- [ ] **Step 4: Add state + action to the store**

In `src/state/store.ts`, add to the `interface AppState` (near the other UI state, e.g. after `notesOpen`):

```ts
  /** auto-update state machine (issue #12) */
  updateStatus: "idle" | "checking" | "downloading" | "ready" | "error";
  /** the staged update's version, for the banner */
  updateVersion: string | null;
  setUpdate: (status: AppState["updateStatus"], version?: string | null) => void;
```

Add to the initial state object (after `notesOpen: readNotesOpen(),`):

```ts
  updateStatus: "idle",
  updateVersion: null,
```

Add the action (near the other setters, e.g. after `toggleNotes`):

```ts
  setUpdate: (status, version) =>
    set((s) => ({
      updateStatus: status,
      updateVersion: version === undefined ? s.updateVersion : version,
    })),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- store.update`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/state/store.ts src/state/store.update.test.ts
git commit -m "Add updater plugin deps + update store slice (#12)"
```

---

### Task 2: Updater module (`src/lib/updater.ts`)

**Files:**
- Create: `src/lib/updater.ts`
- Test: `src/lib/updater.test.ts`

**Interfaces:**
- Consumes (Task 1): `useStore` with `setUpdate`, `pushToast`.
- Produces:
  - `runUpdateCheck(opts?: { manual?: boolean }): Promise<void>` — never throws. Guards on `window.__TAURI_INTERNALS__`; sets `checking` → on available: `downloading` then `ready` (with version) after `downloadAndInstall()`; on none: `idle` (+ manual toast "You're on the latest version"); on error: `error` (+ manual error toast; auto logs).
  - `restartToUpdate(): Promise<void>` — calls `relaunch()`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/updater.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.3.2") }));

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { runUpdateCheck, restartToUpdate } from "./updater";
import { useStore } from "../state/store";

beforeEach(() => {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  useStore.setState({ updateStatus: "idle", updateVersion: null, toasts: [] });
  vi.mocked(check).mockReset();
});

describe("runUpdateCheck", () => {
  it("downloads and marks ready when an update is available", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    vi.mocked(check).mockResolvedValue({ available: true, version: "0.4.0", downloadAndInstall } as never);
    await runUpdateCheck();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(useStore.getState().updateStatus).toBe("ready");
    expect(useStore.getState().updateVersion).toBe("0.4.0");
  });

  it("stays idle and (manual) toasts when up to date", async () => {
    vi.mocked(check).mockResolvedValue(null as never);
    await runUpdateCheck({ manual: true });
    expect(useStore.getState().updateStatus).toBe("idle");
    expect(useStore.getState().toasts.some((t) => t.message.includes("latest version"))).toBe(true);
  });

  it("stays silent when up to date on an automatic check", async () => {
    vi.mocked(check).mockResolvedValue(null as never);
    await runUpdateCheck();
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it("sets error and (manual) toasts when the check throws", async () => {
    vi.mocked(check).mockRejectedValue(new Error("offline"));
    await runUpdateCheck({ manual: true });
    expect(useStore.getState().updateStatus).toBe("error");
    expect(useStore.getState().toasts.some((t) => t.message.includes("Couldn't check for updates"))).toBe(true);
  });

  it("is a no-op outside a bundled Tauri app", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await runUpdateCheck();
    expect(check).not.toHaveBeenCalled();
    expect(useStore.getState().updateStatus).toBe("idle");
  });
});

describe("restartToUpdate", () => {
  it("calls relaunch", async () => {
    await restartToUpdate();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- updater`
Expected: FAIL — cannot find module `./updater`.

- [ ] **Step 3: Write the module**

Create `src/lib/updater.ts`:

```ts
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../state/store";

/** True only inside a bundled Tauri webview (not dev-server browser / jsdom
 *  without the flag). Keeps the update path a silent no-op during development. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Check for an update; if found, download+install it silently and mark the
 * store `ready` so the banner can prompt a restart. Never throws.
 * - manual (Settings button): toast "up to date" / error.
 * - automatic (startup/interval): silent; errors are logged only.
 */
export async function runUpdateCheck(opts: { manual?: boolean } = {}): Promise<void> {
  const { manual = false } = opts;
  if (!inTauri()) return;
  const st = useStore.getState();
  st.setUpdate("checking");
  try {
    const update = await check();
    if (update?.available) {
      st.setUpdate("downloading", update.version);
      await update.downloadAndInstall();
      st.setUpdate("ready", update.version);
    } else {
      st.setUpdate("idle");
      if (manual) {
        let v = "";
        try {
          v = await getVersion();
        } catch {
          /* version is best-effort */
        }
        st.pushToast(
          v ? `You're on the latest version (v${v}).` : "You're on the latest version.",
          "info",
        );
      }
    }
  } catch (err) {
    st.setUpdate("error");
    if (manual) st.pushToast(`Couldn't check for updates — ${err}`, "error");
    else console.error("update check failed", err);
  }
}

/** Relaunch into the staged update. */
export async function restartToUpdate(): Promise<void> {
  await relaunch();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- updater`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/updater.ts src/lib/updater.test.ts
git commit -m "Add updater module: runUpdateCheck + restartToUpdate (#12)"
```

---

### Task 3: UpdateBanner component

**Files:**
- Create: `src/components/UpdateBanner.tsx`
- Test: `src/components/UpdateBanner.test.tsx`
- Modify: `src/App.css` (append banner styles)

**Interfaces:**
- Consumes (Tasks 1-2): store `updateStatus` / `updateVersion`; `restartToUpdate` from `../lib/updater`.
- Produces: `export function UpdateBanner(): JSX.Element | null` — renders a bar only when `updateStatus === "ready"` and not locally dismissed.

- [ ] **Step 1: Write the failing test**

Create `src/components/UpdateBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";
import { useStore } from "../state/store";
import { restartToUpdate } from "../lib/updater";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/updater", () => ({ restartToUpdate: vi.fn().mockResolvedValue(undefined) }));

afterEach(cleanup);

describe("UpdateBanner", () => {
  it("renders nothing when no update is ready", () => {
    useStore.setState({ updateStatus: "idle", updateVersion: null });
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the staged version when ready", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    expect(screen.getByText(/0\.4\.0/)).toBeTruthy();
  });

  it("Restart now calls restartToUpdate", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /restart now/i }));
    expect(restartToUpdate).toHaveBeenCalledOnce();
  });

  it("Later dismisses the banner", () => {
    useStore.setState({ updateStatus: "ready", updateVersion: "0.4.0" });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(screen.queryByText(/is ready/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- UpdateBanner`
Expected: FAIL — cannot find module `./UpdateBanner`.

- [ ] **Step 3: Write the component**

Create `src/components/UpdateBanner.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- UpdateBanner`
Expected: PASS (4 tests).

- [ ] **Step 5: Add banner styles**

Append to `src/App.css`:

```css
.update-banner {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--fg);
}
.update-banner-text {
  flex: 1 1 auto;
}
.update-banner-restart,
.update-banner-later {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  background: none;
  color: var(--fg);
  font-size: 12px;
}
.update-banner-restart {
  border-color: var(--accent);
  color: var(--accent);
}
.update-banner-restart:hover,
.update-banner-later:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/UpdateBanner.tsx src/components/UpdateBanner.test.tsx src/App.css
git commit -m "Add UpdateBanner component (#12)"
```

---

### Task 4: Wire App.tsx + Settings "Check for updates"

**Files:**
- Modify: `src/App.tsx` (startup + 6h interval effect; render `<UpdateBanner/>`)
- Modify: `src/components/SettingsModal.tsx` (current version + Check for updates button)
- Modify: `src/App.css` (append settings-update-row style)
- Test: `src/components/SettingsModal.update.test.tsx` (create)

**Interfaces:**
- Consumes: `runUpdateCheck` from `../lib/updater`; `UpdateBanner`.

- [ ] **Step 1: Write the failing test**

Create `src/components/SettingsModal.update.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { runUpdateCheck } from "../lib/updater";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.3.2") }));
vi.mock("../lib/updater", () => ({ runUpdateCheck: vi.fn().mockResolvedValue(undefined) }));

afterEach(cleanup);

describe("SettingsModal check for updates", () => {
  it("shows the current version and runs a manual check on click", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/0\.3\.2/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(runUpdateCheck).toHaveBeenCalledWith({ manual: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- SettingsModal.update`
Expected: FAIL — no "Check for updates" button / version text.

- [ ] **Step 3: Add the Settings row**

In `src/components/SettingsModal.tsx`:

Add imports at the top (after the existing imports):

```ts
import { getVersion } from "@tauri-apps/api/app";
import { runUpdateCheck } from "../lib/updater";
```

Add version state + fetch inside the component (near the other `useState`/`useEffect`; place the state with the others around line 31 and the effect after the shells/fonts effect):

```ts
  const [appVersion, setAppVersion] = useState("");
```

```ts
  useEffect(() => {
    let alive = true;
    void getVersion()
      .then((v) => alive && setAppVersion(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
```

Add this field to the rendered form (e.g. immediately after the Theme `label` block, before the next field):

```tsx
        <div className="settings-field">
          <span>Updates</span>
          <div className="settings-update-row">
            <span className="settings-version">
              Current version: {appVersion || "—"}
            </span>
            <button
              type="button"
              className="settings-check-update"
              onClick={() => void runUpdateCheck({ manual: true })}
            >
              Check for updates
            </button>
          </div>
          <small>Checks automatically on launch; use this to check now.</small>
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- SettingsModal.update`
Expected: PASS.

- [ ] **Step 5: Wire App.tsx**

In `src/App.tsx`:

Add imports (after the other component imports):

```tsx
import { UpdateBanner } from "./components/UpdateBanner";
import { runUpdateCheck } from "./lib/updater";
```

Add this effect alongside the other `useEffect` pollers (e.g. after the PR poll effect):

```tsx
  // Auto-update: check shortly after launch, then every 6h. No-op outside a
  // bundled Tauri app. The banner (rendered below) prompts a restart when ready.
  useEffect(() => {
    const t = window.setTimeout(() => void runUpdateCheck(), 5000);
    const iv = window.setInterval(() => void runUpdateCheck(), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, []);
```

Render the banner — add `<UpdateBanner />` right after `<Toasts />` (App.tsx:283):

```tsx
      <Toasts />
      <UpdateBanner />
```

- [ ] **Step 6: Add the settings-update-row style**

Append to `src/App.css`:

```css
.settings-update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.settings-check-update {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 12px;
  color: var(--fg-muted);
  cursor: pointer;
  background: none;
  font-size: 12px;
}
.settings-check-update:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS (all suites).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/SettingsModal.tsx src/App.css src/components/SettingsModal.update.test.tsx
git commit -m "Wire auto-update check (startup + interval) and Settings check button (#12)"
```

---

### Task 5: Rust plugins, config & CI

> **PAUSE POINT (controller):** before this task, obtain the Tauri updater **public key** from the maintainer (Task 6). The `pubkey` below must be the real key, not a placeholder — an empty/invalid key would break the bundled updater.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the frontend from Tasks 1-4 (which calls the JS plugin APIs backed by these Rust plugins).

- [ ] **Step 1: Add the Rust crates**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after the existing `tauri-plugin-*` lines):

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 2: Register the plugins**

In `src-tauri/src/lib.rs`, add to the builder chain (after the existing `.plugin(...)` calls, before `.manage(...)`):

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 3: Add capabilities**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
    "updater:default",
    "process:allow-restart"
```

- [ ] **Step 4: Configure the updater**

In `src-tauri/tauri.conf.json`:

Add `"createUpdaterArtifacts": true` to the `bundle` object (e.g. right after `"active": true,`):

```json
    "active": true,
    "createUpdaterArtifacts": true,
```

Add a top-level `plugins` object (a sibling of `bundle`), using the maintainer-provided public key:

```json
  "plugins": {
    "updater": {
      "pubkey": "<MAINTAINER-PROVIDED TAURI UPDATER PUBLIC KEY>",
      "endpoints": [
        "https://github.com/GrillerGeek/AgentPanel/releases/latest/download/latest.json"
      ]
    }
  }
```

- [ ] **Step 5: Pass signing secrets to CI**

In `.github/workflows/release.yml`, add two env vars to the `tauri-action` step's `env:` block (alongside the `APPLE_*` entries, around release.yml:87):

```yaml
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

- [ ] **Step 6: Verify it compiles and the frontend still builds**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles (downloads + builds `tauri-plugin-updater` / `-process`); no errors. This is a large first-time compile — allow several minutes.

Run: `npm test && npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/tauri.conf.json .github/workflows/release.yml
git commit -m "Add Tauri updater + process plugins, config and CI signing (#12)"
```

---

### Task 6: Maintainer key-gen prerequisite + release-time verification

**Files:** none (maintainer actions + documented verification; auto-update's true end-to-end cannot run in dev/unit/browser).

- [ ] **Step 1: Generate the updater signing key (maintainer)**

Run: `npm run tauri signer generate -- -w ~/.tauri/agentpanel.key`
Expected: prints a **public key** and writes a password-protected private key to `~/.tauri/agentpanel.key`. Keep the password.

- [ ] **Step 2: Add GitHub Actions secrets (maintainer)**

In the GitHub repo settings → Secrets and variables → Actions, add:
- `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `~/.tauri/agentpanel.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password chosen in Step 1

- [ ] **Step 3: Provide the public key**

Give the printed public key to the implementer of Task 5 to paste into `tauri.conf.json` `plugins.updater.pubkey`. (This is the Task 5 pause dependency.)

- [ ] **Step 4: Release-time end-to-end verification**

After a release is built and **published** (not left as a draft):
1. Confirm the published release assets include `latest.json` and the signed installers (`*-setup.exe` / `*.nsis.zip` for Windows, `*.app.tar.gz` for macOS).
2. Install a build one version older than the published release.
3. Launch it. Within a few seconds the update downloads silently; the bottom banner appears: "AgentPanel v<new> is ready."
4. Click **Restart now** → the app relaunches into the new version (verify via Settings → Current version).
5. Repeat once choosing **Later**, then quit and relaunch manually → confirm the new version runs and the banner no longer appears.

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-12-auto-update-design.md`):
- Rust updater + process plugins, registration, permissions → Task 5. ✓
- `tauri.conf.json` updater config (`createUpdaterArtifacts`, pubkey, endpoints) → Task 5 Step 4. ✓
- CI signing env vars → Task 5 Step 5. ✓
- Maintainer key-gen prerequisite (pause) → Task 6 + Task 5 pause note. ✓
- `src/lib/updater.ts` (runUpdateCheck/restartToUpdate, dev no-op, auto-silent/manual-toast) → Task 2. ✓
- Store slice (updateStatus/updateVersion/setUpdate) → Task 1. ✓
- UpdateBanner (ready-only, Restart/Later, not modal/toast) → Task 3. ✓
- App wiring (startup + 6h interval, render banner) → Task 4 Step 5. ✓
- Settings "Check for updates" (getVersion + manual) → Task 4 Step 3. ✓
- Error handling (dev no-op, auto silent, manual toast, verify-failure safe) → Tasks 2 (logic) + covered by tests. ✓
- Testing (unit mocked, component, store, manual release-time) → Tasks 1-4 tests + Task 6 Step 4. ✓
- Out-of-scope items (notarization setup, release-notes UI, delta/channels, forced updates, progress bar) → not implemented. ✓

**Placeholder scan:** the only intentional placeholder is `pubkey` in Task 5 Step 4, explicitly a maintainer-supplied value gated behind the Task 5 pause and Task 6 — not a plan gap. All code/test steps contain complete content; all run steps have exact commands + expected results.

**Type/name consistency:** `updateStatus` enum identical in Task 1 (store), Task 2 (module), Task 3 (banner). `setUpdate(status, version?)`, `runUpdateCheck({ manual? })`, `restartToUpdate()` used consistently across tasks and tests. `updateVersion` string|null throughout. Feed URL identical in spec and Task 5. Capability strings `updater:default` / `process:allow-restart` match the spec.
