mod smb_client;
mod sync_engine;

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

use smb_client::{ConnectResult, DirEntry, DownloadResult};
use sync_engine::{SyncAction, SyncProgress, SyncState};
use tauri::http::{header, HeaderValue, Response, StatusCode};
use tauri::Emitter;

#[cfg(target_os = "android")]
pub(crate) fn app_data_dir() -> std::path::PathBuf {
    let identifier = option_env!("TAURI_APP_IDENTIFIER").unwrap_or("com.miyako.app");
    std::path::PathBuf::from(format!("/data/user/0/{identifier}/files"))
}

#[cfg(not(target_os = "android"))]
pub(crate) fn app_data_dir() -> Result<std::path::PathBuf, String> {
    dirs::data_dir().ok_or("Failed to get app data directory".to_string())
}

// ---------------------------------------------------------------------------
// media:// protocol
//
// Audio files are streamed to the WebView through a custom `media` URI scheme
// with HTTP Range support, instead of the old read_audio_file command that
// base64-encoded whole files into memory (a 3-4x memory multiplier and a GC
// storm for large FLAC/WAV files).
// ---------------------------------------------------------------------------

/// Maximum bytes served for a single Range request. The audio element issues
/// follow-up Range requests as it buffers, which bounds peak memory to one
/// chunk instead of one whole file.
const MEDIA_RANGE_CHUNK: u64 = 4 * 1024 * 1024;

/// Directories the media protocol is allowed to serve. Populated at startup
/// (app data dir / home dir) and via the `media_allow_root` command when the
/// frontend resolves a playback directory from user settings.
static ALLOWED_MEDIA_ROOTS: StdMutex<Vec<PathBuf>> = StdMutex::new(Vec::new());

fn register_default_media_roots() {
    let mut roots = ALLOWED_MEDIA_ROOTS
        .lock()
        .expect("media root lock poisoned");
    #[cfg(target_os = "android")]
    let defaults = vec![app_data_dir()];
    #[cfg(not(target_os = "android"))]
    let defaults = vec![dirs::home_dir(), dirs::audio_dir(), dirs::data_dir()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    for root in defaults {
        if let Ok(canonical) = root.canonicalize() {
            if !roots.contains(&canonical) {
                roots.push(canonical);
            }
        }
    }
}

/// Allow the media protocol to serve files under `path`. Accepts `~`-relative
/// paths (same expansion as the sync engine's local dir) so the frontend can
/// pass the configured localDir verbatim.
#[tauri::command]
fn media_allow_root(path: String) -> Result<(), String> {
    let expanded = sync_engine::expand_local_dir(&path)?;
    let canonical = std::fs::canonicalize(&expanded)
        .map_err(|e| format!("Cannot resolve media root '{}': {}", expanded.display(), e))?;
    let mut roots = ALLOWED_MEDIA_ROOTS
        .lock()
        .map_err(|_| "media root lock poisoned")?;
    if !roots.contains(&canonical) {
        roots.push(canonical);
    }
    Ok(())
}

/// Decode %XX escapes once. Tauri/convertFileSrc percent-encodes the full
/// absolute path (including '/'), so a single decode recovers it.
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("Invalid percent-encoding in media path".to_string());
            }
            let hi = (bytes[i + 1] as char)
                .to_digit(16)
                .ok_or_else(|| "Invalid percent-encoding in media path".to_string())?;
            let lo = (bytes[i + 2] as char)
                .to_digit(16)
                .ok_or_else(|| "Invalid percent-encoding in media path".to_string())?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Media path is not valid UTF-8".to_string())
}

fn mime_from_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

fn media_response(
    status: StatusCode,
    body: Vec<u8>,
    extra_headers: &[(&str, String)],
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    for (name, value) in extra_headers {
        builder = builder.header(*name, value.as_str());
    }
    builder.body(body).unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new())
            .unwrap()
    })
}

/// Resolve and validate a requested media path against the allowed roots.
fn resolve_media_path(raw: &str) -> Result<PathBuf, Response<Vec<u8>>> {
    // convertFileSrc encodes the absolute path; decode once. If the result is
    // not absolute (double-encoding somewhere in the stack), decode the
    // *decoded* string again — decoding `raw` twice is a no-op.
    let mut decoded = percent_decode(raw)
        .map_err(|e| media_response(StatusCode::BAD_REQUEST, e.into_bytes(), &[]))?;
    if !decoded.starts_with('/') {
        if let Ok(second) = percent_decode(&decoded) {
            if second.starts_with('/') {
                decoded = second;
            }
        }
    }
    if !decoded.starts_with('/') {
        return Err(media_response(
            StatusCode::BAD_REQUEST,
            format!("Media path must be absolute: {}", decoded).into_bytes(),
            &[],
        ));
    }

    let canonical = std::fs::canonicalize(&decoded).map_err(|_| {
        media_response(
            StatusCode::NOT_FOUND,
            format!("Media file not found: {}", decoded).into_bytes(),
            &[],
        )
    })?;

    let allowed = {
        let roots = ALLOWED_MEDIA_ROOTS
            .lock()
            .expect("media root lock poisoned");
        roots.iter().any(|root| canonical.starts_with(root))
    };
    if !allowed {
        return Err(media_response(
            StatusCode::FORBIDDEN,
            format!("Media path is outside the allowed roots: {}", decoded).into_bytes(),
            &[],
        ));
    }
    Ok(canonical)
}

/// Parse a `Range: bytes=...` header into (start, end_inclusive), where the
/// end is capped to keep responses bounded.
fn parse_range(header_value: &str, file_len: u64) -> Option<(u64, u64)> {
    let spec = header_value.trim().strip_prefix("bytes=")?;
    let spec = spec.trim();
    let (start_str, end_str) = if let Some((s, e)) = spec.split_once('-') {
        (s, e)
    } else {
        return None;
    };

    let range = if start_str.is_empty() {
        // suffix range: bytes=-N (last N bytes)
        let suffix: u64 = end_str.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = file_len.saturating_sub(suffix);
        (start, file_len.saturating_sub(1))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= file_len {
            return None;
        }
        let end = if end_str.is_empty() {
            file_len - 1
        } else {
            end_str.parse::<u64>().ok()?.min(file_len - 1)
        };
        (start, end)
    };

    // Cap each response to MEDIA_RANGE_CHUNK so peak memory stays bounded.
    let (start, end) = range;
    let capped_end = (start + MEDIA_RANGE_CHUNK - 1).min(end);
    Some((start, capped_end))
}

fn read_range(path: &Path, start: u64, end: u64) -> Result<Vec<u8>, String> {
    let len = (end - start + 1) as usize;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open media file: {}", e))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("Failed to seek media file: {}", e))?;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("Failed to read media file: {}", e))?;
    Ok(buf)
}

fn handle_media_request(request: tauri::http::Request<Vec<u8>>) -> Response<Vec<u8>> {
    let raw_path = request.uri().path().to_string();
    // Strip query string if present.
    let raw_path = raw_path.split('?').next().unwrap_or("").to_string();

    let path = match resolve_media_path(&raw_path) {
        Ok(p) => p,
        Err(resp) => return resp,
    };

    let mime = mime_from_ext(&path);
    let file_len = match std::fs::metadata(&path) {
        Ok(m) if m.is_file() => m.len(),
        _ => {
            return media_response(
                StatusCode::NOT_FOUND,
                format!("Media file not found: {}", path.display()).into_bytes(),
                &[],
            )
        }
    };

    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    match range_header
        .as_deref()
        .and_then(|r| parse_range(r, file_len))
    {
        Some((start, end)) if end >= start => {
            let content_range = format!("bytes {}-{}/{}", start, end, file_len);
            match read_range(&path, start, end) {
                Ok(body) => {
                    let content_len = body.len().to_string();
                    media_response(
                        StatusCode::PARTIAL_CONTENT,
                        body,
                        &[
                            (header::CONTENT_TYPE.as_str(), mime.to_string()),
                            (header::CONTENT_RANGE.as_str(), content_range),
                            (header::CONTENT_LENGTH.as_str(), content_len),
                        ],
                    )
                }
                Err(e) => media_response(StatusCode::INTERNAL_SERVER_ERROR, e.into_bytes(), &[]),
            }
        }
        _ => {
            // No (or unsatisfiable) Range header: serve the whole file. This
            // still avoids base64 and the extra JS-side copies.
            match read_range(&path, 0, file_len.saturating_sub(1)) {
                Ok(body) => {
                    let content_len = body.len().to_string();
                    media_response(
                        StatusCode::OK,
                        body,
                        &[
                            (header::CONTENT_TYPE.as_str(), mime.to_string()),
                            (header::CONTENT_LENGTH.as_str(), content_len),
                        ],
                    )
                }
                Err(e) => media_response(StatusCode::INTERNAL_SERVER_ERROR, e.into_bytes(), &[]),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Connect to an SMB share
#[tauri::command]
async fn smb_connect(
    server: String,
    share: String,
    username: String,
    password: String,
) -> Result<ConnectResult, String> {
    smb_client::connect(server, share, username, password).await
}

/// List directory contents on SMB share
#[tauri::command]
async fn smb_list_dir(connection_id: String, path: String) -> Result<Vec<DirEntry>, String> {
    smb_client::list_dir(connection_id, path).await
}

/// Disconnect from SMB server
#[tauri::command]
async fn smb_disconnect(connection_id: String) -> Result<DownloadResult, String> {
    smb_client::disconnect(connection_id).await
}

/// Scan remote directory recursively for music files
#[tauri::command]
async fn sync_scan_remote(
    connection_id: String,
    path: String,
) -> Result<Vec<sync_engine::RemoteFile>, String> {
    sync_engine::scan_remote_directory(&connection_id, &path).await
}

/// Compare remote files with local directory
#[tauri::command]
async fn sync_compare(
    remote_files: Vec<sync_engine::RemoteFile>,
    local_dir: String,
) -> Result<Vec<SyncAction>, String> {
    sync_engine::compare_with_local(&remote_files, &local_dir).await
}

/// Perform sync download
#[tauri::command]
async fn sync_download(
    window: tauri::WebviewWindow,
    connection_id: String,
    actions: Vec<SyncAction>,
    local_dir: String,
    state_path: String,
) -> Result<SyncState, String> {
    let window_handle = window.clone();
    let progress_callback: sync_engine::ProgressCallback =
        Box::new(move |current, total, message, verbose| {
            let payload = SyncProgress {
                current,
                total,
                message: message.to_string(),
                remote_path: None,
                verbose,
            };
            let _ = window_handle.emit("sync-progress", payload);
        });

    sync_engine::sync_download(
        &connection_id,
        &actions,
        &local_dir,
        &state_path,
        Some(&progress_callback),
    )
    .await
}

/// Load sync state
#[tauri::command]
async fn sync_load_state(state_path: String) -> Result<SyncState, String> {
    sync_engine::load_sync_state(&state_path).await
}

/// Read JSON file from app data directory
#[tauri::command]
async fn storage_read(dir: String, filename: String) -> Result<String, String> {
    let app_data = get_app_data_dir()?;
    let file_path = app_data.join(&dir).join(&filename);

    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path.display()));
    }

    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write JSON file to app data directory
#[tauri::command]
async fn storage_write(dir: String, filename: String, content: String) -> Result<(), String> {
    let app_data = get_app_data_dir()?;
    let dir_path = app_data.join(&dir);
    let file_path = dir_path.join(&filename);

    // Create directory if it doesn't exist
    fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))?;

    fs::write(&file_path, content).map_err(|e| format!("Failed to write file: {}", e))
}

/// 获取应用数据目录（跨平台）
fn get_app_data_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        Ok(app_data_dir())
    }

    #[cfg(not(target_os = "android"))]
    {
        app_data_dir()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_default_media_roots();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .register_uri_scheme_protocol("media", |_ctx, request| handle_media_request(request))
        .invoke_handler(tauri::generate_handler![
            smb_connect,
            smb_list_dir,
            smb_disconnect,
            sync_scan_remote,
            sync_compare,
            sync_download,
            sync_load_state,
            storage_read,
            storage_write,
            media_allow_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod media_tests {
    use super::*;

    #[test]
    fn percent_decode_recovers_encoded_paths() {
        assert_eq!(
            percent_decode("/data%2Fuser%2F0%2Fmusic.flac").unwrap(),
            "/data/user/0/music.flac"
        );
        assert_eq!(
            percent_decode("/plain/path.mp3").unwrap(),
            "/plain/path.mp3"
        );
        assert!(percent_decode("/bad%2").is_err());
        assert!(percent_decode("/bad%zz").is_err());
    }

    #[test]
    fn double_encoded_path_decodes_to_absolute() {
        // %252F is '%' + '2F': decoding once yields "%2F", decoding the
        // decoded string again yields "/". Simulates double-encoding in the
        // URI stack.
        let once = percent_decode("%252Fdata%252Fmusic.flac").unwrap();
        assert_eq!(once, "%2Fdata%2Fmusic.flac");
        let twice = percent_decode(&once).unwrap();
        assert_eq!(twice, "/data/music.flac");
        assert!(twice.starts_with('/'));
    }

    #[test]
    fn parse_range_handles_all_forms() {
        // plain range
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        // open-ended range is capped to the chunk size
        let (start, end) = parse_range("bytes=0-", 10 * MEDIA_RANGE_CHUNK).unwrap();
        assert_eq!(start, 0);
        assert_eq!(end, MEDIA_RANGE_CHUNK - 1);
        // range exceeding the file is clamped
        assert_eq!(parse_range("bytes=500-", 600), Some((500, 599)));
        // suffix range
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // start beyond the file is unsatisfiable
        assert_eq!(parse_range("bytes=2000-", 1000), None);
        // malformed header
        assert_eq!(parse_range("chunks=0-50", 1000), None);
    }

    #[test]
    fn read_range_reads_exact_slice() {
        let dir = std::env::temp_dir().join(format!(
            "miyako_media_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.bin");
        let data: Vec<u8> = (0..=255u8).collect();
        std::fs::write(&file, &data).unwrap();

        assert_eq!(read_range(&file, 10, 20).unwrap(), data[10..=20].to_vec());
        assert_eq!(read_range(&file, 0, 255).unwrap(), data);

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
