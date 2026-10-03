use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use tauri::{ipc::CapabilityBuilder, AppHandle, Manager};
use tauri_plugin_fs::FsExt;

/// Grant read/write access to the whole vault, hidden folders included
/// (`.obsidian` settings, `.trash` for deleted notes). Only folders the user
/// chose in the folder dialog (kept across restarts by the persisted scope)
/// can be granted, so the web side cannot reach arbitrary paths.
#[tauri::command]
fn allow_vault(app: AppHandle, path: String) -> Result<(), String> {
    if !app.fs_scope().is_allowed(&path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let root = path.trim_end_matches(['/', '\\']).to_string();
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    let capability = CapabilityBuilder::new(format!("vault-{:x}", hasher.finish()))
        .window("main")
        .permission_scoped(
            "fs:scope",
            vec![
                serde_json::json!({ "path": root }),
                serde_json::json!({ "path": format!("{root}/**") }),
            ],
            Vec::<serde_json::Value>::new(),
        );
    match app.add_capability(capability) {
        Ok(()) => Ok(()),
        // Already granted earlier in this session.
        Err(e) if e.to_string().contains("already") => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Serialize)]
struct ScanEntry {
    path: String,
    mtime: u64,
    size: u64,
}

/// Every file of the vault with its modification time (ms) and size, in one
/// call: listing a vault file by file through the fs plugin is slow, and the
/// app checks the folder every few seconds for changes made by other apps.
/// Folders named in `ignore` (.obsidian, .trash…) are skipped.
#[tauri::command]
fn scan_vault(app: AppHandle, path: String, ignore: Vec<String>) -> Result<Vec<ScanEntry>, String> {
    if !app.fs_scope().is_allowed(&path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let root = std::path::PathBuf::from(path.trim_end_matches(['/', '\\']));
    let mut out = Vec::new();
    let mut stack = vec![(root, String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) if prefix.is_empty() => return Err(e.to_string()),
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if meta.is_dir() {
                if !ignore.contains(&name) {
                    stack.push((entry.path(), rel));
                }
            } else if meta.is_file() {
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(ScanEntry { path: rel, mtime, size: meta.len() });
            }
        }
    }
    Ok(out)
}

/// Zeolite desktop shell: the shared web UI in a native window, with access
/// to the vault folder the user picks. The folder stays allowed across
/// restarts (persisted scope), so the last vault reopens directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // Must come after the fs plugin: it saves and restores the folders allowed by the dialog.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        // Web links open in the default browser.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![allow_vault, scan_vault])
        .run(tauri::generate_context!())
        .expect("error while running Zeolite");
}
