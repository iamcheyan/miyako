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
  private async loadSavedState() {
    const saved = loadPlaybackState();
    if (saved) {
      this.playlist = saved.playlist;
      this.currentIndex = saved.currentIndex;
      this.playMode = saved.playMode;
      this.audio.volume = saved.volume;

      // 恢复播放位置
      if (saved.currentIndex >= 0 && saved.currentIndex < saved.playlist.length) {
        try {
          this.audio.src = await this.toBlobUrl(saved.playlist[saved.currentIndex]);
          this.audio.currentTime = saved.currentTime;
        } catch (e) {
          console.error("Failed to restore saved state:", e);
        }
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
      console.log("Audio: play event");
      this.emit("play");
      this.saveState();
    });
    this.audio.addEventListener("pause", () => {
      console.log("Audio: pause event");
      this.emit("pause");
      this.saveState();
    });
    this.audio.addEventListener("ended", () => {
      console.log("Audio: ended event");
      this.handleEnded();
    });
    this.audio.addEventListener("timeupdate", () => {
      this.emit("timeupdate", this.audio.currentTime);
      if (Math.floor(this.audio.currentTime) % 3 === 0) {
        this.saveState();
      }
    });
    this.audio.addEventListener("loadedmetadata", () => {
      console.log("Audio: loadedmetadata, duration:", this.audio.duration);
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

  // 将本地文件路径转换为可播放的 blob URL
  private async toBlobUrl(filePath: string): Promise<string> {
    if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("blob:")) {
      return filePath;
    }

    try {
      // 使用自定义 Rust 命令读取文件
      const { invoke } = await import("@tauri-apps/api/core");
      const base64Data = await invoke<string>("read_audio_file", { path: filePath });

      // 将 base64 转换为 Blob
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: this.getMimeType(filePath) });
      const url = URL.createObjectURL(blob);

      console.log("Created blob URL for:", filePath);
      return url;
    } catch (e) {
      console.error("Failed to create blob URL:", e);
      throw e;
    }
  }

  // 根据文件扩展名获取 MIME 类型
  private getMimeType(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop();
    switch (ext) {
      case 'mp3': return 'audio/mpeg';
      case 'flac': return 'audio/flac';
      case 'wav': return 'audio/wav';
      case 'm4a': return 'audio/mp4';
      case 'aac': return 'audio/aac';
      case 'ogg': return 'audio/ogg';
      default: return 'audio/mpeg';
    }
  }

  async play(src?: string) {
    if (src) {
      this.audio.src = await this.toBlobUrl(src);
      console.log("Audio src set to:", this.audio.src);
    }
    try {
      await this.audio.play();
      console.log("Audio play started");
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

  async loadPlaylist(tracks: string[], startIndex: number = 0) {
    this.playlist = tracks;
    this.currentIndex = startIndex;

    if (tracks.length > 0 && startIndex >= 0 && startIndex < tracks.length) {
      this.audio.src = await this.toBlobUrl(tracks[startIndex]);
    }
    this.saveState();
  }

  async playTrack(index: number) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this.audio.src = await this.toBlobUrl(this.playlist[index]);
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
