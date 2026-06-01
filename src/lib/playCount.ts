// 播放次数管理
const STORAGE_KEY = "miyako_play_counts";

// 获取所有播放次数
export const getAllPlayCounts = (): Record<string, number> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// 获取单首歌曲的播放次数
export const getPlayCount = (localPath: string): number => {
  const counts = getAllPlayCounts();
  return counts[localPath] || 0;
};

// 增加播放次数
export const incrementPlayCount = (localPath: string): void => {
  try {
    const counts = getAllPlayCounts();
    counts[localPath] = (counts[localPath] || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch (e) {
    console.error("Failed to save play count:", e);
  }
};

// 获取播放次数排名（用于排序）
export const getPlayCountRanking = (): string[] => {
  const counts = getAllPlayCounts();
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
};
