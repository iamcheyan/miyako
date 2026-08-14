import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import type { DirEntry } from "../types/tauri-commands";
import { loadSmbConfig } from "../lib/smbConfig";
import { ensureSmbConnection, getSmbSessionState, subscribeSmbSession } from "../lib/smbSession";
import { isDemoMode, getDemoRootEntries, getDemoEntries } from "../lib/demoData";
import { useVirtualList } from "../hooks/useVirtualList";
import { VirtualItems } from "./VirtualList";
import "./RemoteBrowser.css";

const MUSIC_EXTENSIONS = [".mp3", ".flac", ".aac", ".wav"];

// 虚拟化行高：文件夹/文件/区块标题统一 56px
const ENTRY_ROW_HEIGHT = 56;

type BrowserRow =
  | { kind: "header"; label: string }
  | { kind: "dir"; name: string }
  | { kind: "file"; name: string; size: number };

function RemoteBrowser() {
  const navigate = useNavigate();
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState(getSmbSessionState());
  const [pathHistory, setPathHistory] = useState<string[]>([]);

  // 加载配置并连接
  useEffect(() => {
    const config = loadSmbConfig();

    // 演示模式：纯前端假数据，不发起 SMB 连接
    if (isDemoMode()) {
      return;
    }

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
    // 演示模式：返回假数据
    if (isDemoMode()) {
      setIsLoading(true);
      setError(null);
      
      // 模拟加载延迟
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 根据路径返回不同的假数据
      const now = Date.now();
      const demoEntries: DirEntry[] = getDemoEntries(path).map(entry => ({
        ...entry,
        last_modified: now,
      }));
      
      setEntries(demoEntries);
      setCurrentPath(path);
      setIsLoading(false);
      return;
    }
    
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
    // 演示模式：加载假数据
    if (isDemoMode()) {
      const now = Date.now();
      const demoEntries: DirEntry[] = getDemoRootEntries().map(entry => ({
        ...entry,
        last_modified: now,
      }));
      setEntries(demoEntries);
      setCurrentPath("音乐库");
      return;
    }
    
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
    // 添加历史记录条目
    window.history.pushState({ path: newPath }, "");
  };

  const handleBackClick = useCallback(() => {
    if (pathHistory.length === 0) return;
    const prevPath = pathHistory[pathHistory.length - 1];
    setPathHistory((prev) => prev.slice(0, -1));
    loadDirectory(prevPath);
  }, [pathHistory, loadDirectory]);

  // 处理系统返回键
  useEffect(() => {
    const handlePopState = () => {
      if (pathHistory.length > 0) {
        handleBackClick();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [pathHistory.length, handleBackClick]);

  const musicFiles = entries.filter(
    (e) => !e.is_directory && isMusicFile(e.name)
  );

  const folders = entries.filter((e) => e.is_directory);

  // 统一行模型（文件夹/文件/区块标题），供虚拟化列表渲染
  const rows: BrowserRow[] = [];
  if (folders.length > 0) {
    rows.push({ kind: "header", label: "文件夹" });
    for (const folder of folders) {
      rows.push({ kind: "dir", name: folder.name });
    }
  }
  if (musicFiles.length > 0) {
    rows.push({ kind: "header", label: "音乐文件" });
    for (const file of musicFiles) {
      rows.push({ kind: "file", name: file.name, size: file.size });
    }
  }

  // 虚拟化：远程目录只渲染可视区 ±20 行
  const virtualList = useVirtualList(rows.length, ENTRY_ROW_HEIGHT);

  return (
    <div className="remote-browser">
      {/* 固定标题栏 */}
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="page-title">远程浏览</h1>
      </div>

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

      {/* 可滚动内容（虚拟化：只渲染可视区 ±20 行） */}
      <div className="remote-scroll" {...virtualList.containerProps}>
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
            {rows.length === 0 ? (
              <div className="empty-state">
                <span className="material-symbols-outlined empty-icon">folder_off</span>
                <span>目录为空</span>
              </div>
            ) : (
              <div className="entry-list">
                <VirtualItems
                  totalHeight={virtualList.totalHeight}
                  startIndex={virtualList.startIndex}
                  endIndex={virtualList.endIndex}
                  itemHeight={ENTRY_ROW_HEIGHT}
                  render={(index) => {
                    const row = rows[index];
                    if (row.kind === "header") {
                      return (
                        <div className="vrow-header">
                          <h3 className="section-title">{row.label}</h3>
                        </div>
                      );
                    }
                    if (row.kind === "dir") {
                      return (
                        <button
                          className="entry-item"
                          onClick={() => handleFolderClick(row.name)}
                        >
                          <span className="material-symbols-outlined entry-icon folder">
                            folder
                          </span>
                          <span className="entry-name">{row.name}</span>
                          <span className="material-symbols-outlined">chevron_right</span>
                        </button>
                      );
                    }
                    return (
                      <div className="entry-item">
                        <span className="material-symbols-outlined entry-icon music">
                          audio_file
                        </span>
                        <div className="entry-info">
                          <span className="entry-name">{row.name}</span>
                          <span className="entry-size">{formatSize(row.size)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RemoteBrowser;
