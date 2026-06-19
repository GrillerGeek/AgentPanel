//! Phase 0 terminal spike: a minimal cross-platform PTY session manager.
//!
//! On Windows `portable-pty` resolves to ConPTY; on Unix to `openpty`. The same
//! code therefore works everywhere, which is what lets the Rust core stay
//! platform-agnostic (per the AgentPanel plan).
//!
//! Each session spawns a shell, streams its output to the frontend over a Tauri
//! `Channel`, and accepts keystrokes / resizes back via commands. Output bytes
//! are base64-framed so partial UTF-8 / ANSI sequences can't be corrupted in
//! transit; xterm.js reassembles and decodes the byte stream itself.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::State;

/// One live terminal session: the master side (for resize), a writer (for
/// keystrokes), and the child handle (so we can kill the process tree on close).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// App-wide PTY state, registered via `.manage()`.
#[derive(Default)]
pub struct PtyManager {
    /// Serializes spawns: ConPTY can stall an output pipe on concurrent spawn.
    spawn_lock: Mutex<()>,
    sessions: Mutex<HashMap<u32, PtySession>>,
    next_id: Mutex<u32>,
}

/// Pick the default shell. Phase 0 keeps this simple; the plan upgrades this to
/// pwsh -> powershell -> cmd discovery with a user setting in a later phase.
fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        CommandBuilder::new("powershell.exe")
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        CommandBuilder::new(shell)
    }
}

/// Open a new PTY, spawn a shell, and stream its output over `on_output`.
/// Returns an opaque session id used by the other commands.
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyManager>,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    on_output: Channel<String>,
) -> Result<u32, String> {
    // Hold the spawn lock across openpty + spawn (ConPTY race mitigation).
    let _guard = state.spawn_lock.lock().map_err(|e| e.to_string())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = default_shell();
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    // Drop the slave so the only handle keeping the pty open is the master;
    // otherwise the reader never sees EOF when the child exits.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let id = {
        let mut n = state.next_id.lock().map_err(|e| e.to_string())?;
        *n += 1;
        *n
    };

    // Reader thread: pump bytes -> base64 -> frontend until EOF.
    let channel = on_output.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let engine = base64::engine::general_purpose::STANDARD;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: child exited
                Ok(n) => {
                    if channel.send(engine.encode(&buf[..n])).is_err() {
                        break; // frontend channel gone
                    }
                }
                Err(_) => break,
            }
        }
    });

    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );

    Ok(id)
}

/// Forward keystrokes (already UTF-8) from xterm to the shell.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize the PTY when the xterm viewport changes.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close a session and kill its child process.
#[tauri::command]
pub fn pty_close(state: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}
