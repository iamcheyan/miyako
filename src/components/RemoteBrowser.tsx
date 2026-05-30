import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, SmbConfig } from "../types/tauri-commands";
import "./RemoteBrowser.css";

const MUSIC_EXTENSIONS = [".mp3", ".flac", ".aac", ".wav"];
const STORAGE_KEY = "smb-config";

function RemoteBrowser() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Load saved config and connect on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig) as SmbConfig;
        connectToSmb(config);
      } catch (e) {
        console.error("Failed to parse saved config:", e);
      }
    }
  }, []);

  const connectToSmb = async (config: SmbConfig) => {
    try {
      const result = await invoke<{ connection_id: string }>("smb_connect", {
        server: config.server,
        share: config.share,
        username: config.username,
        password: config.password,
      });
      setConnectionId(result.connection_id);
    } catch (e) {
      console.error("Failed to connect:", e);
    }
  };

  const loadDirectory = useCallback(async (path: string) => {
    if (!connectionId) {
      setError("未连接到 SMB 服务器");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<DirEntry[]>("smb_list_dir", {
        connectionId,
        path,
      });
      setEntries(result);
      setCurrentPath(path);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(`加载目录失败: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId]);

  // Load root directory on connection
  useEffect(() => {
    if (connectionId) {
      loadDirectory("");
    }
  }, [connectionId, loadDirectory]);

  const isMusicFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
    return MUSIC_EXTENSIONS.includes(ext);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleFolderClick = (folderName: string) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(newPath)) {
        newSet.delete(newPath);
      } else {
        newSet.add(newPath);
      }
      return newSet;
    });
    loadDirectory(newPath);
  };

  const handleBackClick = () => {
    if (!currentPath) return;
    const parentPath = currentPath.split("/").slice(0, -1).join("/");
    loadDirectory(parentPath);
  };

  const musicFiles = entries.filter(
    (e) => !e.is_directory && isMusicFile(e.name)
  );

  const folders = entries.filter((e) => e.is_directory);

  return (
    <div className="remote-browser">
      <div className="browser-header">
        <h2>远程目录浏览</h2>
        {currentPath && (
          <button className="back-btn" onClick={handleBackClick}>
            ← 返回上级
          </button>
        )}
      </div>

      <div className="current-path">
        当前路径: /{currentPath || "根目录"}
      </div>

      {isLoading && <div className="loading">加载中...</div>}

      {error && <div className="error-message">{error}</div>}

      {!isLoading && !error && (
        <div className="browser-content">
          {folders.length === 0 && musicFiles.length === 0 && (
            <div className="empty-state">目录为空</div>
          )}

          {folders.length > 0 && (
            <div className="section">
              <h3>文件夹</h3>
              <ul className="folder-list">
                {folders.map((folder) => (
                  <li
                    key={folder.name}
                    className={`folder-item ${
                      expandedFolders.has(`${currentPath}/${folder.name}`)
                        ? "expanded"
                        : ""
                    }`}
                    onClick={() => handleFolderClick(folder.name)}
                  >
                    <span className="folder-icon">
                      {expandedFolders.has(`${currentPath}/${folder.name}`)
                        ? "📂"
                        : "📁"}
                    </span>
                    <span className="folder-name">{folder.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {musicFiles.length > 0 && (
            <div className="section">
              <h3>音乐文件</h3>
              <ul className="file-list">
                {musicFiles.map((file) => (
                  <li key={file.name} className="file-item">
                    <span className="file-icon">🎵</span>
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatSize(file.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RemoteBrowser;
