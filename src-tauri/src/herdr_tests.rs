use super::*;

#[tokio::test]
async fn framing_preserves_fragmented_binary_and_rejects_oversized_frames() {
    let (mut tx, mut rx) = tokio::io::duplex(32);
    let task = tokio::spawn(async move {
        // Force header/payload fragmentation at each byte boundary.
        for byte in [7, 0, 0, 0, 0, 3, 0, 0, 0, 0xff, 0, 0x1b] {
            tx.write_all(&[byte]).await.unwrap();
            tokio::task::yield_now().await;
        }
        tx.write_u32_le(1).await.unwrap();
        tx.write_u8(0).await.unwrap();
        tx.write_u32_le((MAX_FRAME + 1) as u32).await.unwrap();
    });
    let frame = read_frame(&mut rx).await.unwrap();
    assert_eq!((frame.channel, frame.kind), (7, 0));
    assert_eq!(frame.data, [0xff, 0, 0x1b]);
    assert!(read_frame(&mut rx).await.err().unwrap().contains("1 MiB"));
    task.await.unwrap();
}

#[tokio::test]
async fn writer_uses_little_endian_channel_and_length() {
    let (mut tx, mut rx) = tokio::io::duplex(64);
    write_frame(&mut tx, 513, 3, &[80, 0, 24, 0]).await.unwrap();
    let mut bytes = [0; 13];
    rx.read_exact(&mut bytes).await.unwrap();
    assert_eq!(bytes, [1, 2, 0, 0, 3, 4, 0, 0, 0, 80, 0, 24, 0]);
}

fn options(binding: Option<Binding>) -> Options {
    Options {
        executable: std::env::var("AGENTPANEL_HC_TEST_BINARY").unwrap_or("herdr-core".into()),
        session: "agentpanel-adapter-test".into(), key: "0123456789abcdef0123456789abcdef".into(),
        cwd: std::env::var("AGENTPANEL_HC_TEST_CWD").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into()),
        shell: "/bin/sh".into(), env: HashMap::new(), binding,
    }
}

#[test]
fn validates_session_and_pane_identity_before_starting_a_process() {
    let mut value = options(None);
    assert!(validate(&value).is_ok());
    value.session = "../default".into();
    assert!(validate(&value).is_err());
    value.session = "agentpanel".into(); value.key = "p1".into();
    assert!(validate(&value).is_err());
}

#[test]
fn initial_status_comes_from_the_subscription_boundary() {
    let snapshot = json!({"seq":7,"terminals":[
        {"address":"t1","status":{"state":"blocked"}},
        {"address":"t2","status":{"state":"working"}}
    ]});
    assert_eq!(subscription_state(&snapshot, "t1").as_deref(), Some("blocked"));
    assert_eq!(subscription_state(&snapshot, "missing"), None);
    assert_eq!(subscription_state(&json!({"terminals":[]}), "t1"), None);
}

async fn marker(rx: &mut mpsc::UnboundedReceiver<Event>, connection: &Connection, marker: &[u8]) -> Vec<u8> {
    tokio::time::timeout(DEADLINE, async {
        let mut output = Vec::new();
        loop {
            match rx.recv().await.expect("runtime event") {
                Event::Output { data, bytes } => {
                    output.extend(base64::engine::general_purpose::STANDARD.decode(data).unwrap());
                    connection.sender.send(Control::Ack(bytes)).await.unwrap();
                    assert!(output.len() < MAX_FRAME);
                    if output.windows(marker.len()).any(|w| w == marker) { return output; }
                },
                Event::Disconnected { message } => panic!("{message}"),
                _ => {},
            }
        }
    }).await.expect("terminal marker deadline")
}

#[tokio::test]
#[ignore = "run through scripts/spikes/run_herdr_adapter_test.py with an isolated official binary"]
async fn live_adapter_reconnects_without_replaying_or_replacing_the_program() {
    let (events, mut rx) = mpsc::unbounded_channel();
    let opened = open(options(None), 24, 80, move |e| events.send(e).is_ok()).await.unwrap();
    assert!(opened.created);
    let saved = opened.binding.clone();
    opened.connection.send(Control::Input("printf '\\nPID:%s\\n' \"$$\"\r".into())).unwrap();
    let output = marker(&mut rx, &opened.connection, b"\r\nPID:").await;
    // The marker prefix can span chunks; ask for a complete delimited value.
    opened.connection.send(Control::Input("printf '\\nIDENTITY-%s-END\\n' \"$$\"\r".into())).unwrap();
    let output = [output, marker(&mut rx, &opened.connection, b"-END\r\n").await].concat();
    let text = String::from_utf8_lossy(&output);
    let identity = text.lines().find(|l| l.starts_with("IDENTITY-")).unwrap().trim().to_string();
    opened.connection.send(Control::Detach).unwrap();
    // Reattach even when the first viewer is gone. Repaint must contain history.
    let (events, mut rx) = mpsc::unbounded_channel();
    let resumed = open(options(Some(saved.clone())), 24, 80, move |e| events.send(e).is_ok()).await.unwrap();
    assert!(!resumed.created);
    assert_eq!(resumed.binding, saved);
    resumed.connection.send(Control::Input("printf '\\nRESUMED-%s-END\\n' \"$$\"\r".into())).unwrap();
    let expected = format!("\r\n{}\r\n", identity.replace("IDENTITY-", "RESUMED-"));
    marker(&mut rx, &resumed.connection, expected.as_bytes()).await;
    resumed.connection.send(Control::Resize(37, 101)).unwrap();
    resumed.connection.send(Control::Input("stty size\r".into())).unwrap();
    marker(&mut rx, &resumed.connection, b"37 101").await;
    resumed.connection.send(Control::Input("dd if=/dev/zero bs=1024 count=300 2>/dev/null | tr '\\000' x; printf '\\nFLOOD-END\\n'\r".into())).unwrap();
    let output = marker(&mut rx, &resumed.connection, b"\r\nFLOOD-END\r\n").await;
    assert!(output.len() >= 300 * 1024);
    resumed.connection.send(Control::Input("printf '\\033]7501;state=blocked:app=adapter-test\\033\\\\'\r".into())).unwrap();
    tokio::time::timeout(DEADLINE, async {
        loop {
            match rx.recv().await.unwrap() {
                Event::Status { state: Some(state) } if state == "blocked" => break,
                Event::Output { bytes, .. } => resumed.connection.sender.send(Control::Ack(bytes)).await.unwrap(),
                Event::Disconnected { message } => panic!("{message}"),
                _ => {},
            }
        }
    }).await.expect("authoritative status event");
    // Saved binding mismatches cannot silently create another shell.
    let mut wrong = saved.clone(); wrong.core_id = "another-core".into();
    assert!(matches!(open(options(Some(wrong)), 24, 80, |_| true).await, Err(e) if e.contains("another core")));
    resumed.connection.terminate().await.unwrap();
    resumed.connection.terminate().await.unwrap(); // confirmed stop is idempotent
    assert!(matches!(open(options(Some(saved)), 24, 80, |_| true).await, Err(e) if e.contains("ended")));
}

#[tokio::test]
#[ignore = "run through scripts/spikes/run_herdr_ssh_test.py with a disposable SSH guest"]
async fn live_adapter_attaches_to_ssh_terminal() {
    let binding = Binding { core_id: std::env::var("AGENTPANEL_HC_REMOTE_CORE").unwrap(),
        address: std::env::var("AGENTPANEL_HC_REMOTE_ADDRESS").unwrap() };
    let mut opts = options(Some(binding.clone()));
    opts.key = "a".repeat(32);
    let (events, mut rx) = mpsc::unbounded_channel();
    let opened = open(opts, 24, 80, move |e| events.send(e).is_ok()).await.unwrap();
    assert!(!opened.created);
    assert_eq!(opened.binding, binding);
    opened.connection.send(Control::Input("printf '\\nSSH-%s-END\\n' \"$(uname -s)\"\r".into())).unwrap();
    marker(&mut rx, &opened.connection, b"\r\nSSH-Linux-END\r\n").await;
    opened.connection.send(Control::Resize(33, 99)).unwrap();
    opened.connection.send(Control::Input("stty size\r".into())).unwrap();
    marker(&mut rx, &opened.connection, b"33 99").await;
    opened.connection.send(Control::Detach).unwrap();
}
