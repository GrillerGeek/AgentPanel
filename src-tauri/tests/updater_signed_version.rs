use serde_json::json;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{Ipv4Addr, TcpListener},
    path::Path,
    process::Command,
    thread,
    time::Duration,
};
use tauri_plugin_updater::{Error, UpdaterExt};

const TIMEOUT: Duration = Duration::from_secs(10);

#[test]
fn updater_enforces_the_signed_version_before_returning_downloaded_bytes() {
    let fixtures = tempfile::tempdir().unwrap();
    let fixture_script =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/updater-test-fixtures.mjs");
    let status = Command::new("node")
        .arg(fixture_script)
        .arg(fixtures.path())
        .status()
        .expect("run the locked Tauri signer via Node");
    assert!(status.success());

    let pubkey = fs::read_to_string(fixtures.path().join("test.key.pub")).unwrap();
    let payload = fs::read(fixtures.path().join("payload.bin")).unwrap();
    let cases = [
        ("bound", "0.7.1", "0.7.2", payload.as_slice(), "valid"),
        ("next", "0.7.2", "0.7.3", payload.as_slice(), "valid"),
        ("legacy", "0.7.1", "0.7.2", payload.as_slice(), "missing"),
        ("old", "0.7.1", "0.7.2", payload.as_slice(), "mismatch"),
        ("forged", "0.7.1", "0.7.2", payload.as_slice(), "forged"),
        ("bound", "0.7.1", "0.7.2", b"changed", "forged"),
        ("old", "0.7.1", "0.7.0", payload.as_slice(), "older"),
    ];
    for (signature, current, announced, body, expectation) in cases {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let sig = fs::read_to_string(fixtures.path().join(format!("{signature}.sig"))).unwrap();
        let manifest = json!({
            "version": announced,
            "platforms": { "fixture": { "url": format!("{base}/payload"), "signature": sig.trim() } }
        })
        .to_string();

        let data = body.to_vec();
        let requests = if expectation == "older" { 1 } else { 2 };
        let server = thread::spawn(move || {
            for connection in listener.incoming().take(requests) {
                let mut connection = connection.unwrap();
                connection.set_read_timeout(Some(TIMEOUT)).unwrap();
                let mut reader = BufReader::new(&connection);
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                let (kind, response) = if request.starts_with("GET /manifest ") {
                    ("application/json", manifest.as_bytes())
                } else {
                    assert!(request.starts_with("GET /payload "));
                    ("application/octet-stream", data.as_slice())
                };
                for line in reader.lines() {
                    if line.unwrap().is_empty() {
                        break;
                    }
                }
                write!(
                    connection,
                    "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    response.len()
                )
                .unwrap();
                connection.write_all(response).unwrap();
            }
        });

        let mut config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &mut config["plugins"]["updater"];
        assert_eq!(updater["requireSignedVersion"], true);
        updater["endpoints"] = json!([format!("{base}/manifest")]);
        updater["pubkey"] = json!(pubkey.trim());
        updater["dangerousInsecureTransportProtocol"] = json!(true);
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), updater.clone());
        context.package_info_mut().version = current.parse().unwrap();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("fixture")
            .no_proxy()
            .build()
            .unwrap();

        tauri::async_runtime::block_on(async {
            let update = tokio::time::timeout(TIMEOUT, updater.check())
                .await
                .unwrap()
                .unwrap();
            if expectation == "older" {
                assert!(
                    update.is_none(),
                    "an honestly announced older version is not offered"
                );
                return;
            }
            let result = tokio::time::timeout(TIMEOUT, update.unwrap().download(|_, _| {}, || {}))
                .await
                .unwrap();
            match expectation {
                "valid" => assert_eq!(result.unwrap(), payload),
                "missing" => assert!(matches!(result, Err(Error::MissingSignedVersion))),
                "mismatch" => assert!(matches!(result, Err(Error::SignedVersionMismatch { .. }))),
                "forged" => assert!(result.is_err(), "cryptographically invalid bytes must fail"),
                _ => unreachable!(),
            }
        });
        server.join().unwrap();
    }
}
