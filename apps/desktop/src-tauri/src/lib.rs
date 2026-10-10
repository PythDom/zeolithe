use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use std::path::PathBuf;
use std::sync::Mutex;

pub mod lan;

use tauri::{ipc::CapabilityBuilder, AppHandle, Emitter, Manager, State, WebviewWindowBuilder};
use tauri_plugin_fs::FsExt;

/// Where Zeolite keeps its own data (web storage: last vault, sync settings;
/// the list of vault folders chosen): a `Zeolite-data` folder next to the
/// exe, so the app is truly portable and leaves nothing in the user profile.
/// Falls back to the usual per-user folder when the exe's folder is read-only.
struct DataDir(PathBuf);

fn portable_data_dir() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.join("Zeolite-data");
    std::fs::create_dir_all(&dir).ok()?;
    let probe = dir.join(".write-test");
    std::fs::write(&probe, b"").ok()?;
    let _ = std::fs::remove_file(&probe);
    Some(dir)
}

/// Vault folders the user chose in the folder dialog, so they can be reopened
/// after a restart (kept in `Zeolite-data/vaults.json`).
fn chosen_vaults(data: &DataDir) -> Vec<String> {
    std::fs::read_to_string(data.0.join("vaults.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn remember_vault(data: &DataDir, root: &str) {
    let mut list = chosen_vaults(data);
    if !list.iter().any(|p| p == root) {
        list.push(root.to_string());
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = std::fs::write(data.0.join("vaults.json"), json);
        }
    }
}

fn vault_allowed(app: &AppHandle, data: &DataDir, path: &str) -> bool {
    let root = path.trim_end_matches(['/', '\\']);
    app.fs_scope().is_allowed(path) || chosen_vaults(data).iter().any(|p| p == root)
}

/// Grant read/write access to the whole vault, hidden folders included
/// (`.obsidian` settings, `.trash` for deleted notes). Only folders the user
/// chose in the folder dialog (remembered in `Zeolite-data/vaults.json`)
/// can be granted, so the web side cannot reach arbitrary paths.
#[tauri::command]
fn allow_vault(app: AppHandle, data: State<DataDir>, path: String) -> Result<(), String> {
    if !vault_allowed(&app, &data, &path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let root = path.trim_end_matches(['/', '\\']).to_string();
    remember_vault(&data, &root);
    let mut hasher = DefaultHasher::new();
    root.hash(&mut hasher);
    // Windows checks existing files under their canonical form (`\\?\C:\…`):
    // allow that form too, or only new files could be written after a restart.
    let mut roots = vec![root.clone()];
    if let Ok(canonical) = std::fs::canonicalize(&root) {
        let c = canonical.to_string_lossy().to_string();
        if c != root {
            roots.push(c);
        }
    }
    let entries: Vec<serde_json::Value> = roots
        .iter()
        .flat_map(|r| [serde_json::json!({ "path": r }), serde_json::json!({ "path": format!("{r}/**") })])
        .collect();
    let capability = CapabilityBuilder::new(format!("vault-{:x}", hasher.finish()))
        .window("main")
        .permission_scoped("fs:scope", entries.clone(), Vec::<serde_json::Value>::new())
        // Attachments open in their default app.
        .permission_scoped("opener:allow-open-path", entries, Vec::<serde_json::Value>::new());
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
/// The vault shared with a phone or tablet on the local network, if any.
#[derive(Default)]
struct Sharing(Mutex<Option<lan::LanServer>>);

#[derive(serde::Serialize)]
struct SharingInfo {
    /// This computer's addresses on the network, the most likely first (empty if not connected).
    ips: Vec<String>,
    port: u16,
}

/// Share the open vault on the local network (Wi-Fi) with the pairing code
/// `token`. Devices that write or delete files trigger a `lan-changed` event.
#[tauri::command]
fn lan_start(app: AppHandle, data: State<DataDir>, sharing: State<Sharing>, path: String, name: String, token: String, port: u16) -> Result<SharingInfo, String> {
    if !vault_allowed(&app, &data, &path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let mut current = sharing.0.lock().map_err(|e| e.to_string())?;
    let root = PathBuf::from(path.trim_end_matches(['/', '\\']));
    // Already sharing this vault with this code (e.g. reopened): keep it.
    if let Some(s) = current.as_ref().filter(|s| s.is_running() && s.root == root && s.token == token) {
        return Ok(SharingInfo { ips: lan::local_addresses(), port: s.port });
    }
    if let Some(old) = current.take() {
        old.stop();
    }
    let handle = app.clone();
    let server = lan::start(root, name, token, port, move |paths| {
        let _ = handle.emit("lan-changed", paths);
    })?;
    let info = SharingInfo { ips: lan::local_addresses(), port: server.port };
    *current = Some(server);
    Ok(info)
}

#[tauri::command]
fn lan_stop(sharing: State<Sharing>) -> Result<(), String> {
    if let Some(server) = sharing.0.lock().map_err(|e| e.to_string())?.take() {
        server.stop();
    }
    Ok(())
}

/// Address and port while sharing (None when stopped, e.g. after too many wrong codes).
#[tauri::command]
fn lan_status(sharing: State<Sharing>) -> Result<Option<SharingInfo>, String> {
    let current = sharing.0.lock().map_err(|e| e.to_string())?;
    Ok(current.as_ref().filter(|s| s.is_running()).map(|s| SharingInfo { ips: lan::local_addresses(), port: s.port }))
}

/// Open an e-mail draft (an .eml file marked "X-Unsent") in the default mail
/// app: Outlook and Windows Mail open it as a new message ready to send.
#[tauri::command]
fn open_mail_draft(app: AppHandle, eml: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("Zeolite-mail-{stamp}.eml"));
    std::fs::write(&path, eml).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_vault(app: AppHandle, data: State<DataDir>, path: String, ignore: Vec<String>) -> Result<Vec<ScanEntry>, String> {
    if !vault_allowed(&app, &data, &path) {
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

/// A path inside the vault as the web side gives it ("folder/note.md"):
/// nothing absolute, no `..`, no drive letter.
fn inside_vault(root: &std::path::Path, rel: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = rel.split(['/', '\\']).collect();
    if rel.is_empty() || rel.contains(':') || parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
        return None;
    }
    Some(parts.iter().fold(root.to_path_buf(), |acc, p| acc.join(p)))
}

/// Read many notes in one call, several at a time: on a network drive each
/// read waits for the server, so one call per note (and one at a time) made
/// opening a large vault slow. Unreadable files come back as `None`.
#[tauri::command]
async fn read_notes(app: AppHandle, path: String, files: Vec<String>) -> Result<Vec<Option<String>>, String> {
    let data = app.state::<DataDir>();
    if !vault_allowed(&app, &data, &path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let root = PathBuf::from(path.trim_end_matches(['/', '\\']));
    Ok(read_texts(&root, &files))
}

fn read_texts(root: &std::path::Path, files: &[String]) -> Vec<Option<String>> {
    const THREADS: usize = 8;
    let mut out: Vec<Option<String>> = vec![None; files.len()];
    let chunk = files.len().div_ceil(THREADS).max(1);
    std::thread::scope(|scope| {
        for (names, slots) in files.chunks(chunk).zip(out.chunks_mut(chunk)) {
            scope.spawn(move || {
                for (name, slot) in names.iter().zip(slots.iter_mut()) {
                    *slot = inside_vault(root, name).and_then(|p| std::fs::read(p).ok()).map(|bytes| {
                        let text = String::from_utf8_lossy(&bytes);
                        // Like the web's TextDecoder: no byte order mark.
                        text.strip_prefix('\u{feff}').unwrap_or(&text).to_string()
                    });
                }
            });
        }
    });
    out
}

/// Every folder of the vault (empty ones included) in one call.
#[tauri::command]
fn vault_dirs(app: AppHandle, data: State<DataDir>, path: String, ignore: Vec<String>) -> Result<Vec<String>, String> {
    if !vault_allowed(&app, &data, &path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let mut out = Vec::new();
    let mut stack = vec![(PathBuf::from(path.trim_end_matches(['/', '\\'])), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if ignore.contains(&name) || !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            out.push(rel.clone());
            stack.push((entry.path(), rel));
        }
    }
    out.sort();
    Ok(out)
}

/// Where on-device AI models can be put by hand (`Zeolite-data/models`,
/// next to the portable exe): for a PC that cannot download them.
fn models_root(data: &DataDir) -> PathBuf {
    data.0.join("models")
}

/// Model folders chosen in the folder dialog (kept in `Zeolite-data/models.json`).
fn chosen_model_folders(data: &DataDir) -> Vec<String> {
    std::fs::read_to_string(data.0.join("models.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn model_folder_allowed(data: &DataDir, folder: &str) -> bool {
    let path = std::path::Path::new(folder.trim_end_matches(['/', '\\']));
    if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return false;
    }
    path.starts_with(models_root(data)) || chosen_model_folders(data).iter().any(|p| std::path::Path::new(p) == path)
}

/// The folder for models put there by hand (created if needed).
#[tauri::command]
fn models_dir(data: State<DataDir>) -> Result<String, String> {
    let dir = models_root(&data);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Remember a model folder just chosen in the folder dialog, so that it can
/// still be read after a restart.
#[tauri::command]
fn allow_model_folder(app: AppHandle, data: State<DataDir>, path: String) -> Result<(), String> {
    let root = path.trim_end_matches(['/', '\\']).to_string();
    if model_folder_allowed(&data, &root) {
        return Ok(());
    }
    if !app.fs_scope().is_allowed(&path) {
        return Err("This folder was not chosen in the folder dialog.".into());
    }
    let mut list = chosen_model_folders(&data);
    list.push(root);
    let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    std::fs::write(data.0.join("models.json"), json).map_err(|e| e.to_string())
}

/// One file of a model folder ("config.json", "onnx/model_quantized.onnx"),
/// as raw bytes. A missing file is the error "not found".
#[tauri::command]
fn read_model_file(data: State<DataDir>, folder: String, file: String) -> Result<tauri::ipc::Response, String> {
    if !model_folder_allowed(&data, &folder) {
        return Err("This model folder was not chosen in the folder dialog.".into());
    }
    let root = PathBuf::from(folder.trim_end_matches(['/', '\\']));
    let path = inside_vault(&root, &file).ok_or("not found")?;
    match std::fs::read(path) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("not found".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_notes_and_refuses_paths_outside() {
        let root = std::env::temp_dir().join(format!("zeolite-read-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("a.md"), "\u{feff}# A").unwrap();
        std::fs::write(root.join("sub/b.md"), "# B").unwrap();
        let files: Vec<String> = ["a.md", "sub/b.md", "missing.md", "../a.md", "C:/x.md", "/etc/passwd"].iter().map(|s| s.to_string()).collect();
        let texts = read_texts(&root, &files);
        assert_eq!(texts, vec![Some("# A".into()), Some("# B".into()), None, None, None, None]);
        let many: Vec<String> = (0..50).map(|_| "sub/b.md".to_string()).collect();
        assert!(read_texts(&root, &many).iter().all(|t| t.as_deref() == Some("# B")));
        assert!(read_texts(&root, &[]).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn model_folders_must_be_chosen_or_in_the_models_folder() {
        let base = std::env::temp_dir().join(format!("zeolite-models-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let data = DataDir(base.clone());
        let inside = base.join("models").join("multilingual-e5-small");
        assert!(model_folder_allowed(&data, &inside.to_string_lossy()));
        assert!(!model_folder_allowed(&data, &base.join("models").join("..").join("x").to_string_lossy()));
        assert!(!model_folder_allowed(&data, "/somewhere/else"));
        std::fs::write(base.join("models.json"), r#"["/somewhere/else"]"#).unwrap();
        assert!(model_folder_allowed(&data, "/somewhere/else/"));
        assert!(!model_folder_allowed(&data, "/somewhere/else/sub"));
        let _ = std::fs::remove_dir_all(&base);
    }
}

/// Zeolite desktop shell: the shared web UI in a native window, with access
/// to the vault folder the user picks. Chosen folders are remembered in
/// `Zeolite-data`, so the last vault reopens directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data = portable_data_dir()
                .or_else(|| app.path().app_data_dir().ok())
                .ok_or("No folder to keep Zeolite's settings in.")?;
            std::fs::create_dir_all(&data)?;
            // The window is created here (not from the config) so that its web storage
            // goes into the data folder instead of the user profile.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("No main window in the configuration.")?;
            app.manage(DataDir(data.clone()));
            let mut window = WebviewWindowBuilder::from_config(app.handle(), &config)?.data_directory(data.join("webview"));
            // A window built by hand has no icon by default (Windows then shows a generic one
            // in the taskbar): give it the app's icon.
            if let Some(icon) = app.default_window_icon() {
                window = window.icon(icon.clone())?;
            }
            window.build()?;
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // Web links open in the default browser.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(Sharing::default())
        .invoke_handler(tauri::generate_handler![allow_vault, scan_vault, read_notes, vault_dirs, models_dir, allow_model_folder, read_model_file, open_mail_draft, lan_start, lan_stop, lan_status])
        .run(tauri::generate_context!())
        .expect("error while running Zeolite");
}
