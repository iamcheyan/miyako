use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use smb::{Client, ClientConfig, Directory, FileDirectoryInformation, GetLen, UncPath};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use serde::{Deserialize, Serialize};

use futures_util::StreamExt;
use std::str::FromStr;

use crate::sync_engine::CancelToken;

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
    // Create client config - 匿名访问时启用 guest access。
    // 30s 连接/请求超时：防止弱网下 connect / read 无限期挂起。
    let timeout = Duration::from_secs(CONNECTION_TIMEOUT_SECS);
    let config = if username.is_empty() {
        ClientConfig {
            connection: smb::ConnectionConfig {
                allow_unsigned_guest_access: true,
                timeout: Some(timeout),
                ..Default::default()
            },
            ..Default::default()
        }
    } else {
        ClientConfig {
            connection: smb::ConnectionConfig {
                timeout: Some(timeout),
                ..Default::default()
            },
            ..Default::default()
        }
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

/// Seconds without any received chunk before a single file's transfer is
/// considered stalled and the sync gives up on that file.
pub const READ_STALL_TIMEOUT_SECS: u64 = 30;

/// SMB connect/request timeout, applied at the transport level.
const CONNECTION_TIMEOUT_SECS: u64 = 30;

/// Sentinel error returned when a download is stopped by the user. Sync
/// engine translates this into its own cancel handling.
pub(crate) const ERR_CANCELLED: &str = "__CANCELLED__";

/// Where a `.part` transfer should start, given the bytes already on disk.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PartStart {
    /// No usable `.part` on disk (or it is stale): start from byte 0.
    Fresh,
    /// Keep the existing bytes and resume after this offset.
    Resume(u64),
}

/// Decide how to (re)start a `.part` file relative to the remote size. A part
/// larger than the remote file is stale garbage from a different version of
/// the file and must be restarted from scratch.
pub(crate) fn part_start_offset(part_len: Option<u64>, remote_size: u64) -> PartStart {
    match part_len {
        Some(len) if len > 0 && len <= remote_size => PartStart::Resume(len),
        _ => PartStart::Fresh,
    }
}

/// Byte-range read abstraction over a remote file. Generic so the streaming
/// loop (resume / stall timeout / cancellation) can be unit-tested with an
/// in-memory source instead of a live SMB server.
pub(crate) trait ReadSource {
    fn read_chunk<'a>(
        &'a mut self,
        buf: &'a mut [u8],
        offset: u64,
    ) -> Pin<Box<dyn Future<Output = Result<usize, String>> + Send + 'a>>;
}

/// [`ReadSource`] over an open remote SMB file.
struct SmbFileSource<'a> {
    file: &'a smb::File,
}

impl ReadSource for SmbFileSource<'_> {
    fn read_chunk<'a>(
        &'a mut self,
        buf: &'a mut [u8],
        offset: u64,
    ) -> Pin<Box<dyn Future<Output = Result<usize, String>> + Send + 'a>> {
        Box::pin(async move {
            self.file
                .read_block(buf, offset, None, false)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))
        })
    }
}

/// Download a file from SMB share to local path, streaming to a `.part`
/// temporary file that is renamed into place on success. `progress` is called
/// with (bytes_done, total_bytes) as chunks arrive.
///
/// An interrupted previous attempt is resumed: the `.part` file is appended
/// to and the remote read starts at the offset already on disk. The `.part`
/// file is preserved on cancel/timeout/error so the next run continues from
/// the same offset.
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
    cancel: Option<&CancelToken>,
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

    // 断点续传：已存在的 .part 从其当前大小继续；只有当 .part 比远端文件
    // 还大（陈旧/损坏）时才删除重来。
    let part_len = tokio::fs::metadata(&part_path).await.map(|m| m.len()).ok();
    if part_start_offset(part_len, file_size) == PartStart::Fresh {
        let _ = tokio::fs::remove_file(&part_path).await;
    }

    let result = stream_to_part_file(
        &mut SmbFileSource { file },
        file_size,
        &part_path,
        Duration::from_secs(READ_STALL_TIMEOUT_SECS),
        cancel,
        progress,
    )
    .await;

    // Close the remote file handle regardless of the download outcome
    let close_result = file.handle().close().await;

    let written = match result {
        Ok(bytes) => bytes,
        Err(e) => {
            // 保留 .part：取消/超时/失败后重跑可从已下载偏移续传
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

/// Append chunks from `source` to the `.part` file, starting from the bytes
/// already present in it (resume). Returns the total bytes now in the file.
///
/// Every chunk read must complete within `stall_timeout` of the previous one,
/// otherwise the transfer is considered stalled and fails. The cancel token
/// is checked before every chunk. On any failure the `.part` file is left in
/// place for the next run to resume.
async fn stream_to_part_file<S: ReadSource + ?Sized>(
    source: &mut S,
    file_size: u64,
    part_path: &str,
    stall_timeout: Duration,
    cancel: Option<&CancelToken>,
    mut progress: Option<&mut (dyn FnMut(u64, u64) + Send + Sync + '_)>,
) -> Result<u64, String> {
    let mut out = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part_path)
        .await
        .map_err(|e| format!("Failed to open local file: {}", e))?;

    // Existing part length == remote offset to resume from.
    let mut written = out
        .metadata()
        .await
        .map_err(|e| format!("Failed to stat local file: {}", e))?
        .len();

    let mut buf = vec![0u8; READ_CHUNK];

    // tokio::fs::File 在后台线程落盘；出错返回前必须显式 flush，
    // 否则 .part 尾部字节可能仍在缓冲区里（续传偏移以磁盘长度为准，
    // 不会损坏数据，但会让“已下载”立即可见性不稳定）。
    let outcome: Result<(), String> = loop {
        if let Some(token) = cancel {
            if token.is_cancelled() {
                break Err(ERR_CANCELLED.to_string());
            }
        }

        // 单块读超时：块必须在 stall_timeout 内返回，否则判定卡死。
        // read_fut 持有 buf 的可变借用，放进独立作用域让它在 write 前释放。
        let bytes_read = {
            let read_fut = source.read_chunk(&mut buf, written);
            tokio::pin!(read_fut);
            let deadline = tokio::time::Instant::now() + stall_timeout;
            tokio::select! {
                res = &mut read_fut => match res {
                    Ok(n) => n,
                    Err(e) => break Err(e),
                },
                _ = tokio::time::sleep_until(deadline) => {
                    break Err(format!(
                        "读取超时：{} 秒内无数据进展（跳过该文件）",
                        stall_timeout.as_secs()
                    ));
                }
            }
        };

        if bytes_read == 0 {
            break Ok(());
        }

        if let Err(e) = out.write_all(&buf[..bytes_read]).await {
            break Err(format!("Failed to write local file: {}", e));
        }
        written += bytes_read as u64;

        if let Some(cb) = progress.as_deref_mut() {
            cb(written, file_size);
        }
    };

    // 无论成功失败都 flush：成功路径报错，失败路径尽量保住已下载字节
    if let Err(e) = out.flush().await {
        if outcome.is_ok() {
            return Err(format!("Failed to flush local file: {}", e));
        }
    }
    outcome.map(|()| written)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_engine::CancelToken;

    /// In-memory [`ReadSource`] mimicking a remote file: serves
    /// `chunk_size` bytes per read, optionally fails after serving
    /// `fail_after` bytes, or hangs forever (`stall`).
    struct VecSource {
        data: Vec<u8>,
        chunk_size: usize,
        fail_after: Option<u64>,
        stall: bool,
        requested_offsets: Vec<u64>,
    }

    impl VecSource {
        fn new(data: Vec<u8>, chunk_size: usize) -> Self {
            Self {
                data,
                chunk_size,
                fail_after: None,
                stall: false,
                requested_offsets: Vec::new(),
            }
        }
    }

    impl ReadSource for VecSource {
        fn read_chunk<'a>(
            &'a mut self,
            buf: &'a mut [u8],
            offset: u64,
        ) -> Pin<Box<dyn Future<Output = Result<usize, String>> + Send + 'a>> {
            Box::pin(async move {
                if self.stall {
                    return std::future::pending().await;
                }

                if let Some(remaining) = self.fail_after {
                    if remaining == 0 {
                        return Err("模拟网络中断".to_string());
                    }
                    self.fail_after = Some(remaining - 1);
                }

                self.requested_offsets.push(offset);
                let start = offset as usize;
                if start >= self.data.len() {
                    return Ok(0);
                }
                let end = (start + self.chunk_size).min(self.data.len());
                let n = end - start;
                buf[..n].copy_from_slice(&self.data[start..end]);
                Ok(n)
            })
        }
    }

    fn temp_part_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "miyako_part_test_{}_{}_{}.part",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn part_start_offset_decides_resume_vs_fresh() {
        assert_eq!(part_start_offset(None, 100), PartStart::Fresh);
        assert_eq!(part_start_offset(Some(0), 100), PartStart::Fresh);
        // .part 比远端大：陈旧数据，必须从头开始
        assert_eq!(part_start_offset(Some(101), 100), PartStart::Fresh);
        assert_eq!(part_start_offset(Some(100), 100), PartStart::Resume(100));
        assert_eq!(part_start_offset(Some(40), 100), PartStart::Resume(40));
    }

    #[tokio::test]
    async fn interrupted_download_resumes_from_part_offset() {
        let part = temp_part_path("resume");
        let data: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();

        // 第一次：服务两个块后“网络中断”
        let mut first = VecSource::new(data.clone(), 32 * 1024);
        first.fail_after = Some(2);
        let err = stream_to_part_file(
            &mut first,
            data.len() as u64,
            part.to_str().unwrap(),
            Duration::from_secs(5),
            None,
            None,
        )
        .await;
        assert!(err.is_err());

        let part_len = tokio::fs::metadata(&part).await.unwrap().len();
        assert_eq!(part_len, 64 * 1024, "失败的 .part 必须保留已下载字节");

        // 第二次：必须从 .part 当前大小处继续读，而不是从头
        let mut second = VecSource::new(data.clone(), 32 * 1024);
        let written = stream_to_part_file(
            &mut second,
            data.len() as u64,
            part.to_str().unwrap(),
            Duration::from_secs(5),
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(written, data.len() as u64);
        assert_eq!(
            second.requested_offsets.first(),
            Some(&part_len),
            "重跑必须从已下载偏移继续（断点续传）"
        );
        let on_disk = tokio::fs::read(&part).await.unwrap();
        assert_eq!(on_disk, data, "续传后的文件内容必须与远端一致");

        let _ = std::fs::remove_file(&part);
    }

    #[tokio::test]
    async fn cancel_mid_transfer_preserves_part_file() {
        let part = temp_part_path("cancel");
        let data: Vec<u8> = vec![9u8; 300_000];
        let token = CancelToken::new();
        let trigger = token.clone();

        // 收到第一块进度后立刻取消
        let mut progress = move |_done: u64, _total: u64| {
            trigger.cancel();
        };

        let mut source = VecSource::new(data.clone(), 32 * 1024);
        let err = stream_to_part_file(
            &mut source,
            data.len() as u64,
            part.to_str().unwrap(),
            Duration::from_secs(5),
            Some(&token),
            Some(&mut progress),
        )
        .await
        .unwrap_err();

        assert_eq!(err, ERR_CANCELLED);
        let part_len = tokio::fs::metadata(&part).await.unwrap().len();
        assert!(part_len > 0, "取消后 .part 必须保留待续传");

        // 取消后重跑（无 token）能续传完成
        let mut resumed = VecSource::new(data, 32 * 1024);
        let written = stream_to_part_file(
            &mut resumed,
            300_000,
            part.to_str().unwrap(),
            Duration::from_secs(5),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(written, 300_000);
        assert_eq!(resumed.requested_offsets.first(), Some(&part_len));

        let _ = std::fs::remove_file(&part);
    }

    #[tokio::test]
    async fn stalled_read_times_out_and_skips() {
        let part = temp_part_path("stall");
        let mut source = VecSource::new(vec![1u8; 1024], 512);
        source.stall = true;

        let started = std::time::Instant::now();
        let err = stream_to_part_file(
            &mut source,
            1024,
            part.to_str().unwrap(),
            Duration::from_millis(150),
            None,
            None,
        )
        .await
        .unwrap_err();

        assert!(err.contains("读取超时"), "卡死的读必须报超时: {err}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "超时必须及时返回，而不是永久挂起"
        );

        let _ = std::fs::remove_file(&part);
    }
}
