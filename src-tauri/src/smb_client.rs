use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use smb::{Client, ClientConfig, Directory, FileDirectoryInformation, GetLen, UncPath};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use serde::{Deserialize, Serialize};

use futures_util::StreamExt;
use std::str::FromStr;

/// Connection information stored for each active SMB connection
pub struct SmbConnection {
    #[allow(dead_code)] // retained for diagnostics/logging parity with older code
    pub id: String,
    pub server: String,
    pub share: String,
    #[allow(dead_code)]
    pub username: String,
    pub client: Client,
}

/// Shared handle to a connection. The inner tokio Mutex serializes SMB I/O on
/// a single connection (the smb client is not used concurrently), while the
/// global map lock is only held to clone this handle. Network I/O never runs
/// under the global map lock, so listing/downloading on one connection cannot
/// block commands on other connections or disconnects.
pub type SharedSmbConnection = Arc<Mutex<SmbConnection>>;

/// Directory entry returned from listing
#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub last_modified: Option<i64>,
}

/// Connection result returned from smb_connect
#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectResult {
    pub success: bool,
    pub connection_id: String,
    pub message: String,
}

/// Download result
#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub message: String,
    pub bytes_written: u64,
}

/// Progress callback for downloads: `(bytes_done, total_bytes)`. Passed as
/// `&mut (dyn FnMut + '_)` so it borrows the caller's closure instead of
/// requiring `'static`.

/// Global connection manager
pub struct ConnectionManager {
    connections: Mutex<HashMap<String, SharedSmbConnection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    /// Clone the shared handle out of the map. The map lock is released
    /// immediately; per-connection I/O is serialized by the inner mutex.
    pub async fn get_connection(&self, id: &str) -> Option<SharedSmbConnection> {
        self.connections.lock().await.get(id).cloned()
    }

    pub async fn remove_connection(&self, id: &str) -> Option<SharedSmbConnection> {
        self.connections.lock().await.remove(id)
    }
}

/// Global connection manager instance
static CONNECTION_MANAGER: tokio::sync::OnceCell<ConnectionManager> =
    tokio::sync::OnceCell::const_new();

/// Get or initialize the global connection manager
async fn get_manager() -> &'static ConnectionManager {
    CONNECTION_MANAGER
        .get_or_init(|| async { ConnectionManager::new() })
        .await
}

/// Connect to an SMB share
pub async fn connect(
    server: String,
    share: String,
    username: String,
    password: String,
) -> Result<ConnectResult, String> {
    let manager = get_manager().await;

    // Generate a unique connection ID
    let connection_id = uuid::Uuid::new_v4().to_string();

    // Build UNC path: \\server\share
    let unc_path_str = format!("\\\\{}\\{}", server, share);
    let unc_path =
        UncPath::from_str(&unc_path_str).map_err(|e| format!("Invalid UNC path: {}", e))?;

    // Create client config - 匿名访问时启用 guest access
    let config = if username.is_empty() {
        ClientConfig {
            connection: smb::ConnectionConfig {
                allow_unsigned_guest_access: true,
                ..Default::default()
            },
            ..Default::default()
        }
    } else {
        ClientConfig::default()
    };

    let client = Client::new(config);

    // Connect and authenticate
    client
        .share_connect(&unc_path, &username, password)
        .await
        .map_err(|e| format!("Failed to connect to SMB server: {}", e))?;

    // Store the connection
    let conn = SmbConnection {
        id: connection_id.clone(),
        server,
        share,
        username,
        client,
    };

    let mut connections = manager.connections.lock().await;
    connections.insert(connection_id.clone(), Arc::new(Mutex::new(conn)));

    Ok(ConnectResult {
        success: true,
        connection_id,
        message: format!("Successfully connected to {}", unc_path_str),
    })
}

/// Build the full UNC path for a path inside the connection's share
fn full_unc_path(conn: &SmbConnection, path: &str) -> String {
    let path_trimmed = path.trim_start_matches('\\').trim_start_matches('/');
    if path_trimmed.is_empty() {
        format!("\\\\{}\\{}", conn.server, conn.share)
    } else {
        format!("\\\\{}\\{}\\{}", conn.server, conn.share, path_trimmed)
    }
}

/// List directory contents
pub async fn list_dir(connection_id: String, path: String) -> Result<Vec<DirEntry>, String> {
    let manager = get_manager().await;
    let conn_handle = manager
        .get_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Per-connection lock only; the global map lock is not held during I/O.
    let conn = conn_handle.lock().await;

    let full_unc_str = full_unc_path(&conn, &path);
    let unc = UncPath::from_str(&full_unc_str).map_err(|e| format!("Invalid path: {}", e))?;

    // Open the directory
    let access = smb::FileAccessMask::new().with_generic_read(true);
    let resource = conn
        .client
        .create_file(&unc, &smb::FileCreateArgs::make_open_existing(access))
        .await
        .map_err(|e| format!("Failed to open directory: {}", e))?;

    let directory = resource.unwrap_dir();

    // Wrap in Arc for the query method
    let dir_arc = Arc::new(directory);

    // Query directory contents
    let mut stream = Directory::query::<FileDirectoryInformation>(&dir_arc, "*")
        .await
        .map_err(|e| format!("Failed to query directory: {}", e))?;

    let mut result = Vec::new();

    while let Some(entry_result) = stream.next().await {
        let entry = entry_result.map_err(|e| format!("Failed to read directory entry: {}", e))?;

        let name = entry.file_name.to_string();

        // Skip . and .. entries
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = entry.file_attributes.directory();
        let size = entry.end_of_file;
        let last_modified = Some(
            entry
                .last_write_time
                .date_time()
                .assume_utc()
                .unix_timestamp(),
        );

        result.push(DirEntry {
            name,
            is_directory: is_dir,
            size,
            last_modified,
        });
    }

    // Close the directory handle
    dir_arc
        .handle()
        .close()
        .await
        .map_err(|e| format!("Failed to close directory: {}", e))?;

    Ok(result)
}

/// Size of a single SMB read during streaming downloads
const READ_CHUNK: usize = 1024 * 1024;

/// Download a file from SMB share to local path, streaming to a `.part`
/// temporary file that is renamed into place on success. `progress` is called
/// with (bytes_done, total_bytes) as chunks arrive.
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
    progress: Option<&mut (dyn FnMut(u64, u64) + Send + Sync + '_)>,
) -> Result<DownloadResult, String> {
    let manager = get_manager().await;
    let conn_handle = manager
        .get_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Ensure parent directory exists before taking the connection lock
    if let Some(parent) = Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create local directory: {}", e))?;
    }

    let part_path = format!("{}.part", local_path);

    let conn = conn_handle.lock().await;

    let full_remote_path = full_unc_path(&conn, &remote_path);
    let unc =
        UncPath::from_str(&full_remote_path).map_err(|e| format!("Invalid remote path: {}", e))?;

    // Open the remote file with read access
    let access = smb::FileAccessMask::new().with_generic_read(true);
    let resource = conn
        .client
        .create_file(&unc, &smb::FileCreateArgs::make_open_existing(access))
        .await
        .map_err(|e| format!("Failed to open remote file: {}", e))?;

    let file = resource
        .as_file()
        .ok_or_else(|| "Remote path is not a file".to_string())?;

    // Get file size
    let file_size = file
        .get_len()
        .await
        .map_err(|e| format!("Failed to get file size: {}", e))?;

    let result = stream_to_part_file(file, file_size, &part_path, progress).await;

    // Close the remote file handle regardless of the download outcome
    let close_result = file.handle().close().await;

    let written = match result {
        Ok(bytes) => bytes,
        Err(e) => {
            // Remove the partial file so stale `.part` data is never mistaken
            // for a completed download.
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err(e);
        }
    };
    close_result.map_err(|e| format!("Failed to close file: {}", e))?;

    // Atomically move the completed file into place
    tokio::fs::rename(&part_path, &local_path)
        .await
        .map_err(|e| format!("Failed to finalize local file: {}", e))?;

    Ok(DownloadResult {
        success: true,
        message: format!("Successfully downloaded {} bytes", written),
        bytes_written: written,
    })
}

/// Read the remote file in chunks and stream them to `part_path`.
async fn stream_to_part_file(
    file: &smb::File,
    file_size: u64,
    part_path: &str,
    mut progress: Option<&mut (dyn FnMut(u64, u64) + Send + Sync + '_)>,
) -> Result<u64, String> {
    let mut out = tokio::fs::File::create(part_path)
        .await
        .map_err(|e| format!("Failed to create local file: {}", e))?;

    let mut buf = vec![0u8; READ_CHUNK];
    let mut offset = 0u64;
    let mut written = 0u64;

    loop {
        let bytes_read = file
            .read_block(&mut buf, offset, None, false)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        out.write_all(&buf[..bytes_read])
            .await
            .map_err(|e| format!("Failed to write local file: {}", e))?;
        offset += bytes_read as u64;
        written += bytes_read as u64;

        if let Some(cb) = progress.as_deref_mut() {
            cb(written, file_size);
        }
    }

    out.flush()
        .await
        .map_err(|e| format!("Failed to flush local file: {}", e))?;
    Ok(written)
}

/// Disconnect from SMB server
pub async fn disconnect(connection_id: String) -> Result<DownloadResult, String> {
    let manager = get_manager().await;

    let conn_handle = manager
        .remove_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Wait for any in-flight I/O on this connection, then close the client.
    let conn = conn_handle.lock().await;
    let server = conn.server.clone();
    let share = conn.share.clone();
    conn.client
        .close()
        .await
        .map_err(|e| format!("Failed to close connection: {}", e))?;

    Ok(DownloadResult {
        success: true,
        message: format!("Disconnected from {}\\{}", server, share),
        bytes_written: 0,
    })
}
