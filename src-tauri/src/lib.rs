mod smb_client;
mod sync_engine;

use smb_client::{ConnectResult, DirEntry, DownloadResult, FileInfo};
use sync_engine::{FileIndex, SyncAction, SyncProgress, SyncState};
use std::fs;
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

/// 读取本地音频文件并返回 base64 编码
#[tauri::command]
async fn read_audio_file(path: String) -> Result<String, String> {
    use base64::Engine;
    let data = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// 检查文件是否存在
#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).exists())
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
async fn smb_list_dir(
    connection_id: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    smb_client::list_dir(connection_id, path).await
}

/// Download file from SMB share to local path
#[tauri::command]
async fn smb_download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<DownloadResult, String> {
    smb_client::download_file(connection_id, remote_path, local_path).await
}

/// Get file information from SMB share
#[tauri::command]
async fn smb_get_file_info(
    connection_id: String,
    path: String,
) -> Result<FileInfo, String> {
    smb_client::get_file_info(connection_id, path).await
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
    let progress_callback: sync_engine::ProgressCallback = Box::new(move |current, total, message| {
        let payload = SyncProgress {
            current,
            total,
            message: message.to_string(),
            remote_path: None,
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

/// Download file_index.json from server
#[tauri::command]
async fn sync_download_file_index(
    connection_id: String,
    remote_path: String,
) -> Result<FileIndex, String> {
    sync_engine::download_file_index(&connection_id, &remote_path).await
}

/// Compare file_index.json with local files using MD5
#[tauri::command]
async fn sync_compare_with_index(
    file_index: FileIndex,
    local_dir: String,
    state_path: String,
) -> Result<Vec<SyncAction>, String> {
    let state = sync_engine::load_sync_state(&state_path).await?;
    sync_engine::compare_with_file_index(&file_index, &local_dir, &state).await
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

/// 控制 Android 状态栏显示/隐藏
#[tauri::command]
async fn set_status_bar_visible(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        window.emit("status-bar-change", visible).map_err(|e| e.to_string())?;
    }
    let _ = visible;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            smb_connect,
            smb_list_dir,
            smb_download_file,
            smb_get_file_info,
            smb_disconnect,
            sync_scan_remote,
            sync_compare,
            sync_download,
            sync_load_state,
            sync_download_file_index,
            sync_compare_with_index,
            storage_read,
            storage_write,
            read_audio_file,
            file_exists,
            set_status_bar_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
