import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SyncState } from "../types/tauri-commands";
import "./MusicLibrary.css";

const STATE_PATH = "sync_state.json";

interface MusicFile {
  name: string;
  path: string;
  size: number;
}

interface Folder {
  name: string;
  path: string;
  files: MusicFile[];
}

function MusicLibrary() {
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

      // Group files by folder
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
          path: file.remote_path,
          size: file.size,
        });
      }

      // Convert to folder array
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

  const handleFileClick = (file: MusicFile) => {
    // TODO: Play the file
    console.log("Play file:", file.path);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatFileName = (name: string): string => {
    // Remove extension
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  };

  const filteredFiles = currentFiles.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="music-library">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  // Show folder list
  if (!currentPath) {
    return (
      <div className="music-library">
        <div className="library-header">
          <h2>音乐库</h2>
        </div>

        {folders.length === 0 && (
          <div className="empty-state">
            还没有同步任何音乐
            <br />
            请先在同步页面同步音乐
          </div>
        )}

        {folders.length > 0 && (
          <div className="folder-grid">
            {folders.map((folder) => (
              <div
                key={folder.path}
                className="folder-card"
                onClick={() => handleFolderClick(folder)}
              >
                <div className="folder-icon">📁</div>
                <div className="folder-name">{folder.name}</div>
                <div className="folder-count">{folder.files.length} 首</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Show file list
  return (
    <div className="music-library">
      <div className="library-header">
        <button className="back-btn" onClick={handleBackClick}>
          ← 返回
        </button>
        <h2>{currentPath === "根目录" ? "根目录" : currentPath.split("/").pop()}</h2>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="搜索音乐..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredFiles.length === 0 && (
        <div className="empty-state">
          {searchQuery ? "没有找到匹配的音乐" : "此文件夹没有音乐文件"}
        </div>
      )}

      {filteredFiles.length > 0 && (
        <ul className="file-list">
          {filteredFiles.map((file) => (
            <li
              key={file.path}
              className="file-item"
              onClick={() => handleFileClick(file)}
            >
              <span className="file-icon">🎵</span>
              <span className="file-name">{formatFileName(file.name)}</span>
              <span className="file-size">{formatSize(file.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MusicLibrary;
