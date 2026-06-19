//! GitHub integration via the `gh` CLI. Everything degrades gracefully: if
//! `gh` is missing, unauthenticated, or there's no PR for the branch, we simply
//! return None and the UI shows nothing.

use std::process::Command;

use serde_json::Value;

use crate::model::PrInfo;

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// Summarize a gh `statusCheckRollup` array into one word.
fn summarize_checks(rollup: &Value) -> String {
    let Some(arr) = rollup.as_array() else {
        return "none".to_string();
    };
    if arr.is_empty() {
        return "none".to_string();
    }
    let mut any_fail = false;
    let mut any_pending = false;
    for c in arr {
        // StatusContext has `state`; CheckRun has `status` + `conclusion`.
        if let Some(state) = c.get("state").and_then(Value::as_str) {
            match state {
                "FAILURE" | "ERROR" => any_fail = true,
                "PENDING" | "EXPECTED" => any_pending = true,
                _ => {}
            }
        } else if let Some(status) = c.get("status").and_then(Value::as_str) {
            if status != "COMPLETED" {
                any_pending = true;
            } else {
                match c.get("conclusion").and_then(Value::as_str) {
                    Some("SUCCESS") | Some("NEUTRAL") | Some("SKIPPED") | None => {}
                    Some(_) => any_fail = true, // FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED
                }
            }
        }
    }
    if any_fail {
        "failing".to_string()
    } else if any_pending {
        "pending".to_string()
    } else {
        "passing".to_string()
    }
}

/// Build a PrInfo from `gh pr view` JSON. Public for testing.
pub fn parse_pr(json: &[u8]) -> Option<PrInfo> {
    let v: Value = serde_json::from_slice(json).ok()?;
    let number = v.get("number")?.as_u64()?;
    Some(PrInfo {
        number,
        state: v.get("state").and_then(Value::as_str).unwrap_or("").to_string(),
        title: v.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
        url: v.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
        checks: summarize_checks(v.get("statusCheckRollup").unwrap_or(&Value::Null)),
    })
}

/// Look up the PR for whatever branch is checked out in `path`. None on any
/// failure (gh missing/unauthed, no PR, parse error).
pub fn pr_info(path: &str) -> Option<PrInfo> {
    let mut cmd = Command::new("gh");
    cmd.current_dir(path)
        .args(["pr", "view", "--json", "number,state,title,url,statusCheckRollup"]);
    no_window(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_pr(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pr_with_passing_checks() {
        let json = br#"{
            "number": 42, "state": "OPEN", "title": "Add thing", "url": "https://x/42",
            "statusCheckRollup": [
                {"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"},
                {"__typename":"StatusContext","state":"SUCCESS"}
            ]
        }"#;
        let pr = parse_pr(json).unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.state, "OPEN");
        assert_eq!(pr.checks, "passing");
    }

    #[test]
    fn failing_beats_pending_beats_passing() {
        let failing = serde_json::json!([
            {"status":"COMPLETED","conclusion":"SUCCESS"},
            {"status":"IN_PROGRESS"},
            {"status":"COMPLETED","conclusion":"FAILURE"}
        ]);
        assert_eq!(summarize_checks(&failing), "failing");

        let pending = serde_json::json!([
            {"status":"COMPLETED","conclusion":"SUCCESS"},
            {"status":"QUEUED"}
        ]);
        assert_eq!(summarize_checks(&pending), "pending");

        let none = serde_json::json!([]);
        assert_eq!(summarize_checks(&none), "none");
    }

    #[test]
    fn no_number_is_none() {
        assert!(parse_pr(br#"{"state":"OPEN"}"#).is_none());
    }
}
