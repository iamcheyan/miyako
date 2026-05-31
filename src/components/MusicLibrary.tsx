import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import { isDemoMode, getDemoFolders } from "../lib/demoData";
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [currentFiles, setCurrentFiles] = useState<MusicFile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMusicLibrary();
  }, []);

  const loadMusicLibrary = async () => {
    setIsLoading(true);
    
    // 演示模式：使用假数据
    if (isDemoMode()) {
      const demoFolders = getDemoFolders();
      setFolders(demoFolders as Folder[]);
      setIsLoading(false);
      return;
    }
    
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
    // 添加历史记录条目
    window.history.pushState({ path: folder.path }, "");
  };

  const handleAllFilesClick = () => {
    // 收集所有文件夹的歌曲
    const allFiles: MusicFile[] = [];
    for (const folder of folders) {
      allFiles.push(...folder.files);
    }
    setCurrentPath(t("musicLibrary.allSongs"));
    setCurrentFiles(allFiles);
    setSearchQuery("");
    // 添加历史记录条目
    window.history.pushState({ path: t("musicLibrary.allSongs") }, "");
  };

  const handleBackClick = useCallback(() => {
    setCurrentPath(null);
    setCurrentFiles([]);
    setSearchQuery("");
  }, []);

  // 处理系统返回键
  useEffect(() => {
    const handlePopState = () => {
      if (currentPath) {
        handleBackClick();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [currentPath, handleBackClick]);

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

  // 加载状态
  if (isLoading) {
    return (
      <div className="library-loading">
        <div className="loading-spinner" />
        <span>{t("musicLibrary.loading")}</span>
      </div>
    );
  }

  return (
    <div className="library-page">
      {/* 固定头部：返回导航 + 搜索按钮 */}
      <div className="library-header">
        <div className="list-header">
          <button className="back-btn-small" onClick={handleBackClick}>
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="list-header-info">
            <h2 className="list-title">{currentPath.split("/").pop()}</h2>
            <span className="list-subtitle">{currentFiles.length} {t("musicLibrary.songs")}</span>
          </div>
          <button className="search-btn" onClick={() => setIsSearchOpen(true)}>
            <span className="material-symbols-outlined">search</span>
          </button>
        </div>
      </div>

      {/* 可滚动内容：文件列表 */}
      <div className="library-scroll">
        {filteredFiles.length === 0 ? (
          <div className="empty-state small">
            <span className="material-symbols-outlined empty-icon">search_off</span>
            <p className="empty-desc">
              {searchQuery ? t("musicLibrary.searchNoResults") : t("musicLibrary.emptyFolder")}
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

      {/* 搜索弹出层 */}
      {isSearchOpen && (
        <div className="search-overlay">
          <div className="search-overlay-header">
            <span className="material-symbols-outlined search-overlay-icon">search</span>
            <input
              ref={searchInputRef}
              type="text"
              className="search-overlay-input"
              placeholder={t("musicLibrary.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button className="search-overlay-close" onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery("");
            }}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <div className="search-overlay-results">
            {searchQuery && filteredFiles.length === 0 ? (
              <div className="search-no-results">
                <span className="material-symbols-outlined">search_off</span>
                <span>{t("musicLibrary.searchNoResults")}</span>
              </div>
            ) : (
              filteredFiles.map((file) => (
                <button
                  key={file.remotePath}
                  className="search-result-item"
                  onClick={() => {
                    handleFileClick(file);
                    setIsSearchOpen(false);
                    setSearchQuery("");
                  }}
                >
                  <span className="material-symbols-outlined">music_note</span>
                  <div className="search-result-info">
                    <span className="search-result-name">{formatFileName(file.name)}</span>
                    <span className="search-result-path">{file.remotePath}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MusicLibrary;
