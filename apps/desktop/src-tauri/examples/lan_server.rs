//! Share a folder like "Share with a phone or tablet" does, without the app
//! (for testing): `cargo run --example lan_server -- <folder> <code> [port]`.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(root), Some(code)) = (args.get(1), args.get(2)) else {
        eprintln!("usage: lan_server <folder> <code> [port]");
        std::process::exit(2);
    };
    let port = args.get(3).and_then(|p| p.parse().ok()).unwrap_or(47123);
    let server = zeolite_lib::lan::start(root.into(), "Test vault".into(), code.clone(), port, |paths| println!("changed: {paths:?}")).expect("start");
    println!("sharing {root} on {:?}:{}", zeolite_lib::lan::local_addresses(), server.port);
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
