import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import { isDemoMode, getDemoFolders } from "../lib/demoData";
import { getFavorites, isFavorite, toggleFavorite } from "../lib/favorites";
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

// 全局音乐库缓存，用于返回路由时瞬时还原 DOM 与滚动状态，实现完美秒开和滚动恢复！
let globalLibraryCache: {
  folders: Folder[];
  currentPath: string | null;
  currentFiles: MusicFile[];
  scrollTop: number;
} | null = null;

function MusicLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>(globalLibraryCache?.folders || []);
  const [currentPath, setCurrentPath] = useState<string | null>(globalLibraryCache?.currentPath || null);
  const [currentFiles, setCurrentFiles] = useState<MusicFile[]>(globalLibraryCache?.currentFiles || []);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!globalLibraryCache);
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    loadMusicLibrary();
  }, []);

  // 检测标题是否溢出
  useEffect(() => {
    if (listTitleRef.current) {
      const el = listTitleRef.current;
      setTitleOverflow(el.scrollWidth > el.clientWidth);
    }
  }, [currentPath]);

  // 检测所有 folder-name 和 file-name 是否溢出，添加 scrolling class
  useEffect(() => {
    const checkOverflow = () => {
      document.querySelectorAll(".folder-name, .file-name").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.scrollWidth > htmlEl.clientWidth) {
          htmlEl.classList.add("scrolling");
        } else {
          htmlEl.classList.remove("scrolling");
        }
      });
    };
    // 延迟检查，等待 DOM 渲染完成
    const timer = setTimeout(checkOverflow, 100);
    return () => clearTimeout(timer);
  }, [currentFiles, folders]);

  // 监听滚动事件并更新缓存中的 scrollTop
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (globalLibraryCache) {
      globalLibraryCache.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  // 实时同步页面的分类路径和歌曲状态到全局缓存中
  useEffect(() => {
    if (globalLibraryCache) {
      globalLibraryCache.currentPath = currentPath;
      globalLibraryCache.currentFiles = currentFiles;
    }
  }, [currentPath, currentFiles]);

  // 当路径改变或页面加载完毕时，自动还原滚动条位置 (秒开恢复)
  useEffect(() => {
    const targetScrollTop = (window as any).musicLibraryScrollTop || (globalLibraryCache?.scrollTop || 0);

    if (targetScrollTop > 0) {
      const restoreScroll = () => {
        const scrollEl = document.querySelector(".page-wrapper .library-scroll");
        if (scrollEl) {
          scrollEl.scrollTop = targetScrollTop;
          
          // 极致双重校准：如果由于 Android 布局延迟导致没有一次性设置成功，在 50ms 后重新校准
          if (scrollEl.scrollTop !== targetScrollTop) {
            setTimeout(() => {
              if (scrollEl) {
                scrollEl.scrollTop = targetScrollTop;
              }
            }, 50);
          }
        }
      };

      // 三重保险定位：立即执行 + 下一帧绘制执行 + 100ms 强制落位，完美对抗慢速 CPU 渲染延迟
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      setTimeout(restoreScroll, 100);
    }
  }, [currentPath, isLoading, folders]);

  const loadMusicLibrary = async () => {
    // 只有在完全没有缓存的时候才显示加载动画，返回时直接静默后台加载，彻底消除加载闪屏
    if (!globalLibraryCache) {
      setIsLoading(true);
    }
    
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
      
      // 初始化或更新全局秒开缓存
      if (!globalLibraryCache) {
        globalLibraryCache = {
          folders: folderArray,
          currentPath: null,
          currentFiles: [],
          scrollTop: 0
        };
      } else {
        globalLibraryCache.folders = folderArray;
      }
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
    window.history.pushState({ path: folder.path }, "");
  };

  const handleAllFilesClick = () => {
    const allFiles: MusicFile[] = [];
    for (const folder of folders) {
      allFiles.push(...folder.files);
    }
    setCurrentPath(t("musicLibrary.allSongs"));
    setCurrentFiles(allFiles);
    setSearchQuery("");
    window.history.pushState({ path: t("musicLibrary.allSongs") }, "");
  };

  const handleBackClick = useCallback(() => {
    setCurrentPath(null);
    setCurrentFiles([]);
    setSearchQuery("");
  }, []);

  const handleFavoritesClick = () => {
    setCurrentPath(t("musicLibrary.quickActions.favorites"));
    setCurrentFiles(validFavorites);
    setSearchQuery("");
    window.history.pushState({ path: "favorites" }, "");
  };

  const handlePlayAllCurrentFiles = async () => {
    if (currentFiles.length === 0) return;
    const player = getAudioPlayer();
    const trackPaths = currentFiles.map((f) => f.localPath);
    player.loadPlaylist(trackPaths, 0);
    await player.play();
  };

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
    console.log("Playing file:", file.localPath);

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

  // 获取所有文件（用于全局搜索）
  const allFiles: MusicFile[] = [];
  for (const folder of folders) {
    allFiles.push(...folder.files);
  }
  
  // 获取收藏列表（favoritesVersion 用于强制更新）
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  favoritesVersion;
  const favorites = getFavorites();
  // 过滤出在本地音乐库中真实存在的收藏文件，避免因为删除文件或重命名导致数量对不上
  const validFavorites = allFiles.filter(file => favorites.includes(file.localPath));
  
  // 全局搜索结果（用于搜索弹出层）
  const searchResults = searchQuery
    ? allFiles.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];
  
  // 当前文件夹的过滤结果（用于文件列表页面）
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
      {/* 文件夹列表页面 */}
      {!currentPath ? (
        <>
          <div className="library-header">
            <div className="quick-actions">
              <button className="action-card" onClick={() => setIsSearchOpen(true)}>
                <span className="material-symbols-outlined action-icon">search</span>
                <span className="action-label">{t("common.search")}</span>
              </button>
              <button className="action-card" onClick={() => navigate("/settings")}>
                <span className="material-symbols-outlined action-icon">settings_input_antenna</span>
                <span className="action-label">{t("musicLibrary.quickActions.nasSettings")}</span>
              </button>
              <button className="action-card" onClick={() => navigate("/sync")}>
                <span className="material-symbols-outlined action-icon">sync</span>
                <span className="action-label">{t("musicLibrary.quickActions.syncMusic")}</span>
              </button>
            </div>
          </div>
          <div className="library-scroll" onScroll={handleScroll}>
            {folders.length === 0 ? (
              <div className="empty-state">
                <span className="material-symbols-outlined empty-icon">library_music</span>
                <h3 className="empty-title">{t("musicLibrary.empty.title")}</h3>
                <p className="empty-desc">{t("musicLibrary.empty.description")}</p>
                <div className="empty-actions">
                  <button className="empty-btn primary" onClick={() => navigate("/sync")}>{t("musicLibrary.empty.configureNAS")}</button>
                  <button className="empty-btn secondary" onClick={() => navigate("/sync")}>{t("musicLibrary.empty.startSync")}</button>
                </div>
              </div>
            ) : (
              <div className="folder-list">
                <button className="folder-item all-files" onClick={handleAllFilesClick}>
                  <span className="material-symbols-outlined folder-icon">library_music</span>
                  <div className="folder-info">
                    <span className="folder-name">{t("musicLibrary.allSongs")}</span>
                    <span className="folder-count">{folders.reduce((sum, f) => sum + f.files.length, 0)} {t("musicLibrary.songs")}</span>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
                <button className="folder-item favorites" onClick={handleFavoritesClick}>
                  <span className="material-symbols-outlined folder-icon" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                  <div className="folder-info">
                    <span className="folder-name">{t("musicLibrary.quickActions.favorites")}</span>
                    <span className="folder-count">{favorites.length} {t("musicLibrary.songs")}</span>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
                {folders.map((folder) => (
                  <button key={folder.path} className="folder-item" onClick={() => handleFolderClick(folder)}>
                    <span className="material-symbols-outlined folder-icon">folder</span>
                    <div className="folder-info">
                      <span className="folder-name">{folder.name}</span>
                      <span className="folder-count">{folder.files.length} {t("musicLibrary.songs")}</span>
                    </div>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 文件列表页面 */}
          <div className="library-header">
            <div className="list-header">
              <button className="back-btn-small" onClick={handleBackClick}>
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <div className="list-header-info">
                <h2 ref={listTitleRef} className={`list-title ${titleOverflow ? "scrolling" : ""}`}>{currentPath?.split("/").pop() || ""}</h2>
                <span className="list-subtitle">{currentFiles.length} {t("musicLibrary.songs")}</span>
              </div>
              <button className="play-all-btn btn-interactive" onClick={handlePlayAllCurrentFiles} title="播放全部">
                <span className="material-symbols-outlined" style={{ fontSize: "28px" }}>play_circle</span>
              </button>
              <button className="search-btn" onClick={() => setIsSearchOpen(true)}>
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
          </div>
          <div className="library-scroll" onScroll={handleScroll}>
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
                  <div key={file.remotePath} className="file-item">
                    <button className="file-play-btn" onClick={() => handleFileClick(file)}>
                      <span className="file-index">{index + 1}</span>
                      <div className="file-info">
                        <span className="file-name">{formatFileName(file.name)}</span>
                        <span className="file-size">{formatSize(file.size)}</span>
                      </div>
                      <button
                        className="file-fav-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(file.localPath);
                          setFavoritesVersion(v => v + 1);
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontVariationSettings: isFavorite(file.localPath) ? "'FILL' 1" : "'FILL' 0",
                            color: isFavorite(file.localPath) ? "#ff2d55" : undefined,
                            textShadow: isFavorite(file.localPath) ? "0 1px 0 rgba(255, 255, 255, 0.4)" : undefined
                          }}
                        >
                          favorite
                        </span>
                      </button>
                      <span className="material-symbols-outlined">play_circle</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

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
            {searchQuery && searchResults.length === 0 ? (
              <div className="search-no-results">
                <span className="material-symbols-outlined">search_off</span>
                <span>{t("musicLibrary.searchNoResults")}</span>
              </div>
            ) : (
              searchResults.map((file) => (
                <button
                  key={file.remotePath}
                  className="search-result-item"
                  onClick={() => {
                    // 搜索结果点击时，需要先加载对应的文件夹到 currentFiles
                    setCurrentFiles(allFiles);
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
