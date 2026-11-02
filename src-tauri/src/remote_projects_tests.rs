use super::*;

fn remote(machine: &str) -> RemoteTarget {
    RemoteTarget { endpoint: crate::herdr::Endpoint { executable: "hc".into(), session: "agentpanel".into() },
        core_id: "aggregate".into(), machine: machine.into(), machine_id: format!("id-{machine}"), session: None }
}

#[test]
fn worktree_paths_and_legacy_local_records_remain_unambiguous() {
    let local: Repository = serde_json::from_str(r#"{"id":"/repo","path":"/repo","name":"repo","isGit":true}"#).unwrap();
    assert!(local.remote.is_none());
    assert!(crate::commands::require_local(&local).is_ok());
    let mut repo = local.clone(); repo.remote = Some(remote("one")); repo.id = identity(repo.remote.as_ref().unwrap(), "/repo");
    let out = "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo with\ttab\nand newline\0HEAD def\0\0";
    let first = parse_worktrees(out, &repo).unwrap();
    assert_eq!(first[1].path, "/repo with\ttab\nand newline");
    assert!(first[0].is_primary && !first[1].is_primary);
    repo.remote = Some(remote("two"));
    assert!(crate::commands::require_local(&repo).is_err());
    let mut missing_identity = local.clone(); missing_identity.id = "remote:incomplete".into();
    assert!(crate::commands::require_local(&missing_identity).is_err());
    let second = parse_worktrees(out, &repo).unwrap();
    assert_ne!(first[0].id, second[0].id);
    assert_ne!(first[0].id, "/repo");
}

#[test]
fn status_handles_detached_unborn_rename_and_tracking_headers() {
    let out = "# branch.oid abc\0# branch.head feature\0# branch.ab +3 -2\02 R. rename target\01 original name\0? untracked\0";
    let (st, initial) = parse_status(out);
    assert_eq!(st.branch.as_deref(), Some("feature"));
    assert_eq!((st.dirty, st.ahead, st.behind, initial), (2, 3, 2, false));
    let (st, initial) = parse_status("# branch.oid (initial)\0# branch.head main\0");
    assert!(initial); assert_eq!(st.branch.as_deref(), Some("main"));
    assert!(parse_status("# branch.head (detached)\0").0.branch.is_none());
}

#[test]
fn numstat_does_not_split_file_names_at_tabs_or_newlines() {
    let files = parse_numstat("2\t3\tfile\twith\ncharacters\0-\t-\timage.png\0").unwrap();
    assert_eq!(files[0].path, "file\twith\ncharacters");
    assert_eq!((files[0].added, files[0].removed), (2, 3));
    assert!(files[1].binary);
}

async fn marker(rx: &mut tokio::sync::mpsc::UnboundedReceiver<crate::herdr::Event>,
                connection: &crate::herdr::Connection, expected: &[u8]) -> Vec<u8> {
    use base64::Engine;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let mut bytes = Vec::new();
        loop {
            match rx.recv().await.unwrap() {
                crate::herdr::Event::Output { data, bytes: count } => {
                    bytes.extend(base64::engine::general_purpose::STANDARD.decode(data).unwrap());
                    connection.sender.send(crate::herdr::Control::Ack(count)).await.unwrap();
                    if bytes.windows(expected.len()).any(|w| w == expected) { return bytes; }
                    assert!(bytes.len() < 1024 * 1024);
                },
                crate::herdr::Event::Disconnected { message } => panic!("{message}"),
                _ => {},
            }
        }
    }).await.expect("remote program output")
}

#[tokio::test]
#[ignore = "run through run_herdr_ssh_test.py --projects with disposable Git/SSH guests"]
async fn live_remote_projects_git_views_and_new_programs() {
    use crate::herdr::{self, Options, Control};
    let endpoint = herdr::Endpoint { executable: std::env::var("AGENTPANEL_HC_TEST_BINARY").unwrap(), session: "agentpanel-adapter-test".into() };
    let target = RemoteTarget { endpoint: endpoint.clone(), core_id: std::env::var("AGENTPANEL_HC_REMOTE_CORE").unwrap(),
        machine: "linux".into(), machine_id: std::env::var("AGENTPANEL_HC_REMOTE_MACHINE").unwrap(), session: Some("adapter-peer-test".into()) };
    let mut other = target.clone(); other.machine = "other".into(); other.machine_id = std::env::var("AGENTPANEL_HC_OTHER_MACHINE").unwrap();
    let repo = inspect(target.clone(), "/home/agentpanel/project").await.unwrap();
    let other_repo = inspect(other, "/home/agentpanel/project").await.unwrap();
    assert_ne!(repo.id, other_repo.id);
    let stored = AppStore::default();
    stored.repos.lock().unwrap().extend([repo.clone(), other_repo.clone()]);
    let worktrees = worktrees(&repo).await.unwrap();
    assert_eq!(worktrees.len(), 2);
    assert!(worktrees.iter().any(|w| w.path == "/home/agentpanel/linked checkout"));
    let mut read = RemoteGit::connect(&target).await.unwrap();
    let index_before = read.git(&repo.path, &["hash-object", ".git/index"]).await.unwrap();
    drop(read);
    let current = status(&stored, &repo.id, &repo.path).await.unwrap();
    assert_eq!(current.branch.as_deref(), Some("main"));
    assert_eq!(current.dirty, 4);
    let files = diff(&stored, &repo.id, &repo.path).await.unwrap();
    assert!(files.iter().any(|f| f.path == "tracked.txt" && f.added == 1 && f.removed == 1));
    assert!(files.iter().any(|f| f.path == "untracked name.txt" && f.status == "untracked"));
    assert!(patch(&stored, &repo.id, &repo.path, "tracked.txt").await.unwrap().contains("+linux-change"));
    assert!(patch(&stored, &other_repo.id, &other_repo.path, "tracked.txt").await.unwrap().contains("+other-change"));
    assert!(patch(&stored, &repo.id, &repo.path, "untracked name.txt").await.unwrap().contains("+untracked"));
    assert!(patch(&stored, &repo.id, &repo.path, "binary.bin").await.unwrap().contains("Binary files"));
    let link = patch(&stored, &repo.id, &repo.path, "link.txt").await.unwrap();
    assert!(link.contains("../outside.txt") && !link.contains("outside-secret"));
    let unborn = inspect(target.clone(), "/home/agentpanel/unborn").await.unwrap();
    stored.repos.lock().unwrap().push(unborn.clone());
    assert!(status(&stored, &unborn.id, &unborn.path).await.unwrap().last_commit.is_none());
    assert!(diff(&stored, &unborn.id, &unborn.path).await.unwrap_err().contains("initial commit"));
    let feature = "/home/agentpanel/linked checkout";
    assert!(diff(&stored, &repo.id, feature).await.unwrap().iter().any(|f| f.path == "feature.txt"));
    assert!(status(&stored, &repo.id, "/tmp").await.unwrap_err().contains("not a registered"));
    assert!(patch(&stored, &repo.id, &repo.path, "../outside").await.is_err());
    let mut wrong = target.clone(); wrong.machine_id = "replacement".into();
    assert!(inspect(wrong, &repo.path).await.unwrap_err().contains("another machine"));
    let mut read = RemoteGit::connect(&target).await.unwrap();
    assert_eq!(index_before, read.git(&repo.path, &["hash-object", ".git/index"]).await.unwrap());
    drop(read);
    let make_options = |binding| Options { executable: endpoint.executable.clone(), session: endpoint.session.clone(),
        key: "d".repeat(32), cwd: repo.path.clone(), shell: "/not-a-remote-shell".into(),
        env: [("AP_CLIENT_SECRET".into(), "must-not-leak".into())].into(), binding,
        attach_only: false, target: Some(target.clone()), existing_only: false };
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let opened = herdr::open(make_options(None), 24, 80, move |e| tx.send(e).is_ok()).await.unwrap();
    assert!(opened.created); assert!(opened.binding.address.starts_with("linux/"));
    opened.connection.send(Control::Input("printf '\\nREMOTE-PID-%s-END SECRET-%s-END\\n' \"$$\" \"${AP_CLIENT_SECRET-unset}\"\r".into())).unwrap();
    let bytes = marker(&mut rx, &opened.connection, b"SECRET-unset-END\r\n").await;
    let text = String::from_utf8(bytes).unwrap();
    let identity = text.lines().find(|l| l.starts_with("REMOTE-PID-")).unwrap().trim().to_string();
    assert!(opened.connection.terminate().await.is_err());
    opened.connection.send(Control::Detach).unwrap();
    let mut opts = make_options(Some(opened.binding.clone())); opts.existing_only = true;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let resumed = herdr::open(opts, 24, 80, move |e| tx.send(e).is_ok()).await.unwrap();
    assert!(!resumed.created);
    resumed.connection.send(Control::Input("printf '\\nREMOTE-PID-%s-END SECRET-%s-END\\n' \"$$\" \"${AP_CLIENT_SECRET-unset}\"\r".into())).unwrap();
    marker(&mut rx, &resumed.connection, format!("\r\n{identity}\r\n").as_bytes()).await;
    resumed.connection.send(Control::Detach).unwrap();
    let mut missing = make_options(None); missing.key = "e".repeat(32); missing.existing_only = true;
    assert!(herdr::open(missing, 24, 80, |_| true).await.err().unwrap().contains("No replacement"));
}
