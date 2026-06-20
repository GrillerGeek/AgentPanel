//! Detect the interactive shells installed on this machine so Settings can offer
//! them by friendly name (e.g. "PowerShell 7" vs "Windows PowerShell") instead of
//! making the user remember executable names.
//!
//! Each entry carries the resolved absolute path, which is what gets handed to
//! `pty_spawn` — so picking "PowerShell 7" launches pwsh even when it isn't on
//! PATH, and there's no ambiguity between the two PowerShells.

#[cfg(windows)]
use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ShellInfo {
    /// Human-friendly name shown in Settings.
    pub label: String,
    /// Absolute path (or bare command) handed to the PTY.
    pub path: String,
}

#[cfg(windows)]
fn push_unique(out: &mut Vec<ShellInfo>, label: &str, path: PathBuf) {
    let p = path.to_string_lossy().to_string();
    if !out.iter().any(|s| s.path.eq_ignore_ascii_case(&p)) {
        out.push(ShellInfo {
            label: label.to_string(),
            path: p,
        });
    }
}

/// First existing file among `candidates`.
#[cfg(windows)]
fn first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|p| p.is_file()).cloned()
}

/// Resolve an executable name against PATH (exact filename match).
#[cfg(windows)]
fn which(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|p| p.is_file())
}

#[cfg(windows)]
fn detect() -> Vec<ShellInfo> {
    let mut out: Vec<ShellInfo> = Vec::new();

    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
    let pf86 =
        std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());

    // PowerShell 7+ (pwsh) — the modern, cross-platform PowerShell. Listed first
    // so it's the obvious pick over the legacy Windows PowerShell below.
    if let Some(p) = which("pwsh.exe").or_else(|| {
        first_existing(&[
            PathBuf::from(format!(r"{pf}\PowerShell\7\pwsh.exe")),
            PathBuf::from(format!(r"{pf86}\PowerShell\7\pwsh.exe")),
        ])
    }) {
        push_unique(&mut out, "PowerShell 7", p);
    }

    // Windows PowerShell 5.1 (ships with Windows).
    let winps = PathBuf::from(format!(
        r"{sysroot}\System32\WindowsPowerShell\v1.0\powershell.exe"
    ));
    if winps.is_file() {
        push_unique(&mut out, "Windows PowerShell", winps);
    }

    // Command Prompt.
    let cmd = PathBuf::from(format!(r"{sysroot}\System32\cmd.exe"));
    if cmd.is_file() {
        push_unique(&mut out, "Command Prompt", cmd);
    }

    // Git Bash (from Git for Windows). NB: do NOT use a bare `which("bash.exe")`:
    // C:\Windows\System32\bash.exe is the WSL launcher, not Git Bash (WSL is its
    // own entry below). Resolve from the Git install dir instead — either a known
    // location or derived from git.exe on PATH (<git>\{cmd,bin}\git.exe →
    // <git>\bin\bash.exe).
    let git_bash = first_existing(&[
        PathBuf::from(format!(r"{pf}\Git\bin\bash.exe")),
        PathBuf::from(format!(r"{pf86}\Git\bin\bash.exe")),
    ])
    .or_else(|| {
        let git = which("git.exe")?;
        let root = git.parent()?.parent()?;
        let candidate = root.join("bin").join("bash.exe");
        candidate.is_file().then_some(candidate)
    });
    if let Some(p) = git_bash {
        push_unique(&mut out, "Git Bash", p);
    }

    // WSL (default distribution).
    let wsl = PathBuf::from(format!(r"{sysroot}\System32\wsl.exe"));
    if wsl.is_file() {
        push_unique(&mut out, "WSL", wsl);
    }

    // Nushell, if installed.
    if let Some(p) = which("nu.exe") {
        push_unique(&mut out, "Nushell", p);
    }

    out
}

#[cfg(not(windows))]
fn detect() -> Vec<ShellInfo> {
    use std::path::Path;
    let mut out: Vec<ShellInfo> = Vec::new();
    let mut add = |label: &str, path: &str| {
        if Path::new(path).is_file() && !out.iter().any(|s| s.path == path) {
            out.push(ShellInfo {
                label: label.to_string(),
                path: path.to_string(),
            });
        }
    };
    add("Bash", "/bin/bash");
    add("Zsh", "/bin/zsh");
    add("Fish", "/usr/bin/fish");
    add("sh", "/bin/sh");
    if let Ok(s) = std::env::var("SHELL") {
        if Path::new(&s).is_file() && !out.iter().any(|x| x.path == s) {
            out.push(ShellInfo {
                label: "Default ($SHELL)".to_string(),
                path: s,
            });
        }
    }
    out
}

/// List the interactive shells available on this machine, best-first.
#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    detect()
}
