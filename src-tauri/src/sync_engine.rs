use parking_lot::Mutex as SyncMutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::sync::Mutex;

use crate::smb_client;

/// Remote file entry from scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFile {
    pub remote_path: String,
    pub size: u64,
    pub last_modified: Option<i64>,
}

/// Sync action needed for a file. `size`/`last_modified` are carried from the
/// remote scan so the download loop does not need a second SMB round-trip per
/// file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub remote_path: String,
    pub local_path: String,
    pub action: Action,
    pub reason: String,
    pub size: u64,
    pub last_modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Action {
    Download,
    Skip,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
    pub remote_path: Option<String>,
    /// `true` for high-frequency byte-level progress updates. UIs should
    /// update progress indicators but must not append these to a log.
    pub verbose: bool,
}

/// Progress callback type
pub type ProgressCallback = Box<dyn Fn(usize, usize, &str, bool) + Send + Sync>;

/// Cooperative cancellation flag for a running sync. The download loop checks
/// it between files and the transfer loop checks it between chunks; a cancel
/// preserves `.part` files so the next run resumes from where it stopped.
#[derive(Clone, Debug)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub(crate) fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Cancel flags for in-flight syncs, keyed by resolved state path (the same
/// key as `SYNC_LOCKS`) so the UI can cancel a running sync without holding
/// a handle to it.
static SYNC_CANCELS: LazyLock<SyncMutex<HashMap<PathBuf, CancelToken>>> =
    LazyLock::new(|| SyncMutex::new(HashMap::new()));

/// Register the cancel token for a starting sync run.
fn register_cancel(path: PathBuf, token: CancelToken) {
    SYNC_CANCELS.lock().insert(path, token);
}

/// Remove the registry entry when a sync run ends (RAII).
struct CancelGuard {
    path: PathBuf,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        SYNC_CANCELS.lock().remove(&self.path);
    }
}

/// Mark the sync identified by `state_path` as cancelled. Returns `false`
/// when no sync is currently running for that path.
pub fn request_cancel(state_path: &str) -> Result<bool, String> {
    let resolved = resolve_state_path(state_path)?;
    match SYNC_CANCELS.lock().get(&resolved) {
        Some(token) => {
            token.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

const MUSIC_EXTENSIONS: &[&str] = &[".mp3", ".flac", ".aac", ".wav"];

/// Maximum directory depth for the recursive remote scan
const MAX_SCAN_DEPTH: usize = 16;

/// Maximum number of files collected by a single remote scan
const MAX_SCAN_FILES: usize = 100_000;

/// Minimum interval between byte-level progress emissions
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(200);

/// Persist the sync state after this many files, or after this much time,
/// whichever comes first.
const STATE_CHECKPOINT_FILES: usize = 20;
const STATE_CHECKPOINT_INTERVAL: Duration = Duration::from_secs(2);

/// Abort the sync after this many consecutive download failures (e.g. the
/// NAS went away mid-sync). Single-file failures (timeouts) are skipped.
const MAX_CONSECUTIVE_FAILURES: usize = 3;

/// Check if a file is a music file based on extension
fn is_music_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    MUSIC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
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

/// Expand `~`-relative local dirs (used by the sync engine and by the
/// media protocol's allow-root command).
pub(crate) fn expand_local_dir(local_dir: &str) -> Result<PathBuf, String> {
    resolve_local_dir(local_dir)
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

/// Recursively scan remote directory for music files
pub async fn scan_remote_directory(
    connection_id: &str,
    path: &str,
) -> Result<Vec<RemoteFile>, String> {
    let mut result = Vec::new();
    scan_directory_recursive(connection_id, path, &mut result, 0).await?;
    Ok(result)
}

async fn scan_directory_recursive(
    connection_id: &str,
    path: &str,
    result: &mut Vec<RemoteFile>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH {
        return Err(format!(
            "Remote directory tree exceeds the maximum depth of {} (at '{}')",
            MAX_SCAN_DEPTH, path
        ));
    }
    if result.len() >= MAX_SCAN_FILES {
        return Err(format!(
            "Remote scan exceeded the maximum of {} music files",
            MAX_SCAN_FILES
        ));
    }

    let entries = smb_client::list_dir(connection_id.to_string(), path.to_string()).await?;

    for entry in entries {
        if result.len() >= MAX_SCAN_FILES {
            break;
        }

        let entry_path = if path.is_empty() {
            entry.name.clone()
        } else {
            format!("{}/{}", path, entry.name)
        };

        if entry.is_directory {
            // Recursively scan subdirectories
            Box::pin(scan_directory_recursive(
                connection_id,
                &entry_path,
                result,
                depth + 1,
            ))
            .await?;
        } else if is_music_file(&entry.name) {
            result.push(RemoteFile {
                remote_path: entry_path,
                size: entry.size,
                last_modified: entry.last_modified,
            });
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

    for remote in remote_files {
        let local_path = build_local_path(local_dir, &remote.remote_path)?;
        let local = Path::new(&local_path);
        let local_path_string = local_path.to_string_lossy().into_owned();

        if !local.exists() {
            // Local file doesn't exist, need to download
            actions.push(SyncAction {
                remote_path: remote.remote_path.clone(),
                local_path: local_path_string,
                action: Action::Download,
                reason: "文件不存在".to_string(),
                size: remote.size,
                last_modified: remote.last_modified,
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
                    action: Action::Download,
                    reason,
                    size: remote.size,
                    last_modified: remote.last_modified,
                });
            } else {
                actions.push(SyncAction {
                    remote_path: remote.remote_path.clone(),
                    local_path: local_path_string,
                    action: Action::Skip,
                    reason: "文件相同，跳过".to_string(),
                    size: remote.size,
                    last_modified: remote.last_modified,
                });
            }
        }
    }

    Ok(actions)
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

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse sync state: {}", e))
}

/// Save sync state to file atomically (write to a temp file, then rename), so
/// an interrupted write can never corrupt the existing state.
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

    let mut tmp_path = state_path.clone();
    let file_name = state_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sync_state.json")
        .to_string();
    tmp_path.set_file_name(format!("{}.tmp", file_name));

    fs::write(&tmp_path, content)
        .await
        .map_err(|e| format!("Failed to write sync state: {}", e))?;
    fs::rename(&tmp_path, &state_path)
        .await
        .map_err(|e| format!("Failed to finalize sync state: {}", e))?;

    Ok(())
}

/// Per-library sync locks, keyed by resolved state path. Prevents two
/// concurrent `sync_download` runs from writing the same library directory
/// and state file at the same time.
static SYNC_LOCKS: tokio::sync::OnceCell<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    tokio::sync::OnceCell::const_new();

async fn acquire_sync_lock(state_path: &str) -> Result<Arc<Mutex<()>>, String> {
    let resolved = resolve_state_path(state_path)?;
    let locks = SYNC_LOCKS
        .get_or_init(|| async { Mutex::new(HashMap::new()) })
        .await;
    let mut map = locks.lock().await;
    Ok(map
        .entry(resolved)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

/// Download files with progress callback
pub async fn sync_download(
    connection_id: &str,
    actions: &[SyncAction],
    _local_dir: &str,
    state_path: &str,
    callback: Option<&ProgressCallback>,
) -> Result<SyncState, String> {
    let lock = acquire_sync_lock(state_path).await?;
    // Try-lock: a second sync on the same library fails fast instead of
    // queueing behind the first one and double-writing state.
    let _guard = lock
        .try_lock()
        .map_err(|_| "同步已在进行中，请稍后再试".to_string())?;

    // Register the cancel token for this run so `request_cancel` can find it.
    let cancel = CancelToken::new();
    let resolved_state = resolve_state_path(state_path)?;
    register_cancel(resolved_state.clone(), cancel.clone());
    let _cancel_guard = CancelGuard {
        path: resolved_state,
    };

    let mut state = load_sync_state(state_path).await?;
    let downloads: Vec<&SyncAction> = actions
        .iter()
        .filter(|a| a.action == Action::Download)
        .collect();
    let total = downloads.len();

    let mut files_since_save = 0usize;
    let mut last_save = Instant::now();
    let mut failure: Option<String> = None;
    let mut cancelled = false;
    let mut consecutive_failures = 0usize;
    for (index, action) in downloads.iter().enumerate() {
        if let Some(cb) = callback {
            cb(
                index + 1,
                total,
                &format!("下载: {}", action.remote_path),
                false,
            );
        }

        // Byte-level progress is throttled to PROGRESS_EMIT_INTERVAL and
        // marked `verbose` so the UI can skip logging it. The emitter owns
        // its per-file throttle state to avoid holding a mutable borrow
        // across loop iterations.
        let mut last_byte_emit = Instant::now();
        let current = index + 1;
        let remote_label = action.remote_path.clone();
        let mut byte_progress = move |done: u64, size: u64| {
            if let Some(cb) = callback {
                if last_byte_emit.elapsed() >= PROGRESS_EMIT_INTERVAL && size > 0 {
                    last_byte_emit = Instant::now();
                    let pct = (done as f64 / size as f64 * 100.0).min(100.0);
                    cb(
                        current,
                        total,
                        &format!("下载: {} ({:.0}%)", remote_label, pct),
                        true,
                    );
                }
            }
        };

        let download_result = smb_client::download_file(
            connection_id.to_string(),
            action.remote_path.clone(),
            action.local_path.clone(),
            Some(&cancel),
            Some(&mut byte_progress),
        )
        .await;

        match download_result {
            Ok(result) => {
                // Use the freshly downloaded size; fall back to the scan size.
                let size = if result.bytes_written > 0 {
                    result.bytes_written
                } else {
                    action.size
                };

                if let Some(existing) = state
                    .synced_files
                    .iter_mut()
                    .find(|f| f.remote_path == action.remote_path)
                {
                    existing.local_path = action.local_path.clone();
                    existing.size = size;
                    existing.last_modified = action.last_modified;
                } else {
                    state.synced_files.push(SyncedFile {
                        remote_path: action.remote_path.clone(),
                        local_path: action.local_path.clone(),
                        size,
                        last_modified: action.last_modified,
                    });
                }
                files_since_save += 1;
                consecutive_failures = 0;

                if let Some(cb) = callback {
                    cb(
                        index + 1,
                        total,
                        &format!("完成: {}", action.remote_path),
                        false,
                    );
                }
            }
            Err(e) => {
                if e == smb_client::ERR_CANCELLED {
                    // 用户取消：保留 .part 待续传，不标记为失败
                    cancelled = true;
                    break;
                }

                // 单文件失败（含读取超时）：记录并跳过，不让整个同步卡死。
                if let Some(cb) = callback {
                    cb(
                        index + 1,
                        total,
                        &format!("跳过 {}: {}", action.remote_path, e),
                        false,
                    );
                }
                consecutive_failures += 1;
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    failure = Some(format!(
                        "连续 {} 个文件下载失败，中止同步: {}",
                        consecutive_failures, e
                    ));
                    break;
                }
            }
        }

        // Checkpoint: persist every STATE_CHECKPOINT_FILES files or every
        // STATE_CHECKPOINT_INTERVAL, so an interrupted sync can resume.
        if files_since_save >= STATE_CHECKPOINT_FILES
            || last_save.elapsed() >= STATE_CHECKPOINT_INTERVAL
        {
            if let Err(e) = save_sync_state(state_path, &state).await {
                return Err(format!("Failed to save sync state: {}", e));
            }
            files_since_save = 0;
            last_save = Instant::now();
        }
    }
    // Persist whatever completed before returning (success, failure, or error).
    // 取消不算失败，但也不盖「完成时间」戳：下次同步继续。
    state.last_sync_time = if failure.is_none() && !cancelled {
        Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        )
    } else {
        state.last_sync_time
    };

    save_sync_state(state_path, &state).await?;

    if let Some(e) = failure {
        return Err(e);
    }

    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // Scan metadata must be carried into the actions so downloads do not
        // need a second per-file SMB round-trip.
        assert_eq!(actions[0].size, 1024);
        assert_eq!(actions[0].last_modified, Some(1000));
        assert_eq!(actions[1].size, 2048);
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
            }],
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: SyncState = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.last_sync_time, Some(1234567890));
        assert_eq!(deserialized.synced_files.len(), 1);
        assert_eq!(deserialized.synced_files[0].remote_path, "music/song.mp3");
    }

    #[tokio::test]
    async fn test_save_sync_state_is_atomic_and_loadable() {
        let dir = std::env::temp_dir().join(format!(
            "miyako_sync_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state_path = dir.join("nested/sync_state.json");
        let state = SyncState {
            last_sync_time: Some(42),
            synced_files: vec![SyncedFile {
                remote_path: "a/b.flac".to_string(),
                local_path: "/local/a/b.flac".to_string(),
                size: 7,
                last_modified: None,
            }],
        };

        save_sync_state(state_path.to_str().unwrap(), &state)
            .await
            .unwrap();

        // No temp file may survive the atomic write.
        let leftover = dir.join("nested/sync_state.json.tmp");
        assert!(!leftover.exists());

        let loaded = load_sync_state(state_path.to_str().unwrap()).await.unwrap();
        assert_eq!(loaded.last_sync_time, Some(42));
        assert_eq!(loaded.synced_files.len(), 1);
        assert_eq!(loaded.synced_files[0].size, 7);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn request_cancel_matches_running_sync_lifecycle() {
        let key = std::env::temp_dir().join(format!(
            "miyako_cancel_test_{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state_path = key.to_str().unwrap().to_string();

        // 未运行中的同步：无同步可取消
        assert!(!request_cancel(&state_path).unwrap());

        // 注册（= 同步开始）后可取消；guard drop（= 同步结束）后不再可取消
        let token = CancelToken::new();
        register_cancel(key.clone(), token.clone());
        let guard = CancelGuard { path: key.clone() };

        assert!(request_cancel(&state_path).unwrap());
        assert!(token.is_cancelled());

        drop(guard);
        assert!(!request_cancel(&state_path).unwrap());
    }
}
