import { getAudioPlayer } from "./audioPlayer";

export class MediaSessionManager {
  private player = getAudioPlayer();
  private isInitialized = false;

  initialize() {
    if (this.isInitialized) return;
    if (!("mediaSession" in navigator)) {
      console.warn("MediaSession API not supported");
      return;
    }

    this.setupMediaSession();
    this.setupAudioFocus();
    this.isInitialized = true;
  }

  private setupMediaSession() {
    // Android WebView 需要先设置 metadata 才能激活 MediaSession
    // action handlers 在 metadata 设置后注册才有效
    // Update metadata when track changes
    this.player.on("loadedmetadata", () => {
      this.updateMetadata();
      this.registerActionHandlers();
      // 设置播放状态，确保 Android MediaSession 完全激活
      this.updatePlaybackState();
    });

    this.player.on("play", () => {
      this.updatePlaybackState();
    });

    this.player.on("pause", () => {
      this.updatePlaybackState();
    });

    this.player.on("timeupdate", () => {
      this.updatePositionState();
    });
  }

  private registerActionHandlers() {
    const { mediaSession } = navigator;
    if (!mediaSession) return;

    // Android WebView 要求在 metadata 设置后才能成功注册 action handlers
    try {
      mediaSession.setActionHandler("play", () => {
        this.player.play();
      });

      mediaSession.setActionHandler("pause", () => {
        this.player.pause();
      });

      mediaSession.setActionHandler("stop", () => {
        this.player.stop();
      });

      mediaSession.setActionHandler("previoustrack", () => {
        this.player.previous();
      });

      mediaSession.setActionHandler("nexttrack", () => {
        this.player.next();
      });

      mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime != null) {
          this.player.seekTo(details.seekTime);
        }
      });
    } catch (e) {
      console.warn("Failed to set MediaSession action handlers:", e);
    }
  }

  private setupAudioFocus() {
    // Handle headphone unplugging
    const audio = document.querySelector("audio");
    if (audio) {
      audio.addEventListener("pause", () => {
        // Update MediaSession state when audio is paused externally
        this.updatePlaybackState();
      });
    }

    // Handle visibility change (app goes to background)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // App is in background, keep playing
        // MediaSession will handle audio focus
      }
    });
  }

  private updateMetadata() {
    const state = this.player.getState();
    if (!state.currentTrack) return;

    const fileName = this.getFileName(state.currentTrack);
    const folderName = this.getFolderName(state.currentTrack);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: fileName,
      artist: folderName || "未知艺术家",
      album: "NAS Music Sync",
    });
  }

  private updatePlaybackState() {
    const state = this.player.getState();
    navigator.mediaSession.playbackState = state.isPlaying
      ? "playing"
      : "paused";
  }

  private updatePositionState() {
    const state = this.player.getState();
    if (state.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: state.duration,
        playbackRate: 1,
        position: state.currentTime,
      });
    }
  }

  private getFileName(path: string): string {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1];
    const lastDot = fileName.lastIndexOf(".");
    return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  }

  private getFolderName(path: string): string {
    const parts = path.split("/");
    return parts.length > 1 ? parts[parts.length - 2] : "";
  }
}

// Singleton instance
let managerInstance: MediaSessionManager | null = null;

export function getMediaSessionManager(): MediaSessionManager {
  if (!managerInstance) {
    managerInstance = new MediaSessionManager();
  }
  return managerInstance;
}
