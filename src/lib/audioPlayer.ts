import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  bindNativeAudioEvents,
  getNativeCurrentTime,
  getNativeDuration,
  isAndroidNativeAudioAvailable,
  isNativePlaying,
  pauseNativeAudio,
  playNativeAudio,
  resumeNativeAudio,
  seekNativeAudio,
  stopNativeAudio,
} from "./androidNativeAudio";
import { savePlaybackState, loadPlaybackState } from "./playbackStorage";
import { isDemoMode, getDemoPlaylist, getDemoCurrentIndex } from "./demoData";
import { incrementPlayCount } from "./playCount";

export type PlayMode = "sequential" | "loop" | "shuffle";

export type PlayerEvent =
  | "play"
  | "pause"
  | "stop"
  | "ended"
  | "timeupdate"
  | "loadedmetadata"
  | "error"
  | "nexttrack"
  | "previoustrack";

export type EventCallback = (...args: unknown[]) => void;

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTrack: string | null;
  currentTime: number;
  duration: number;
  playMode: PlayMode;
  playlist: string[];
  currentIndex: number;
  radioMode: boolean;
}

export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private pendingRestoreSeconds: number | null = null;
  private playlist: string[] = [];
  private currentIndex: number = -1;
  private playMode: PlayMode = "sequential";
  private radioMode: boolean = false;
  private eventListeners: Map<PlayerEvent, Set<EventCallback>> = new Map();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedTime = -1;
  private loadGeneration = 0;
  private switchQueue: Promise<void> = Promise.resolve();
  private readonly useNativeAudio = isAndroidNativeAudioAvailable();
  private nativeTimeTimer: ReturnType<typeof setInterval> | null = null;

  // 演示模式专用状态
  private demoMode = false;
  private demoPlaying = false;
  private demoCurrentTime = 0;
  private demoDuration = 240;
  private demoTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.useNativeAudio) {
      this.setupNativeAudioEvents();
    } else {
      this.audio = new Audio();
      this.audio.preload = "none";
      this.audio.setAttribute("playsinline", "true");
      this.setupAudioEvents();
    }
    this.loadSavedState();
    
    // 检查是否为演示模式
    if (isDemoMode()) {
      this.demoMode = true;
      this.demoPlaying = false;
      this.demoCurrentTime = 0;
    }
  }

  // 加载保存的状态
  private async loadSavedState() {
    // 演示模式下加载演示播放列表
    if (isDemoMode()) {
      this.playlist = await getDemoPlaylist();
      this.currentIndex = getDemoCurrentIndex();
      this.demoDuration = 240; // 默认4分钟
      this.emit("loadedmetadata", this.demoDuration);
      return;
    }

    const saved = loadPlaybackState();
    if (saved) {
      this.playlist = saved.playlist;
      this.currentIndex = saved.currentIndex;
      this.playMode = saved.playMode;

      if (saved.currentIndex >= 0 && saved.currentIndex < saved.playlist.length) {
        if (this.useNativeAudio) {
          if (saved.currentTime > 0) {
            this.pendingRestoreSeconds = saved.currentTime;
          }
        } else {
          try {
            const audio = this.requireAudio();
            audio.src = await this.toPlayableUrl(saved.playlist[saved.currentIndex]);
            audio.currentTime = saved.currentTime;
          } catch (e) {
            console.error("Failed to restore saved state:", e);
          }
        }
      }
    }
  }

  private requireAudio(): HTMLAudioElement {
    if (!this.audio) {
      throw new Error("Web audio element is not available");
    }
    return this.audio;
  }

  // 保存状态（防抖）
  private saveState() {
    if (this.radioMode) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      if (this.playlist.length > 0 && this.currentIndex >= 0) {
        savePlaybackState({
          playlist: this.playlist,
          currentIndex: this.currentIndex,
          currentTime: this.useNativeAudio
            ? getNativeCurrentTime()
            : this.requireAudio().currentTime,
          playMode: this.playMode,
        });
      }
    }, 500);
  }

  private setupNativeAudioEvents() {
    bindNativeAudioEvents((detail) => {
      switch (detail.type) {
        case "play":
          this.startNativeTimeUpdates();
          this.emit("play");
          this.saveState();
          break;
        case "pause":
          this.stopNativeTimeUpdates();
          this.emit("pause");
          this.saveState();
          break;
        case "stop":
          this.stopNativeTimeUpdates();
          this.emit("stop");
          this.saveState();
          break;
        case "ended":
          this.stopNativeTimeUpdates();
          this.handleEnded();
          break;
        case "loadedmetadata": {
          if (this.pendingRestoreSeconds != null && this.pendingRestoreSeconds > 0) {
            seekNativeAudio(this.pendingRestoreSeconds);
            this.pendingRestoreSeconds = null;
          }
          this.emit("loadedmetadata", detail.duration ?? 0);
          break;
        }
        case "error":
          this.stopNativeTimeUpdates();
          this.emit("error", new Error("Native audio playback failed"));
          break;
        case "nexttrack":
          if (this.radioMode) {
            this.emit("nexttrack");
          } else {
            void this.next();
          }
          break;
        case "previoustrack":
          if (this.radioMode) {
            this.emit("previoustrack");
          } else {
            void this.previous();
          }
          break;
      }
    });
  }

  private startNativeTimeUpdates() {
    if (this.nativeTimeTimer) return;
    this.nativeTimeTimer = setInterval(() => {
      this.emit("timeupdate", getNativeCurrentTime());
    }, 500);
  }

  private stopNativeTimeUpdates() {
    if (!this.nativeTimeTimer) return;
    clearInterval(this.nativeTimeTimer);
    this.nativeTimeTimer = null;
  }

  private setupAudioEvents() {
    const audio = this.requireAudio();
    audio.addEventListener("play", () => {
      this.emit("play");
      this.saveState();
    });
    audio.addEventListener("pause", () => {
      this.emit("pause");
      this.saveState();
    });
    audio.addEventListener("ended", () => {
      this.handleEnded();
    });
    audio.addEventListener("timeupdate", () => {
      this.emit("timeupdate", audio.currentTime);
      const second = Math.floor(audio.currentTime);
      if (second !== this.lastPersistedTime && second % 5 === 0) {
        this.lastPersistedTime = second;
        this.saveState();
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      this.emit("loadedmetadata", audio.duration);
    });
    audio.addEventListener("error", (e) => {
      console.error("Audio error:", audio.error);
      this.emit("error", e);
    });
  }

  private handleEnded() {
    this.emit("ended");

    if (this.radioMode) {
      return;
    }

    switch (this.playMode) {
      case "sequential":
        this.next();
        break;
      case "loop": {
        const track = this.playlist[this.currentIndex];
        if (this.useNativeAudio && track) {
          seekNativeAudio(0);
          resumeNativeAudio();
        } else {
          const audio = this.requireAudio();
          audio.currentTime = 0;
          void audio.play();
        }
        break;
      }
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

  // 演示模式：开始模拟播放
  private startDemoPlayback() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
    }
    this.demoPlaying = true;
    
    // 模拟播放进度
    this.demoTimer = setInterval(() => {
      if (this.demoPlaying) {
        this.demoCurrentTime += 0.5;
        if (this.demoCurrentTime >= this.demoDuration) {
          this.demoCurrentTime = 0;
          this.handleDemoEnded();
        }
        this.emit("timeupdate", this.demoCurrentTime);
      }
    }, 500);
    
    this.emit("play");
  }
  
  // 演示模式：暂停
  private pauseDemoPlayback() {
    this.demoPlaying = false;
    this.emit("pause");
  }
  
  // 演示模式：播放结束处理
  private handleDemoEnded() {
    this.emit("ended");
    switch (this.playMode) {
      case "sequential":
        this.demoNext();
        break;
      case "loop":
        this.demoCurrentTime = 0;
        this.startDemoPlayback();
        break;
      case "shuffle":
        this.demoPlayRandom();
        break;
    }
  }
  
  // 演示模式：下一首
  private demoNext() {
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
    this.demoPlayTrack(nextIndex);
  }
  
  // 演示模式：随机播放
  private demoPlayRandom() {
    if (this.playlist.length === 0) return;
    const randomIndex = Math.floor(Math.random() * this.playlist.length);
    this.demoPlayTrack(randomIndex);
  }
  
  // 演示模式：播放指定曲目
  private demoPlayTrack(index: number) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this.demoCurrentTime = 0;
      this.emit("loadedmetadata", this.demoDuration);
      if (this.demoPlaying) {
        this.startDemoPlayback();
      }
      this.saveState();
    }
  }

  /** 流式播放本地文件；Tauri 真机路径使用 convertFileSrc，不做整文件 base64 读入 */
  private async toPlayableUrl(filePath: string): Promise<string> {
    if (
      filePath.startsWith("http://") ||
      filePath.startsWith("https://") ||
      filePath.startsWith("blob:") ||
      filePath.startsWith("asset://")
    ) {
      return filePath;
    }

    if (isTauri()) {
      return convertFileSrc(filePath);
    }

    return filePath;
  }

  private schedulePlayCount(path: string) {
    window.setTimeout(() => incrementPlayCount(path), 0);
  }

  private isSwitchAborted(generation: number) {
    return generation !== this.loadGeneration;
  }

  private enqueueSwitch<T>(task: () => Promise<T>): Promise<T> {
    const next = this.switchQueue.then(task, task);
    this.switchQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private waitUntilReady(generation: number, timeoutMs = 20000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isSwitchAborted(generation)) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const audio = this.requireAudio();
      const cleanup = () => {
        clearTimeout(timer);
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("loadeddata", onReady);
        audio.removeEventListener("error", onError);
      };

      const onReady = () => {
        if (this.isSwitchAborted(generation)) {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        const mediaError = audio.error;
        reject(new Error(mediaError?.message || "Audio load failed"));
      };

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Audio load timeout"));
      }, timeoutMs);

      if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        cleanup();
        resolve();
        return;
      }

      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("loadeddata", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }

  private async prepareAudioSource(filePath: string): Promise<number> {
    const generation = ++this.loadGeneration;
    const audio = this.requireAudio();
    audio.pause();
    const url = await this.toPlayableUrl(filePath);
    if (this.isSwitchAborted(generation)) {
      throw new DOMException("Aborted", "AbortError");
    }
    audio.src = url;
    audio.load();
    return generation;
  }

  private async setAudioSource(filePath: string) {
    await this.prepareAudioSource(filePath);
  }

  private playWithNative(filePath: string) {
    ++this.loadGeneration;
    playNativeAudio(filePath);
    this.schedulePlayCount(filePath);
  }

  private async startPlayback(filePath: string, generation: number) {
    if (this.useNativeAudio) {
      this.playWithNative(filePath);
      return;
    }

    await this.waitUntilReady(generation);
    if (this.isSwitchAborted(generation)) {
      throw new DOMException("Aborted", "AbortError");
    }
    await this.requireAudio().play();
    this.schedulePlayCount(filePath);
  }

  async play(src?: string) {
    // 演示模式
    if (this.demoMode) {
      this.startDemoPlayback();
      return;
    }

    if (this.useNativeAudio) {
      if (src) {
        this.playWithNative(src);
        return;
      }
      if (isNativePlaying()) {
        return;
      }
      const track =
        this.currentIndex >= 0 && this.currentIndex < this.playlist.length
          ? this.playlist[this.currentIndex]
          : null;
      if (track) {
        // 暂停后恢复播放（currentTime > 0 说明已加载过），否则从头播放
        if (getNativeCurrentTime() > 0) {
          resumeNativeAudio();
        } else {
          this.playWithNative(track);
        }
        return;
      }
      resumeNativeAudio();
      return;
    }

    if (src) {
      const generation = await this.prepareAudioSource(src);
      await this.startPlayback(src, generation);
      return;
    }

    try {
      await this.requireAudio().play();
      if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
        this.schedulePlayCount(this.playlist[this.currentIndex]);
      }
    } catch (e) {
      console.error("Audio play failed:", e);
      throw e;
    }
  }

  pause() {
    // 演示模式
    if (this.demoMode) {
      this.pauseDemoPlayback();
      return;
    }

    if (this.useNativeAudio) {
      pauseNativeAudio();
      return;
    }
    
    this.requireAudio().pause();
  }

  stop() {
    if (this.useNativeAudio) {
      stopNativeAudio();
      return;
    }

    const audio = this.requireAudio();
    audio.pause();
    audio.currentTime = 0;
    this.emit("stop");
    this.saveState();
  }

  seekTo(time: number) {
    // 演示模式
    if (this.demoMode) {
      this.demoCurrentTime = time;
      this.emit("timeupdate", this.demoCurrentTime);
      this.saveState();
      return;
    }

    if (this.useNativeAudio) {
      seekNativeAudio(time);
      this.emit("timeupdate", time);
      this.saveState();
      return;
    }
    
    this.requireAudio().currentTime = time;
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

    // 演示模式
    if (this.demoMode) {
      this.demoCurrentTime = 0;
      this.emit("loadedmetadata", this.demoDuration);
      this.saveState();
      return;
    }
    
    if (!this.useNativeAudio && tracks.length > 0 && startIndex >= 0 && startIndex < tracks.length) {
      await this.setAudioSource(tracks[startIndex]);
    }
    this.saveState();
  }

  /** 电台/快速切歌：串行切换；Android 走原生 MediaPlayer */
  async switchToTrack(filePath: string) {
    return this.enqueueSwitch(async () => {
      this.playlist = [filePath];
      this.currentIndex = 0;

      if (this.demoMode) {
        this.demoPlayTrack(0);
        return;
      }

      if (this.useNativeAudio) {
        this.pendingRestoreSeconds = null;
        this.playWithNative(filePath);
        if (!this.radioMode) {
          this.saveState();
        }
        return;
      }

      const generation = await this.prepareAudioSource(filePath);
      await this.startPlayback(filePath, generation);
      if (!this.radioMode) {
        this.saveState();
      }
    });
  }

  async playTrack(index: number) {
    if (index < 0 || index >= this.playlist.length) return;

    return this.enqueueSwitch(async () => {
      if (this.demoMode) {
        this.demoPlayTrack(index);
        return;
      }

      this.currentIndex = index;
      const track = this.playlist[index];
      if (this.useNativeAudio) {
        this.pendingRestoreSeconds = null;
        this.playWithNative(track);
        this.saveState();
        return;
      }

      const generation = await this.prepareAudioSource(track);
      await this.startPlayback(track, generation);
      this.saveState();
    });
  }

  async next() {
    if (this.playlist.length === 0) return;

    // 演示模式
    if (this.demoMode) {
      this.demoNext();
      return;
    }
    
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

    // 演示模式
    if (this.demoMode) {
      let prevIndex: number;
      switch (this.playMode) {
        case "shuffle":
          prevIndex = Math.floor(Math.random() * this.playlist.length);
          break;
        default:
          prevIndex = (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
          break;
      }
      this.demoPlayTrack(prevIndex);
      return;
    }
    
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
    // 演示模式：返回动态模拟数据
    if (this.demoMode) {
      return {
        isPlaying: this.demoPlaying,
        currentTrack: this.playlist[this.currentIndex] || null,
        currentTime: this.demoCurrentTime,
        duration: this.demoDuration,
        playMode: this.playMode,
        playlist: [...this.playlist],
        currentIndex: this.currentIndex,
        radioMode: this.radioMode,
      };
    }

    if (this.useNativeAudio) {
      return {
        isPlaying: isNativePlaying(),
        currentTrack:
          this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null,
        currentTime: getNativeCurrentTime(),
        duration: getNativeDuration(),
        playMode: this.playMode,
        playlist: [...this.playlist],
        currentIndex: this.currentIndex,
        radioMode: this.radioMode,
      };
    }

    const audio = this.requireAudio();
    return {
      isPlaying: !audio.paused,
      currentTrack:
        this.currentIndex >= 0 ? this.playlist[this.currentIndex] : null,
      currentTime: audio.currentTime,
      duration: audio.duration || 0,
      playMode: this.playMode,
      playlist: [...this.playlist],
      currentIndex: this.currentIndex,
      radioMode: this.radioMode,
    };
  }

  // 检查是否有保存的播放状态
  hasSavedState(): boolean {
    return loadPlaybackState() !== null;
  }

  setRadioMode(enabled: boolean) {
    this.radioMode = enabled;
  }

  getRadioMode(): boolean {
    return this.radioMode;
  }

  getCurrentTime(): number {
    if (this.useNativeAudio) {
      return getNativeCurrentTime();
    }
    return this.requireAudio().currentTime;
  }

  getDuration(): number {
    if (this.useNativeAudio) {
      return getNativeDuration();
    }
    return this.requireAudio().duration || 0;
  }


  isPlaying(): boolean {
    if (this.useNativeAudio) {
      return isNativePlaying();
    }
    return !this.requireAudio().paused;
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
