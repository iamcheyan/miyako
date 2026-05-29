use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use smb::{Client, ClientConfig, Directory, FileDirectoryInformation, GetLen, UncPath};
use tokio::sync::Mutex;

use serde::{Deserialize, Serialize};

use futures_util::StreamExt;

/// Connection information stored for each active SMB connection
pub struct SmbConnection {
    pub id: String,
    pub server: String,
    pub share: String,
    #[allow(dead_code)]
    pub username: String,
    pub client: Client,
}

/// Directory entry returned from listing
#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub last_modified: Option<i64>,
}

/// File information returned from smb_get_file_info
#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub is_directory: bool,
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

/// Global connection manager
pub struct ConnectionManager {
    connections: Mutex<HashMap<String, SmbConnection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub async fn add_connection(&self, conn: SmbConnection) {
        let mut connections = self.connections.lock().await;
        connections.insert(conn.id.clone(), conn);
    }

    pub async fn get_connection(&self, id: &str) -> Option<String> {
        // Return just the connection_id so we can use it with the client later
        let connections = self.connections.lock().await;
        connections.get(id).map(|_| id.to_string())
    }

    pub async fn remove_connection(&self, id: &str) -> Option<SmbConnection> {
        let mut connections = self.connections.lock().await;
        connections.remove(id)
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
    let unc_path = UncPath::from_str(&unc_path_str)
        .map_err(|e| format!("Invalid UNC path: {}", e))?;

    // Create client
    let client = Client::new(ClientConfig::default());

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

    manager.add_connection(conn).await;

    Ok(ConnectResult {
        success: true,
        connection_id,
        message: format!("Successfully connected to {}", unc_path_str),
    })
}

/// List directory contents
pub async fn list_dir(
    connection_id: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    let manager = get_manager().await;
    let conn = manager
        .get_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Get the connection from the manager
    let connections = manager.connections.lock().await;
    let conn = connections
        .get(&conn)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Build the full UNC path for the directory
    let path_trimmed = path.trim_start_matches('\\').trim_start_matches('/');
    let full_unc_str = if path_trimmed.is_empty() {
        format!("\\\\{}\\{}", conn.server, conn.share)
    } else {
        format!(
            "\\\\{}\\{}\\{}",
            conn.server,
            conn.share,
            path_trimmed
        )
    };

    let unc = UncPath::from_str(&full_unc_str)
        .map_err(|e| format!("Invalid path: {}", e))?;

    // Open the directory
    let access = smb::FileAccessMask::new().with_generic_read(true);
    let resource = conn
        .client
        .create_file(&unc, &smb::FileCreateArgs::make_open_existing(access))
        .await
        .map_err(|e| format!("Failed to open directory: {}", e))?;

    let directory = resource
        .unwrap_dir();

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
        let last_modified = Some(entry.last_write_time.date_time().assume_utc().unix_timestamp());

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

/// Download a file from SMB share to local path
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<DownloadResult, String> {
    let manager = get_manager().await;
    let conn_id = manager
        .get_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Get the connection from the manager
    let connections = manager.connections.lock().await;
    let conn = connections
        .get(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Build the full remote UNC path
    let remote_path_trimmed = remote_path.trim_start_matches('\\').trim_start_matches('/');
    let full_remote_path = format!(
        "\\\\{}\\{}\\{}",
        conn.server,
        conn.share,
        remote_path_trimmed
    );

    let unc = UncPath::from_str(&full_remote_path)
        .map_err(|e| format!("Invalid remote path: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create local directory: {}", e))?;
    }

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
    let file_size = file.get_len().await.map_err(|e| format!("Failed to get file size: {}", e))?;

    // Read file contents in chunks
    let mut contents = Vec::with_capacity(file_size as usize);
    let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
    let mut offset = 0u64;

    loop {
        let bytes_read = file
            .read_block(&mut buf, offset, None, false)
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        contents.extend_from_slice(&buf[..bytes_read]);
        offset += bytes_read as u64;
    }

    // Write to local file
    std::fs::write(&local_path, &contents)
        .map_err(|e| format!("Failed to write local file: {}", e))?;

    // Close the file handle
    file.handle()
        .close()
        .await
        .map_err(|e| format!("Failed to close file: {}", e))?;

    Ok(DownloadResult {
        success: true,
        message: format!("Successfully downloaded {} bytes", contents.len()),
        bytes_written: contents.len() as u64,
    })
}

/// Get file information
pub async fn get_file_info(
    connection_id: String,
    path: String,
) -> Result<FileInfo, String> {
    let manager = get_manager().await;
    let conn_id = manager
        .get_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Get the connection from the manager
    let connections = manager.connections.lock().await;
    let conn = connections
        .get(&conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // Build the full path
    let path_trimmed = path.trim_start_matches('\\').trim_start_matches('/');
    let full_path = format!(
        "\\\\{}\\{}\\{}",
        conn.server,
        conn.share,
        path_trimmed
    );

    let unc = UncPath::from_str(&full_path)
        .map_err(|e| format!("Invalid path: {}", e))?;

    // Open the file with read access
    let access = smb::FileAccessMask::new().with_generic_read(true);
    let resource = conn
        .client
        .create_file(&unc, &smb::FileCreateArgs::make_open_existing(access))
        .await
        .map_err(|e| format!("Failed to open file: {}", e))?;

    // Extract info based on resource type
    let info = match &resource {
        smb::Resource::File(f) => {
            let size = f.get_len().await.map_err(|e| format!("Failed to get file size: {}", e))?;
            let modified = f.handle().modified().assume_utc().unix_timestamp();
            FileInfo {
                name: f.handle().name().to_string(),
                size,
                is_directory: false,
                last_modified: Some(modified),
            }
        }
        smb::Resource::Directory(d) => {
            let modified = d.handle().modified().assume_utc().unix_timestamp();
            FileInfo {
                name: d.handle().name().to_string(),
                size: 0,
                is_directory: true,
                last_modified: Some(modified),
            }
        }
        _ => {
            return Err("Unsupported resource type".to_string());
        }
    };

    // Close the resource
    match &resource {
        smb::Resource::File(f) => {
            f.handle()
                .close()
                .await
                .map_err(|e| format!("Failed to close resource: {}", e))?;
        }
        smb::Resource::Directory(d) => {
            d.handle()
                .close()
                .await
                .map_err(|e| format!("Failed to close resource: {}", e))?;
        }
        _ => {}
    }

    Ok(info)
}

/// Disconnect from SMB server
pub async fn disconnect(connection_id: String) -> Result<DownloadResult, String> {
    let manager = get_manager().await;

    let conn = manager
        .remove_connection(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    // Close the client connection
    conn.client
        .close()
        .await
        .map_err(|e| format!("Failed to close connection: {}", e))?;

    Ok(DownloadResult {
        success: true,
        message: format!("Disconnected from {}\\{}", conn.server, conn.share),
        bytes_written: 0,
    })
}
