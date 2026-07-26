//! Telemetry consent persistence and privacy scrubbing for the opt-in Sentry
//! crash-reporting feature.
//!
//! Consent lives in a small Rust-owned JSON file (sibling of `store.rs`'s
//! data) in the app config directory, e.g. `telemetry.json`:
//! `{ "consent": "unset" | "granted" | "denied" }`. `main.rs` reads this file
//! synchronously, before `tauri::Builder` runs; missing or unparsable file
//! means `Unset`, which means no telemetry (fail closed). Sentry initializes
//! only when consent is `Granted`; a change of consent takes effect on next
//! launch.
//!
//! `scrub_paths` redacts absolute filesystem paths (which leak OS usernames
//! via the home directory) from exception values/messages before they are
//! sent, for both the Rust and TypeScript/JS Sentry SDKs.
//!
//! See docs/superpowers/specs/2026-07-23-crash-reporting-design.md.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Stored/transmitted as a lowercase string: `"unset"`, `"granted"`, `"denied"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Consent {
    Unset,
    Granted,
    Denied,
}

/// On-disk shape of `telemetry.json`.
#[derive(Serialize, Deserialize)]
struct StoredConsent {
    consent: Consent,
}

/// Bundle identifier from `tauri.conf.json`'s `identifier` field -- the same
/// value Tauri's own `app_data_dir()` joins onto the platform data dir.
const BUNDLE_ID: &str = "com.jason.agentpanel";

/// Resolve the real `telemetry.json` location. No `AppHandle` exists yet at
/// the point this is needed (before `tauri::Builder` runs), so this
/// recomputes the same directory Tauri's `app_data_dir()` would resolve to,
/// rather than going through Tauri.
pub fn consent_path() -> PathBuf {
    platform_data_dir().join(BUNDLE_ID).join("telemetry.json")
}

#[cfg(target_os = "windows")]
fn platform_data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_os = "macos")]
fn platform_data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"))
        .unwrap_or_else(|| PathBuf::from("."))
}

// minimal: XDG fallback only; Linux isn't a shipped bundle target today (see
// tauri.conf.json's bundle.targets), but this keeps dev builds/CI on Linux
// runners resolvable instead of panicking.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn platform_data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Read consent from `path`. A missing file or one that fails to parse
/// (corrupt JSON, or an unrecognized `consent` value) is treated as `Unset`
/// (fail closed, no telemetry) -- never an error.
pub fn read_consent(path: &Path) -> Consent {
    let Ok(data) = fs::read_to_string(path) else {
        return Consent::Unset;
    };
    serde_json::from_str::<StoredConsent>(&data)
        .map(|s| s.consent)
        .unwrap_or(Consent::Unset)
}

/// Persist `consent` to `path` as JSON.
pub fn write_consent(path: &Path, consent: Consent) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json =
        serde_json::to_string_pretty(&StoredConsent { consent }).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Path segments that mark the project/app root in a stack frame -- when one
/// of these appears in a path, everything before it is stripped rather than
/// just redacting the home directory.
fn is_project_marker(segment: &str) -> bool {
    matches!(segment, "agentpanel" | "AgentPanel" | "src-tauri" | "src")
}

/// Matches an absolute path rooted at any recognized home/mount prefix:
/// macOS/Unix `/Users/name/...`, Windows `C:\Users\name\...` or
/// `C:/Users/name/...` (any drive letter case, either separator),
/// Linux `/home/name/...` and `/root` (no separate username segment -- it's
/// the root account's own home dir), macOS volume mounts `/Volumes/name/...`,
/// and Windows UNC shares `\\server\share\...`. Captures the whole
/// whitespace-delimited path token so trailing `:line:col` survives redaction.
fn home_path_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?:/Users/|/home/|/Volumes/|/root\b|[A-Za-z]:[\\/]Users[\\/]|\\\\[^\\/\s]+\\[^\\/\s]+)[^\s]*",
        )
        .unwrap()
    })
}

/// Safety-net check used after the main redaction pass: if any of the
/// recognized home/mount prefixes still survives (any drive-letter case,
/// either Windows separator), the text couldn't be scrubbed confidently.
fn unscrubbed_marker_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?:/Users/|/home/|/Volumes/|/root\b|[A-Za-z]:[\\/]Users[\\/]|\\\\[^\\/\s]+\\[^\\/\s]+)",
        )
        .unwrap()
    })
}

/// How many leading path segments make up the home/mount prefix to fold into
/// `~`, given the token already split on its separator. Two-segment prefixes
/// (`Users`/`home`/`Volumes` + the following name segment) fold both; `root`
/// is a one-segment prefix (`/root` **is** the home dir, no name follows);
/// UNC shares fold the leading `("", "", server, share)` run.
fn home_prefix_fold_len(segments: &[&str]) -> Option<usize> {
    if let Some(idx) = segments.iter().position(|s| matches!(*s, "Users" | "home" | "Volumes")) {
        return Some((idx + 2).min(segments.len()));
    }
    if let Some(idx) = segments.iter().position(|s| *s == "root") {
        return Some(idx + 1);
    }
    if segments.len() >= 4 && segments[0].is_empty() && segments[1].is_empty() {
        // Leading "\\server\share" splits (on '\\') into ["", "", server, share, ...].
        return Some(4);
    }
    None
}

/// Redact a single matched path token: strip everything before a project-root
/// marker segment when one is present; otherwise fall back to home/mount
/// redaction (replace the recognized prefix with `~`).
fn redact_path_token(token: &str) -> String {
    let sep = if token.contains('\\') { '\\' } else { '/' };
    let sep_str = sep.to_string();
    let segments: Vec<&str> = token.split(sep).collect();

    if let Some(marker_idx) = segments.iter().position(|s| is_project_marker(s)) {
        return segments[marker_idx..].join(&sep_str);
    }

    match home_prefix_fold_len(&segments) {
        Some(fold_len) => {
            let rest = &segments[fold_len..];
            if rest.is_empty() {
                "~".to_string()
            } else {
                format!("~{sep}{}", rest.join(&sep_str))
            }
        }
        None => token.to_string(),
    }
}

/// Redact home-directory/mount-point segments from Windows-, macOS- and
/// Linux-style absolute paths appearing anywhere in `input` (exception
/// values, messages, stack frames) -- see `home_path_re` for the recognized
/// prefixes. Non-path text is left intact. If, after redaction, one of those
/// prefixes still survives (i.e. the message can't be scrubbed with
/// confidence), the string is truncated at that point rather than sent with a
/// username/host attached.
pub fn scrub_paths(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last = 0;
    for m in home_path_re().find_iter(input) {
        out.push_str(&input[last..m.start()]);
        out.push_str(&redact_path_token(m.as_str()));
        last = m.end();
    }
    out.push_str(&input[last..]);

    if let Some(m) = unscrubbed_marker_re().find(&out) {
        out.truncate(m.start());
    }
    out
}

/// Response shape for the `get_telemetry_consent` command: the current file
/// value plus whether the Rust SDK actually initialized this session (the
/// value captured at startup, before this file could have changed).
#[derive(Debug, Clone, Serialize)]
pub struct TelemetryConsentInfo {
    pub consent: Consent,
    pub active_this_session: bool,
}

#[tauri::command]
pub fn get_telemetry_consent() -> TelemetryConsentInfo {
    TelemetryConsentInfo {
        consent: read_consent(&consent_path()),
        active_this_session: crate::telemetry_active_this_session(),
    }
}

/// Update the consent file. The frontend never touches the file directly;
/// this is the only write path. Takes effect on next launch -- it does not
/// retroactively start or stop reporting this session (see module docs).
#[tauri::command]
pub fn set_telemetry_consent(consent: Consent) -> Result<(), String> {
    write_consent(&consent_path(), consent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentpanel_telemetry_test_{}_{}.json",
            std::process::id(),
            name
        ))
    }

    // --- read_consent: file read/parse behavior -----------------------

    #[test]
    fn missing_file_reads_as_unset() {
        let path = tmp_path("missing");
        let _ = fs::remove_file(&path);
        assert_eq!(read_consent(&path), Consent::Unset);
    }

    #[test]
    fn corrupt_json_reads_as_unset() {
        let path = tmp_path("corrupt");
        fs::write(&path, "{ this is not valid json").unwrap();
        assert_eq!(read_consent(&path), Consent::Unset);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn unrecognized_consent_value_reads_as_unset() {
        let path = tmp_path("badvalue");
        fs::write(&path, r#"{"consent": "maybe"}"#).unwrap();
        assert_eq!(read_consent(&path), Consent::Unset);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn explicit_unset_value_reads_as_unset() {
        let path = tmp_path("explicit_unset");
        fs::write(&path, r#"{"consent": "unset"}"#).unwrap();
        assert_eq!(read_consent(&path), Consent::Unset);
        let _ = fs::remove_file(&path);
    }

    // --- write_consent / read_consent round trip -----------------------

    #[test]
    fn round_trip_granted() {
        let path = tmp_path("granted");
        write_consent(&path, Consent::Granted).unwrap();
        assert_eq!(read_consent(&path), Consent::Granted);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn round_trip_denied() {
        let path = tmp_path("denied");
        write_consent(&path, Consent::Denied).unwrap();
        assert_eq!(read_consent(&path), Consent::Denied);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn round_trip_unset() {
        let path = tmp_path("unset_roundtrip");
        write_consent(&path, Consent::Unset).unwrap();
        assert_eq!(read_consent(&path), Consent::Unset);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn write_then_overwrite_reflects_latest_value() {
        let path = tmp_path("overwrite");
        write_consent(&path, Consent::Granted).unwrap();
        assert_eq!(read_consent(&path), Consent::Granted);
        write_consent(&path, Consent::Denied).unwrap();
        assert_eq!(read_consent(&path), Consent::Denied);
        let _ = fs::remove_file(&path);
    }

    // --- scrub_paths: home-directory / username redaction ---------------
    //
    // The spec does not pin down the exact replacement token (e.g. "~",
    // "<home>", or something else) used when a path is scrubbed -- only that
    // the username/home directory must not survive, and that messages are
    // "kept but path-scrubbed" (not dropped). These tests assert that
    // invariant rather than an exact scrubbed string, since asserting a
    // specific token would be guessing at an unstated resolution.

    #[test]
    fn scrub_paths_redacts_macos_username() {
        let input = "Error at /Users/jane/dev/agentpanel/src-tauri/src/main.rs:42";
        let out = scrub_paths(input);
        assert!(!out.contains("jane"), "username should be redacted: {out}");
        assert!(!out.contains("/Users/jane"), "home dir should be redacted: {out}");
    }

    #[test]
    fn scrub_paths_redacts_windows_username() {
        let input = r"Error at C:\Users\jane\dev\agentpanel\src-tauri\src\main.rs:42";
        let out = scrub_paths(input);
        assert!(!out.contains("jane"), "username should be redacted: {out}");
        assert!(
            !out.contains(r"C:\Users\jane"),
            "home dir should be redacted: {out}"
        );
    }

    #[test]
    fn scrub_paths_keeps_message_text_intact() {
        let input = "panic: index out of bounds for /Users/jane/repo/src/lib.rs";
        let out = scrub_paths(input);
        assert!(
            out.contains("panic: index out of bounds"),
            "non-path message text should be preserved: {out}"
        );
        assert!(!out.contains("jane"));
    }

    // --- scrub_paths: additional home/mount prefixes (fix round h) ------

    #[test]
    fn scrub_paths_redacts_linux_home_username() {
        let input = "Error at /home/jane/dev/agentpanel/src/lib.rs:10";
        let out = scrub_paths(input);
        assert!(!out.contains("jane"), "username should be redacted: {out}");
        assert!(!out.contains("/home/jane"), "home dir should be redacted: {out}");
    }

    #[test]
    fn scrub_paths_redacts_root_home() {
        let input = "Error at /root/repo/src/lib.rs:10";
        let out = scrub_paths(input);
        assert!(!out.contains("/root"), "root home dir should be redacted: {out}");
    }

    #[test]
    fn scrub_paths_redacts_macos_volume_mount() {
        let input = "Error at /Volumes/Untitled/dev/agentpanel/src/lib.rs:10";
        let out = scrub_paths(input);
        assert!(!out.contains("Untitled"), "volume name should be redacted: {out}");
        assert!(!out.contains("/Volumes/Untitled"), "mount prefix should be redacted: {out}");
    }

    #[test]
    fn scrub_paths_redacts_unc_share() {
        let input = r"Error at \\build-server\repos\agentpanel\src\lib.rs:10";
        let out = scrub_paths(input);
        assert!(!out.contains("build-server"), "server name should be redacted: {out}");
        assert!(!out.contains("repos"), "share name should be redacted: {out}");
    }

    #[test]
    fn scrub_paths_redacts_lowercase_drive_forward_slash_windows_path() {
        // Lowercase drive letter + forward-slash separator (Git-Bash-style
        // paths); regression coverage for the widened truncation backstop,
        // which previously only matched uppercase `[A-Z]:\Users\`.
        let input = "Error at c:/Users/jane/dev/agentpanel/src/lib.rs:10";
        let out = scrub_paths(input);
        assert!(!out.contains("jane"), "username should be redacted: {out}");
    }
}
