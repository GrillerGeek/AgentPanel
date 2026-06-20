//! Enumerate installed font families so Settings can offer the terminal font by
//! name. This matters because the powerline / icon glyphs in modern shell prompts
//! live in "Nerd Fonts", which the default Cascadia Code doesn't include — the
//! user needs to be able to pick one that's actually installed.
//!
//! The Windows font registry stores per-face *full* names (e.g. "FiraCode Nerd
//! Font Mono Reg (TrueType)"); we derive a usable CSS *family* name from each and
//! keep only families that look like terminal/programming fonts, so the picker
//! stays relevant instead of listing all ~500 system fonts.

/// Derive a CSS family name from a registry face name by dropping the trailing
/// "(TrueType)" note and common weight/style suffixes. Best-effort: the Settings
/// field is also free-text, so an imperfect suggestion is never a dead end.
#[cfg(windows)]
fn family_name(full: &str) -> String {
    let mut s = full;
    if let Some(idx) = s.rfind(" (") {
        s = &s[..idx]; // strip " (TrueType)" / " (OpenType)" etc.
    }
    // Trailing tokens that denote a weight/style/variant, not the family.
    const TRIM: &[&str] = &[
        "Windows Compatible",
        "Extra Light",
        "Semi Bold",
        "Demi Bold",
        "Extra Bold",
        "ExtraLight",
        "SemiBold",
        "DemiBold",
        "ExtraBold",
        "Complete",
        "Regular",
        "Oblique",
        "Italic",
        "Medium",
        "Retina",
        "Light",
        "Black",
        "Heavy",
        "SemBd",
        "Thin",
        "Bold",
        "Ret",
        "Med",
        "Reg",
        "Bd",
    ];
    let mut name = s.trim().to_string();
    loop {
        let lower = name.to_lowercase();
        let mut cut_to: Option<usize> = None;
        for t in TRIM {
            let tl = t.to_lowercase();
            if lower.len() > tl.len() + 1 && lower.ends_with(&tl) {
                let cut = name.len() - t.len();
                if name.as_bytes()[cut - 1] == b' ' {
                    cut_to = Some(cut - 1);
                    break;
                }
            }
        }
        match cut_to {
            Some(c) => name.truncate(c),
            None => break,
        }
        name = name.trim_end().to_string();
    }
    name
}

/// Keep families that look like terminal / programming fonts so the picker isn't
/// drowned in proportional UI fonts.
#[cfg(windows)]
fn is_terminal_font(name: &str) -> bool {
    let n = name.to_lowercase();
    const HINTS: &[&str] = &[
        "mono",
        "code",
        "consol",
        "nerd",
        "powerline",
        "fira",
        "jetbrains",
        "hack",
        "meslo",
        "source code",
        "cousine",
        "inconsolata",
        "courier",
        "cascadia",
        "iosevka",
        "victor",
        "anonymous",
        "ubuntu mono",
        "dejavu sans mono",
        "terminess",
        "terminal",
    ];
    HINTS.iter().any(|h| n.contains(h))
}

#[cfg(windows)]
fn detect() -> Vec<String> {
    use std::collections::BTreeSet;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let sub = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
    let mut fams: BTreeSet<String> = BTreeSet::new();

    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        if let Ok(key) = root.open_subkey(sub) {
            for (face, _) in key.enum_values().flatten() {
                let fam = family_name(&face);
                if !fam.is_empty() && is_terminal_font(&fam) {
                    fams.insert(fam);
                }
            }
        }
    }
    fams.into_iter().collect()
}

#[cfg(not(windows))]
fn detect() -> Vec<String> {
    // No registry off Windows; offer common monospace families as suggestions.
    [
        "monospace",
        "DejaVu Sans Mono",
        "Menlo",
        "Monaco",
        "Source Code Pro",
        "Fira Code",
        "JetBrains Mono",
        "Hack",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// List installed terminal/programming font families for the Settings picker.
#[tauri::command]
pub fn list_fonts() -> Vec<String> {
    detect()
}
