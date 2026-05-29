mod smb_client;

use smb_client::{ConnectResult, DirEntry, DownloadResult, FileInfo};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            smb_connect,
            smb_list_dir,
            smb_download_file,
            smb_get_file_info,
            smb_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
