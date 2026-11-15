//! Experimental local herdr-core generation 1 client. No installer, shell
//! wrapper, or TCP listener. Dropping a viewer never kills its terminal.
use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot};

const MAX_FRAME: usize = 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(10);

#[cfg(test)]
#[path = "herdr_tests.rs"]
mod tests;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub core_id: String, pub address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub executable: String,
    pub session: String,
    pub key: String,
    pub cwd: String,
    pub shell: String,
    pub env: HashMap<String, String>,
    pub binding: Option<Binding>,
    #[serde(default)]
    pub attach_only: bool,
    #[serde(default)]
    pub target: Option<RemoteTarget>,
    #[serde(default)]
    pub existing_only: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Endpoint { pub executable: String, pub session: String }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTarget {
    pub endpoint: Endpoint,
    pub core_id: String,
    pub machine: String,
    pub machine_id: String,
    pub session: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Event {
    Output { data: String, bytes: usize },
    Status { state: Option<String> },
    Closed { reason: String, code: Option<u32> },
    Disconnected { message: String },
}

struct Frame { channel: u32, kind: u8, data: Vec<u8> }

async fn read_frame(reader: &mut (impl AsyncRead + Unpin)) -> Result<Frame, String> {
    let channel = reader.read_u32_le().await.map_err(|e| e.to_string())?;
    let kind = reader.read_u8().await.map_err(|e| e.to_string())?;
    let size = reader.read_u32_le().await.map_err(|e| e.to_string())? as usize;
    if size > MAX_FRAME { return Err("Herdr frame exceeds the prototype's 1 MiB limit".into()); }
    let mut data = vec![0; size];
    reader.read_exact(&mut data).await.map_err(|e| e.to_string())?;
    Ok(Frame { channel, kind, data })
}

async fn write_frame(writer: &mut (impl AsyncWrite + Unpin), channel: u32, kind: u8, data: &[u8]) -> Result<(), String> {
    tokio::time::timeout(DEADLINE, async {
        writer.write_u32_le(channel).await?;
        writer.write_u8(kind).await?;
        writer.write_u32_le(data.len() as u32).await?;
        writer.write_all(data).await?;
        writer.flush().await
    }).await.map_err(|_| "Herdr write timed out".to_string())?.map_err(|e| e.to_string())
}

async fn request(writer: &mut ChildStdin, reader: &mut BufReader<ChildStdout>, method: &str, params: Value,
                 early: &mut Vec<Frame>) -> Result<Value, String> {
    let data = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params})).unwrap();
    write_frame(writer, 0, 0, &data).await?;
    tokio::time::timeout(DEADLINE, async {
        loop {
            let frame = read_frame(reader).await?;
            if frame.channel == 0 && frame.kind == 0 {
                let value: Value = serde_json::from_slice(&frame.data).map_err(|e| e.to_string())?;
                if value["id"] != 1 { return Err("Unexpected Herdr response id".into()); }
                if let Some(error) = value.get("error") { return Err(error.to_string()); }
                return value.get("result").cloned().ok_or("Missing Herdr result".into());
            }
            if early.iter().map(|f| f.data.len()).sum::<usize>() + frame.data.len() > MAX_FRAME {
                return Err("Herdr setup output exceeds buffer limit".into());
            }
            early.push(frame);
        }
    }).await.map_err(|_| "Herdr request timed out; delivery may be uncertain. Reconnect before retrying.".to_string())?
}

pub enum Control {
    Input(String), Resize(u16, u16), Ack(usize), Detach,
    Terminate(oneshot::Sender<Result<(), String>>),
}

pub struct Connection { pub sender: mpsc::Sender<Control>, finished: Arc<AtomicBool>, attach_only: bool }

impl Connection {
    pub async fn terminate(&self) -> Result<(), String> {
        if self.attach_only { return Err("This terminal may only be detached from AgentPanel".into()); }
        if self.finished.load(Ordering::Acquire) { return Ok(()); }
        let (sender, reply) = oneshot::channel();
        self.send(Control::Terminate(sender))?;
        tokio::time::timeout(DEADLINE, reply).await
            .map_err(|_| "Herdr termination timed out; process state is uncertain".to_string())?
            .map_err(|_| "Herdr disconnected before confirming termination".to_string())?
    }
    pub fn send(&self, control: Control) -> Result<(), String> {
        self.sender.try_send(control).map_err(|_| "Herdr connection unavailable or input queue full; reconnect before retrying".into())
    }
}

pub struct Opened { pub connection: Connection, pub binding: Binding, pub created: bool }

fn validate(options: &Options) -> Result<(), String> {
    validate_endpoint(&options.executable, &options.session)?;
    if options.attach_only && options.binding.is_none() { return Err("Attaching requires an existing terminal binding".into()); }
    if options.key.len() != 32 || !options.key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid persistent pane identity".into());
    }
    // Imported paths belong to the destination OS, not necessarily this OS.
    if options.cwd.is_empty() || (!options.attach_only && options.target.is_none() && !std::path::Path::new(&options.cwd).is_absolute()) {
        return Err("Herdr requires an absolute worktree path".into());
    }
    if let Some(target) = &options.target {
        if options.executable != target.endpoint.executable || options.session != target.endpoint.session {
            return Err("Remote terminal endpoint changed".into());
        }
    }
    Ok(())
}

fn validate_endpoint(executable: &str, session: &str) -> Result<(), String> {
    if executable.trim().is_empty() { return Err("Set the herdr-core executable in Settings".into()); }
    if session.is_empty() || session.len() > 32 ||
        !session.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Herdr session must contain 1–32 letters, numbers, hyphens, or underscores".into());
    }
    Ok(())
}

async fn connect(executable: &str, session: &str) -> Result<(Child, ChildStdin, BufReader<ChildStdout>, Value), String> {
    validate_endpoint(executable, session)?;
    if cfg!(windows) { return Err("Herdr prototype is not enabled on Windows yet (ConPTY input acceptance pending)".into()); }
    let resolved = crate::herdr_executable::resolve(executable)?;
    let mut command = Command::new(&resolved);
    command.arg("connect").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    // Never attach to an inherited agent session or endpoint accidentally.
    for (key, _) in std::env::vars() {
        if key.starts_with("HC_") || key.starts_with("HERDR_") { command.env_remove(key); }
    }
    command.env("HC_SESSION", session);
    let mut child = command.spawn().map_err(|e| crate::herdr_executable::launch_error(&resolved.to_string_lossy(), &e))?;
    let mut writer = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let hello = tokio::time::timeout(DEADLINE, async {
        writer.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"hello\",\"params\":{\"framed\":true,\"generation\":1}}\n").await.map_err(|e| e.to_string())?;
        writer.flush().await.map_err(|e| e.to_string())?;
        let mut line = Vec::new();
        loop {
            let byte = reader.read_u8().await.map_err(|e| e.to_string())?;
            if byte == b'\n' { break; }
            line.push(byte);
            if line.len() > 65536 { return Err("Herdr handshake too large".to_string()); }
        }
        let hello: Value = serde_json::from_slice(&line).map_err(|e| e.to_string())?;
        let hello = hello["result"].clone();
        if hello["generation"] != 1 || hello["framed"] != true { return Err("Incompatible Herdr protocol".into()); }
        Ok::<Value, String>(hello)
    }).await.map_err(|_| "Herdr handshake timed out".to_string())??;
    Ok((child, writer, reader, hello))
}

/// An explicit refresh of the selected core; never reads screen contents or
/// creates terminals, installs runtimes, changes labels, or edits SSH profiles.
pub async fn inventory(endpoint: Endpoint) -> Result<Value, String> {
    let (mut child, mut writer, mut reader, hello) = connect(&endpoint.executable, &endpoint.session).await?;
    let mut early = Vec::new();
    let result = async {
        let machines = request(&mut writer, &mut reader, "machine.list", json!({}), &mut early).await?;
        let terminals = request(&mut writer, &mut reader, "terminal.list", json!({}), &mut early).await?;
        let machines = machines["machines"].as_array().ok_or("Invalid machine inventory")?.iter().map(|m| json!({
            "name":m["name"],"coreId":m["id"],"host":m["host"],"session":m["session"],
            "state":m["state"],"why":m["why"]
        })).collect::<Vec<_>>();
        let terminals = terminals["terminals"].as_array().ok_or("Invalid terminal inventory")?.iter().map(|t| json!({
            "address":t["address"],"cwd":t["cwd"],"title":t["title"],"state":t["state"],
            "status":t["status"]["state"]
        })).collect::<Vec<_>>();
        Ok(json!({"coreId":hello["core"]["id"],"coreName":hello["core"]["name"],"machines":machines,"terminals":terminals}))
    }.await;
    let _ = child.kill().await; // Only the disposable `hc connect` viewer.
    result
}

fn validate_machine(binding: &Binding, machines: &Value) -> Result<(), String> {
    if let Some((name, _)) = binding.address.split_once('/') {
        let machine = machines["machines"].as_array().and_then(|items| items.iter().find(|m| m["name"] == name))
            .ok_or("Saved machine is no longer configured")?;
        let expected = binding.machine_id.as_deref().filter(|s| !s.is_empty()).ok_or("Saved remote terminal is missing machine identity")?;
        if machine["id"].as_str() != Some(expected) {
            return Err("Saved terminal belongs to another machine. No replacement was started.".into());
        }
        if machine["state"] != "connected" { return Err("Machine is offline or needs login. Refresh Machines after signing in with Herdr/OpenSSH.".into()); }
    }
    Ok(())
}

async fn check_target(target: &RemoteTarget, hello: &Value, writer: &mut ChildStdin,
                      reader: &mut BufReader<ChildStdout>, early: &mut Vec<Frame>) -> Result<(), String> {
    if target.core_id.is_empty() || hello["core"]["id"] != target.core_id {
        return Err("Remote project belongs to another local core. No fallback was used.".into());
    }
    if target.machine.is_empty() || target.machine.contains('/') || target.machine_id.is_empty() {
        return Err("Remote project is missing machine identity".into());
    }
    let machines = request(writer, reader, "machine.list", json!({}), early).await?;
    validate_machine(&Binding { core_id: target.core_id.clone(), address: format!("{}/identity", target.machine),
        machine_id: Some(target.machine_id.clone()) }, &machines)
}

pub(crate) static REMOTE_OPERATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

static REMOTE_QUERIES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Internal, bounded remote transport. Read queries and explicit checkout
/// mutations share identity validation; no generic command API is exposed
/// through Tauri. Mutations never retry or attempt recursive cleanup.
pub(crate) struct RemoteGit {
    _child: Child, writer: ChildStdin, reader: BufReader<ChildStdout>, early: Vec<Frame>,
    target: RemoteTarget, _permit: tokio::sync::SemaphorePermit<'static>,
}

impl RemoteGit {
    pub(crate) async fn connect(target: &RemoteTarget) -> Result<Self, String> {
        let permit = tokio::time::timeout(Duration::from_secs(2), REMOTE_QUERIES.acquire()).await
            .map_err(|_| "Remote Git queries are busy; refresh to retry".to_string())?.map_err(|e| e.to_string())?;
        let (child, mut writer, mut reader, hello) = connect(&target.endpoint.executable, &target.endpoint.session).await?;
        let mut early = Vec::new();
        check_target(target, &hello, &mut writer, &mut reader, &mut early).await?;
        Ok(Self { _child: child, writer, reader, early, target: target.clone(), _permit: permit })
    }

    pub(crate) async fn output(&mut self, path: &str, args: &[&str]) -> Result<(i64, String, String), String> {
        let mut argv = vec!["git", "--no-pager", "--literal-pathspecs", "-c", "core.fsmonitor=false",
            "-c", "core.untrackedCache=false", "-c", "core.quotepath=false", "-C", path];
        argv.extend_from_slice(args);
        let result = request(&mut self.writer, &mut self.reader, "machine.exec", json!({
            "on":self.target.machine,"argv":argv,"timeout":5,
            "env":{"GIT_OPTIONAL_LOCKS":"0","LC_ALL":"C"}
        }), &mut self.early).await?;
        if result["timed_out"] == true || result["truncated"] == true {
            return Err("Remote Git output exceeded its time or size limit; results are unavailable".into());
        }
        let decode = |key: &str| -> Result<String, String> {
            let data = base64::engine::general_purpose::STANDARD.decode(result[key].as_str().ok_or("Invalid remote Git response")?)
                .map_err(|e| e.to_string())?;
            String::from_utf8(data).map_err(|_| "Remote Git returned non-UTF-8 data".into())
        };
        Ok((result["code"].as_i64().ok_or("Remote Git ended without an exit code")?, decode("stdout")?, decode("stderr")?))
    }

    pub(crate) async fn terminals(&mut self) -> Result<Value, String> {
        request(&mut self.writer, &mut self.reader, "terminal.list", json!({"all":true}), &mut self.early).await
    }

    pub(crate) async fn command(&mut self, argv: &[&str]) -> Result<(), String> {
        let result = request(&mut self.writer, &mut self.reader, "machine.exec", json!({
            "on":self.target.machine,"argv":argv,"timeout":5
        }), &mut self.early).await?;
        if result["code"] != 0 || result["timed_out"] == true || result["truncated"] == true {
            return Err("Remote directory preparation failed; refresh and inspect the destination before retrying".into());
        }
        Ok(())
    }

    pub(crate) async fn mutate(&mut self, path: &str, args: &[&str]) -> Result<(), String> {
        let mut safe = vec!["-c", "core.hooksPath=/dev/null", "-c", "submodule.recurse=false"];
        safe.extend_from_slice(args);
        self.git(path, &safe).await.map(|_| ()).map_err(|error|
            format!("{error}. Remote operation may have partially completed; refresh and inspect before retrying. No automatic retry or cleanup was attempted."))
    }

    pub(crate) async fn git(&mut self, path: &str, args: &[&str]) -> Result<String, String> {
        let (code, out, error) = self.output(path, args).await?;
        if code != 0 { return Err(format!("Remote Git failed: {}", error.trim())); }
        Ok(out)
    }
}

/// Serialized by the Tauri manager to avoid simultaneous creation of the same
/// pane. The unique core name also prevents duplicates across app processes.
pub async fn open(options: Options, rows: u16, cols: u16,
                  emit: impl Fn(Event) -> bool + Send + Sync + 'static) -> Result<Opened, String> {
    validate(&options)?;
    let _remote_guard = if options.target.is_some() && options.binding.is_none() {
        Some(REMOTE_OPERATIONS.lock().await)
    } else { None };
    let (child, mut writer, mut reader, hello) = connect(&options.executable, &options.session).await?;
    let (binding, created, channel, events, early) = tokio::time::timeout(DEADLINE * 3, async {
        for needed in ["terminal.list", "terminal.get", "terminal.run", "terminal.attach", "terminal.kill", "events.subscribe"] {
            if !hello["methods"].as_array().is_some_and(|a| a.iter().any(|m| m == needed)) {
                return Err(format!("Herdr does not support {needed}"));
            }
        }
        let core_id = hello["core"]["id"].as_str().ok_or("Herdr omitted core identity")?.to_string();
        let mut early = Vec::new();
        if let Some(target) = &options.target {
            check_target(target, &hello, &mut writer, &mut reader, &mut early).await?;
            if options.binding.as_ref().is_some_and(|b| b.machine_id.as_ref() != Some(&target.machine_id) ||
                !b.address.starts_with(&format!("{}/", target.machine))) {
                return Err("Saved terminal belongs to another machine".into());
            }
        }
        let (terminal, created) = if let Some(binding) = &options.binding {
            if binding.core_id != core_id { return Err("Saved terminal belongs to another core. No replacement was started.".into()); }
            if options.attach_only {
                let machines = request(&mut writer, &mut reader, "machine.list", json!({}), &mut early).await?;
                validate_machine(binding, &machines)?;
            }
            (request(&mut writer, &mut reader, "terminal.get", json!({"terminal":binding.address}), &mut early).await?, false)
        } else {
            let list = request(&mut writer, &mut reader, "terminal.list", json!({"all":true}), &mut early).await?;
            let matches: Vec<_> = list["terminals"].as_array().ok_or("Invalid Herdr inventory")?.iter()
                .filter(|t| t["labels"]["agentpanel.pane"] == options.key).collect();
            match matches.as_slice() {
                [terminal] => ((*terminal).clone(), false),
                [] => {
                    if options.existing_only { return Err("Saved remote terminal was not found. No replacement was started.".into()); }
                    let argv = if options.target.is_some() || options.shell.is_empty() { Vec::<String>::new() } else { vec![options.shell.clone()] };
                    let mut env = if options.target.is_some() { HashMap::new() } else { options.env.clone() };
                    env.retain(|key, _| !key.starts_with("HC_") && !key.starts_with("HERDR_"));
                    env.entry("TERM".into()).or_insert("xterm-256color".into());
                    env.entry("COLORTERM".into()).or_insert("truecolor".into());
                    let terminal = request(&mut writer, &mut reader, "terminal.run", json!({
                        "argv":argv,"cwd":options.cwd,"env":env,"name":options.key,
                        "on":options.target.as_ref().map(|t| &t.machine),
                        "labels":{"agentpanel.pane":options.key},"no_parent":true
                    }), &mut early).await?;
                    (terminal, true)
                },
                _ => return Err("Multiple Herdr terminals claim this pane; select one outside AgentPanel".into()),
            }
        };
        if terminal["state"] != "live" { return Err("Saved Herdr terminal has ended. Close this pane to create a new terminal.".into()); }
        if (!options.attach_only && terminal["labels"]["agentpanel.pane"] != options.key) || terminal["cwd"] != options.cwd {
            return Err("Saved Herdr terminal does not match this pane and worktree".into());
        }
        let address = terminal["address"].as_str().ok_or("Herdr omitted terminal address")?.to_string();
        if options.target.as_ref().is_some_and(|t| !address.starts_with(&format!("{}/", t.machine))) {
            return Err("Terminal does not belong to the selected machine".into());
        }
        if options.attach_only && options.binding.as_ref().is_none_or(|b| b.address != address) {
            return Err("Saved terminal address changed. Refresh Machines to attach explicitly.".into());
        }
        let attached = request(&mut writer, &mut reader, "terminal.attach", json!({"terminal":address,
            "rows":rows,"cols":cols,"history":200,"resumed":!created}), &mut early).await?;
        let channel = stream_channel(&attached)?;
        let subscribed = request(&mut writer, &mut reader, "events.subscribe", json!({"terminal":address}), &mut early).await?;
        let events = stream_channel(&subscribed)?;
        // Subscribe returns the authoritative snapshot at the start of the
        // event stream. The earlier get/run result can already be stale.
        emit(Event::Status { state: subscription_state(&subscribed, &address) });
        Ok((Binding { core_id, address, machine_id: options.target.as_ref().map(|t| t.machine_id.clone())
            .or_else(|| options.binding.as_ref().and_then(|b| b.machine_id.clone())) }, created, channel, events, early))
    }).await.map_err(|_| "Herdr connection timed out. Reconnect to inspect uncertain delivery.".to_string())??;
    let (sender, receiver) = mpsc::channel(32);
    let address = binding.address.clone();
    let finished = Arc::new(AtomicBool::new(false));
    tokio::spawn(drive(child, writer, reader, channel, events, address, early, receiver, finished.clone(), emit));
    let detach_only = options.attach_only || options.target.is_some() || binding.address.contains('/');
    Ok(Opened { connection: Connection { sender, finished, attach_only: detach_only }, binding, created })
}

fn stream_channel(value: &Value) -> Result<u32, String> {
    value["channel"].as_u64().and_then(|n| u32::try_from(n).ok()).filter(|n| *n != 0).ok_or("Invalid Herdr stream channel".into())
}

fn subscription_state(snapshot: &Value, address: &str) -> Option<String> {
    snapshot["terminals"].as_array()?.iter().find(|t| t["address"] == address)?
        ["status"]["state"].as_str().map(String::from)
}

async fn drive(mut child: Child, mut writer: ChildStdin, mut reader: BufReader<ChildStdout>, channel: u32,
               events: u32, address: String, early: Vec<Frame>, mut controls: mpsc::Receiver<Control>,
               finished: Arc<AtomicBool>, emit: impl Fn(Event) -> bool + Send + Sync + 'static) {
    let (frames_tx, mut frames) = mpsc::channel(8);
    let reader_task = tokio::spawn(async move {
        for frame in early { if frames_tx.send(Ok(frame)).await.is_err() { return; } }
        loop {
            let frame = read_frame(&mut reader).await;
            let ended = frame.is_err();
            if frames_tx.send(frame).await.is_err() || ended { return; }
        }
    });
    let mut outstanding = 0usize;
    let mut status_buffer = Vec::new();
    let mut terminate: Option<oneshot::Sender<Result<(), String>>> = None;
    let mut intentional = false;
    let outcome: Result<(), String> = async {
        loop {
            tokio::select! {
                control = controls.recv() => match control {
                    Some(Control::Input(data)) => {
                        if data.len() > 65536 { return Err("Herdr input exceeds 64 KiB limit; use smaller pastes".into()); }
                        write_frame(&mut writer, channel, 0, data.as_bytes()).await?;
                    },
                    Some(Control::Resize(rows, cols)) => {
                        let mut data = cols.to_le_bytes().to_vec(); data.extend(rows.to_le_bytes());
                        write_frame(&mut writer, channel, 3, &data).await?;
                    },
                    Some(Control::Ack(bytes)) => {
                        if bytes > outstanding { return Err("Invalid Herdr output acknowledgement".into()); }
                        outstanding -= bytes;
                        write_frame(&mut writer, channel, 1, &(bytes as u32).to_le_bytes()).await?;
                    },
                    Some(Control::Terminate(reply)) => {
                        if terminate.is_some() { let _ = reply.send(Err("Termination already pending".into())); continue; }
                        terminate = Some(reply);
                        let data = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":99,"method":"terminal.kill","params":{"terminal":address}})).unwrap();
                        write_frame(&mut writer, 0, 0, &data).await?;
                    },
                    Some(Control::Detach) | None => { intentional = true; break; },
                },
                frame = frames.recv() => {
                    let frame = frame.ok_or("Herdr reader stopped")??;
                    if frame.channel == channel && frame.kind == 0 {
                        outstanding += frame.data.len();
                        if outstanding > MAX_FRAME { return Err("Herdr output consumer fell behind".into()); }
                        for bytes in frame.data.chunks(8192) {
                            if !emit(Event::Output { data: base64::engine::general_purpose::STANDARD.encode(bytes), bytes: bytes.len() }) {
                                intentional = true; return Ok(());
                            }
                        }
                    } else if frame.channel == channel && frame.kind == 2 {
                        let reason: Value = serde_json::from_slice(&frame.data).unwrap_or(Value::Null);
                        let reason_text = reason["reason"].as_str().unwrap_or("stream_closed").to_string();
                        if !["exited", "killed"].contains(&reason_text.as_str()) { return Err(format!("Herdr stream closed: {reason_text}. Reconnect to inspect the session.")); }
                        finished.store(true, Ordering::Release);
                        emit(Event::Closed { reason: reason_text, code: reason["exit_code"].as_u64().and_then(|n| u32::try_from(n).ok()) });
                        if terminate.is_none() { intentional = true; break; }
                    } else if frame.channel == events && frame.kind == 0 {
                        status_buffer.extend(&frame.data);
                        if status_buffer.len() > 65536 { return Err("Herdr status event too large".into()); }
                        while let Some(end) = status_buffer.iter().position(|b| *b == b'\n') {
                            let line: Vec<_> = status_buffer.drain(..=end).collect();
                            let value: Value = serde_json::from_slice(&line).map_err(|e| e.to_string())?;
                            if value["params"]["type"] == "status" {
                                emit(Event::Status { state: value["params"]["data"]["status"]["state"].as_str().map(String::from) });
                            } else if value["method"] == "missed" {
                                return Err("Herdr events missed; reconnect for a fresh snapshot".into());
                            }
                        }
                        write_frame(&mut writer, events, 1, &(frame.data.len() as u32).to_le_bytes()).await?;
                    } else if frame.channel == events && frame.kind == 2 {
                        return Err("Herdr status subscription ended; reconnect for fresh state".into());
                    } else if frame.channel == 0 && frame.kind == 0 {
                        let reply: Value = serde_json::from_slice(&frame.data).map_err(|e| e.to_string())?;
                        if reply["id"] == 99 {
                            let result = if let Some(error) = reply.get("error") { Err(error.to_string()) }
                                else if reply["result"]["state"] == "finished" { Ok(()) }
                                else { Err("Herdr did not confirm termination".into()) };
                            let success = result.is_ok();
                            if let Some(tx) = terminate.take() { let _ = tx.send(result); }
                            if success {
                                finished.store(true, Ordering::Release);
                                intentional = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }.await;
    if let Some(reply) = terminate { let _ = reply.send(Err("Herdr connection ended before termination was confirmed".into())); }
    if !intentional { emit(Event::Disconnected { message: outcome.err().unwrap_or("Herdr disconnected. Reconnect to inspect the session.".into()) }); }
    reader_task.abort();
    // This is only `hc connect`, never the core/holder or its program.
    let _ = child.kill().await;
}
