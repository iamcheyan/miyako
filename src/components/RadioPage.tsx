import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import { isDemoMode, getDemoFolders } from "../lib/demoData";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { showStatusBar } from "../lib/androidStatusBar";
import "./RadioPage.css";

const STATE_PATH = "sync_state.json";

interface MusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
  tag?: string;
}

type RadioMode = "music" | "podcast";

function RadioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentSong, setCurrentSong] = useState<MusicFile | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [allMusicFiles, setAllMusicFiles] = useState<MusicFile[]>([]);
  const [allPodcastFiles, setAllPodcastFiles] = useState<MusicFile[]>([]);
  const [blacklist, setBlacklist] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RadioMode>("music");
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // 显示状态栏
  useEffect(() => {
    showStatusBar();
  }, []);

  // 加载音乐文件
  useEffect(() => {
    loadMusicFiles();
  }, []);

  // 监听播放状态
  useEffect(() => {
    const player = getAudioPlayer();
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      playNextSong();
    };

    player.on("play", handlePlay);
    player.on("pause", handlePause);
    player.on("ended", handleEnded);

    return () => {
      player.off("play", handlePlay);
      player.off("pause", handlePause);
      player.off("ended", handleEnded);
    };
  }, [allMusicFiles, allPodcastFiles, blacklist, mode]);

  // 更新收藏状态
  useEffect(() => {
    if (currentSong) {
      setIsFavorited(isFavorite(currentSong.localPath));
    }
  }, [currentSong]);

  const loadMusicFiles = async () => {
    try {
      let musicFiles: MusicFile[] = [];
      let podcastFiles: MusicFile[] = [];

      if (isDemoMode()) {
        const { folders, rootFiles } = await getDemoFolders();
        const demoFiles: MusicFile[] = [...rootFiles];
        for (const folder of folders) {
          demoFiles.push(...folder.files);
        }
        musicFiles = demoFiles.filter(f => f.tag !== "podcast");
        podcastFiles = demoFiles.filter(f => f.tag === "podcast");
      } else {
        const state = await invoke<SyncState>("sync_load_state", {
          statePath: STATE_PATH,
        });
        const allFiles = state.synced_files.map(f => ({
          name: f.remote_path.split("/").pop() || f.remote_path,
          remotePath: f.remote_path,
          localPath: f.local_path,
          size: f.size,
          tag: f.tag || undefined,
        }));
        musicFiles = allFiles.filter(f => f.tag !== "podcast");
        podcastFiles = allFiles.filter(f => f.tag === "podcast");
      }

      setAllMusicFiles(musicFiles);
      setAllPodcastFiles(podcastFiles);

      // 自动播放第一首
      const currentFiles = mode === "music" ? musicFiles : podcastFiles;
      if (currentFiles.length > 0) {
        playRandomSong(currentFiles, new Set());
      }
    } catch (e) {
      console.error("Failed to load music files:", e);
    }
  };

  const playRandomSong = useCallback((files: MusicFile[], currentBlacklist: Set<string>) => {
    const availableFiles = files.filter(f => !currentBlacklist.has(f.localPath));
    if (availableFiles.length === 0) {
      setCurrentSong(null);
      return;
    }

    const randomIndex = Math.floor(Math.random() * availableFiles.length);
    const song = availableFiles[randomIndex];
    setCurrentSong(song);
    setIsFavorited(isFavorite(song.localPath));

    // 播放歌曲
    const player = getAudioPlayer();
    player.loadPlaylist([song.localPath], 0);
    player.play();
    setIsPlaying(true);
  }, []);

  const playNextSong = useCallback(() => {
    const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;
    playRandomSong(currentFiles, blacklist);
  }, [allMusicFiles, allPodcastFiles, blacklist, mode, playRandomSong]);

  const handlePlayPause = () => {
    const player = getAudioPlayer();
    if (isPlaying) {
      player.pause();
    } else {
      // 如果没有当前歌曲（如演示模式初次加载），先随机选一首
      if (!currentSong) {
        const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;
        if (currentFiles.length > 0) {
          playRandomSong(currentFiles, blacklist);
          return;
        }
      }
      player.play();
    }
  };

  const handleTrash = () => {
    if (!currentSong) return;
    const newBlacklist = new Set(blacklist);
    newBlacklist.add(currentSong.localPath);
    setBlacklist(newBlacklist);
    // 播放下一首
    const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;
    playRandomSong(currentFiles, newBlacklist);
  };

  const handleToggleFavorite = () => {
    if (!currentSong) return;
    toggleFavorite(currentSong.localPath);
    setIsFavorited(!isFavorited);
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

  // 滑动手势处理
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  // radio-header 滑动：切换音乐/播客模式
  const handleHeaderTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50 && mode === "music") {
      switchMode("podcast");
    } else if (distance < -50 && mode === "podcast") {
      switchMode("music");
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  // radio-content 滑动：左滑前一曲，右滑下一曲
  const handleContentTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) {
      // 左滑：前一曲
      playPreviousSong();
    } else if (distance < -50) {
      // 右滑：下一曲
      playNextSong();
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  const playPreviousSong = useCallback(() => {
    const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;
    playRandomSong(currentFiles, blacklist);
  }, [allMusicFiles, allPodcastFiles, blacklist, mode, playRandomSong]);

  const switchMode = (newMode: RadioMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setBlacklist(new Set());
    const currentFiles = newMode === "music" ? allMusicFiles : allPodcastFiles;
    if (currentFiles.length > 0) {
      playRandomSong(currentFiles, new Set());
    }
  };

  // 获取歌曲显示名称（去掉扩展名）
  const getDisplayName = (name: string): string => {
    const lastDot = name.lastIndexOf(".");
    return lastDot > 0 ? name.substring(0, lastDot) : name;
  };

  const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;

  return (
    <div className="radio-page">
      {/* 顶部导航 - 左右滑动切换音乐/播客 */}
      <header
        className="radio-header"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleHeaderTouchEnd}
      >
        <button className="back-btn" onClick={handleBack}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="radio-title">{t("nav.radio")}</h1>
        <div className="mode-indicator">
          <span className={`mode-dot ${mode === "music" ? "active" : ""}`} />
          <span className={`mode-dot ${mode === "podcast" ? "active" : ""}`} />
        </div>
      </header>

      {/* 模式标签 - 点击切换 */}
      <div className="mode-label" onClick={() => switchMode(mode === "music" ? "podcast" : "music")}>
        <span className="mode-text">
          {mode === "music" ? t("nav.music") : t("nav.podcast")}
        </span>
      </div>

      {/* 主要内容区域 - 左滑前一曲，右滑下一曲 */}
      <div
        className="radio-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleContentTouchEnd}
      >
        {/* 图形展示 - 点击切换模式 */}
        <div className="visual-container" onClick={() => switchMode(mode === "music" ? "podcast" : "music")}>
          {mode === "music" ? (
            // 音乐：唱片
            <div className={`vinyl-disc ${isPlaying ? "spinning" : ""}`}>
              <div className="vinyl-label">
                <span className="material-symbols-outlined">music_note</span>
              </div>
            </div>
          ) : (
            // 播客：麦克风
            <div className={`microphone-container ${isPlaying ? "broadcasting" : ""}`}>
              {/* 云朵 */}
              <div className="clouds">
                <div className="cloud cloud-back" />
                <div className="cloud cloud-front" />
              </div>
              {/* 麦克风 */}
              <div className="microphone-body">
                <svg
                  className="microphone-svg"
                  viewBox="0 0 128 128"
                  role="img"
                  aria-label="Tokyo Tower"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <path d="M66.75 58.39l-.5-32.18s-.64-20.15-.64-21.75s-.32-2.99-1.2-3.07c-.88-.08-1.75.58-1.83 2.75c-.08 2.17-.5 21.44-.5 21.44s-2.69-.02-2.74.37c-.11.8-.63 17-1.19 23.1c-.56 6.1-2.87 21.75-5.76 29.39c-1.44 3.8-4.7 11.51-7.89 16.97c-3.21 5.51-7.4 11.35-9.91 14.86c-5 6.99-7.88 9.48-7.06 10.27c.38.37 10.36.17 10.36.17s6.39-8.84 7.94-11.13c2.09-3.09 4.67-5.07 7.89-4.57c2.22.35 4.08 1.93 4.54 5.52c.61 4.66.79 12.46 1.36 12.9c.87.69 6.99.68 6.99.68l.14-65.72zm-6.89 42.62c-.99.46-3.19-.87-5.45-1.16c-2.26-.29-3.94.64-5.1-.46s.46-4.06 1.91-6.84c1.45-2.78 4.58-7.88 6.2-7.53c1.73.37 2.32 4.87 2.84 8.69c.3 2.18.58 6.83-.4 7.3zm-2.03-18.37c-.52-.06-2.07-3.9-1.62-4.35c.46-.46 4.29-.06 4.52.46s-2.38 3.95-2.9 3.89zm1.1-6.96c-1.51-.06-2.13-.99-2.03-1.85c.17-1.45 1.17-1.86 2.38-1.62c1.27.25 1.63.99 1.68 1.85c.06.93-.52 1.68-2.03 1.62z" fill="#ee3e23" />
                  <path d="M52.25 89.42l6.49 12.64l2.43-1.62l-7.62-14.59c.01 0-.79 2.55-1.3 3.57z" fill="#ee3e23" />
                  <path fill="#ee3e23" d="M59.97 87.79L47.86 99.27l1.97 1.68l11.19-10.14z" />
                  <path d="M64.32 28.4l-5.11.1s-.15 3.19-.21 4.24c-.06 1.04-.13 3.72-.13 3.72h6.03l-.58-8.06z" fill="#e3e1df" />
                  <path fill="#c9c7ca" d="M62.25 16.71h3.77l-.29-8.93h-3.3z" />
                  <path d="M64.32 45.84l-5.94-.11s-.09 1.96-.32 4.16c-.17 1.64-.58 4.35-.58 4.35l8 .06l-1.16-8.46z" fill="#e3e1df" />
                  <path d="M64.85 62.93S51.16 63 50.58 63c-.58 0-1.66.84-.35 2.73c.93 1.34 3.72 4.79 4.24 4.92s10.66 0 10.66 0l-.28-7.72z" fill="#c9c7ca" />
                  <path d="M101.59 118.7c-.44-.53-5.14-6.25-9.2-12.11s-8.02-12.01-10.27-16.34c-4.51-8.67-6-13.92-8.41-23.21c-1.24-4.78-2.66-10.12-3.76-24.98c-1.02-13.8-.4-16.23-.96-16.28c-.46-.05-4.97-.15-4.97-.15s.17 17.55.31 32.92c.14 15.05.81 65.54.81 65.54s.73.03 1.7.03c1.76-.01 4.31-.09 4.62-.38c.54-.52.58-10.43.85-14.21c.3-4.22 4.85-7.07 9.44-2.8c5.13 4.78 10.22 13.93 10.84 14.38c.78.56 8.75.09 9.73.09c.95-.03.15-1.44-.73-2.5zM69.41 72.05c1.18-.33 2.49.19 2.71 1.11c.21.92.05 2.12-1.69 2.32c-1.41.16-2.16-.24-2.34-1.39c-.17-1.09.47-1.8 1.32-2.04zm-.77 6.75c.29-.7 3.76-1.31 4.21-.66c.45.65-.39 4.39-1.39 4.44c-1 .04-3.04-3.26-2.82-3.78zm11.97 20.34c-.9.9-1.83.43-5.17 1.07c-3.34.64-4.23 1.56-5.45 1.36c-1.22-.19-1.08-2.9-.76-7.65c.32-4.75 1.39-8.66 2.95-8.94c2.11-.37 4.37 4.32 5.65 6.69s3.68 6.57 2.78 7.47z" fill="#cd3001" />
                  <path fill="#cd3001" d="M76.53 86.34l-7.84 16.13l3.41.06l6.48-14z" />
                  <path fill="#cd3001" d="M69.27 86.92l13.43 13.1l-3.41.52l-11.31-10.67z" />
                  <path fill="#c9c7ca" d="M64.04 28.41l5.25.01l.29 7.94l-5.51.12z" />
                  <path d="M64.2 45.81l6.06.06l.4 3.97c.19 1.82.51 4.4.51 4.4l-6.92.04l-.05-8.47z" fill="#c9c7ca" />
                  <path d="M64.37 62.93s11.66-.03 12.8-.03c1.17 0 1.68.69 1.3 1.56c-.38.86-3.38 5.18-3.83 5.94c-.13.22-10.19.25-10.19.25l-.08-7.72z" fill="#afb1b0" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* 歌曲信息 */}
        <div className="song-info">
          <h2 className="song-name">
            {currentSong ? getDisplayName(currentSong.name) : t("radio.noSong")}
          </h2>
          <span className="song-count">
            {currentFiles.length} {mode === "music" ? t("musicLibrary.songs") : t("nav.podcast")}
          </span>
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="radio-controls">
        {/* 垃圾桶按钮 - 从电台移除 */}
        <button
          className="control-btn trash-btn"
          onClick={handleTrash}
          disabled={!currentSong}
          title={t("radio.removeFromStation")}
        >
          <span className="material-symbols-outlined">delete</span>
        </button>

        {/* 播放/暂停按钮 */}
        <button
          className="control-btn play-btn"
          onClick={handlePlayPause}
        >
          <span className="material-symbols-outlined">
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        {/* 收藏按钮 */}
        <button
          className={`control-btn favorite-btn ${isFavorited ? "favorited" : ""}`}
          onClick={handleToggleFavorite}
          disabled={!currentSong}
        >
          <span className="material-symbols-outlined" style={isFavorited ? { fontVariationSettings: "'FILL' 1" } : {}}>
            favorite
          </span>
        </button>
      </div>

    </div>
  );
}

export default RadioPage;
