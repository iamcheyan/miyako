import { convertFileSrc } from "@tauri-apps/api/core";
import { savePlaybackState, loadPlaybackState } from "./playbackStorage";

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
  volume: number;
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
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

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
      this.audio.volume = saved.volume;

      // 恢复播放位置
      if (saved.currentIndex >= 0 && saved.currentIndex < saved.playlist.length) {
        this.audio.src = this.toAssetUrl(saved.playlist[saved.currentIndex]);
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
          volume: this.audio.volume,
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
    this.audio.addEventListener("ended", () => this.handleEnded());
    this.audio.addEventListener("timeupdate", () => {
      this.emit("timeupdate", this.audio.currentTime);
      // 每 3 秒保存一次播放位置
      if (Math.floor(this.audio.currentTime) % 3 === 0) {
        this.saveState();
      }
    });
    this.audio.addEventListener("loadedmetadata", () =>
      this.emit("loadedmetadata", this.audio.duration)
    );
    this.audio.addEventListener("error", (e) => this.emit("error", e));
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

  // 将本地文件路径转换为可播放的 URL
  private toAssetUrl(filePath: string): string {
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      return filePath;
    }
    return convertFileSrc(filePath);
  }

  async play(src?: string) {
    if (src) {
      this.audio.src = this.toAssetUrl(src);
    }
    await this.audio.play();
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

  setVolume(volume: number) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
    this.saveState();
  }

  setPlayMode(mode: PlayMode) {
    this.playMode = mode;
    this.saveState();
  }

  getPlayMode(): PlayMode {
    return this.playMode;
  }

  loadPlaylist(tracks: string[], startIndex: number = 0) {
    this.playlist = tracks;
    this.currentIndex = startIndex;

    if (tracks.length > 0 && startIndex >= 0 && startIndex < tracks.length) {
      this.audio.src = this.toAssetUrl(tracks[startIndex]);
    }
    this.saveState();
  }

  async playTrack(index: number) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this.audio.src = this.toAssetUrl(this.playlist[index]);
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
    return {
      isPlaying: !this.audio.paused,
      currentTrack:
        this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null,
      currentTime: this.audio.currentTime,
      duration: this.audio.duration || 0,
      volume: this.audio.volume,
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

  getVolume(): number {
    return this.audio.volume;
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
    playerInstance = newAudioPlayer();
  }
  return playerInstance;
}

// 创建新的播放器实例
function newAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
