mod commands;
mod fonts;
mod gh;
mod git;
mod model;
mod pty;
mod shells;
mod store;
mod telemetry;
mod watcher;

use std::ops::Deref;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use store::AppStore;
use tauri::Manager;
use telemetry::Consent;
use watcher::WatcherState;

/// Whether the Rust Sentry SDK actually initialized this session -- captured
/// once at startup (see `init_telemetry`), before `tauri::Builder` runs.
/// `get_telemetry_consent` exposes this so the frontend's JS SDK init is gated
/// on the same startup snapshot rather than the (possibly since-changed) file.
static ACTIVE_THIS_SESSION: OnceLock<bool> = OnceLock::new();

/// Holds the Sentry client alive for the process lifetime. Dropping the
/// `ClientInitGuard` flushes and disables reporting, so it must never go out
/// of scope; a `OnceLock` set once in `run()` and never read again does that.
/// IMPORTANT: never make this droppable (e.g. by moving it into a scoped
/// variable, or wiring a graceful-shutdown path that calls `.close()`) unless
/// the transport it holds still has connect/request timeouts -- a transport
/// without them can hang the dying process on a blocking queue send while
/// draining on drop (see `TimeoutTransportFactory`).
static SENTRY_GUARD: OnceLock<sentry::ClientInitGuard> = OnceLock::new();

pub(crate) fn telemetry_active_this_session() -> bool {
    *ACTIVE_THIS_SESSION.get().unwrap_or(&false)
}

/// Compile-time DSN (docs/superpowers/specs/2026-07-23-crash-reporting-design.md).
/// Absent or empty (dev builds, forks without the `AGENTPANEL_SENTRY_DSN` build
/// secret) means Sentry never initializes even when consent is `granted` --
/// there is no real DSN checked into this repo.
fn sentry_dsn() -> Option<&'static str> {
    option_env!("AGENTPANEL_SENTRY_DSN").filter(|s| !s.is_empty())
}

/// Redact absolute filesystem paths (which leak OS usernames) from an
/// outgoing event's message, exception values/stack-frame paths, and
/// breadcrumbs (message + any string values in `data`) before it is sent.
/// Kept, not dropped -- see `telemetry::scrub_paths` for the rules.
///
/// Breadcrumbs get scrubbed here as defense-in-depth: the JS side disables
/// automatic breadcrumb capture entirely (see src/lib/telemetry.ts), but the
/// Rust SDK's own default integrations (panic, etc.) can still add
/// breadcrumbs directly in this process, bypassing the JS gate.
fn scrub_event(mut event: sentry::protocol::Event<'static>) -> Option<sentry::protocol::Event<'static>> {
    if let Some(msg) = event.message.take() {
        event.message = Some(telemetry::scrub_paths(&msg));
    }
    for exception in event.exception.iter_mut() {
        if let Some(value) = exception.value.take() {
            exception.value = Some(telemetry::scrub_paths(&value));
        }
        if let Some(stacktrace) = exception.stacktrace.as_mut() {
            for frame in stacktrace.frames.iter_mut() {
                if let Some(filename) = frame.filename.take() {
                    frame.filename = Some(telemetry::scrub_paths(&filename));
                }
                if let Some(abs_path) = frame.abs_path.take() {
                    frame.abs_path = Some(telemetry::scrub_paths(&abs_path));
                }
            }
        }
    }
    for breadcrumb in event.breadcrumbs.iter_mut() {
        if let Some(message) = breadcrumb.message.take() {
            breadcrumb.message = Some(telemetry::scrub_paths(&message));
        }
        for value in breadcrumb.data.values_mut() {
            if let sentry::protocol::value::Value::String(s) = value {
                *s = telemetry::scrub_paths(s);
            }
        }
    }
    Some(event)
}

/// Sentry's default reqwest transport (1) builds its `reqwest::Client` (TLS
/// stack setup) synchronously inside `create_transport`, which runs during
/// `sentry::init()` -- i.e. on the startup path, before `tauri::Builder` --
/// and (2) has no connect/request timeouts, so a black-holed endpoint can
/// leave its internal worker stuck and its bounded envelope queue full,
/// which can in turn block a caller's `send_envelope` (e.g. at panic time) on
/// that queue's blocking send.
///
/// This factory fixes (2) directly: the `reqwest::Client` it hands to
/// `ReqwestHttpTransport` has explicit connect + request timeouts, so the
/// worker can never get stuck indefinitely and the queue keeps draining.
///
/// It does NOT fix (1) with a lazy/background-thread-deferred client build.
/// A safe version of that would need to reimplement `ReqwestHttpTransport`'s
/// internal queue/flush/shutdown semantics (both are private to the `sentry`
/// crate) to correctly hand off buffered envelopes once the real client is
/// ready, without a lost-envelope or double-flush race -- reported to Mordain
/// as infeasible to build and verify with confidence in this pass rather than
/// risk a subtly-broken telemetry pipeline. The startup cost this leaves in
/// place is a one-time, single-threaded TLS-stack build (not a per-request or
/// indefinite one), bounded to the pre-Builder init window.
struct TimeoutTransportFactory;

impl sentry::TransportFactory for TimeoutTransportFactory {
    fn create_transport(&self, options: &sentry::ClientOptions) -> Arc<dyn sentry::Transport> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client for Sentry transport");
        Arc::new(sentry::transports::ReqwestHttpTransport::with_client(options, client))
    }
}

/// Read consent and initialize Sentry (if granted and a DSN is compiled in),
/// synchronously before `tauri::Builder` runs -- the panic hook has to be
/// installed before anything can panic. Missing/corrupt consent file reads as
/// `Unset` (fail closed). Returns whether telemetry is actually active this
/// session; this is the single read-once guard -- nothing here re-checks
/// consent mid-session (a change takes effect on next launch).
fn init_telemetry() -> bool {
    let consent = telemetry::read_consent(&telemetry::consent_path());
    let Some(dsn) = sentry_dsn() else {
        #[cfg(debug_assertions)]
        eprintln!("telemetry inactive: no AGENTPANEL_SENTRY_DSN compiled in");
        return false;
    };
    if consent != Consent::Granted {
        #[cfg(debug_assertions)]
        eprintln!("telemetry inactive: consent is {consent:?}, not granted");
        return false;
    }

    // Release format must match the JS SDK's (see src/lib/telemetry.ts's
    // `initTelemetry`) and the CI source-map upload's `--release` value
    // (.github/workflows/release.yml) exactly, or traces from one side won't
    // symbolicate against maps/releases uploaded under the other's name.
    let release = format!("agentpanel@{}", env!("CARGO_PKG_VERSION"));

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(release.into()),
            send_default_pii: false, // no IP address stored
            // Prevent the default `contexts` integration from auto-filling the
            // hostname (it only does so when this is `None`).
            server_name: Some("".into()),
            before_send: Some(Arc::new(scrub_event)),
            transport: Some(Arc::new(TimeoutTransportFactory)),
            ..Default::default()
        },
    ));
    let _ = SENTRY_GUARD.set(guard);
    true
}

/// True when launched with AGENTPANEL_BENCH=1 — the frontend then auto-runs the
/// perf benchmark and reports results via `write_bench`.
#[tauri::command]
fn bench_requested() -> bool {
    std::env::var("AGENTPANEL_BENCH").map(|v| v == "1").unwrap_or(false)
}

/// Write benchmark results (JSON) to a temp file for external collection.
#[tauri::command]
fn write_bench(data: String) {
    let _ = std::fs::write(std::env::temp_dir().join("agentpanel_bench.json"), data);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before the builder: the panic hook (installed by `sentry::init`)
    // has to be in place before anything can panic, and consent has to be
    // read synchronously since no `AppHandle` exists yet to do it async.
    let active_this_session = init_telemetry();
    let _ = ACTIVE_THIS_SESSION.set(active_this_session);

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    // Routes WebView (JS SDK) events through the Rust SDK over Tauri IPC --
    // only meaningful (and only registered) once the Rust SDK is actually up.
    if let Some(client) = SENTRY_GUARD.get().map(|g| g.deref()) {
        builder = builder.plugin(tauri_plugin_sentry::init(client));
    }
    builder
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
            pty::detect_login_path,
            commands::add_repository,
            commands::list_repositories,
            commands::remove_repository,
            commands::list_worktrees,
            commands::create_worktree,
            commands::delete_worktree,
            commands::worktree_status,
            commands::worktree_pr,
            commands::open_in_editor,
            watcher::set_watched_paths,
            shells::list_shells,
            fonts::list_fonts,
            bench_requested,
            write_bench,
            telemetry::get_telemetry_consent,
            telemetry::set_telemetry_consent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
