mod commands;
mod gh;
mod git;
mod model;
mod pty;
mod store;
mod watcher;

use store::AppStore;
use tauri::Manager;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::default())
        .manage(AppStore::default())
        .manage(WatcherState::default())
        .setup(|app| {
            // Load persisted repositories into the in-memory store.
            let handle = app.handle().clone();
            let repos = store::load(&handle);
            *app.state::<AppStore>().repos.lock().unwrap() = repos;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            commands::add_repository,
            commands::list_repositories,
            commands::remove_repository,
            commands::list_worktrees,
            commands::create_worktree,
            commands::delete_worktree,
            commands::worktree_status,
            commands::worktree_pr,
            watcher::set_watched_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
