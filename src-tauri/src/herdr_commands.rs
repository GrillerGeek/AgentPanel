//! Tauri boundary. Numeric viewer handles are ephemeral; core bindings persist
//! in the pane's session record. A disconnect is never a terminate request.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, atomic::{AtomicU32, Ordering}};
use serde::Serialize;
use tauri::{State, ipc::Channel};
use crate::herdr::{self, Binding, Connection, Control, Event, Options};

#[derive(Default)]
pub struct HerdrManager {
    opens: tokio::sync::Mutex<()>,
    viewers: Mutex<HashMap<u32, Arc<Connection>>>,
    next: AtomicU32,
}

impl HerdrManager {
    fn viewer(&self, id: u32) -> Result<Arc<Connection>, String> {
        self.viewers.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("Herdr viewer is detached".into())
    }

    async fn terminate(&self, id: u32) -> Result<(), String> {
        // An absent handle is not evidence that its runtime process stopped.
        // Retain known completed handles until the viewer detaches, so a
        // duplicate cleanup remains idempotent without accepting unknown IDs.
        self.viewer(id)?.terminate().await
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult { id: u32, binding: Binding, created: bool }

#[tauri::command]
pub async fn herdr_open(state: State<'_, HerdrManager>, options: Options, rows: u16, cols: u16,
                        on_event: Channel<Event>) -> Result<OpenResult, String> {
    let _guard = state.opens.lock().await;
    let opened = herdr::open(options, rows.max(1), cols.max(1), move |event| on_event.send(event).is_ok()).await?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.viewers.lock().map_err(|e| e.to_string())?.insert(id, Arc::new(opened.connection));
    Ok(OpenResult { id, binding: opened.binding, created: opened.created })
}

#[tauri::command]
pub fn herdr_write(state: State<'_, HerdrManager>, id: u32, data: String) -> Result<(), String> {
    if data.len() > 65536 { return Err("Herdr paste exceeds the prototype's 64 KiB input limit".into()); }
    state.viewer(id)?.send(Control::Input(data))
}

#[tauri::command]
pub fn herdr_resize(state: State<'_, HerdrManager>, id: u32, rows: u16, cols: u16) -> Result<(), String> {
    state.viewer(id)?.send(Control::Resize(rows.max(1), cols.max(1)))
}

#[tauri::command]
pub async fn herdr_ack(state: State<'_, HerdrManager>, id: u32, bytes: usize) -> Result<(), String> {
    if bytes > 65536 { return Err("Invalid Herdr credit amount".into()); }
    state.viewer(id)?.sender.send(Control::Ack(bytes)).await.map_err(|_| "Herdr viewer disconnected".into())
}

#[tauri::command]
pub fn herdr_detach(state: State<'_, HerdrManager>, id: u32) -> Result<(), String> {
    if let Some(viewer) = state.viewers.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = viewer.send(Control::Detach);
    }
    Ok(())
}

#[tauri::command]
pub async fn herdr_terminate(state: State<'_, HerdrManager>, id: u32) -> Result<(), String> {
    state.terminate(id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_handle_cannot_authorize_worktree_deletion() {
        let manager = HerdrManager::default();
        assert!(manager.terminate(42).await.unwrap_err().contains("detached"));
    }
}
