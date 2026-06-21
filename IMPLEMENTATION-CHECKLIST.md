# AgentPanel — UX Roadmap Implementation Checklist (Themes 1–4)

Derived from `ux-research/findings-report.md`. Scope = roadmap **Themes 1–4**.
**Theme 5 (enterprise: signing/MSI, proxy/GHE, audit log, configurable worktree
location) is explicitly out of scope** for this goal.

Ordering logic: **Theme 1 is the keystone — build it first**, because per-agent
state underpins Theme 2's "confirm when an agent is running" and Theme 4's agent
filters/attention sort. Themes 2 and 3 are cheap and mostly independent and can
follow in parallel. Theme 4 depends on Theme 1's state.

---

## Guardrails (apply to EVERY task — non-negotiable)

- [ ] `npm test` (vitest) green after each theme
- [ ] `cargo test` (manifest `src-tauri/Cargo.toml`) green after any Rust change
- [ ] `npx tsc --noEmit` and `cargo check` clean before claiming a task done
- [ ] **Render-verify every UI change in a real browser** (`npm run dev`, load `http://localhost:1420` in the Playwright browser, confirm a non-empty snapshot and no React errors like "Maximum update depth"). tsc/unit tests do NOT catch render crashes. See memory `verify-ui-renders-before-claiming-tested`.
- [ ] **No existing feature removed** (worktree-per-agent model, scoped tabs + `repo / branch` chip, Active terminals section, git/PR badges, ▶ quick-launch, shell/font/theme pickers, GPU toggle, session restore must all keep working)
- [ ] Zustand selectors must return primitives/stable refs — never a freshly-built object passed straight to `useStore` (build derived objects with `useMemo`)
- [ ] Commit per logical unit; push to `GrillerGeek/AgentPanel`

---

## Theme 1 — Make agents observable (KEYSTONE — do first, unblocks all 5 personas)

### 1A · PTY exit + lifecycle signal from Rust (`src-tauri/src/pty.rs`, `lib.rs`)
- [x] Pass `AppHandle` into `pty_spawn` so the session can emit events
- [x] When the reader thread hits EOF, `child.wait()` for the exit status and emit a `pty-exit` event `{ sessionId, code }`
- [x] Ensure intentional close (`pty_close` / taskkill) is distinguishable from a natural agent exit — the reader claims the session on EOF; if `pty_close` already removed it, no event fires

### 1B · Per-session activity capture (`src/Terminal.tsx`)
- [x] On each decoded PTY output chunk, record a last-output timestamp and keep a small rolling tail buffer (~2 KB) per pane for prompt detection (in `src/state/agentRuntime.ts`, off-store so it doesn't re-render)
- [x] Subscribe to `pty-exit`; mark that session `exited` with its code

### 1C · State derivation (`src/state/activity.ts` — replaced the busy/idle TODO)
- [x] Implement states: `running` (output within ~1.5 s), `idle` (quiet at a normal prompt), `awaiting` (tail matches a maintainable confirmation-prompt list, ANSI-stripped), `exited` — with unit tests
- [x] Store `agentStatus: Record<paneId, AgentState>` in `src/state/store.ts`
- [x] Add a 1 s ticker (ungated so background agents are still tracked for notifications) that pushes state only when it changes
- [x] Surface honestly: states carry plain labels ("running"/"waiting for input"/"exited"/"idle"); conservative awaiting patterns avoid false positives

### 1D · Surface state in the UI
- [x] Status dot per session in `src/components/ActiveSessions.tsx` (color + tooltip per state, pulsing for "awaiting")
- [x] Status badge (dot) in `src/components/TabBar.tsx` tab titles
- [ ] (optional) indicator on the worktree row in `src/components/Sidebar.tsx`

### 1E · Notifications (depends on 1C)
- [x] Add `tauri-plugin-notification` (Rust dep + `@tauri-apps/plugin-notification` + `notification:default` capability)
- [x] Request notification permission on first use (`src/lib/notify.ts`, cached)
- [x] Fire an OS notification on transition to `awaiting` and `exited` **for non-active sessions only**; the clickable in-app toast activates that session's tab (`setActiveTab`)
- [x] Mirror as an in-app toast (`src/components/Toasts.tsx`, now clickable via `focusTabId`)
- [x] Add a Settings toggle for notifications (default on)
- [ ] **Acceptance (manual — needs a real agent):** run an agent that prints a `(y/n)` prompt in a background worktree → its dot shows "awaiting input" and a notification fires; clicking the toast jumps to that session

---

## Theme 2 — Safe & learnable (cheap trust/clarity wins)

- [ ] Reusable `ConfirmDialog` component (message, confirm/cancel, optional "don't ask again")
- [ ] Confirmation on **Remove repository**, **Remove worktree**, and **Close-all-terminals (✕)** in `Sidebar.tsx` / `ActiveSessions.tsx`; copy states exactly what is removed and that **the branch and on-disk code are not deleted** (worktree remove deletes the worktree dir only)
- [ ] Confirm-on-close when a tab/pane has a **running agent** (uses Theme 1 state)
- [ ] Guardrails are **dismissible**: "don't ask again" preference persisted in settings (resolves junior-vs-power-user tension)
- [ ] Undo toast for reversible actions (e.g. closed tab) where feasible; otherwise confirm only
- [ ] **"What is a worktree?" explainer** — a `?`/info affordance near "+ new worktree" and worktree rows, plain-English: what it is, where it lands on disk (sibling `<repo>-worktrees/<branch>`), what base branch it forks from, and that it won't touch your files
- [ ] Show the target disk path + base branch in the new-worktree form/tooltip
- [ ] Plain-language git status: keep the glyphs but add words ("2 commits not pushed", "3 changed files") and a small legend for ↑↓● + PR colors (hover legend or a `?` in the sidebar header)
- [ ] **First-run tour**: 3 dismissible cards (what AgentPanel is → add a repo → launch an agent), shown when no repos exist; persist a "seen" flag
- [ ] **Surface terminal find/search**: wire the already-bundled `@xterm/addon-search` — `Ctrl+F` opens an in-terminal search box in `Terminal.tsx`
- [ ] **Acceptance:** a git novice can tell what "remove worktree" will and won't delete; `Ctrl+F` searches terminal scrollback; first launch explains itself

---

## Theme 3 — Keyboard / palette completeness (cheap power-user wins)

- [ ] Expand `src/components/CommandPalette.tsx` to cover all primary actions: split pane, run-agent (one per `agentCommands`), switch theme, open settings, new/close terminal, close worktree/session
- [ ] Add **jump-to-session** entries (list active sessions, filterable by repo/branch query)
- [ ] **Global cross-worktree session switching** via a keystroke (e.g. `Ctrl+Shift+Tab` cycles worktrees) + next/prev-session actions using `setActiveWorktree`; keep the existing within-worktree `Ctrl+Tab`
- [ ] **Remappable keybindings**: centralize a default keymap (action → chord), load overrides from settings (exportable/file-based escape hatch), and replace the hardcoded handlers in `src/App.tsx` with a keymap lookup
- [ ] Make chord interception configurable so `Ctrl+W` / `Ctrl+T` can be released to reach the shell/TUI when unbound
- [ ] Settings: at minimum view current bindings + reset to defaults (full editor optional)
- [ ] **Acceptance:** every primary action is reachable from the palette; rebinding persists; cross-worktree jump works by keyboard

---

## Theme 4 — Fleet scale (maintainer; depends on Theme 1 state)

- [ ] **Search box** in `Sidebar.tsx` filtering repos/worktrees by name/branch
- [ ] **Filters** (chips/toggles): only worktrees with a running agent / dirty / open PR / red CI — wired to `statuses`, `prs`, and `agentStatus`
- [ ] **Attention-queue sort** in `ActiveSessions.tsx`: auto-float `awaiting-input` and `exited`/finished sessions to the top (currently first-appearance order)
- [ ] **Collapse-all / expand-all** repos in the sidebar
- [ ] **Cross-repo PR/CI roll-up**: one sortable view listing every open PR + check state across all repos (reuse the already-polled `prs` data; surface as a modal or palette-accessible panel)
- [ ] **Acceptance:** with many worktrees open, search/filters narrow the list, the neediest agents sort to the top, and the roll-up lists every open PR across repos

---

## Definition of done (whole goal)

- [ ] All boxes above checked
- [ ] `npm test` + `cargo test` green; `tsc` + `cargo check` clean
- [ ] Every UI change render-verified in a browser (no React errors)
- [ ] No existing feature removed
- [ ] Changes committed and pushed; a short before/after note added to this file or the perf/UX log
- [ ] A fresh release build produced for manual testing

## Explicitly deferred (Theme 5 — not this goal)
Code-signing / MSI / winget, corporate proxy + GitHub Enterprise config, durable
per-agent transcript/audit log, configurable worktree location + adopt-existing.
Tracked in `ux-research/findings-report.md`.
