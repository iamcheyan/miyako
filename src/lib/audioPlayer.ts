import { convertFileSrc } from "@tauri-apps/api/core";
import { savePlaybackState, loadPlaybackState } from "./playbackStorage";
import { isDemoMode, getDemoPlaylist, getDemoCurrentIndex } from "./demoData";

export type PlayMode = "sequential" | "loop" | "shuffle";

export type PlayerEvent =
  | "play"
  | "pause"
  | "stop"
  | "ended"
  | "timeupdate"
  | "loadedmetadata"
  | "error";

export type EventCallback = (...args: unknown[]) => void;

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTrack: string | null;
  currentTime: number;
  duration: number;
  playMode: PlayMode;
  playlist: string[];
  currentIndex: number;
}

export class AudioPlayer {
  private audio: HTMLAudioElement;
  private playlist: string[] = [];
  private currentIndex: number = -1;
  private playMode: PlayMode = "sequential";
  private eventListeners: Map<PlayerEvent, Set<EventCallback>> = new Map();
  private saveTimeout: number | null = null;

  constructor() {
    this.audio = new Audio();
    this.setupAudioEvents();
    this.loadSavedState();
  }

  // 加载保存的状态
  private loadSavedState() {
    const saved = loadPlaybackState();
    if (saved) {
      this.playlist = saved.playlist;
      this.currentIndex = saved.currentIndex;
      this.playMode = saved.playMode;

      // 恢复播放位置（通过 media:// 协议流式读取，不整文件加载进内存）
      if (saved.currentIndex >= 0 && saved.currentIndex < saved.playlist.length) {
        this.audio.src = this.toPlayableUrl(saved.playlist[saved.currentIndex]);
        this.audio.currentTime = saved.currentTime;
      }
    }
  }

  // 保存状态（防抖）
  private saveState() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      if (this.playlist.length > 0 && this.currentIndex >= 0) {
        savePlaybackState({
          playlist: this.playlist,
          currentIndex: this.currentIndex,
          currentTime: this.audio.currentTime,
          playMode: this.playMode,
        });
      }
    }, 500);
  }

  private setupAudioEvents() {
    this.audio.addEventListener("play", () => {
      this.emit("play");
      this.saveState();
    });
    this.audio.addEventListener("pause", () => {
      this.emit("pause");
      this.saveState();
    });
    this.audio.addEventListener("ended", () => {
      this.handleEnded();
    });
    this.audio.addEventListener("timeupdate", () => {
      this.emit("timeupdate", this.audio.currentTime);
      if (Math.floor(this.audio.currentTime) % 3 === 0) {
        this.saveState();
      }
    });
    this.audio.addEventListener("loadedmetadata", () => {
      this.emit("loadedmetadata", this.audio.duration);
    });
    this.audio.addEventListener("error", (e) => {
      console.error("Audio error:", this.audio.error);
      this.emit("error", e);
    });
  }

  private handleEnded() {
    this.emit("ended");

    switch (this.playMode) {
      case "sequential":
        this.next();
        break;
      case "loop":
        this.audio.currentTime = 0;
        this.audio.play();
        break;
      case "shuffle":
        this.playRandom();
        break;
    }
  }

  private emit(event: PlayerEvent, ...args: unknown[]) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((cb) => cb(...args));
    }
  }

  on(event: PlayerEvent, callback: EventCallback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: PlayerEvent, callback: EventCallback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  // 将本地文件路径转换为可流式播放的 media:// URL。
  // 音频由 Rust 侧的 media 协议按 HTTP Range 分块提供，
  // 不再把整首歌 base64 读进内存再复制成 Blob。
  private toPlayableUrl(filePath: string): string {
    if (
      filePath.startsWith("http://") ||
      filePath.startsWith("https://") ||
      filePath.startsWith("blob:") ||
      filePath.startsWith("media:")
    ) {
      return filePath;
    }
    return convertFileSrc(filePath, "media");
  }

  async play(src?: string) {
    if (src) {
      this.audio.src = this.toPlayableUrl(src);
    }
    try {
      await this.audio.play();
    } catch (e) {
      console.error("Audio play failed:", e);
      throw e;
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.emit("stop");
    this.saveState();
  }

  seekTo(time: number) {
    this.audio.currentTime = time;
    this.saveState();
  }


  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
    this.saveState();
  }

  getPlayMode(): PlayMode {
    return this.playMode;
  }

  async loadPlaylist(tracks: string[], startIndex: number = 0) {
    this.playlist = tracks;
    this.currentIndex = startIndex;

    if (tracks.length > 0 && startIndex >= 0 && startIndex < tracks.length) {
      this.audio.src = this.toPlayableUrl(tracks[startIndex]);
    }
    this.saveState();
  }

  async playTrack(index: number) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this.audio.src = this.toPlayableUrl(this.playlist[index]);
      await this.audio.play();
      this.saveState();
    }
  }

  async next() {
    if (this.playlist.length === 0) return;

    let nextIndex: number;
    switch (this.playMode) {
      case "shuffle":
        nextIndex = Math.floor(Math.random() * this.playlist.length);
        break;
      case "loop":
        nextIndex = this.currentIndex;
        break;
      default:
        nextIndex = (this.currentIndex + 1) % this.playlist.length;
        break;
    }

    await this.playTrack(nextIndex);
  }

  async previous() {
    if (this.playlist.length === 0) return;

    let prevIndex: number;
    switch (this.playMode) {
      case "shuffle":
        prevIndex = Math.floor(Math.random() * this.playlist.length);
        break;
      default:
        prevIndex =
          (this.currentIndex - 1 + this.playlist.length) %
          this.playlist.length;
        break;
    }

    await this.playTrack(prevIndex);
  }

  private async playRandom() {
    if (this.playlist.length === 0) return;

    const randomIndex = Math.floor(Math.random() * this.playlist.length);
    await this.playTrack(randomIndex);
  }

  getState(): AudioPlayerState {
    // 演示模式：返回假数据
    if (isDemoMode()) {
      const demoPlaylist = getDemoPlaylist();
      const demoIndex = getDemoCurrentIndex();
      return {
        isPlaying: true,
        currentTrack: demoPlaylist[demoIndex] || null,
        currentTime: 45,
        duration: 240,
        playMode: "sequential",
        playlist: demoPlaylist,
        currentIndex: demoIndex,
      };
    }
    
    return {
      isPlaying: !this.audio.paused,
      currentTrack:
        this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null,
      currentTime: this.audio.currentTime,
      duration: this.audio.duration || 0,
      playMode: this.playMode,
      playlist: [...this.playlist],
      currentIndex: this.currentIndex,
    };
  }

  // 检查是否有保存的播放状态
  hasSavedState(): boolean {
    return loadPlaybackState() !== null;
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }

  getDuration(): number {
    return this.audio.duration || 0;
  }


  isPlaying(): boolean {
    return !this.audio.paused;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getPlaylist(): string[] {
    return [...this.playlist];
  }
}

// Singleton instance
let playerInstance: AudioPlayer | null = null;

export function getAudioPlayer(): AudioPlayer {
  if (!playerInstance) {
    playerInstance = new AudioPlayer();
  }
  return playerInstance;
}
