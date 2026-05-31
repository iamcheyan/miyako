// 收藏歌曲管理

const FAVORITES_KEY = "miyako_favorites";

// 获取所有收藏的歌曲路径
export const getFavorites = (): string[] => {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

// 检查歌曲是否已收藏
export const isFavorite = (trackPath: string): boolean => {
  const favorites = getFavorites();
  return favorites.includes(trackPath);
};

// 切换收藏状态
export const toggleFavorite = (trackPath: string): boolean => {
  const favorites = getFavorites();
  const index = favorites.indexOf(trackPath);
  
  if (index === -1) {
    // 添加收藏
    favorites.push(trackPath);
  } else {
    // 取消收藏
    favorites.splice(index, 1);
  }
  
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return index === -1; // 返回 true 表示已收藏，false 表示已取消
};

// 获取收藏数量
export const getFavoritesCount = (): number => {
  return getFavorites().length;
};
