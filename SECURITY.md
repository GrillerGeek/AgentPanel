# Security Policy

## Supported versions

AgentPanel is pre-1.0 and ships from `main`. Security fixes land on the latest release; please
make sure you're on the newest version from
[Releases](https://github.com/GrillerGeek/AgentPanel/releases) before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/GrillerGeek/AgentPanel/security).
2. Click **Report a vulnerability**.

If you're unable to use private reporting, open a regular issue asking for a secure contact
channel — **without** including any vulnerability details — and a maintainer will follow up privately.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce (a proof of concept if possible).
- Affected version(s) and platform (Windows/macOS).

You can expect an initial response within a few days. Once the issue is confirmed and fixed, we'll
coordinate a release and credit you if you'd like.

## Scope notes

AgentPanel runs local shells and CLIs, executes `git`/`gh`, and reads/writes files in the
repositories you point it at — all with the privileges of the launching user. Reports about the
app's own behavior (e.g. command injection, unsafe path handling, insecure IPC between the
frontend and the Rust core, or credential leakage) are in scope. The behavior of third-party agent
CLIs you choose to run inside AgentPanel is not.
