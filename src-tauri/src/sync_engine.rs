use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

use crate::smb_client;

/// Remote file entry from scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFile {
    pub remote_path: String,
    pub size: u64,
    pub last_modified: Option<i64>,
}

/// Sync action needed for a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub remote_path: String,
    pub local_path: String,
    pub action: Action,
    pub reason: String,
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

/// Progress callback type
pub type ProgressCallback = Box<dyn Fn(usize, usize, &str) + Send + Sync>;

const MUSIC_EXTENSIONS: &[&str] = &[".mp3", ".flac", ".aac", ".wav"];

/// Check if a file is a music file based on extension
fn is_music_file(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    MUSIC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
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
        let local_path = format!("{}/{}", local_dir, remote.remote_path);
        let local = Path::new(&local_path);

        if !local.exists() {
            // Local file doesn't exist, need to download
            actions.push(SyncAction {
                remote_path: remote.remote_path.clone(),
                local_path,
                action: Action::Download,
                reason: "文件不存在".to_string(),
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
                    local_path,
                    action: Action::Download,
                    reason,
                });
            } else {
                actions.push(SyncAction {
                    remote_path: remote.remote_path.clone(),
                    local_path,
                    action: Action::Skip,
                    reason: "文件相同，跳过".to_string(),
                });
            }
        }
    }

    Ok(actions)
}

/// Load sync state from file
pub async fn load_sync_state(state_path: &str) -> Result<SyncState, String> {
    if !Path::new(state_path).exists() {
        return Ok(SyncState {
            last_sync_time: None,
            synced_files: Vec::new(),
        });
    }

    let content = fs::read_to_string(state_path)
        .await
        .map_err(|e| format!("Failed to read sync state: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse sync state: {}", e))
}

/// Save sync state to file
pub async fn save_sync_state(state_path: &str, state: &SyncState) -> Result<(), String> {
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize sync state: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = Path::new(state_path).parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create state directory: {}", e))?;
    }

    fs::write(state_path, content)
        .await
        .map_err(|e| format!("Failed to write sync state: {}", e))?;

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

    for (index, action) in actions.iter().enumerate() {
        match action.action {
            Action::Download => {
                if let Some(cb) = callback {
                    cb(index + 1, total, &format!("下载: {}", action.remote_path));
                }

                // Download the file
                smb_client::download_file(
                    connection_id.to_string(),
                    action.remote_path.clone(),
                    action.local_path.clone(),
                )
                .await?;

                // Get file info for accurate size
                let file_info = smb_client::get_file_info(
                    connection_id.to_string(),
                    action.remote_path.clone(),
                )
                .await?;

                // Update sync state
                if let Some(existing) = state
                    .synced_files
                    .iter_mut()
                    .find(|f| f.remote_path == action.remote_path)
                {
                    existing.local_path = action.local_path.clone();
                    existing.size = file_info.size;
                    existing.last_modified = file_info.last_modified;
                } else {
                    state.synced_files.push(SyncedFile {
                        remote_path: action.remote_path.clone(),
                        local_path: action.local_path.clone(),
                        size: file_info.size,
                        last_modified: file_info.last_modified,
                    });
                }
            }
            Action::Skip => {
                if let Some(cb) = callback {
                    cb(index + 1, total, &format!("跳过: {}", action.remote_path));
                }
            }
        }
    }

    // Update last sync time
    state.last_sync_time = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    );

    // Save state
    save_sync_state(state_path, &state).await?;

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
}
