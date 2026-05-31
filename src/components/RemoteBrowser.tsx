import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DirEntry } from "../types/tauri-commands";
import { loadSmbConfig } from "../lib/smbConfig";
import { ensureSmbConnection, getSmbSessionState, subscribeSmbSession } from "../lib/smbSession";
import "./RemoteBrowser.css";

const MUSIC_EXTENSIONS = [".mp3", ".flac", ".aac", ".wav"];

function RemoteBrowser() {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState(getSmbSessionState());
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  // 加载配置并连接
  useEffect(() => {
    const config = loadSmbConfig();
    const unsubscribe = subscribeSmbSession((nextState) => {
      setConnectionState(nextState);
      setError(nextState.error);
    });
    ensureSmbConnection(config).catch(() => {});
    return unsubscribe;
  }, []);

  const getRemotePath = (): string => {
    const config = loadSmbConfig();
    return config.remotePath || "";
  };

  const loadDirectory = useCallback(async (path: string) => {
    const activeConnectionId =
      connectionState.connectionId || await ensureSmbConnection(loadSmbConfig());

    if (!activeConnectionId) {
      setError("未连接到 SMB 服务器");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await invoke<DirEntry[]>("smb_list_dir", {
        connectionId: activeConnectionId,
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
  }, [connectionState.connectionId]);

  // 连接后加载根目录
  useEffect(() => {
    if (connectionState.connectionId) {
      loadDirectory(getRemotePath());
    }
  }, [connectionState.connectionId, loadDirectory]);

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
    setPathHistory((prev) => [...prev, currentPath]);
    loadDirectory(newPath);
  };

  const handleBackClick = () => {
    if (pathHistory.length === 0) return;
    const prevPath = pathHistory[pathHistory.length - 1];
    setPathHistory((prev) => prev.slice(0, -1));
    loadDirectory(prevPath);
  };

  const musicFiles = entries.filter(
    (e) => !e.is_directory && isMusicFile(e.name)
  );

  const folders = entries.filter((e) => e.is_directory);

  return (
    <div className="remote-browser">
      {/* 固定头部：路径导航 + 错误提示 */}
      <div className="remote-header">
        {/* 路径导航 */}
        {currentPath && (
          <div className="path-nav">
            <button className="back-btn" onClick={handleBackClick}>
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <span className="current-path">
              /{currentPath || "根目录"}
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="error-banner">
            <span className="material-symbols-outlined">error</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 可滚动内容 */}
      <div className="remote-scroll">
        {/* 加载状态 */}
        {isLoading && (
          <div className="browser-loading">
            <div className="loading-spinner" />
            <span>加载中...</span>
          </div>
        )}

        {/* 内容列表 */}
        {!isLoading && !error && (
          <div className="browser-content">
            {folders.length === 0 && musicFiles.length === 0 ? (
              <div className="empty-state">
                <span className="material-symbols-outlined empty-icon">folder_off</span>
                <span>目录为空</span>
              </div>
            ) : (
              <>
                {/* 文件夹列表 */}
                {folders.length > 0 && (
                  <div className="entry-section">
                    <h3 className="section-title">文件夹</h3>
                    <div className="entry-list">
                      {folders.map((folder) => (
                        <button
                          key={folder.name}
                          className="entry-item"
                          onClick={() => handleFolderClick(folder.name)}
                        >
                          <span className="material-symbols-outlined entry-icon folder">
                            folder
                          </span>
                          <span className="entry-name">{folder.name}</span>
                          <span className="material-symbols-outlined">chevron_right</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 音乐文件列表 */}
                {musicFiles.length > 0 && (
                  <div className="entry-section">
                    <h3 className="section-title">音乐文件</h3>
                    <div className="entry-list">
                      {musicFiles.map((file) => (
                        <div key={file.name} className="entry-item">
                          <span className="material-symbols-outlined entry-icon music">
                            audio_file
                          </span>
                          <div className="entry-info">
                            <span className="entry-name">{file.name}</span>
                            <span className="entry-size">{formatSize(file.size)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RemoteBrowser;
