import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import "./MusicLibrary.css";

const STATE_PATH = "sync_state.json";

interface MusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
}

interface Folder {
  name: string;
  path: string;
  files: MusicFile[];
}

function MusicLibrary() {
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentFiles, setCurrentFiles] = useState<MusicFile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadMusicLibrary();
  }, []);

  const loadMusicLibrary = async () => {
    setIsLoading(true);
    try {
      const state = await invoke<SyncState>("sync_load_state", {
        statePath: STATE_PATH,
      });

      // 按文件夹分组
      const folderMap = new Map<string, MusicFile[]>();

      for (const file of state.synced_files) {
        const parts = file.remote_path.split("/");
        const folderPath = parts.slice(0, -1).join("/") || "根目录";
        const fileName = parts[parts.length - 1];

        if (!folderMap.has(folderPath)) {
          folderMap.set(folderPath, []);
        }

        folderMap.get(folderPath)!.push({
          name: fileName,
          remotePath: file.remote_path,
          localPath: file.local_path,
          size: file.size,
        });
      }

      // 转换为文件夹数组
      const folderArray: Folder[] = [];
      for (const [path, files] of folderMap.entries()) {
        const name = path === "根目录" ? "根目录" : path.split("/").pop()!;
        folderArray.push({ name, path, files });
      }

      setFolders(folderArray);
    } catch (e) {
      console.error("Failed to load music library:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderClick = (folder: Folder) => {
    setCurrentPath(folder.path);
    setCurrentFiles(folder.files);
    setSearchQuery("");
  };

  const handleBackClick = () => {
    setCurrentPath(null);
    setCurrentFiles([]);
    setSearchQuery("");
  };

  const handleFileClick = async (file: MusicFile) => {
    const player = getAudioPlayer();

    // 使用 local_path (绝对路径)
    console.log("Playing file:", file.localPath);

    // 加载播放列表（当前文件夹的所有音乐文件）
    const trackPaths = currentFiles.map((f) => f.localPath);
    const trackIndex = currentFiles.findIndex((f) => f.localPath === file.localPath);

    player.loadPlaylist(trackPaths, trackIndex >= 0 ? trackIndex : 0);
    await player.play();
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatFileName = (name: string): string => {
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  };

  const filteredFiles = currentFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="library-loading">
        <div className="loading-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  // 显示文件夹列表
  if (!currentPath) {
    return (
      <div className="library-page">
        {/* 固定头部：搜索栏 + 快捷操作 */}
        <div className="library-header">
          <div className="search-bar">
            <span className="material-symbols-outlined search-icon">search</span>
            <input
              type="text"
              className="search-input"
              placeholder="搜索音乐..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="quick-actions">
            <button
              className="action-card"
              onClick={() => navigate("/sync")}
            >
              <span className="material-symbols-outlined action-icon">settings_input_antenna</span>
              <span className="action-label">NAS 设置</span>
            </button>

            <button
              className="action-card"
              onClick={() => navigate("/sync")}
            >
              <span className="material-symbols-outlined action-icon">sync</span>
              <span className="action-label">同步音乐</span>
            </button>

            <button
              className="action-card"
              onClick={() => navigate("/remote")}
            >
              <span className="material-symbols-outlined action-icon">folder_open</span>
              <span className="action-label">浏览远程</span>
            </button>
          </div>
        </div>

        {/* 可滚动内容：文件夹列表 */}
        <div className="library-scroll">
          {folders.length === 0 ? (
            <div className="empty-state">
              <span className="material-symbols-outlined empty-icon">library_music</span>
              <h3 className="empty-title">还没有音乐</h3>
              <p className="empty-desc">
                请先配置 NAS 连接，然后同步音乐到本地
              </p>
              <div className="empty-actions">
                <button
                  className="empty-btn primary"
                  onClick={() => navigate("/sync")}
                >
                  配置 NAS
                </button>
                <button
                  className="empty-btn secondary"
                  onClick={() => navigate("/sync")}
                >
                  开始同步
                </button>
              </div>
            </div>
          ) : (
            <div className="folder-list">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  className="folder-item"
                  onClick={() => handleFolderClick(folder)}
                >
                  <span className="material-symbols-outlined folder-icon">folder</span>
                  <div className="folder-info">
                    <span className="folder-name">{folder.name}</span>
                    <span className="folder-count">{folder.files.length} 首歌曲</span>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 显示文件列表
  return (
    <div className="library-page">
      {/* 固定头部：返回导航 + 搜索栏 */}
      <div className="library-header">
        <div className="list-header">
          <button className="back-btn-small" onClick={handleBackClick}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="list-header-info">
            <h2 className="list-title">{currentPath.split("/").pop()}</h2>
            <span className="list-subtitle">{currentFiles.length} 首歌曲</span>
          </div>
        </div>

        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">search</span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索歌曲..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 可滚动内容：文件列表 */}
      <div className="library-scroll">
        {filteredFiles.length === 0 ? (
          <div className="empty-state small">
            <span className="material-symbols-outlined empty-icon">search_off</span>
            <p className="empty-desc">
              {searchQuery ? "没有找到匹配的歌曲" : "此文件夹没有音乐文件"}
            </p>
          </div>
        ) : (
          <div className="file-list">
            {filteredFiles.map((file, index) => (
              <button
                key={file.remotePath}
                className="file-item"
                onClick={() => handleFileClick(file)}
              >
                <span className="file-index">{index + 1}</span>
                <div className="file-info">
                  <span className="file-name">{formatFileName(file.name)}</span>
                  <span className="file-size">{formatSize(file.size)}</span>
                </div>
                <span className="material-symbols-outlined">play_circle</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MusicLibrary;
