---
quest: Implement opt-in Sentry crash reporting per the approved design spec
mode: feature
started: 2026-07-23T00:00:00Z
spec: docs/superpowers/specs/2026-07-23-crash-reporting-design.md
slug: crash-reporting
status: completed
model_check: "haiku (param honored)"
parent_model: "claude-fable-5"
---

# Plan

## Context

Spec: `docs/superpowers/specs/2026-07-23-crash-reporting-design.md` (user-approved this
session). It is a design doc, not an IDD-format spec; its **Testing**, **Architecture**,
**Error handling**, and **Out of scope** sections serve as Expectations/Boundaries. They
are concrete and verifiable, so no `spec-reviewer` detour is needed (noted as a
Mordain decision below).

Load-bearing spec requirements (verbatim):

> - `main.rs` reads this file **synchronously, before `tauri::Builder` runs**. Missing or
>   unparsable file ⇒ `unset` ⇒ no telemetry.
> - Sentry initializes **only** when consent is `granted`.
> - Two new Tauri commands expose it to the frontend: `get_telemetry_consent()` returns
>   both the current file value **and** `active_this_session` (the value captured at
>   startup — whether the Rust SDK actually initialized); `set_telemetry_consent(consent)`
>   updates the file.
> - A change of consent takes effect **on next launch**.

Privacy (verbatim): `send_default_pii` off; `server_name` stripped; console breadcrumbs
disabled; `before_send` path/username redaction; terminal contents/PTY I/O/env/repo
paths never attached.

Cited codebase patterns:
- `src-tauri/src/store.rs` — fail-soft JSON persistence style (`unwrap_or_default`,
  missing/corrupt ⇒ default). The telemetry module mirrors this, but CANNOT use
  `AppHandle`-based `app_data_dir()` (no handle exists pre-Builder). It resolves the
  platform data dir + `com.jason.agentpanel` (identifier from `tauri.conf.json:5`)
  directly — same directory Tauri resolves to.
- `src/components/UpdateBanner.tsx` — the non-blocking banner pattern the consent
  prompt copies.
- `src/components/PaneErrorBoundary.tsx` — gets a `componentDidCatch` →
  `captureException` hook.
- `src/components/SettingsModal.update.test.tsx` — Vitest + `vi.mock("@tauri-apps/api/core")`
  invoke-mocking pattern for frontend tests.
- `src-tauri/src/lib.rs` — plugin registration + `generate_handler!` list where the two
  new commands and sentry-tauri plugin register.

## Dispatch sequence

### Sequential build
1. [x] model-echo diagnostic — haiku honored
2. [x] Seraphine Dawnveil — test-author (sonnet) — RED verified by Mordain: Vitest
   3 new files failing (6 assertions + 2 expected unresolved imports); cargo 11
   telemetry tests failing on `todo!()` panics, crate compiles (Rust toolchain was
   absent on this machine; Mordain installed rustup stable to hold the gate)
3. [x] Bruga Ironseam — feature-implementer (sonnet) — GREEN verified by Mordain:
   cargo 20/20; Vitest 90 pass + exactly the 7 pre-existing store.notes failures.
   Ratified deviation: `tauri-plugin-sentry` 0.5 (Tauri-v2 successor of the spec's
   v1-only "sentry-tauri"); init in lib.rs::run() (main.rs is a 2-line shim);
   added beforeBundleCommand + scripts/strip-sourcemaps.mjs
4. [x] Tink Whiffletree — SKIPPED: inspection of telemetry.rs / lib.rs / telemetry.ts
   found convention-matching, constraint-commented code; no dup beyond the
   spec-mandated Rust/TS scrubber mirror. Ceremonial dispatch declined.
5. [x] IDD idd-tech-lead-reviewer (sonnet) — first dispatch failed on agent name
   (`tech-lead-reviewer` → correct: `idd-tech-lead-reviewer`); retried. Verdict:
   REQUEST-CHANGES — ratified all three Bruga deviations; confirmed breadcrumb-
   bypass HIGH and banner write-failure HIGH at code level; flagged DSN CI gap +
   release-string mismatch as merge blockers; noted banner optimistic-dismiss can
   diverge UI state from file state until restart

### Parallel reviews (after green) — all six fired in one message
- [x] Oriana — security-reviewer (opus) — 1 HIGH, 1 med, 2 low, 3 info
- [x] Cassian — docs-writer (sonnet) — README + SECURITY.md edits applied; anchor ok
- [x] Vance — observability-reviewer (sonnet) — 1 HIGH, 2 med, 1 low, 1 info
- [x] Thalia — reliability-reviewer (opus) — 0 high, 1 med, 1 low, 6 info
- [x] Cassia — performance-reviewer (sonnet) — 1 HIGH, 2 med, 2 low, 6 info
- [x] Garran — ops-readiness-reviewer (sonnet) — runbook delivered; found DSN never
  injected in release.yml + release-string mismatch breaking JS symbolication

### Closer
- [x] Rook Mossbrook — pr-author (sonnet) — dispatched after the fix round closed
  all HIGHs (halt lifted by user-approved fix round; Oriana + Vance re-verified
  all their findings CLOSED). PR title "Add opt-in Sentry crash reporting" +
  body emitted; user creates the PR.

## Review findings (triaged)

HIGH (block Rook):
1. [Oriana][security] Click/nav breadcrumbs bypass BOTH scrubbers; UI `title`/
   `aria-label` attrs (TabBar.tsx:191/160/242, Sidebar.tsx:139/177) carry absolute
   cwd/repo paths, usernames, branch names, commit messages, command lines into
   events verbatim. Violates spec allowlist + README promise.
2. [Vance][observability] TelemetryBanner.tsx:32-35 — consent-write failure never
   surfaced (spec requires toast); optimistic dismiss + unhandled rejection.
3. [Cassia][performance] lib.rs init_telemetry pre-Builder `sentry::init` does
   blocking TLS-stack construction (est. up to ~20ms) + 2 thread spawns on the
   startup path for opted-in users; spec says never slow startup.

MED (fix or note in PR):
- [Oriana] Scrubber only knows `/Users/`-rooted paths; `/home/<n>`, `/Volumes/…`,
  UNC shares pass unredacted (repo paths reachable on shipped mac/Win).
- [Vance] strip-sourcemaps.mjs bare catch swallows all readdir errors, silently
  defeating its own ship-no-maps guarantee; should only swallow ENOENT.
- [Vance] (= Oriana HIGH #1, breadcrumb scrub gap, observability angle)
- [Thalia] Default reqwest transport has NO timeouts; black-holed endpoint + full
  queue (30) ⇒ panic-time flush blocks the dying process forever. Fix: custom
  transport with connect/request timeouts.
- [Cassia] @sentry/browser eagerly bundled/parsed for ALL users incl. non-consented
  (~25-35KB gz est.); suggest dynamic import behind active_this_session.
- [Garran][ops, release-blocking in practice] AGENTPANEL_SENTRY_DSN never injected
  in release.yml build env ⇒ shipped builds compile with no DSN, telemetry inert.
- [Garran][ops] Release-string mismatch: Rust `0.4.1` / JS `agentpanel@0.4.1` /
  CI upload `0.4.1` ⇒ JS stack traces never symbolicate.

LOW/INFO of note:
- [Oriana] extra.componentStack (PaneErrorBoundary) outside spec allowlist;
  extra/contexts/tags are an unscrubbed sink. README IP-address claim stronger than
  client can enforce (needs Sentry project setting). Windows safety-net regex
  narrower than primary matcher.
- [Thalia] Normal-exit events unflushed (BY DESIGN, verified no shutdown hang);
  panics delivered best-effort in ≤2s; native crashes (SIGSEGV) not covered
  (minidump deliberately off — product scope note). Statics race-free. IPC
  saturation cannot block PTY path. Offline buffer bounded at 30.
- [Cassia] Duplicate get_telemetry_consent invoke at boot (App + banner).
  Cargo.lock oddity: sentry-actix/actix-web entries present — run
  `cargo tree -e features -p sentry` to confirm not compiled in.
- [Vance] No debug-build diagnostic distinguishing no-DSN / denied / corrupt-file
  inactive states.

## Reviewers selected

Always-on:
- Oriana (`security-reviewer`) — fires
- Cassian (`docs-writer`) — fires

Gated:
- Vance (`observability-reviewer`) — fired — default-on for feature-implementer chains;
  telemetry init/consent paths must not fail silently in ways we can't diagnose
- Thalia (`reliability-reviewer`) — fired — diff adds network I/O (Sentry transport)
  and a startup-critical read
- Cassia (`performance-reviewer`) — fired — spec mandates telemetry "never block, slow
  startup"; latency mention ⇒ bias-to-fire
- Garran (`ops-readiness-reviewer`) — fired — user-visible behavior change shipping in
  next release; DSN/secret setup needs a runbook
- Ysolde (`migration-safety-reviewer`) — skipped — no migrations, schema, or backfills
- Vera (`ui-test-author`) — skipped — repo has no Playwright harness (Tauri desktop app;
  UI tests are Vitest + testing-library per existing pattern); spec's UI expectations
  are covered by Seraphine's component tests
- Lior (`accessibility-reviewer`) — skipped — gate pairs Lior with Vera; banner/toggle
  reuse existing accessible patterns, and Seraphine's tests assert roles/labels

## Fix round (2026-07-24, user-approved)

Bruga resumed with a 12-item scoped list (a-l). 11 implemented; GREEN re-verified
by Mordain: cargo 25/25 (+5 scrubber-shape tests), Vitest 96 pass + exactly the 7
pre-existing store.notes failures (+6 new tests). Bruga also confirmed
`npm run build` + `tsc --noEmit` clean and the dynamic @sentry/browser chunk split
(main bundle ~332KB → ~246KB).

- (a) breadcrumbs: JS Breadcrumbs integration dropped entirely +
  beforeBreadcrumb→sendBreadcrumbToRust removed; Rust scrub_event now scrubs
  event.breadcrumbs (defense-in-depth)
- (b) banner .catch → revert to unset + pushToast; reject-flow test added
- (c/g) TimeoutTransportFactory with connect/request timeouts wired via
  ClientOptions.transport; SENTRY_GUARD droppability warning comment.
  LAZY construction judged infeasible by Bruga (sentry 0.42 private worker/flush
  semantics; unverifiable hand-off logic) — MORDAIN RULING: accepted. With
  timeouts in place, Thalia's hang scenario is closed; what remains of Cassia's
  HIGH is a bounded one-time TLS-stack build (est. ≤~20ms) on startup, only for
  opted-in users on DSN-bearing builds. Documented as accepted cost in PR body.
- (d) AGENTPANEL_SENTRY_DSN injected into release.yml build env (secrets)
- (e) release strings aligned to agentpanel@<version> in Rust + CI (JS already)
- (f) strip-sourcemaps.mjs: ENOENT-only catch, rethrows otherwise
- (h) scrubbers extended: /home/<name>, /root, /Volumes/<name>, UNC shares;
  widened truncation backstop incl. lowercase-drive/forward-slash Windows
- (i/j) @sentry/browser dynamically imported behind active_this_session;
  PaneErrorBoundary uses new captureError export; componentStack extra dropped
- (k) README IP claim softened to client-enforceable wording
- (l) debug-build-only eprintln! diagnostics for inactive-telemetry causes

Re-verification: Oriana + Vance resumed for focused CLOSED/STILL-OPEN verdicts
on their findings before Rook.

## Decisions made by Mordain

- Treat the approved design doc as the spec despite non-IDD format — its Testing/Error
  handling/Out of scope sections are concrete Expectations/Boundaries; routing to
  spec-author would re-litigate a user-approved design.
- Consent path resolution: platform data dir + `com.jason.agentpanel` resolved without
  `AppHandle` (pre-Builder constraint) — new `telemetry.rs` module keeps pure,
  path-parameterized functions so tests need no Tauri runtime.
- DSN strategy: compile-time `option_env!("AGENTPANEL_SENTRY_DSN")` (and Vite env for
  any frontend need). Absent/empty DSN ⇒ Sentry never initializes even with consent
  granted — dev builds and forks stay telemetry-free by default. User must create the
  Sentry project and set the env in CI (open item).
- Skipped Aldric — architecture was settled with the user during brainstorming; no
  competing in-repo patterns to arbitrate.
- Skipped Vera/Lior — no Playwright harness exists; component-level coverage suffices
  for a banner + toggle (reasons above).

## Open items for the user

QUEST HALTED before PR draft (hard rule: HIGH findings ⇒ stop and surface). Decide:

1. Fix round (recommended): re-dispatch Bruga with a scoped fix list —
   (a) scrub or disable DOM/nav breadcrumbs [Oriana HIGH];
   (b) banner .catch → toast + revert on write failure [Vance HIGH];
   (c) move sentry::init off the pre-Builder blocking path or accept documented
       one-time ~ms-20ms cost for opted-in users [Cassia HIGH — cheap fix vs accept];
   (d) inject AGENTPANEL_SENTRY_DSN into release.yml build env [Garran];
   (e) align release strings (Rust/JS/CI upload) [Garran];
   (f) strip-sourcemaps.mjs: swallow only ENOENT [Vance med];
   (g) transport connect/request timeouts [Thalia med];
   optionally (h) broaden scrubber beyond /Users/ paths, (i) dynamic-import
   @sentry/browser, (j) drop componentStack extra.
2. Or accept specific findings as-is (each is fail-closed/privacy-safe in the
   current no-DSN state, but README promises would be false once a DSN ships).

External setup only the maintainer can do:
- Create the Sentry org/project (pick data region; enable "do not store IP"
  project setting to match README claim).
- Add SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT secrets + AGENTPANEL_SENTRY_DSN
  to the repo; decide secret vs variable for the DSN.
- Configure Sentry alert rules + key rate limits (free tier: 5k events/mo).
- First release: manually verify a test Rust panic and a test JS error arrive
  scrubbed and symbolicated (no automated coverage of the full tauri build).

Environment notes:
- Pre-existing unrelated failure: src/state/store.notes.test.ts (7 tests,
  localStorage.clear not a function) — fails on clean checkout too.
- Rust toolchain (rustup stable, minimal profile) was installed on this machine
  by Mordain to run the Rust gates; it was absent before this quest.
- Cargo.lock sanity check suggested: `cargo tree -e features -p sentry` re
  unexpected sentry-actix entries (Cassia info).
