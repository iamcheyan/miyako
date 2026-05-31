fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    if let Some(identifier) = read_tauri_identifier() {
        println!("cargo:rustc-env=TAURI_APP_IDENTIFIER={identifier}");
    }
    tauri_build::build()
}

fn read_tauri_identifier() -> Option<String> {
    let config = std::fs::read_to_string("tauri.conf.json").ok()?;
    for line in config.lines() {
        let line = line.trim();
        if !line.starts_with("\"identifier\"") {
            continue;
        }

        let (_, value) = line.split_once(':')?;
        let value = value.trim().trim_end_matches(',').trim();
        return value.strip_prefix('"')?.strip_suffix('"').map(str::to_owned);
    }
    None
}
