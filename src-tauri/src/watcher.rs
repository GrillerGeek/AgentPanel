//! Filesystem watching for worktrees. On any change under a watched worktree,
//! we emit a throttled `worktrees-changed` event; the frontend debounces it
//! into a status refresh. A slow poll on the frontend remains as a safety net.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{recommended_watcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatcherState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Ignore derived/noisy directories. Critically, ignoring `.git` breaks a
/// feedback loop: `git status` (run on every refresh) writes `.git/index`,
/// which would otherwise fire an event -> refresh -> write -> event -> ...
fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some(".git" | "node_modules" | "target" | "dist" | ".next" | "build")
        )
    })
}

/// (Re)configure the set of watched worktree paths. Recreates the watcher so the
/// watched set always matches the current worktrees. Per-path watch errors are
/// ignored (a path may have just been removed).
#[tauri::command]
pub fn set_watched_paths(
    app: AppHandle,
    state: State<'_, WatcherState>,
    paths: Vec<String>,
) -> Result<(), String> {
    // Leading-edge throttle: at most one emit per 250ms during a burst.
    let last = Arc::new(Mutex::new(Instant::now() - Duration::from_secs(1)));
    let handle = app.clone();

    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Skip events that touch only ignored paths (derived dirs + .git).
        if !event.paths.iter().any(|p| !is_ignored(p)) {
            return;
        }
        if let Ok(mut last) = last.lock() {
            if last.elapsed() >= Duration::from_millis(400) {
                *last = Instant::now();
                let _ = handle.emit("worktrees-changed", ());
            }
        }
    })
    .map_err(|e| e.to_string())?;

    for p in &paths {
        let _ = watcher.watch(Path::new(p), RecursiveMode::Recursive);
    }

    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}
