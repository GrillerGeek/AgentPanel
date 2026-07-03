# Contributing to AgentPanel

Thanks for your interest in improving AgentPanel! This is a Tauri 2 (Rust) + React/TypeScript
desktop app. Contributions of all sizes are welcome — bug reports, fixes, features, and docs.

## Getting set up

See the [README](README.md#build-from-source) for prerequisites (Rust stable, Node 18+, and the
per-OS [Tauri prerequisites](https://tauri.app/start/prerequisites/)). Then:

```sh
npm install
npm run tauri dev      # run in development with hot reload
```

## Project layout

- **`src-tauri/`** — Rust core: `pty.rs` (PTY/ConPTY sessions), `git.rs` (worktree ops),
  `gh.rs` (PR/CI), `watcher.rs` (file watching), `commands.rs` (the Tauri command surface),
  `store.rs` (persistence).
- **`src/`** — React + TypeScript: `state/` (Zustand store), `Terminal.tsx` (xterm.js + WebGL),
  `components/`, `themes/`.
- **`docs/dev/`** — internal design notes, UX research, and plans.

## Before you open a pull request

Please make sure the checks below pass locally — CI runs the same on Windows and macOS.

```sh
npm test                                              # frontend unit tests (Vitest)
npx tsc --noEmit                                      # TypeScript type-check
cargo test --manifest-path src-tauri/Cargo.toml       # Rust tests
cargo build --manifest-path src-tauri/Cargo.toml      # Rust compiles
```

If your change touches UI behavior, please also verify it in a running build (`npm run tauri dev`)
and describe what you checked in the PR — type-checks and unit tests don't catch render-time issues.

## Pull request guidelines

- Branch off `main`; keep PRs focused on one logical change.
- Write a clear description of **what** changed and **why**. Link any related issue.
- Match the surrounding code's style, naming, and comment density. There's no separate formatter
  step to run — keep diffs minimal and idiomatic.
- The Rust core is intentionally platform-agnostic. Gate OS-specific code behind `#[cfg(...)]`
  and preserve behavior parity between Windows and macOS where practical.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/GrillerGeek/AgentPanel/issues/new/choose). For
security issues, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
