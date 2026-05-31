import { invoke } from "@tauri-apps/api/core";

export interface RecentTrack {
  path: string;
  playedAt: number; // unix timestamp
}

export interface PlaybackState {
  currentTrack: string | null;
  currentTime: number;
  playMode: string;
}

const STORAGE_DIR = "app_data";
const RECENT_FILE = "recent.json";
const HISTORY_FILE = "history.json";
const PLAYBACK_FILE = "playback_state.json";

export class StorageManager {
  private recent: RecentTrack[] = [];
  private history: RecentTrack[] = [];
  private playbackState: PlaybackState | null = null;

  async initialize() {
    try {
      this.recent = await this.loadJson<RecentTrack[]>(RECENT_FILE, []);
      this.history = await this.loadJson<RecentTrack[]>(HISTORY_FILE, []);
      this.playbackState = await this.loadJson<PlaybackState | null>(
        PLAYBACK_FILE,
        null
      );
    } catch (e) {
      console.error("Failed to initialize storage:", e);
    }
  }

  private async loadJson<T>(filename: string, defaultValue: T): Promise<T> {
    try {
      const content = await invoke<string>("storage_read", {
        dir: STORAGE_DIR,
        filename,
      });
      return JSON.parse(content) as T;
    } catch {
      return defaultValue;
    }
  }

  private async saveJson<T>(filename: string, data: T): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await invoke("storage_write", {
      dir: STORAGE_DIR,
      filename,
      content,
    });
  }

  // Recent tracks (last 50)
  getRecentTracks(): RecentTrack[] {
    return [...this.recent].sort((a, b) => b.playedAt - a.playedAt);
  }

  async addRecentTrack(path: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const track: RecentTrack = { path, playedAt: now };

    // Remove if already exists
    this.recent = this.recent.filter((t) => t.path !== path);

    // Add to front
    this.recent.unshift(track);

    // Keep only last 50
    if (this.recent.length > 50) {
      this.recent = this.recent.slice(0, 50);
    }

    await this.saveJson(RECENT_FILE, this.recent);
  }

  // History (all played tracks)
  getHistory(): RecentTrack[] {
    return [...this.history].sort((a, b) => b.playedAt - a.playedAt);
  }

  async addHistory(path: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const track: RecentTrack = { path, playedAt: now };

    // Add to front
    this.history.unshift(track);

    await this.saveJson(HISTORY_FILE, this.history);
  }

  // Playback state
  getPlaybackState(): PlaybackState | null {
    return this.playbackState;
  }

  async savePlaybackState(state: PlaybackState): Promise<void> {
    this.playbackState = state;
    await this.saveJson(PLAYBACK_FILE, state);
  }

  async clearRecent(): Promise<void> {
    this.recent = [];
    await this.saveJson(RECENT_FILE, this.recent);
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    await this.saveJson(HISTORY_FILE, this.history);
  }

  async clearPlaybackState(): Promise<void> {
    this.playbackState = null;
    await this.saveJson(PLAYBACK_FILE, null);
  }
}

// Singleton instance
let storageInstance: StorageManager | null = null;

export function getStorageManager(): StorageManager {
  if (!storageInstance) {
    storageInstance = new StorageManager();
  }
  return storageInstance;
}
