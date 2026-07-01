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
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

/// Emitted to the frontend when a PTY's child exits on its own (not via
/// `pty_close`). Drives the "agent finished" status + notification.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    session_id: u32,
    code: Option<u32>,
}

/// One live terminal session: the master side (for resize), a writer (for
/// keystrokes), the child handle, and its pid (to kill the whole process tree
/// on close — agents spawn subprocesses that `child.kill()` alone would leak).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    pid: Option<u32>,
}

/// Kill a process and all its descendants. On Windows `child.kill()` only
/// terminates the direct shell, so we use `taskkill /T` to take the tree.
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.output();
}
/// On Unix the PTY child is a session leader (portable-pty calls `setsid`), so
/// its pid IS its process-group id. Negating it sends the signal to the whole
/// group — every subprocess the agent spawned — in a single call.
#[cfg(unix)]
fn kill_process_tree(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

/// App-wide PTY state, registered via `.manage()`.
#[derive(Default)]
pub struct PtyManager {
    /// Serializes spawns: ConPTY can stall an output pipe on concurrent spawn.
    spawn_lock: Mutex<()>,
    /// `Arc` so the per-session reader thread can claim the session on EOF to
    /// report the child's exit (see `pty_spawn`).
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
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
    app: AppHandle,
    state: State<'_, PtyManager>,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    shell: Option<String>,
    env: Option<HashMap<String, String>>,
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

    let mut cmd = match shell {
        Some(s) if !s.trim().is_empty() => CommandBuilder::new(s),
        _ => default_shell(),
    };
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }
    if let Some(vars) = env {
        for (k, v) in vars {
            if !k.trim().is_empty() {
                cmd.env(k, v);
            }
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.process_id();
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

    // Insert the session BEFORE starting the reader, so a fast-exiting child
    // can't race the reader's EOF cleanup ahead of the session existing.
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        PtySession {
            master: pair.master,
            writer,
            child,
            pid,
        },
    );

    // Reader thread: pump bytes -> base64 -> frontend until EOF, then report the
    // child's exit. On EOF we claim the session and `wait()` for its code; if it
    // was already removed (pty_close took it) the close was intentional, so we
    // stay silent — "agent finished" only fires on a natural exit.
    let channel = on_output.clone();
    let sessions = Arc::clone(&state.sessions);
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

                    /// Resolve PATH from a login shell (useful on macOS GUI launches where PATH is
                    /// often minimal compared to Terminal.app).
                    #[tauri::command]
                    pub fn detect_login_path(shell: Option<String>) -> Result<String, String> {
                        #[cfg(target_os = "macos")]
                        {
                            let shell_path = shell
                                .filter(|s| !s.trim().is_empty())
                                .or_else(|| std::env::var("SHELL").ok())
                                .unwrap_or_else(|| "/bin/zsh".to_string());
                            let output = Command::new(shell_path)
                                .args(["-l", "-c", "printf %s \"$PATH\""])
                                .output()
                                .map_err(|e| format!("failed to run login shell: {e}"))?;
                            if !output.status.success() {
                                return Err("login shell returned a non-zero exit status".to_string());
                            }
                            let path = String::from_utf8(output.stdout)
                                .map_err(|e| format!("login PATH output was not valid UTF-8: {e}"))?;
                            let path = path.trim().to_string();
                            if path.is_empty() {
                                return Err("login shell PATH was empty".to_string());
                            }
                            Ok(path)
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let _ = shell;
                            Err("login PATH detection is only supported on macOS".to_string())
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let exited = sessions.lock().ok().and_then(|mut s| s.remove(&id));
        if let Some(mut session) = exited {
            let code = session.child.wait().ok().map(|s| s.exit_code());
            let _ = app.emit("pty-exit", PtyExit { session_id: id, code });
        }
    });

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
        if let Some(pid) = session.pid {
            kill_process_tree(pid);
        }
        let _ = session.child.kill();
    }
    Ok(())
}
