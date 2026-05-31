// 播放状态持久化存储
const STORAGE_KEY = "playback-state";

export interface PlaybackState {
  playlist: string[];
  currentIndex: number;
  currentTime: number;
  volume: number;
  playMode: "sequential" | "loop" | "shuffle";
  lastPlayedAt: number;
}

// 保存播放状态
export function savePlaybackState(state: Omit<PlaybackState, "lastPlayedAt">): void {
  try {
    const data: PlaybackState = {
      ...state,
      lastPlayedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save playback state:", e);
  }
}

// 加载播放状态
export function loadPlaybackState(): PlaybackState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const state = JSON.parse(raw) as PlaybackState;

    // 验证数据有效性
    if (!Array.isArray(state.playlist) || state.playlist.length === 0) {
      return null;
    }

    return state;
  } catch (e) {
    console.error("Failed to load playback state:", e);
    return null;
  }
}

// 清除播放状态
export function clearPlaybackState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
