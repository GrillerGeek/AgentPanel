//! Per-pane terminal scrollback, persisted under the app-data directory.
//!
//! One file per pane (`scrollback/<paneId>.txt`) rather than localStorage: a
//! busy agent pane serializes to hundreds of kilobytes, and localStorage is a
//! ~5 MB budget already shared with settings, notes, and the session. A quota
//! error there would take that other state down with it.
//!
//! This writes terminal output to disk in plain text. It never leaves the
//! machine, but the feature is toggleable and purgeable for exactly that
//! reason (see Settings).

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Keep the newest 256 KiB of a pane's buffer. Enough for a long agent run;
/// small enough that dozens of panes cannot fill a disk.
const MAX_BYTES: usize = 256 * 1024;

/// Pane ids are minted by the frontend (`p1`, `p2`, …) and become file names.
///
/// Validate rather than sanitize: an id outside this shape is either a bug or
/// an attempt at path traversal, and in both cases it must not reach the
/// filesystem. Rejecting is safe — the worst case is one pane without
/// persisted scrollback.
fn is_safe_pane_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `<app-data>/scrollback/`, created on demand.
fn scrollback_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?
        .join("scrollback");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Trim to the last `MAX_BYTES`, cutting at a line boundary so a restored
/// buffer never opens mid-escape-sequence — a half-written ANSI sequence would
/// corrupt the colours of everything printed after it.
fn trim_to_cap(data: &str) -> &str {
    if data.len() <= MAX_BYTES {
        return data;
    }
    // Slicing a &str at a non-char-boundary panics, so walk forward first.
    let mut start = data.len() - MAX_BYTES;
    while start < data.len() && !data.is_char_boundary(start) {
        start += 1;
    }
    let tail = &data[start..];
    match tail.find('\n') {
        Some(i) => &tail[i + 1..],
        None => tail,
    }
}

/// Persist one pane's serialized buffer, truncated to the cap.
#[tauri::command]
pub fn scrollback_save(app: AppHandle, pane_id: String, data: String) -> Result<(), String> {
    if !is_safe_pane_id(&pane_id) {
        return Err(format!("refusing unsafe pane id: {pane_id}"));
    }
    let path = scrollback_dir(&app)?.join(format!("{pane_id}.txt"));
    fs::write(path, trim_to_cap(&data)).map_err(|e| e.to_string())
}

/// Read a pane's saved buffer. A missing or unreadable file is an empty
/// string, never an error — a pane with no history is the normal case.
#[tauri::command]
pub fn scrollback_load(app: AppHandle, pane_id: String) -> Result<String, String> {
    if !is_safe_pane_id(&pane_id) {
        return Ok(String::new());
    }
    let path = scrollback_dir(&app)?.join(format!("{pane_id}.txt"));
    Ok(fs::read_to_string(path).unwrap_or_default())
}

/// Delete every saved buffer whose pane id is not in `keep`.
#[tauri::command]
pub fn scrollback_prune(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    let dir = scrollback_dir(&app)?;
    let keep: HashSet<String> = keep.into_iter().collect();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".txt") else {
            continue;
        };
        if !keep.contains(id) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Delete everything. Backs the Settings purge button, and runs when the
/// feature is switched off.
#[tauri::command]
pub fn scrollback_clear(app: AppHandle) -> Result<(), String> {
    let dir = scrollback_dir(&app)?;
    let _ = fs::remove_dir_all(&dir);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_buffers_whole() {
        assert_eq!(trim_to_cap("hello\nworld\n"), "hello\nworld\n");
        assert_eq!(trim_to_cap(""), "");
    }

    #[test]
    fn keeps_the_tail_of_an_oversized_buffer() {
        let big = "x".repeat(MAX_BYTES) + "\nTHE END\n";
        let out = trim_to_cap(&big);
        assert!(out.len() <= MAX_BYTES);
        assert!(out.ends_with("THE END\n"), "the recent output is what survives");
    }

    #[test]
    fn cuts_at_a_line_boundary() {
        // Lines of 10 bytes each, well past the cap.
        let big: String = (0..(MAX_BYTES / 10 + 50)).map(|_| "123456789\n").collect();
        let out = trim_to_cap(&big);
        assert!(out.starts_with('1'), "must not start mid-line: {:?}", &out[..4.min(out.len())]);
    }

    #[test]
    fn never_splits_a_multibyte_character() {
        // A wall of 3-byte characters guarantees the naive cut point is not a
        // char boundary.
        let big: String = "☃".repeat(MAX_BYTES);
        let out = trim_to_cap(&big);
        assert!(out.chars().all(|c| c == '☃'), "no replacement or panic");
    }

    #[test]
    fn accepts_generated_pane_ids_and_rejects_path_traversal() {
        assert!(is_safe_pane_id("p1"));
        assert!(is_safe_pane_id("p12345"));
        assert!(is_safe_pane_id("pane_id-9"));

        assert!(!is_safe_pane_id(""));
        assert!(!is_safe_pane_id(".."));
        assert!(!is_safe_pane_id("../../etc/passwd"));
        assert!(!is_safe_pane_id("a/b"));
        assert!(!is_safe_pane_id("a\\b"));
        assert!(!is_safe_pane_id("a.txt"));
        assert!(!is_safe_pane_id(&"p".repeat(65)));
    }
}
