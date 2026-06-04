import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import { isDemoMode, getDemoFolders, getDemoPlaylist } from "../lib/demoData";
import { getFavorites, isFavorite, toggleFavorite } from "../lib/favorites";
import { getPlayCount } from "../lib/playCount";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { PullToRefresh } from "./PullToRefresh";
import { SYNC_STATE_PATH, getUniquePlayableSyncedFiles } from "../lib/syncState";
import { LIBRARY_SYNC_COMPLETE } from "../lib/libraryEvents";
import { getBaseName, stripExtension } from "../lib/pathUtils";
import "./MusicLibrary.css";

declare global {
  interface Window {
    musicLibraryScrollTop?: number;
  }
}

interface MusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
  playCount: number;
  lastModified: number;
  md5?: string;
  tag?: string;
}

interface Folder {
  name: string;
  path: string;
  files: MusicFile[];
}

// 全局音乐库缓存，用于返回路由时瞬时还原 DOM 与滚动状态，实现完美秒开和滚动恢复！
let globalLibraryCache: {
  folders: Folder[];
  rootFiles: MusicFile[];
  currentPath: string | null;
  currentFiles: MusicFile[];
  scrollTop: number;
} | null = null;

type SortMode = "default" | "playCount" | "syncTimeAsc" | "syncTimeDesc";
type ActiveTab = "music" | "podcast";

function MusicLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<Folder[]>(globalLibraryCache?.folders || []);
  const [rootFiles, setRootFiles] = useState<MusicFile[]>(globalLibraryCache?.rootFiles || []);
  const [currentPath, setCurrentPath] = useState<string | null>(globalLibraryCache?.currentPath || null);
  const [currentFiles, setCurrentFiles] = useState<MusicFile[]>(globalLibraryCache?.currentFiles || []);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(!globalLibraryCache);
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    return (localStorage.getItem("miyako_active_tab") as ActiveTab) || "music";
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listTitleRef = useRef<HTMLHeadingElement>(null);

  // 切换标签页并保存到本地存储
  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    localStorage.setItem("miyako_active_tab", tab);
  };

  const filterByActiveTab = useCallback((files: MusicFile[], tab: ActiveTab = activeTab) => {
    if (tab === "music") return files.filter(file => file.tag !== "podcast");
    if (tab === "podcast") return files.filter(file => file.tag === "podcast");
    return files;
  }, [activeTab]);

  useEffect(() => {
    loadMusicLibrary();
  }, []);

  useEffect(() => {
    const onSyncComplete = () => {
      globalLibraryCache = null;
      void loadMusicLibrary();
    };
    window.addEventListener(LIBRARY_SYNC_COMPLETE, onSyncComplete);
    return () => window.removeEventListener(LIBRARY_SYNC_COMPLETE, onSyncComplete);
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
    const targetScrollTop = window.musicLibraryScrollTop || (globalLibraryCache?.scrollTop || 0);

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

    // 演示模式：使用 file_index.json 数据
    if (isDemoMode()) {
      try {
        const { folders: demoFolders, rootFiles: demoRootFiles } = await getDemoFolders();
        setFolders(demoFolders as Folder[]);
        setRootFiles(demoRootFiles as MusicFile[]);

        // 预加载演示播放列表到播放器，使播放按钮可用
        const player = getAudioPlayer();
        const demoPlaylist = await getDemoPlaylist();
        if (demoPlaylist.length > 0) {
          await player.loadPlaylist(demoPlaylist, 0);
        }

        // 初始化或更新全局秒开缓存
        if (!globalLibraryCache) {
          globalLibraryCache = {
            folders: demoFolders as Folder[],
            rootFiles: demoRootFiles as MusicFile[],
            currentPath: null,
            currentFiles: [],
            scrollTop: 0
          };
        } else {
          globalLibraryCache.folders = demoFolders as Folder[];
          globalLibraryCache.rootFiles = demoRootFiles as MusicFile[];
        }
      } catch (e) {
        console.error("Failed to load demo data:", e);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      const state = await invoke<SyncState>("sync_load_state", {
        statePath: SYNC_STATE_PATH,
      });

      // 按文件夹分组
      const folderMap = new Map<string, MusicFile[]>();

      for (const file of getUniquePlayableSyncedFiles(state)) {
        const parts = file.remote_path.split("/");
        const folderPath = parts.slice(0, -1).join("/") || "根目录";
        const fileName = getBaseName(file.remote_path);

        if (!folderMap.has(folderPath)) {
          folderMap.set(folderPath, []);
        }

        folderMap.get(folderPath)!.push({
          name: fileName,
          remotePath: file.remote_path,
          localPath: file.local_path,
          size: file.size,
          playCount: getPlayCount(file.local_path),
          lastModified: file.last_modified || 0,
          md5: file.md5 || undefined,
          tag: file.tag || undefined,
        });
      }

      // 转换为文件夹数组，分离根目录文件
      const folderArray: Folder[] = [];
      let rootFiles: MusicFile[] = [];
      for (const [path, files] of folderMap.entries()) {
        if (path === "根目录") {
          rootFiles = files;
        } else {
          const name = getBaseName(path);
          folderArray.push({ name, path, files });
        }
      }

      setFolders(folderArray);
      setRootFiles(rootFiles);

      if (currentPath) {
        if (currentPath === t("musicLibrary.allSongs")) {
          setCurrentFiles(folderArray.flatMap(folder => folder.files));
        } else if (currentPath === t("musicLibrary.rootDir")) {
          setCurrentFiles(rootFiles);
        } else {
          const currentFolder = folderArray.find(folder => folder.path === currentPath);
          if (currentFolder) {
            setCurrentFiles(currentFolder.files);
          }
        }
      }

      // 初始化或更新全局秒开缓存
      if (!globalLibraryCache) {
        globalLibraryCache = {
          folders: folderArray,
          rootFiles,
          currentPath: null,
          currentFiles: [],
          scrollTop: 0
        };
      } else {
        globalLibraryCache.folders = folderArray;
        globalLibraryCache.rootFiles = rootFiles;
      }
    } catch (e) {
      console.error("Failed to load music library:", e);
    } finally {
      setIsLoading(false);
    }
  };

  // 下拉刷新
  const { pullDistance, isRefreshing, scrollRef, handlers } = usePullToRefresh({
    onRefresh: loadMusicLibrary,
  });

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

  const handleFavoritesClick = async () => {
    // 先清理失效的收藏
    try {
      const state = await invoke<SyncState>("sync_load_state", {
        statePath: SYNC_STATE_PATH,
      });
      const localPaths = state.synced_files.map(f => f.local_path);
      const stored = localStorage.getItem("miyako_favorites");
      if (stored) {
        const favoritesList: string[] = JSON.parse(stored);
        const validFavoritesList = favoritesList.filter(path => localPaths.includes(path));
        localStorage.setItem("miyako_favorites", JSON.stringify(validFavoritesList));
      }
    } catch (e) {
      console.error("Failed to clean favorites:", e);
    }

    // 然后显示收藏列表
    setCurrentPath(t("musicLibrary.quickActions.favorites"));
    setCurrentFiles(validFavorites);
    setSearchQuery("");
    window.history.pushState({ path: "favorites" }, "");
  };

  const playFileFromList = useCallback(async (file: MusicFile, files: MusicFile[]) => {
    const visibleFiles = filterByActiveTab(files);
    if (visibleFiles.length === 0) return;

    const player = getAudioPlayer();
    const trackPaths = visibleFiles.map((f) => f.localPath);
    const trackIndex = visibleFiles.findIndex((f) => f.localPath === file.localPath);

    await player.loadPlaylist(trackPaths, trackIndex >= 0 ? trackIndex : 0);
    await player.play();
  }, [filterByActiveTab]);

  const handlePlayAllCurrentFiles = async () => {
    const visibleFiles = filterByActiveTab(currentFiles);
    if (visibleFiles.length === 0) return;

    const player = getAudioPlayer();
    const trackPaths = visibleFiles.map((f) => f.localPath);
    await player.loadPlaylist(trackPaths, 0);
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

  // 点击外部关闭排序菜单
  useEffect(() => {
    if (!showSortMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".sort-container")) {
        setShowSortMenu(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [showSortMenu]);

  // 播放器展开时按返回键，强制回到主界面文件夹列表
  useEffect(() => {
    const handleForceHome = () => {
      setCurrentPath(null);
      setCurrentFiles([]);
      setSearchQuery("");
    };

    window.addEventListener("force-navigate-home", handleForceHome);
    return () => {
      window.removeEventListener("force-navigate-home", handleForceHome);
    };
  }, []);

  const handleFileClick = async (file: MusicFile) => {
    await playFileFromList(file, currentFiles);
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatFileName = (name: string): string => {
    return stripExtension(name);
  };

  // 获取所有文件（用于全局搜索）
  const allFiles: MusicFile[] = [];
  for (const folder of folders) {
    allFiles.push(...folder.files);
  }

  // 根据 activeTab 过滤文件
  const filteredFolders = folders.map(folder => ({
    ...folder,
    files: filterByActiveTab(folder.files)
  })).filter(folder => folder.files.length > 0);

  const filteredRootFiles = filterByActiveTab(rootFiles);

  // 获取收藏列表（favoritesVersion 用于强制更新）
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  favoritesVersion;
  const favorites = getFavorites();
  // 过滤出在本地音乐库中真实存在的收藏文件，避免因为删除文件或重命名导致数量对不上
  const validFavorites = allFiles.filter(file => favorites.includes(file.localPath));

  // 全局搜索结果（用于搜索弹出层）
  const searchScope = filterByActiveTab(allFiles);
  const searchResults = searchQuery
    ? searchScope.filter((file) =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // 排序函数
  const sortFiles = useCallback((files: MusicFile[], mode: SortMode): MusicFile[] => {
    const sorted = [...files];
    switch (mode) {
      case "playCount":
        return sorted.sort((a, b) => b.playCount - a.playCount);
      case "syncTimeAsc":
        return sorted.sort((a, b) => a.lastModified - b.lastModified);
      case "syncTimeDesc":
        return sorted.sort((a, b) => b.lastModified - a.lastModified);
      default:
        return sorted;
    }
  }, []);

  // 当前文件夹的过滤结果（用于文件列表页面）
  const filteredFiles = sortFiles(
    filterByActiveTab(currentFiles).filter((file) =>
      file.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    sortMode
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
            <div className="header-top">
              <h1 className="app-title">{t("app.title")}</h1>
              <div className="header-actions">
                <button className="search-icon-btn" onClick={() => setIsSearchOpen(true)}>
                  <span className="material-symbols-outlined">search</span>
                </button>
                <button className="settings-icon-btn" onClick={() => navigate("/settings")}>
                  <span className="material-symbols-outlined">settings</span>
                </button>
              </div>
            </div>
            <div className="tab-navigation">
              <button className={`tab-btn ${activeTab === "music" ? "active" : ""}`} onClick={() => handleTabChange("music")}>
                <span className="material-symbols-outlined">music_note</span>
                <span className="tab-label">{t("nav.music")}</span>
              </button>
              <button className={`tab-btn ${activeTab === "podcast" ? "active" : ""}`} onClick={() => handleTabChange("podcast")}>
                <span className="material-symbols-outlined">podcasts</span>
                <span className="tab-label">{t("nav.podcast")}</span>
              </button>
              <button className="tab-btn" onClick={() => navigate("/radio")}>
                <span className="material-symbols-outlined">radio</span>
                <span className="tab-label">{t("nav.radio")}</span>
              </button>
            </div>
          </div>
          <div
            ref={scrollRef}
            className="library-scroll"
            onScroll={handleScroll}
            onTouchStart={handlers.onTouchStart}
            onTouchMove={handlers.onTouchMove}
            onTouchEnd={handlers.onTouchEnd}
          >
            <PullToRefresh pullDistance={pullDistance} isRefreshing={isRefreshing}>
            {folders.length === 0 ? (
              <div className="empty-state">
                <span className="material-symbols-outlined empty-icon">library_music</span>
                <h3 className="empty-title">{t("musicLibrary.empty.title")}</h3>
                <p className="empty-desc">{t("musicLibrary.empty.description")}</p>
                <div className="empty-actions">
                  <button className="empty-btn primary" onClick={() => navigate("/settings")}>{t("musicLibrary.empty.configureNAS")}</button>
                  <button className="empty-btn secondary" onClick={() => navigate("/settings")}>{t("musicLibrary.empty.startSync")}</button>
                </div>
              </div>
            ) : (
              <div className="folder-list">
                <button className="folder-item all-files" onClick={handleAllFilesClick}>
                  <span className="material-symbols-outlined folder-icon">library_music</span>
                  <div className="folder-info">
                    <span className="folder-name">{t("musicLibrary.allSongs")}</span>
                    <span className="folder-count">{filteredFolders.reduce((sum, f) => sum + f.files.length, 0)} {t("musicLibrary.songs")}</span>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
                <button className="folder-item favorites" onClick={handleFavoritesClick}>
                  <span className="material-symbols-outlined folder-icon" style={{ fontVariationSettings: "'FILL' 1" }}>favorite</span>
                  <div className="folder-info">
                    <span className="folder-name">{t("musicLibrary.quickActions.favorites")}</span>
                    <span className="folder-count">{validFavorites.length} {t("musicLibrary.songs")}</span>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
                {filteredRootFiles.length > 0 && (
                  <button className="folder-item root-files" onClick={() => {
                    setCurrentPath(t("musicLibrary.rootDir"));
                    setCurrentFiles(filteredRootFiles);
                    setSearchQuery("");
                    window.history.pushState({ path: t("musicLibrary.rootDir") }, "");
                  }}>
                    <span className="material-symbols-outlined folder-icon">audio_file</span>
                    <div className="folder-info">
                      <span className="folder-name">{t("musicLibrary.rootDir")}</span>
                      <span className="folder-count">{filteredRootFiles.length} {t("musicLibrary.songs")}</span>
                    </div>
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                )}
                {filteredFolders.map((folder) => (
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
            </PullToRefresh>
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
                <h2 ref={listTitleRef} className={`list-title ${titleOverflow ? "scrolling" : ""}`}>{currentPath ? getBaseName(currentPath) : ""}</h2>
                <span className="list-subtitle">{filteredFiles.length} {t("musicLibrary.songs")}</span>
              </div>
              <button className="play-all-btn btn-interactive" onClick={handlePlayAllCurrentFiles} title="播放全部">
                <span className="material-symbols-outlined" style={{ fontSize: "28px" }}>play_circle</span>
              </button>
              <button className="search-btn" onClick={() => setIsSearchOpen(true)}>
                <span className="material-symbols-outlined">search</span>
              </button>
              <div className="sort-container">
                <button className="sort-btn" onClick={() => setShowSortMenu(!showSortMenu)}>
                  <span className="material-symbols-outlined">sort</span>
                </button>
                {showSortMenu && (
                  <div className="sort-menu">
                    <button
                      className={`sort-menu-item ${sortMode === "default" ? "active" : ""}`}
                      onClick={() => { setSortMode("default"); setShowSortMenu(false); }}
                    >
                      <span className="material-symbols-outlined">sort_by_alpha</span>
                      <span>{t("musicLibrary.sort.default")}</span>
                    </button>
                    <button
                      className={`sort-menu-item ${sortMode === "playCount" ? "active" : ""}`}
                      onClick={() => { setSortMode("playCount"); setShowSortMenu(false); }}
                    >
                      <span className="material-symbols-outlined">headphones</span>
                      <span>{t("musicLibrary.sort.playCount")}</span>
                    </button>
                    <button
                      className={`sort-menu-item ${sortMode === "syncTimeDesc" ? "active" : ""}`}
                      onClick={() => { setSortMode("syncTimeDesc"); setShowSortMenu(false); }}
                    >
                      <span className="material-symbols-outlined">schedule</span>
                      <span>{t("musicLibrary.sort.syncTimeNew")}</span>
                    </button>
                    <button
                      className={`sort-menu-item ${sortMode === "syncTimeAsc" ? "active" : ""}`}
                      onClick={() => { setSortMode("syncTimeAsc"); setShowSortMenu(false); }}
                    >
                      <span className="material-symbols-outlined">history</span>
                      <span>{t("musicLibrary.sort.syncTimeOld")}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            ref={scrollRef}
            className="library-scroll"
            onScroll={handleScroll}
            onTouchStart={handlers.onTouchStart}
            onTouchMove={handlers.onTouchMove}
            onTouchEnd={handlers.onTouchEnd}
          >
            <PullToRefresh pullDistance={pullDistance} isRefreshing={isRefreshing}>
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
                    <div className="file-play-btn" role="button" tabIndex={0}
                      onClick={() => handleFileClick(file)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleFileClick(file); } }}
                    >
                      <span className="file-index">{index + 1}</span>
                      <div className="file-info">
                        <span className="file-name">{formatFileName(file.name)}</span>
                        <span className="file-size">{formatSize(file.size)}</span>
                      </div>
                      <button
                        type="button"
                        className="file-fav-btn"
                        aria-label={t("musicLibrary.quickActions.favorites")}
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
                    </div>
                  </div>
                ))}
              </div>
            )}
            </PullToRefresh>
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
                    // 搜索结果点击时，加载全部文件为播放列表并播放该歌曲
                    setCurrentFiles(searchScope);
                    void playFileFromList(file, searchScope);
                    setIsSearchOpen(false);
                    setSearchQuery("");
                    // 自动展开播放器详情页
                    window.dispatchEvent(new Event("expand-player"));
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
