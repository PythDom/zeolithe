//! Direct sync over the local network (Wi-Fi): a small HTTP server sharing
//! the open vault with a phone or tablet on the same network, which syncs
//! with it like with a WebDAV server (same three-way sync on its side).
//!
//! Every request carries the pairing code shown on the PC
//! (`Authorization: Bearer <code>`); after too many wrong codes the server
//! stops. Only files the sync handles are reachable: no hidden folders or
//! files (`.zeolite`, `.obsidian`, `.trash`…), no `..`.
//!
//!   GET    /zeolite/v1/info              → {"app":"zeolite","name":…}
//!   GET    /zeolite/v1/list              → {"files":{path: version}}
//!   GET    /zeolite/v1/file?path=…       → the file
//!   PUT    /zeolite/v1/file?path=…       → {"version":…} (folders created)
//!   DELETE /zeolite/v1/file?path=…       → 204 (also when already gone)

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use percent_encoding::percent_decode_str;
use tiny_http::{Header, Method, Request, Response, Server};

/// Wrong pairing codes accepted before the server stops (guessing protection).
const MAX_FAILURES: u32 = 20;
/// Largest file accepted (attachments included).
const MAX_UPLOAD: u64 = 200 * 1024 * 1024;

pub struct LanServer {
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
    pub port: u16,
}

impl LanServer {
    pub fn stop(mut self) {
        self.server.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }

    pub fn is_running(&self) -> bool {
        self.thread.as_ref().is_some_and(|t| !t.is_finished())
    }
}

/// Start sharing `root` on `port` (0: any free port). `on_change` is called
/// with the paths a device wrote or deleted, so the app can reload them.
pub fn start(root: PathBuf, name: String, token: String, port: u16, on_change: impl Fn(Vec<String>) + Send + 'static) -> Result<LanServer, String> {
    if token.len() < 6 {
        return Err("The pairing code is too short.".into());
    }
    let server = Arc::new(Server::http(("0.0.0.0", port)).map_err(|e| format!("Cannot start sharing on port {port}: {e}"))?);
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let srv = server.clone();
    let failures = AtomicU32::new(0);
    let thread = std::thread::spawn(move || {
        for req in srv.incoming_requests() {
            match handle(req, &root, &name, &token, &failures) {
                Handled::Changed(path) => on_change(vec![path]),
                Handled::Locked => break,
                Handled::Done => {}
            }
        }
    });
    Ok(LanServer { server, thread: Some(thread), port })
}

enum Handled {
    Done,
    Changed(String),
    /// Too many wrong pairing codes: stop serving.
    Locked,
}

fn cors(mut r: Response<std::io::Cursor<Vec<u8>>>) -> Response<std::io::Cursor<Vec<u8>>> {
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
        ("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS"),
        ("Access-Control-Max-Age", "600"),
        ("Cache-Control", "no-store"),
    ] {
        r.add_header(Header::from_bytes(k, v).unwrap());
    }
    r
}

fn json(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut r = Response::from_data(body.into_bytes()).with_status_code(status);
    r.add_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap());
    cors(r)
}

fn error(status: u16, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    json(status, serde_json::json!({ "error": message }).to_string())
}

/// A vault-relative path from the query, if it is one the sync may touch.
fn safe_path(query: &str) -> Option<String> {
    let raw = query.split('&').find_map(|kv| kv.strip_prefix("path="))?;
    let path = percent_decode_str(&raw.replace('+', " ")).decode_utf8().ok()?.to_string();
    let ok = !path.is_empty()
        && path.len() < 1024
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && path.split('/').all(|p| !p.is_empty() && !p.starts_with('.') && p != "node_modules");
    ok.then_some(path)
}

fn version(meta: &std::fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{mtime}-{}", meta.len())
}

fn list(root: &Path) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            if meta.is_dir() {
                stack.push((entry.path(), rel));
            } else if meta.is_file() {
                out.insert(rel, serde_json::Value::String(version(&meta)));
            }
        }
    }
    out
}

fn handle(mut req: Request, root: &Path, name: &str, token: &str, failures: &AtomicU32) -> Handled {
    let url = req.url().to_string();
    let (route, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let method = req.method().clone();
    if method == Method::Options {
        let _ = req.respond(cors(Response::from_data(Vec::new()).with_status_code(204)));
        return Handled::Done;
    }
    let authorised = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str() == format!("Bearer {token}"))
        .unwrap_or(false);
    if !authorised {
        let n = failures.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = req.respond(error(401, "Wrong pairing code."));
        return if n >= MAX_FAILURES { Handled::Locked } else { Handled::Done };
    }
    let mut changed = None;
    let response = match (method, route) {
        (Method::Get, "/zeolite/v1/info") => json(200, serde_json::json!({ "app": "zeolite", "name": name }).to_string()),
        (Method::Get, "/zeolite/v1/list") => json(200, serde_json::json!({ "files": list(root) }).to_string()),
        (m, "/zeolite/v1/file") => match safe_path(query) {
            None => error(400, "Not a path that can be synced."),
            Some(path) => {
                let full = root.join(&path);
                match m {
                    Method::Get => match std::fs::read(&full) {
                        Ok(bytes) => cors(Response::from_data(bytes)),
                        Err(_) => error(404, "No such file."),
                    },
                    Method::Put => {
                        if req.body_length().is_some_and(|n| n as u64 > MAX_UPLOAD) {
                            error(413, "File too large.")
                        } else {
                            let mut body = Vec::new();
                            match req.as_reader().take(MAX_UPLOAD + 1).read_to_end(&mut body) {
                                Err(e) => error(400, &e.to_string()),
                                Ok(_) if body.len() as u64 > MAX_UPLOAD => error(413, "File too large."),
                                Ok(_) => {
                                    let written = full
                                        .parent()
                                        .map(std::fs::create_dir_all)
                                        .unwrap_or(Ok(()))
                                        .and_then(|_| std::fs::write(&full, &body))
                                        .and_then(|_| std::fs::metadata(&full));
                                    match written {
                                        Ok(meta) => {
                                            changed = Some(path);
                                            json(200, serde_json::json!({ "version": version(&meta) }).to_string())
                                        }
                                        Err(e) => error(500, &e.to_string()),
                                    }
                                }
                            }
                        }
                    }
                    Method::Delete => match std::fs::remove_file(&full) {
                        Ok(_) => {
                            changed = Some(path);
                            cors(Response::from_data(Vec::new()).with_status_code(204))
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => cors(Response::from_data(Vec::new()).with_status_code(204)),
                        Err(e) => error(500, &e.to_string()),
                    },
                    _ => error(405, "Method not allowed."),
                }
            }
        },
        _ => error(404, "Unknown address."),
    };
    let _ = req.respond(response);
    changed.map(Handled::Changed).unwrap_or(Handled::Done)
}

/// This computer's address on the local network (the interface used to reach
/// the outside; no packet is sent).
pub fn local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;
    use std::sync::mpsc;

    fn call(port: u16, method: &str, path: &str, token: &str, body: &[u8]) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let head = format!("{method} {path} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        s.write_all(head.as_bytes()).unwrap();
        s.write_all(body).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let status = out[9..12].parse().unwrap();
        let body = out.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        (status, body)
    }

    #[test]
    fn serves_lists_writes_and_refuses() {
        let root = std::env::temp_dir().join(format!("zeolite-lan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        std::fs::create_dir_all(root.join(".zeolite")).unwrap();
        std::fs::write(root.join("Notes/a.md"), "# A").unwrap();
        std::fs::write(root.join(".zeolite/sync.json"), "{}").unwrap();
        let (tx, rx) = mpsc::channel();
        let srv = start(root.clone(), "Test".into(), "CODE1234".into(), 0, move |p| tx.send(p).unwrap()).unwrap();
        let port = srv.port;

        let (s, b) = call(port, "GET", "/zeolite/v1/list", "CODE1234", b"");
        assert_eq!(s, 200);
        assert!(b.contains("\"Notes/a.md\""), "{b}");
        assert!(!b.contains(".zeolite"), "{b}");

        assert_eq!(call(port, "GET", "/zeolite/v1/file?path=Notes%2Fa.md", "CODE1234", b""), (200, "# A".into()));
        let (s, b) = call(port, "PUT", "/zeolite/v1/file?path=New%20folder%2Fb%20%C3%A9.md", "CODE1234", "é".as_bytes());
        assert_eq!(s, 200, "{b}");
        assert_eq!(std::fs::read_to_string(root.join("New folder/b é.md")).unwrap(), "é");
        assert_eq!(rx.recv().unwrap(), vec!["New folder/b é.md".to_string()]);
        assert_eq!(call(port, "DELETE", "/zeolite/v1/file?path=Notes%2Fa.md", "CODE1234", b"").0, 204);
        assert!(!root.join("Notes/a.md").exists());
        assert_eq!(call(port, "DELETE", "/zeolite/v1/file?path=Notes%2Fa.md", "CODE1234", b"").0, 204);

        // Outside the synced files.
        for bad in ["..%2Fx.md", ".zeolite%2Fsync.json", "Notes%2F..%2F..%2Fx", "C%3A%5Cx"] {
            assert_eq!(call(port, "GET", &format!("/zeolite/v1/file?path={bad}"), "CODE1234", b"").0, 400, "{bad}");
        }
        // Wrong code; too many stop the server.
        assert_eq!(call(port, "GET", "/zeolite/v1/list", "nope", b"").0, 401);
        for _ in 1..MAX_FAILURES {
            let _ = call(port, "GET", "/zeolite/v1/list", "nope", b"");
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(!srv.is_running());
        srv.stop();
        let _ = std::fs::remove_dir_all(&root);
    }
}
