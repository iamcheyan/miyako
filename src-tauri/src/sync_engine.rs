use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::smb_client;

/// Remote file entry from scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFile {
    pub remote_path: String,
    pub size: u64,
    pub last_modified: Option<i64>,
}

/// File entry from file_index.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileIndexEntry {
    pub md5: String,
    pub path: String,
    pub size: u64,
    #[serde(default, alias = "backupPath")]
    pub backup_path: Option<String>,
    pub tag: Option<String>,
}

/// File index structure from file_index.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileIndex {
    pub generated_at: f64,
    pub file_count: usize,
    pub files: Vec<FileIndexEntry>,
}

/// Sync action needed for a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub remote_path: String,
    pub local_path: String,
    pub old_local_path: Option<String>, // For LocalMove action
    pub action: Action,
    pub reason: String,
    pub md5: Option<String>,
    #[serde(default, alias = "backupPath")]
    pub backup_path: Option<String>,
    pub tag: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Action {
    Download,
    Skip,
    Delete,
    LocalMove, // New: local file move/rename
}

/// Sync state persisted to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub last_sync_time: Option<i64>,
    pub synced_files: Vec<SyncedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedFile {
    pub remote_path: String,
    pub local_path: String,
    pub size: u64,
    pub last_modified: Option<i64>,
    pub md5: Option<String>,
    #[serde(default, alias = "backupPath")]
    pub backup_path: Option<String>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
    pub remote_path: Option<String>,
}

/// Progress callback type
pub type ProgressCallback = Box<dyn Fn(usize, usize, &str) + Send + Sync>;

const MUSIC_EXTENSIONS: &[&str] = &[
    ".mp3", ".flac", ".aac", ".wav", ".m4a", ".ogg", ".ape", ".opus", ".wma", ".aiff", ".alac",
];

// #region debug-point A:download-debug-reporting
fn report_debug_event(hypothesis_id: &str, msg: &str, data: serde_json::Value) {
    if std::fs::metadata(".dbg/sync-download-stall.env").is_err() {
        return;
    }
    let env_content = std::fs::read_to_string(".dbg/sync-download-stall.env").ok();
    let url = env_content
        .as_deref()
        .and_then(|content| {
            content
                .lines()
                .find_map(|line| line.strip_prefix("DEBUG_SERVER_URL="))
        })
        .unwrap_or("http://127.0.0.1:7778/event");
    let session_id = env_content
        .as_deref()
        .and_then(|content| {
            content
                .lines()
                .find_map(|line| line.strip_prefix("DEBUG_SESSION_ID="))
        })
        .unwrap_or("sync-download-stall");

    let Some(address_and_path) = url.strip_prefix("http://") else {
        return;
    };
    let Some((address, path)) = address_and_path.split_once('/') else {
        return;
    };

    let payload = json!({
        "sessionId": session_id,
        "runId": "post-fix",
        "hypothesisId": hypothesis_id,
        "location": "src-tauri/src/sync_engine.rs",
        "msg": format!("[DEBUG] {}", msg),
        "data": data,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    });

    let Ok(body) = serde_json::to_vec(&payload) else {
        return;
    };

    if let Ok(mut stream) = TcpStream::connect(address) {
        let request = format!(
            "POST /{} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            path,
            address,
            body.len()
        );
        let _ = stream.write_all(request.as_bytes());
        let _ = stream.write_all(&body);
        let _ = stream.flush();
    }
}
// #endregion

/// Check if a file is a music file based on extension
fn is_music_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    MUSIC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

fn remote_path_has_music_extension(remote_path: &str) -> bool {
    Path::new(remote_path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_music_file)
}

fn is_not_found_error(error: &str) -> bool {
    error.contains("Object Name Not Found") || error.contains("0xc0000034")
}

/// Match an index path without extension to an actual SMB filename in its parent folder.
async fn resolve_remote_path_via_listing(
    connection_id: &str,
    remote_path: &str,
    expected_size: Option<u64>,
) -> Option<String> {
    let path = Path::new(remote_path);
    let stem = path.file_name()?.to_str()?;
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let entries = smb_client::list_dir(connection_id.to_string(), parent.clone()).await.ok()?;
    let mut exact_match: Option<String> = None;
    let mut size_match: Option<String> = None;
    let mut prefix_match: Option<String> = None;

    for entry in entries {
        if entry.is_directory {
            continue;
        }
        let name = entry.name.as_str();
        let candidate = if parent.is_empty() {
            name.to_string()
        } else {
            format!("{parent}/{name}")
        };

        if name == stem {
            exact_match = Some(candidate);
            break;
        }

        if name.starts_with(stem) {
            if let Some(size) = expected_size {
                if entry.size == size {
                    size_match = Some(candidate);
                }
            } else {
                prefix_match = Some(candidate);
            }
        }
    }

    exact_match.or(size_match).or(prefix_match)
}

/// Download a remote file, probing common extensions when the index path has none.
async fn download_remote_file_resolved(
    connection_id: &str,
    remote_path: &str,
    local_path: &str,
    expected_size: Option<u64>,
) -> Result<(String, smb_client::DownloadResult), String> {
    let filename = Path::new(remote_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if is_metadata_file(filename) {
        let result = smb_client::download_file(
            connection_id.to_string(),
            remote_path.to_string(),
            local_path.to_string(),
        )
        .await?;
        return Ok((remote_path.to_string(), result));
    }

    match smb_client::download_file(
        connection_id.to_string(),
        remote_path.to_string(),
        local_path.to_string(),
    )
    .await
    {
        Ok(result) => Ok((remote_path.to_string(), result)),
        Err(error) if is_not_found_error(&error) && !remote_path_has_music_extension(remote_path) => {
            let mut last_error = error;
            for ext in MUSIC_EXTENSIONS {
                let candidate = format!("{remote_path}{ext}");
                match smb_client::download_file(
                    connection_id.to_string(),
                    candidate.clone(),
                    local_path.to_string(),
                )
                .await
                {
                    Ok(result) => return Ok((candidate, result)),
                    Err(err) => last_error = err,
                }
            }

            if let Some(resolved) =
                resolve_remote_path_via_listing(connection_id, remote_path, expected_size).await
            {
                if resolved != remote_path {
                    match smb_client::download_file(
                        connection_id.to_string(),
                        resolved.clone(),
                        local_path.to_string(),
                    )
                    .await
                    {
                        Ok(result) => return Ok((resolved, result)),
                        Err(err) => last_error = err,
                    }
                }
            }

            Err(last_error)
        }
        Err(error) => Err(error),
    }
}

/// Check if a file is a metadata file that should be synced (e.g., file_index.json)
fn is_metadata_file(filename: &str) -> bool {
    filename.to_lowercase() == "file_index.json"
}

fn resolve_local_dir(local_dir: &str) -> Result<PathBuf, String> {
    // Android 上使用应用内部存储
    #[cfg(target_os = "android")]
    let home = crate::app_data_dir();

    #[cfg(not(target_os = "android"))]
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;

    if local_dir == "~" {
        return Ok(home);
    }

    if let Some(stripped) = local_dir.strip_prefix("~/") {
        return Ok(home.join(stripped));
    }

    Ok(PathBuf::from(local_dir))
}

fn resolve_state_path(state_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(state_path);
    if path.is_absolute() {
        return Ok(path);
    }

    #[cfg(target_os = "android")]
    {
        return Ok(crate::app_data_dir().join(path));
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(path)
    }
}

fn build_local_path(local_dir: &str, remote_path: &str) -> Result<PathBuf, String> {
    let mut full_path = resolve_local_dir(local_dir)?;
    for segment in remote_path.split('/') {
        if !segment.is_empty() {
            full_path.push(segment);
        }
    }
    Ok(full_path)
}

fn build_remote_child_path(remote_base_path: &str, filename: &str) -> String {
    let base = remote_base_path.trim_matches('/');
    if base.is_empty() {
        filename.to_string()
    } else {
        format!("{}/{}", base, filename)
    }
}

/// Normalize a remote/SMB path (no leading slashes, forward slashes).
fn normalize_remote_path(path: &str) -> String {
    path.trim()
        .trim_start_matches('\\')
        .trim_start_matches('/')
        .replace('\\', "/")
}

/// Resolve an index entry path to the SMB path used for download/list.
fn resolve_index_entry_remote_path(remote_base_path: &str, index_path: &str) -> String {
    let normalized = normalize_remote_path(index_path);
    let base = normalize_remote_path(remote_base_path);
    if base.is_empty() {
        return normalized;
    }
    if normalized == base || normalized.starts_with(&format!("{}/", base)) {
        normalized
    } else {
        format!("{}/{}", base, normalized)
    }
}

fn file_index_remote_candidates(remote_base_path: &str) -> Vec<String> {
    let base = normalize_remote_path(remote_base_path);
    let mut candidates = Vec::new();
    let primary = build_remote_child_path(&base, "file_index.json");
    candidates.push(primary);
    if !base.is_empty() {
        candidates.push("file_index.json".to_string());
    }
    if base != "Music" {
        candidates.push("Music/file_index.json".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|path| seen.insert(path.clone()));
    candidates
}

/// Recursively scan remote directory for music files
pub async fn scan_remote_directory(
    connection_id: &str,
    path: &str,
) -> Result<Vec<RemoteFile>, String> {
    let mut result = Vec::new();
    scan_directory_recursive(connection_id, path, &mut result).await?;
    Ok(result)
}

async fn scan_directory_recursive(
    connection_id: &str,
    path: &str,
    result: &mut Vec<RemoteFile>,
) -> Result<(), String> {
    let entries = smb_client::list_dir(connection_id.to_string(), path.to_string()).await?;

    for entry in entries {
        let entry_path = if path.is_empty() {
            entry.name.clone()
        } else {
            format!("{}/{}", path, entry.name)
        };

        if entry.is_directory {
            // Recursively scan subdirectories
            Box::pin(scan_directory_recursive(connection_id, &entry_path, result)).await?;
        } else if is_music_file(&entry.name) || is_metadata_file(&entry.name) {
            result.push(RemoteFile {
                remote_path: entry_path,
                size: entry.size,
                last_modified: entry.last_modified,
            });
        }
    }

    Ok(())
}

/// Recursively scan local directory for music files
async fn scan_local_music_files(dir: &Path, result: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries = fs::read_dir(dir)
        .await
        .map_err(|e| format!("Failed to read local directory {}: {}", dir.display(), e))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let path = entry.path();
        if path.is_dir() {
            Box::pin(scan_local_music_files(&path, result)).await?;
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if is_music_file(name) || is_metadata_file(name) {
                result.push(path);
            }
        }
    }

    Ok(())
}

/// Compare remote files with local directory to determine sync actions
pub async fn compare_with_local(
    remote_files: &[RemoteFile],
    local_dir: &str,
) -> Result<Vec<SyncAction>, String> {
    let mut actions = Vec::new();

    // 1. 对比远程文件，决定下载/跳过
    for remote in remote_files {
        let local_path = build_local_path(local_dir, &remote.remote_path)?;
        let local = Path::new(&local_path);
        let local_path_string = local_path.to_string_lossy().into_owned();

        if !local.exists() {
            // Local file doesn't exist, need to download
            actions.push(SyncAction {
                remote_path: remote.remote_path.clone(),
                local_path: local_path_string,
                old_local_path: None,
                action: Action::Download,
                reason: "文件不存在".to_string(),
                md5: None,
                backup_path: None,
                tag: None,
                size: Some(remote.size),
            });
        } else {
            // Check if file needs update
            let metadata = fs::metadata(&local_path)
                .await
                .map_err(|e| format!("Failed to get local file metadata: {}", e))?;

            let local_size = metadata.len();
            let local_modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);

            let needs_download = if local_size != remote.size {
                true
            } else if let (Some(remote_mod), Some(local_mod)) =
                (remote.last_modified, local_modified)
            {
                // Download if remote is newer
                remote_mod > local_mod
            } else {
                false
            };

            if needs_download {
                let reason = if local_size != remote.size {
                    format!("大小不同 (本地: {}, 远程: {})", local_size, remote.size)
                } else {
                    "远程文件更新".to_string()
                };

                actions.push(SyncAction {
                    remote_path: remote.remote_path.clone(),
                    local_path: local_path_string,
                    old_local_path: None,
                    action: Action::Download,
                    reason,
                    md5: None,
                    backup_path: None,
                    tag: None,
                    size: Some(remote.size),
                });
            } else {
                actions.push(SyncAction {
                    remote_path: remote.remote_path.clone(),
                    local_path: local_path_string,
                    old_local_path: None,
                    action: Action::Skip,
                    reason: "文件相同，跳过".to_string(),
                    md5: None,
                    backup_path: None,
                    tag: None,
                    size: Some(remote.size),
                });
            }
        }
    }

    // 2. 扫描本地目录，找出不在远程列表中的文件 → 标记删除
    let local_base = resolve_local_dir(local_dir)?;
    if local_base.exists() {
        let mut local_files = Vec::new();
        scan_local_music_files(&local_base, &mut local_files).await?;

        // 构建远程文件的本地路径集合
        let remote_local_paths: std::collections::HashSet<String> = remote_files
            .iter()
            .filter_map(|r| build_local_path(local_dir, &r.remote_path).ok())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();

        for local_file in &local_files {
            let local_str = local_file.to_string_lossy().into_owned();
            if !remote_local_paths.contains(&local_str) {
                // 本地文件不在远程列表中，需要删除
                // remote_path 用相对于 local_dir 的路径作为标识
                let remote_path = local_file
                    .strip_prefix(&local_base)
                    .unwrap_or(local_file)
                    .to_string_lossy()
                    .replace('\\', "/");

                actions.push(SyncAction {
                    remote_path,
                    local_path: local_str,
                    old_local_path: None,
                    action: Action::Delete,
                    reason: "NAS 上已删除".to_string(),
                    md5: None,
                    backup_path: None,
                    tag: None,
                    size: None,
                });
            }
        }
    }

    // Detect renames and moves using heuristics
    detect_renames_and_moves(&mut actions);

    Ok(actions)
}

/// Download file_index.json from the server
pub async fn download_file_index(
    connection_id: &str,
    remote_path: &str,
) -> Result<FileIndex, String> {
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!(
        "file_index_{}.json",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let temp_str = temp_file.to_string_lossy().into_owned();

    let candidates = file_index_remote_candidates(remote_path);
    let mut last_error = String::from("No file_index.json candidates");

    for index_path in candidates {
        if let Err(error) = smb_client::download_file(
            connection_id.to_string(),
            index_path.clone(),
            temp_str.clone(),
        )
        .await
        {
            last_error = format!("{} (tried {})", error, index_path);
            continue;
        }

        let content = match fs::read_to_string(&temp_str).await {
            Ok(content) => content,
            Err(e) => {
                last_error = format!("Failed to read file_index.json from {}: {}", index_path, e);
                continue;
            }
        };
        let _ = fs::remove_file(&temp_str).await;

        return serde_json::from_str(&content).map_err(|e| {
            format!("Failed to parse file_index.json from {}: {}", index_path, e)
        });
    }

    let _ = fs::remove_file(&temp_str).await;
    Err(format!(
        "Failed to download file_index.json (remote base: {:?}): {}",
        remote_path, last_error
    ))
}

/// Compare file_index.json with local files using MD5 matching
pub async fn compare_with_file_index(
    file_index: &FileIndex,
    local_dir: &str,
    state: &SyncState,
    remote_base_path: &str,
) -> Result<Vec<SyncAction>, String> {
    let mut actions = Vec::new();
    let index_remote_path = build_remote_child_path(remote_base_path, "file_index.json");
    let index_local_path = build_local_path(local_dir, "file_index.json")?;
    let index_local_path_str = index_local_path.to_string_lossy().into_owned();

    actions.push(SyncAction {
        remote_path: index_remote_path,
        local_path: index_local_path_str.clone(),
        old_local_path: None,
        action: Action::Download,
        reason: "同步 NAS 元数据索引".to_string(),
        md5: None,
        backup_path: None,
        tag: Some("metadata".to_string()),
        size: None,
    });

    // Build MD5 -> local file mapping from sync state
    let local_md5_map: std::collections::HashMap<String, &SyncedFile> = state
        .synced_files
        .iter()
        .filter_map(|f| f.md5.as_ref().map(|md5| (md5.clone(), f)))
        .collect();

    // Build local path set for files that exist
    let local_base = resolve_local_dir(local_dir)?;
    let mut existing_local_files: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();
    if local_base.exists() {
        let mut local_files = Vec::new();
        scan_local_music_files(&local_base, &mut local_files).await?;
        for f in local_files {
            existing_local_files.insert(f.to_string_lossy().into_owned(), f);
        }
    }

    // Track which local MD5s are matched
    let mut matched_local_md5s: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in &file_index.files {
        let entry_remote_path =
            resolve_index_entry_remote_path(remote_base_path, &entry.path);
        let local_path = build_local_path(local_dir, &entry_remote_path)?;
        let local_path_str = local_path.to_string_lossy().into_owned();

        if let Some(local_file) = local_md5_map.get(&entry.md5) {
            // MD5 exists in local state
            matched_local_md5s.insert(entry.md5.clone());

            if local_file.local_path == local_path_str {
                // Same path, check if file still exists
                if existing_local_files.contains_key(&local_path_str) {
                    // File exists at same path with same MD5 - skip
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str,
                        old_local_path: None,
                        action: Action::Skip,
                        reason: "MD5 相同，跳过".to_string(),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                } else {
                    // File was deleted locally, re-download
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str,
                        old_local_path: None,
                        action: Action::Download,
                        reason: "本地文件已删除".to_string(),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                }
            } else {
                // Different path - this is a move/rename
                if existing_local_files.contains_key(&local_file.local_path) {
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str.clone(),
                        old_local_path: Some(local_file.local_path.clone()),
                        action: Action::LocalMove,
                        reason: format!("MD5 匹配，路径变化: {} -> {}", local_file.local_path, local_path_str),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                } else {
                    // Old file doesn't exist, download
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str,
                        old_local_path: None,
                        action: Action::Download,
                        reason: "原文件不存在，需下载".to_string(),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                }
            }
        } else {
            // MD5 not in local state - new file
            if existing_local_files.contains_key(&local_path_str) {
                let local_size = fs::metadata(&local_path)
                    .await
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);

                if local_size == entry.size {
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str,
                        old_local_path: None,
                        action: Action::Skip,
                        reason: "路径和大小相同，补写 MD5/tag 元数据".to_string(),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                } else {
                    actions.push(SyncAction {
                        remote_path: entry_remote_path.clone(),
                        local_path: local_path_str,
                        old_local_path: None,
                        action: Action::Download,
                        reason: format!("本地大小不同，需更新 (本地: {}, 索引: {})", local_size, entry.size),
                        md5: Some(entry.md5.clone()),
                        backup_path: entry.backup_path.clone(),
                        tag: entry.tag.clone(),
                        size: Some(entry.size),
                    });
                }
            } else {
                // New file, download
                actions.push(SyncAction {
                    remote_path: entry_remote_path.clone(),
                    local_path: local_path_str,
                    old_local_path: None,
                    action: Action::Download,
                    reason: "新文件".to_string(),
                    md5: Some(entry.md5.clone()),
                    backup_path: entry.backup_path.clone(),
                    tag: entry.tag.clone(),
                    size: Some(entry.size),
                });
            }
        }
    }

    // Find local files not in file_index (to delete)
    let index_paths: std::collections::HashSet<String> = file_index
        .files
        .iter()
        .filter_map(|f| {
            let remote = resolve_index_entry_remote_path(remote_base_path, &f.path);
            build_local_path(local_dir, &remote).ok()
        })
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let mut index_paths = index_paths;
    index_paths.insert(index_local_path_str);

    for (local_str, _local_path) in &existing_local_files {
        if !index_paths.contains(local_str) {
            // Check if this file's MD5 was matched (moved)
            let is_matched = state.synced_files.iter().any(|f| {
                f.local_path == *local_str && f.md5.as_ref().is_some_and(|md5| matched_local_md5s.contains(md5))
            });

            if !is_matched {
                let remote_path = Path::new(local_str)
                    .strip_prefix(&local_base)
                    .unwrap_or(Path::new(local_str))
                    .to_string_lossy()
                    .replace('\\', "/");

                actions.push(SyncAction {
                    remote_path,
                    local_path: local_str.clone(),
                    old_local_path: None,
                    action: Action::Delete,
                    reason: "file_index 中不存在".to_string(),
                    md5: None,
                    backup_path: None,
                    tag: None,
                    size: None,
                });
            }
        }
    }

    Ok(actions)
}

/// Detect file renames and moves using heuristics matching
/// This converts Download+Delete pairs into LocalMove when files are likely moved
pub fn detect_renames_and_moves(actions: &mut Vec<SyncAction>) {
    let mut downloads: Vec<SyncAction> = Vec::new();
    let mut deletes: Vec<SyncAction> = Vec::new();
    let mut skips: Vec<SyncAction> = Vec::new();

    // Separate actions into downloads, deletes, and skips
    for act in actions.drain(..) {
        match act.action {
            Action::Download => downloads.push(act),
            Action::Delete => deletes.push(act),
            _ => skips.push(act),
        }
    }

    let mut final_actions = skips;

    // Matching algorithm: try to match downloads with deletes by filename
    for dl in downloads {
        let mut matched_index = None;
        let mut match_reason = String::new();

        let dl_filename = Path::new(&dl.remote_path)
            .file_name()
            .map(|f| f.to_os_string());

        if let Some(ref dl_name) = dl_filename {
            for (idx, del) in deletes.iter().enumerate() {
                if let Some(del_name) = Path::new(&del.remote_path).file_name() {
                    if dl_name == del_name {
                        matched_index = Some(idx);
                        match_reason = format!("文件名相同: {}", dl_name.to_string_lossy());
                        break;
                    }
                }
            }
        }

        if let Some(idx) = matched_index {
            let matched_delete = deletes.remove(idx);
            // Convert to LocalMove action
            final_actions.push(SyncAction {
                remote_path: dl.remote_path,
                local_path: dl.local_path,
                old_local_path: Some(matched_delete.local_path),
                action: Action::LocalMove,
                reason: format!("检测到文件移动: {}", match_reason),
                md5: dl.md5,
                backup_path: dl.backup_path,
                tag: dl.tag,
                size: dl.size,
            });
        } else {
            // No match found, keep as download
            final_actions.push(dl);
        }
    }

    // Remaining deletes that weren't matched
    final_actions.extend(deletes);
    *actions = final_actions;
}

/// Load sync state from file
pub async fn load_sync_state(state_path: &str) -> Result<SyncState, String> {
    let state_path = resolve_state_path(state_path)?;
    if !state_path.exists() {
        return Ok(SyncState {
            last_sync_time: None,
            synced_files: Vec::new(),
        });
    }

    let content = fs::read_to_string(&state_path)
        .await
        .map_err(|e| format!("Failed to read sync state: {}", e))?;

    let mut state: SyncState =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse sync state: {}", e))?;
    dedupe_sync_state(&mut state);
    Ok(state)
}

fn dedupe_sync_state(state: &mut SyncState) {
    let mut seen = std::collections::HashSet::new();
    state.synced_files.retain(|file| {
        let key = format!("{}\n{}", file.remote_path, file.local_path);
        seen.insert(key)
    });
}

/// Save sync state to file
pub async fn save_sync_state(state_path: &str, state: &SyncState) -> Result<(), String> {
    let state_path = resolve_state_path(state_path)?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize sync state: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create state directory: {}", e))?;
    }

    fs::write(&state_path, content)
        .await
        .map_err(|e| format!("Failed to write sync state: {}", e))?;

    Ok(())
}

/// Persist sync state periodically during long downloads (final save still runs at end).
const SYNC_STATE_SAVE_INTERVAL: usize = 10;

async fn maybe_save_sync_state(
    state_path: &str,
    state: &SyncState,
    pending_writes: &mut usize,
    force: bool,
) -> Result<(), String> {
    *pending_writes += 1;
    if force || *pending_writes >= SYNC_STATE_SAVE_INTERVAL {
        save_sync_state(state_path, state).await?;
        *pending_writes = 0;
    }
    Ok(())
}

/// Download files with progress callback
pub async fn sync_download(
    connection_id: &str,
    actions: &[SyncAction],
    _local_dir: &str,
    state_path: &str,
    callback: Option<&ProgressCallback>,
) -> Result<SyncState, String> {
    let mut state = load_sync_state(state_path).await?;
    let total = actions.len();
    let mut download_errors: Vec<String> = Vec::new();
    let mut pending_state_writes = 0usize;
    // #region debug-point A:sync-download-enter
    report_debug_event(
        "A",
        "sync_download entered",
        json!({
            "connectionId": connection_id,
            "actionCount": actions.len(),
            "statePath": state_path,
            "localDir": _local_dir,
            "hasCallback": callback.is_some(),
        }),
    );
    // #endregion

    for (index, action) in actions.iter().enumerate() {
        match action.action {
            Action::Download => {
                // #region debug-point A:download-action-start
                report_debug_event(
                    "A",
                    "download action started",
                    json!({
                        "index": index + 1,
                        "total": total,
                        "remotePath": action.remote_path,
                        "localPath": action.local_path,
                    }),
                );
                // #endregion
                if let Some(cb) = callback {
                    cb(index + 1, total, &format!("下载: {}", action.remote_path));
                }

                // Download the file (probe extensions when index path omits them)
                let resolved_remote_path = match download_remote_file_resolved(
                    connection_id,
                    &action.remote_path,
                    &action.local_path,
                    action.size,
                )
                .await
                {
                    Ok((resolved_remote_path, _)) => {
                        // #region debug-point B:download-file-finished
                        report_debug_event(
                            "B",
                            "download_file returned",
                            json!({
                                "index": index + 1,
                                "total": total,
                                "remotePath": action.remote_path,
                                "localPath": action.local_path,
                            }),
                        );
                        // #endregion
                        resolved_remote_path
                    }
                    Err(error) => {
                        download_errors.push(format!("{}: {}", action.remote_path, error));
                        if let Some(cb) = callback {
                            cb(
                                index + 1,
                                total,
                                &format!("下载失败: {} ({})", action.remote_path, error),
                            );
                        }
                        continue;
                    }
                };

                let is_metadata = Path::new(&action.local_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(is_metadata_file);

                let (file_size, last_modified) = if is_metadata {
                    let metadata = fs::metadata(&action.local_path)
                        .await
                        .map_err(|e| {
                            format!(
                                "Failed to get local file metadata for {}: {}",
                                action.local_path, e
                            )
                        })?;
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64);
                    (metadata.len(), modified)
                } else {
                    let file_info = smb_client::get_file_info(
                        connection_id.to_string(),
                        resolved_remote_path.clone(),
                    )
                    .await?;
                    (file_info.size, file_info.last_modified)
                };
                // #region debug-point C:file-info-finished
                report_debug_event(
                    "C",
                    "get_file_info returned",
                    json!({
                        "index": index + 1,
                        "total": total,
                        "remotePath": action.remote_path,
                        "size": file_size,
                        "lastModified": last_modified,
                    }),
                );
                // #endregion

                // Update sync state
                if let Some(existing) = state
                    .synced_files
                    .iter_mut()
                    .find(|f| {
                        f.remote_path == action.remote_path
                            || f.remote_path == resolved_remote_path
                    })
                {
                    existing.remote_path = resolved_remote_path.clone();
                    existing.local_path = action.local_path.clone();
                    existing.size = file_size;
                    existing.last_modified = last_modified;
                    existing.md5 = action.md5.clone();
                    existing.backup_path = action.backup_path.clone();
                    existing.tag = action.tag.clone();
                } else {
                    state.synced_files.push(SyncedFile {
                        remote_path: resolved_remote_path.clone(),
                        local_path: action.local_path.clone(),
                        size: file_size,
                        last_modified,
                        md5: action.md5.clone(),
                        backup_path: action.backup_path.clone(),
                        tag: action.tag.clone(),
                    });
                }

                maybe_save_sync_state(state_path, &state, &mut pending_state_writes, false).await?;

                // #region debug-point C:state-updated
                report_debug_event(
                    "C",
                    "sync state updated",
                    json!({
                        "index": index + 1,
                        "total": total,
                        "remotePath": action.remote_path,
                        "syncedFileCount": state.synced_files.len(),
                    }),
                );
                // #endregion
            }
            Action::Skip => {
                if let Some(cb) = callback {
                    cb(index + 1, total, &format!("跳过: {}", action.remote_path));
                }

                if action.md5.is_some() || action.tag.is_some() || action.backup_path.is_some() {
                    if let Some(existing) = state
                        .synced_files
                        .iter_mut()
                        .find(|f| f.remote_path == action.remote_path || f.local_path == action.local_path)
                    {
                        existing.remote_path = action.remote_path.clone();
                        existing.local_path = action.local_path.clone();
                        existing.md5 = action.md5.clone();
                        existing.backup_path = action.backup_path.clone();
                        existing.tag = action.tag.clone();
                    } else {
                        let local_path = Path::new(&action.local_path);
                        if local_path.exists() {
                            let metadata = fs::metadata(local_path)
                                .await
                                .map_err(|e| format!("Failed to get local file metadata for {}: {}", action.local_path, e))?;
                            let last_modified = metadata
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64);

                            state.synced_files.push(SyncedFile {
                                remote_path: action.remote_path.clone(),
                                local_path: action.local_path.clone(),
                                size: metadata.len(),
                                last_modified,
                                md5: action.md5.clone(),
                                backup_path: action.backup_path.clone(),
                                tag: action.tag.clone(),
                            });
                        }
                    }
                }
            }
            Action::Delete => {
                if let Some(cb) = callback {
                    cb(index + 1, total, &format!("删除: {}", action.local_path));
                }

                // Delete the local file
                let local_path = Path::new(&action.local_path);
                if local_path.exists() {
                    fs::remove_file(local_path)
                        .await
                        .map_err(|e| format!("Failed to delete {}: {}", action.local_path, e))?;
                }

                // Remove from synced_files state
                state
                    .synced_files
                    .retain(|f| f.local_path != action.local_path);
            }
            Action::LocalMove => {
                if let Some(cb) = callback {
                    cb(
                        index + 1,
                        total,
                        &format!("移动: {} -> {}", action.old_local_path.as_deref().unwrap_or("?"), action.local_path),
                    );
                }

                let old_path_str = action.old_local_path.as_ref().ok_or_else(|| {
                    format!("LocalMove action missing old_local_path for {}", action.remote_path)
                })?;
                let old_path = Path::new(old_path_str);
                let new_path = Path::new(&action.local_path);

                if old_path.exists() {
                    // 1. Ensure new directory exists
                    if let Some(parent) = new_path.parent() {
                        fs::create_dir_all(parent)
                            .await
                            .map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
                    }
                    // 2. Move/rename the file locally (millisecond operation)
                    fs::rename(old_path, new_path)
                        .await
                        .map_err(|e| format!("Failed to move {} to {}: {}", old_path_str, action.local_path, e))?;

                    // 3. Update sync state
                    if let Some(existing) = state
                        .synced_files
                        .iter_mut()
                        .find(|f| f.remote_path == action.remote_path)
                    {
                        existing.local_path = action.local_path.clone();
                        existing.md5 = action.md5.clone();
                        existing.backup_path = action.backup_path.clone();
                        existing.tag = action.tag.clone();
                    } else {
                        // If not found by remote_path, try by old local_path
                        if let Some(existing) = state
                            .synced_files
                            .iter_mut()
                            .find(|f| f.local_path == *old_path_str)
                        {
                            existing.remote_path = action.remote_path.clone();
                            existing.local_path = action.local_path.clone();
                            existing.md5 = action.md5.clone();
                            existing.backup_path = action.backup_path.clone();
                            existing.tag = action.tag.clone();
                        }
                    }

                    maybe_save_sync_state(state_path, &state, &mut pending_state_writes, false).await?;
                } else {
                    // Old file doesn't exist, fall back to download
                    if let Some(cb) = callback {
                        cb(
                            index + 1,
                            total,
                            &format!("原文件不存在，降级下载: {}", action.remote_path),
                        );
                    }
                    let (resolved_remote_path, _) = download_remote_file_resolved(
                        connection_id,
                        &action.remote_path,
                        &action.local_path,
                        action.size,
                    )
                    .await?;

                    // Update sync state
                    let file_info = smb_client::get_file_info(
                        connection_id.to_string(),
                        resolved_remote_path.clone(),
                    )
                    .await?;

                    state.synced_files.push(SyncedFile {
                        remote_path: resolved_remote_path,
                        local_path: action.local_path.clone(),
                        size: file_info.size,
                        last_modified: file_info.last_modified,
                        md5: action.md5.clone(),
                        backup_path: action.backup_path.clone(),
                        tag: action.tag.clone(),
                    });

                    maybe_save_sync_state(state_path, &state, &mut pending_state_writes, false).await?;
                }
            }
        }
    }

    if download_errors.is_empty() {
        state.last_sync_time = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64,
        );
    }

    // Save state
    // #region debug-point C:save-state-start
    report_debug_event(
        "C",
        "save_sync_state starting",
        json!({
            "statePath": state_path,
            "syncedFileCount": state.synced_files.len(),
            "downloadErrorCount": download_errors.len(),
        }),
    );
    // #endregion
    save_sync_state(state_path, &state).await?;
    // #region debug-point C:save-state-finished
    report_debug_event(
        "C",
        "save_sync_state finished",
        json!({
            "statePath": state_path,
            "syncedFileCount": state.synced_files.len(),
            "lastSyncTime": state.last_sync_time,
        }),
    );
    // #endregion

    if download_errors.is_empty() {
        println!("MiyakoSync: success, synced_files={}", state.synced_files.len());
        Ok(state)
    } else {
        let message = format!(
            "{} file(s) failed to download: {}",
            download_errors.len(),
            download_errors.join("; ")
        );
        println!("MiyakoSync: partial failure: {message}");
        Err(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_remote_path() {
        assert_eq!(normalize_remote_path("/Music/song.mp3"), "Music/song.mp3");
        assert_eq!(normalize_remote_path("Music/song.mp3"), "Music/song.mp3");
        assert_eq!(normalize_remote_path("\\Music\\song.mp3"), "Music/song.mp3");
    }

    #[test]
    fn test_resolve_index_entry_remote_path() {
        assert_eq!(
            resolve_index_entry_remote_path("", "/Music/song.mp3"),
            "Music/song.mp3"
        );
        assert_eq!(
            resolve_index_entry_remote_path("Music", "/Music/song.mp3"),
            "Music/song.mp3"
        );
        assert_eq!(
            resolve_index_entry_remote_path("Music", "subdir/song.mp3"),
            "Music/subdir/song.mp3"
        );
    }

    #[test]
    fn test_file_index_remote_candidates() {
        assert_eq!(
            file_index_remote_candidates(""),
            vec![
                "file_index.json".to_string(),
                "Music/file_index.json".to_string(),
            ]
        );
        assert_eq!(
            file_index_remote_candidates("Music"),
            vec![
                "Music/file_index.json".to_string(),
                "file_index.json".to_string(),
            ]
        );
    }

    #[test]
    fn test_is_music_file() {
        assert!(is_music_file("song.mp3"));
        assert!(is_music_file("song.flac"));
        assert!(is_music_file("song.aac"));
        assert!(is_music_file("song.wav"));
        assert!(is_music_file("SONG.MP3"));
        assert!(!is_music_file("song.txt"));
        assert!(!is_music_file("song.mp4"));
        assert!(!is_music_file("song"));
    }

    #[tokio::test]
    async fn test_compare_with_local() {
        let remote_files = vec![
            RemoteFile {
                remote_path: "music/song1.mp3".to_string(),
                size: 1024,
                last_modified: Some(1000),
            },
            RemoteFile {
                remote_path: "music/song2.flac".to_string(),
                size: 2048,
                last_modified: Some(2000),
            },
        ];

        // Test with non-existent local directory
        let actions = compare_with_local(&remote_files, "/tmp/test_sync_nonexistent")
            .await
            .unwrap();

        assert_eq!(actions.len(), 2);
        assert!(actions.iter().all(|a| a.action == Action::Download));
    }

    #[tokio::test]
    async fn test_compare_with_file_index_backfills_metadata_for_existing_same_size_file() {
        let local_dir = std::env::temp_dir().join(format!(
            "miyako_index_backfill_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let music_dir = local_dir.join("Music");
        fs::create_dir_all(&music_dir).await.unwrap();
        fs::write(music_dir.join("song.mp3"), b"abc").await.unwrap();

        let index = FileIndex {
            generated_at: 1.0,
            file_count: 1,
            files: vec![FileIndexEntry {
                md5: "900150983cd24fb0d6963f7d28e17f72".to_string(),
                path: "/Music/song.mp3".to_string(),
                size: 3,
                backup_path: Some("/backup/song.mp3".to_string()),
                tag: Some("music".to_string()),
            }],
        };
        let state = SyncState {
            last_sync_time: None,
            synced_files: Vec::new(),
        };

        let actions = compare_with_file_index(
            &index,
            local_dir.to_str().unwrap(),
            &state,
            "",
        )
        .await
        .unwrap();

        assert!(actions.iter().any(|action| {
            action.remote_path == "Music/song.mp3"
                && action.action == Action::Skip
                && action.md5.as_deref() == Some("900150983cd24fb0d6963f7d28e17f72")
                && action.backup_path.as_deref() == Some("/backup/song.mp3")
                && action.tag.as_deref() == Some("music")
        }));

        let _ = fs::remove_dir_all(&local_dir).await;
    }

    #[tokio::test]
    async fn test_sync_state_serialization() {
        let state = SyncState {
            last_sync_time: Some(1234567890),
            synced_files: vec![SyncedFile {
                remote_path: "music/song.mp3".to_string(),
                local_path: "/local/song.mp3".to_string(),
                size: 1024,
                last_modified: Some(1000),
                md5: None,
                backup_path: None,
                tag: None,
            }],
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: SyncState = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.last_sync_time, Some(1234567890));
        assert_eq!(deserialized.synced_files.len(), 1);
        assert_eq!(deserialized.synced_files[0].remote_path, "music/song.mp3");
    }
}
