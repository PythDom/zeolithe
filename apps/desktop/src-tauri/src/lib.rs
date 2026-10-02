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
        .invoke_handler(tauri::generate_handler![allow_vault])
        .run(tauri::generate_context!())
        .expect("error while running Zeolite");
}
