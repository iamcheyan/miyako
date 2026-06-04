import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SyncState } from "../types/tauri-commands";
import { getAudioPlayer } from "../lib/audioPlayer";
import { isDemoMode, getDemoFolders } from "../lib/demoData";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { showStatusBar } from "../lib/androidStatusBar";
import { getBaseName, stripExtension } from "../lib/pathUtils";
import RadioPodcastVisual from "./RadioPodcastVisual";
import "./RadioPage.css";

import { SYNC_STATE_PATH, getUniquePlayableSyncedFiles } from "../lib/syncState";
import { showAppToast } from "../lib/toastBus";

interface MusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
  tag?: string;
}

type RadioMode = "music" | "podcast";

interface RadioHistory {
  tracks: MusicFile[];
  index: number;
}

const emptyRadioHistory = (): RadioHistory => ({ tracks: [], index: -1 });

/** 播客多为 20–40MB，优先抽较小文件以减少 WebView 起播等待 */
const PODCAST_FAST_START_BYTES = 12 * 1024 * 1024;
const PODCAST_SMALL_POOL_MIN = 5;
const PODCAST_PREFER_SMALL_RATIO = 0.85;

function pickRandomFile(files: MusicFile[], preferSmallFiles: boolean): MusicFile {
  if (!preferSmallFiles || files.length === 0) {
    return files[Math.floor(Math.random() * files.length)];
  }

  const smallFiles = files.filter(
    f => f.size > 0 && f.size <= PODCAST_FAST_START_BYTES,
  );
  const useSmallPool =
    smallFiles.length >= PODCAST_SMALL_POOL_MIN &&
    Math.random() < PODCAST_PREFER_SMALL_RATIO;
  const pool = useSmallPool ? smallFiles : files;
  return pool[Math.floor(Math.random() * pool.length)];
}

function RadioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const pageContent = document.querySelector<HTMLElement>(".page-content");
    pageContent?.classList.add("page-content--radio");
    return () => pageContent?.classList.remove("page-content--radio");
  }, []);

  const [currentSong, setCurrentSong] = useState<MusicFile | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [allMusicFiles, setAllMusicFiles] = useState<MusicFile[]>([]);
  const [allPodcastFiles, setAllPodcastFiles] = useState<MusicFile[]>([]);
  const [blacklist, setBlacklist] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RadioMode>("music");
  const [isBuffering, setIsBuffering] = useState(false);

  const songNameRef = useRef<HTMLHeadingElement>(null);
  const touchStartRef = useRef<number | null>(null);
  const touchEndRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  const allMusicRef = useRef(allMusicFiles);
  const allPodcastRef = useRef(allPodcastFiles);
  const blacklistRef = useRef(blacklist);
  const [loadError, setLoadError] = useState<string | null>(null);
  const historyRef = useRef<Record<RadioMode, RadioHistory>>({
    music: emptyRadioHistory(),
    podcast: emptyRadioHistory(),
  });

  modeRef.current = mode;
  allMusicRef.current = allMusicFiles;
  allPodcastRef.current = allPodcastFiles;
  blacklistRef.current = blacklist;

  useEffect(() => {
    const player = getAudioPlayer();
    player.setRadioMode(true);
    return () => player.setRadioMode(false);
  }, []);

  useEffect(() => {
    showStatusBar();
  }, []);

  // 歌名溢出时添加滚动动画
  useEffect(() => {
    const el = songNameRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth) {
      el.classList.add("scrolling");
    } else {
      el.classList.remove("scrolling");
    }
  }, [currentSong]);

  const playSong = useCallback(async (song: MusicFile, recordHistory = true) => {
    setCurrentSong(song);
    setIsFavorited(isFavorite(song.localPath));
    setIsBuffering(true);
    setIsPlaying(false);

    try {
      const player = getAudioPlayer();
      await player.switchToTrack(song.localPath);

      if (recordHistory) {
        const radioMode = modeRef.current;
        const history = historyRef.current[radioMode];
        if (history.index < history.tracks.length - 1) {
          history.tracks = history.tracks.slice(0, history.index + 1);
        }
        const last = history.tracks[history.index];
        if (!last || last.localPath !== song.localPath) {
          history.tracks.push(song);
        }
        history.index = history.tracks.length - 1;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("Failed to switch radio track:", e);
      setIsBuffering(false);
      setIsPlaying(false);
      showAppToast(t("radio.playbackError"), "error");
    }
  }, [t]);

  const playRandomSong = useCallback(async (files: MusicFile[], currentBlacklist: Set<string>) => {
    const availableFiles = files.filter(f => !currentBlacklist.has(f.localPath));
    if (availableFiles.length === 0) {
      setCurrentSong(null);
      return;
    }

    const song = pickRandomFile(
      availableFiles,
      modeRef.current === "podcast",
    );
    await playSong(song);
  }, [playSong]);

  const playNextSong = useCallback(() => {
    const currentFiles = modeRef.current === "music" ? allMusicRef.current : allPodcastRef.current;
    void playRandomSong(currentFiles, blacklistRef.current);
  }, [playRandomSong]);

  useEffect(() => {
    const player = getAudioPlayer();
    const handlePlay = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const handlePause = () => {
      setIsBuffering(false);
      setIsPlaying(false);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      playNextSong();
    };
    const handleError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
    };

    player.on("play", handlePlay);
    player.on("pause", handlePause);
    player.on("ended", handleEnded);
    player.on("error", handleError);

    return () => {
      player.off("play", handlePlay);
      player.off("pause", handlePause);
      player.off("ended", handleEnded);
      player.off("error", handleError);
    };
  }, [playNextSong]);

  useEffect(() => {
    if (currentSong) {
      setIsFavorited(isFavorite(currentSong.localPath));
    }
  }, [currentSong]);

  const loadMusicFiles = useCallback(async () => {
    setLoadError(null);
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
          statePath: SYNC_STATE_PATH,
        });
        const allFiles = getUniquePlayableSyncedFiles(state)
          .map(f => ({
            name: getBaseName(f.remote_path),
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

      const currentFiles = modeRef.current === "music" ? musicFiles : podcastFiles;
      if (currentFiles.length === 0) {
        setLoadError(t("radio.emptyLibrary"));
        return;
      }
      await playRandomSong(currentFiles, new Set());
    } catch (e) {
      console.error("Failed to load music files:", e);
      setLoadError(t("radio.loadFailed"));
      showAppToast(t("radio.loadFailed"), "error", 5000);
    }
  }, [t, playRandomSong]);

  useEffect(() => {
    void loadMusicFiles();
  }, [loadMusicFiles]);

  const handlePlayPause = async () => {
    const player = getAudioPlayer();
    if (isPlaying) {
      player.pause();
      return;
    }

    if (!currentSong) {
      const currentFiles = modeRef.current === "music" ? allMusicRef.current : allPodcastRef.current;
      if (currentFiles.length > 0) {
        await playRandomSong(currentFiles, blacklistRef.current);
      }
      return;
    }

    try {
      await player.play();
    } catch (e) {
      console.error("Failed to resume radio playback:", e);
    }
  };

  const handleTrash = () => {
    if (!currentSong) return;
    const newBlacklist = new Set(blacklistRef.current);
    newBlacklist.add(currentSong.localPath);
    setBlacklist(newBlacklist);
    const currentFiles = modeRef.current === "music" ? allMusicRef.current : allPodcastRef.current;
    void playRandomSong(currentFiles, newBlacklist);
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

  const handleTouchStart = (e: React.TouchEvent) => {
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndRef.current = e.targetTouches[0].clientX;
  };

  const handleContentTouchEnd = () => {
    const touchStart = touchStartRef.current;
    const touchEnd = touchEndRef.current;
    if (touchStart == null || touchEnd == null) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) {
      playPreviousSong();
    } else if (distance < -50) {
      playNextSong();
    }
    touchStartRef.current = null;
    touchEndRef.current = null;
  };

  const playPreviousSong = useCallback(() => {
    const radioMode = modeRef.current;
    const history = historyRef.current[radioMode];
    if (history.index <= 0) return;

    history.index -= 1;
    const song = history.tracks[history.index];
    void playSong(song, false);
  }, [playSong]);

  useEffect(() => {
    const player = getAudioPlayer();
    player.on("nexttrack", playNextSong);
    player.on("previoustrack", playPreviousSong);
    return () => {
      player.off("nexttrack", playNextSong);
      player.off("previoustrack", playPreviousSong);
    };
  }, [playNextSong, playPreviousSong]);

  const switchMode = (newMode: RadioMode) => {
    if (newMode === modeRef.current) return;
    setMode(newMode);
    setBlacklist(new Set());
    historyRef.current[newMode] = emptyRadioHistory();
    const currentFiles = newMode === "music" ? allMusicRef.current : allPodcastRef.current;
    if (currentFiles.length > 0) {
      void playRandomSong(currentFiles, new Set());
    }
  };

  const getDisplayName = (name: string): string => {
    return stripExtension(name);
  };

  const currentFiles = mode === "music" ? allMusicFiles : allPodcastFiles;

  return (
    <div className="radio-page">
      <header className="radio-header">
        <button className="back-btn" onClick={handleBack}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="mode-tabs">
          <button
            className={`mode-tab ${mode === "music" ? "active" : ""}`}
            onClick={() => switchMode("music")}
          >
            {t("nav.music")}
          </button>
          <button
            className={`mode-tab ${mode === "podcast" ? "active" : ""}`}
            onClick={() => switchMode("podcast")}
          >
            {t("nav.podcast")}
          </button>
        </div>
        <div className="header-spacer" />
      </header>

      <div className="radio-body">
        <div
          className="radio-content"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleContentTouchEnd}
        >
          <div className="visual-container" onClick={() => void handlePlayPause()}>
            {mode === "music" ? (
              <div className={`vinyl-disc ${isPlaying ? "spinning" : ""}`}>
                <div className="vinyl-label">
                  <span className="material-symbols-outlined">music_note</span>
                </div>
              </div>
            ) : (
              <RadioPodcastVisual isPlaying={isPlaying} />
            )}
          </div>

          <div className="song-info">
            <h2 ref={songNameRef} className="song-name">
              {isBuffering
                ? t("common.loading")
                : currentSong
                  ? getDisplayName(currentSong.name)
                  : t("radio.noSong")}
            </h2>
            {loadError && (
              <div className="radio-load-error">
                <p>{loadError}</p>
                <button type="button" className="radio-retry-btn" onClick={() => void loadMusicFiles()}>
                  {t("radio.retry")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="radio-controls">
        <button
          className="control-btn trash-btn"
          onClick={handleTrash}
          disabled={!currentSong}
          title={t("radio.removeFromStation")}
        >
          <span className="material-symbols-outlined">delete</span>
        </button>

        <button
          className={`control-btn favorite-btn ${isFavorited ? "favorited" : ""}`}
          onClick={handleToggleFavorite}
          disabled={!currentSong}
        >
          <span className="material-symbols-outlined" style={isFavorited ? { fontVariationSettings: "'FILL' 1" } : {}}>
            favorite
          </span>
        </button>

        <button
          className="control-btn"
          onClick={() => void handlePlayPause()}
        >
          <span className="material-symbols-outlined">
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        <button
          className="control-btn next-btn"
          onClick={playNextSong}
          disabled={currentFiles.length === 0}
          title={t("radio.nextSong")}
        >
          <span className="material-symbols-outlined">skip_next</span>
        </button>
      </div>
    </div>
  );
}

export default RadioPage;
