# Raj Patel — enterprise staff engineer

> Staff SWE at a ~2000-person fintech; strict mandatory-PR monorepo with heavy CI/CD, Windows behind a corporate proxy, SSO/2FA on GitHub Enterprise. Evaluating whether AgentPanel is safe and useful to recommend to a team that values reliability, auditability, and not surprising my git state.

## Overall impression
The core idea is genuinely good and matches a real pain — I already juggle 3-4 agent sessions in separate worktrees of our monorepo by hand. The terminal layer looks solid and considered (ConPTY, process-tree kill, base64 framing, spawn serialization). But it's built as a single-dev power-user tool, and almost every assumption it makes about my environment — small repos with writable siblings, a vanilla origin, gh that just works, an installer I can run — is wrong or risky in my world. Promising, but today it's a "personal side projects" tool, not something I can put in front of my team.

## Ease of use — 4/5
Happy path is very discoverable: empty state tells you to click "+ Add", folder picker, expand-to-worktrees, quick-launch agent buttons. Loses a point because the things that would confuse me are silent (where worktrees land on disk, why no PR badge appears, what "main" means in a monorepo).

## What worked well
- Worktree-per-agent is the right primitive; "Active terminals" pinned section is a good live map.
- Terminal core is serious: per-pane ConPTY, taskkill /T /F on close (correctly reaps agent child procs), spawn lock for the ConPTY race, EOF-correct reader threads.
- Graceful degradation on gh (shows nothing rather than erroring).
- Worktree removal doesn't delete the branch; --force + prune/remove-dir fallback handles the real Windows cwd-lock failure.
- GPU-off toggle for RDP — thoughtful, someone who actually uses Windows built this.
- Per-user install, no admin.

## Friction & confusion
- [blocker] Unsigned NSIS installer from a personal GitHub repo — EDR/SmartScreen will quarantine it; no MSI/winget/signed artifact = can't go through our software-distribution channel at all.
- [blocker] No corporate-proxy / GitHub Enterprise story — no proxy setting, no GHE host config, silent failure when gh auth expires. "Why is the PR badge missing?" with zero diagnostics is a team support nightmare.
- [major] Worktrees forced into a sibling <repo>-worktrees\<branch> dir I may not control — may be outside the dev sandbox, scanned, or unwritable; multi-GB monorepo siblings are a disk problem; not configurable. Classic "tool surprises my filesystem."
- [major] PR/CI is branch-checked-out-only and assumes a simple remote; fork/multi-remote/renamed-branch flows silently show nothing, and it never says which remote/host it queried — can't trust the badge for compliance.
- [major] No audit trail — fresh shells on restore, scrollback gone, no transcript/log of what an agent ran. An autonomous agent in a repo with no durable record is a non-starter in a regulated shop.
- [major] Status is polled (2.5-5s) + watcher ignores .git, so counts can lag — want that disclosed.
- [minor] Settings/repo list persist as plaintext JSON in %APPDATA%/localStorage (agent commands + repo paths) — mild leakage on roaming/shared profiles; DLP will ask.
- [minor] "main" badge marks the primary checkout, not trunk semantics — could mislead in a monorepo.

## Missing features for my workflow
- [must-have] Signed installer + deployable package (MSI/winget) + offline option — gates everything else.
- [must-have] Configurable worktree location + "use existing worktree" mode — keep worktrees in my sandbox, adopt ones I already have.
- [must-have] Per-agent session transcript / audit log surviving restart — for compliance and review.
- [must-have] GHE host + authenticated-proxy config with clear gh-auth diagnostics — distinguish "no PR" from "auth/proxy blocked."
- [nice-to-have] Guardrails/visibility on destructive git ops (force-push, history rewrite).
- [nice-to-have] CI deep-link to the failing check, not just a red dot.
- [nice-to-have] Written network-transparency statement for security review.

## My top 3 asks
1. Make it deployable/trustworthy in a managed environment: code-signed, MSI/winget, GHE+proxy aware, documented network footprint.
2. Durable per-agent audit trail (transcript + git-action log surviving restart).
3. Let me control where worktrees live and adopt existing ones.

## Would I adopt it?
Maybe — happily on my own machine for personal projects today, but can't recommend it to my team until it's signed/packaged, proxy/GHE-aware, and produces an audit trail.
