//! Read-only executable discovery shared by every Herdr connection. Never runs
//! the executable, starts a session, or rewrites an explicit custom path.
use std::path::{Path, PathBuf};
use std::io::ErrorKind;

const HELP: &str = "Use Find automatically or Browse in Settings → Herdr core executable (or Machines & terminals). Install Herdr core from https://herdr.dev/core/ if needed.";

pub(crate) fn launch_error(executable: &str, error: &std::io::Error) -> String {
    let reason = match error.kind() {
        ErrorKind::NotFound => "was not found",
        ErrorKind::PermissionDenied => "cannot be executed (permission denied)",
        _ => "could not be started",
    };
    format!("Herdr executable {executable:?} {reason}: {error}. {HELP}")
}

pub(crate) fn resolve(executable: &str) -> Result<PathBuf, String> {
    let path = std::env::var_os("PATH").map(|value| std::env::split_paths(&value).collect::<Vec<_>>()).unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    resolve_in(executable, &path, home.as_deref(), &["/opt/homebrew/bin".into(), "/usr/local/bin".into(), "/usr/bin".into()])
}

fn executable_file(path: &Path) -> std::io::Result<bool> {
    let metadata = std::fs::metadata(path)?;
    if !metadata.is_file() { return Ok(false); }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        Ok(metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))] { Ok(true) }
}

fn resolve_in(executable: &str, path: &[PathBuf], home: Option<&Path>, common: &[PathBuf]) -> Result<PathBuf, String> {
    if executable.is_empty() { return Err(format!("Set a Herdr executable. {HELP}")); }
    // Qualified paths are authoritative, including spaces and relative paths.
    // No shell expansion or alias fallback is applied to custom paths.
    if executable.contains('/') || executable.contains('\\') {
        let candidate = PathBuf::from(executable);
        return match executable_file(&candidate) {
            Ok(true) => if candidate.is_absolute() { Ok(candidate) } else {
                std::env::current_dir().map(|cwd| cwd.join(candidate)).map_err(|e| launch_error(executable, &e))
            },
            Ok(false) => Err(launch_error(executable, &std::io::Error::from(ErrorKind::PermissionDenied))),
            Err(error) => Err(launch_error(executable, &error)),
        };
    }
    let known = matches!(executable, "hc" | "herdr-core");
    let mut directories: Vec<PathBuf> = path.iter().filter(|dir| dir.is_absolute()).cloned().collect();
    if known {
        if let Some(home) = home.filter(|home| home.is_absolute()) { directories.push(home.join(".local/bin")); }
        directories.extend_from_slice(common);
    }
    let names = if executable == "hc" { vec!["hc", "herdr-core"] }
        else if executable == "herdr-core" { vec!["herdr-core", "hc"] } else { vec![executable] };
    let mut denied = None;
    // Exhaust all locations for the requested command before trying its alias.
    for name in names {
        for directory in &directories {
            let candidate = directory.join(name);
            match executable_file(&candidate) {
                Ok(true) => return Ok(candidate),
                Ok(false) => if denied.is_none() { denied = Some(candidate); },
                Err(error) if error.kind() == ErrorKind::PermissionDenied => if denied.is_none() { denied = Some(candidate); },
                Err(_) => {},
            }
        }
    }
    if let Some(candidate) = denied {
        Err(launch_error(&candidate.to_string_lossy(), &std::io::Error::from(ErrorKind::PermissionDenied)))
    } else { Err(launch_error(executable, &std::io::Error::from(ErrorKind::NotFound))) }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn binary(directory: &Path, name: &str, mode: u32) -> PathBuf {
        std::fs::create_dir_all(directory).unwrap();
        let file = directory.join(name); std::fs::write(&file, "not executed by discovery").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap(); file
    }
    #[test]
    fn requested_name_precedes_alias_and_path_precedes_common_locations() {
        let tmp = tempfile::tempdir().unwrap(); let first = tmp.path().join("first"); let second = tmp.path().join("second");
        binary(&first, "herdr-core", 0o755); let expected = binary(&second, "hc", 0o755);
        assert_eq!(resolve_in("hc", &[first.clone(), second], None, &[]).unwrap(), expected);
        let requested = binary(&first, "hc", 0o755);
        assert_eq!(resolve_in("hc", &[first.clone()], None, &[tmp.path().join("second")]).unwrap(), requested);
        assert_eq!(resolve_in("herdr-core", &[first.clone()], None, &[]).unwrap(), first.join("herdr-core"));
    }
    #[test]
    fn finds_user_local_then_common_and_alias_without_running_anything() {
        let tmp = tempfile::tempdir().unwrap(); let home = tmp.path().join("home"); let common = tmp.path().join("common");
        let local = binary(&home.join(".local/bin"), "hc", 0o755); binary(&common, "hc", 0o755);
        assert_eq!(resolve_in("herdr-core", &[], Some(&home), &[common.clone()]).unwrap(), local);
        std::fs::remove_file(local).unwrap();
        assert_eq!(resolve_in("hc", &[], Some(&home), &[common.clone()]).unwrap(), common.join("hc"));
    }
    #[test]
    fn custom_path_is_authoritative_and_spaces_are_preserved() {
        let tmp = tempfile::tempdir().unwrap(); let custom = binary(tmp.path(), "my custom core", 0o755);
        binary(tmp.path(), "hc", 0o755);
        assert_eq!(resolve_in(custom.to_str().unwrap(), &[], None, &[]).unwrap(), custom);
        let invalid = tmp.path().join("missing core");
        let message = resolve_in(invalid.to_str().unwrap(), &[tmp.path().into()], None, &[]).unwrap_err();
        assert!(message.contains(invalid.to_str().unwrap())); assert!(message.contains("was not found")); assert!(message.contains("Browse"));
    }
    #[test]
    fn rejects_nonexecutable_files_and_directories_but_can_find_later_executable() {
        let tmp = tempfile::tempdir().unwrap(); let first = tmp.path().join("first"); let second = tmp.path().join("second");
        let denied = binary(&first, "hc", 0o644);
        let message = resolve_in("hc", &[first.clone()], None, &[]).unwrap_err();
        assert!(message.contains("permission denied")); assert!(message.contains(denied.to_str().unwrap()));
        let good = binary(&second, "hc", 0o755);
        assert_eq!(resolve_in("hc", &[first, second], None, &[]).unwrap(), good);
        assert!(resolve_in(tmp.path().to_str().unwrap(), &[], None, &[]).is_err());
    }
    #[test]
    fn skips_relative_path_entries_and_does_not_fallback_for_unknown_commands() {
        let tmp = tempfile::tempdir().unwrap(); binary(tmp.path(), "hc", 0o755);
        assert!(resolve_in("hc", &["".into(), ".".into(), "relative/bin".into()], None, &[]).is_err());
        let message = resolve_in("my-core", &[], None, &[tmp.path().into()]).unwrap_err();
        assert!(message.contains("my-core")); assert!(message.contains("Find automatically"));
    }
}
