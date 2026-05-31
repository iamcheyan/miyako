// 演示数据 - 仅用于测试UI，不影响真实数据
// 使用 ?demo=true URL参数启用

import demoDataJson from "../data/demo-data.json";

export interface DemoMusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
}

export interface DemoFolder {
  name: string;
  path: string;
  files: DemoMusicFile[];
}

export interface DemoDirEntry {
  name: string;
  is_directory: boolean;
  size: number;
}

// 检查是否启用演示模式
export const isDemoMode = (): boolean => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "true";
};

// 获取演示文件夹数据
export const getDemoFolders = (): DemoFolder[] => {
  return demoDataJson.folders as DemoFolder[];
};

// 获取演示播放列表数据（用于PlayerUI）
export const getDemoPlaylist = (): string[] => {
  const folders = demoDataJson.folders as DemoFolder[];
  const playlist: string[] = [];
  
  for (const folder of folders) {
    for (const file of folder.files) {
      playlist.push(file.localPath);
    }
  }
  
  return playlist;
};

// 获取演示模式下的当前播放索引
export const getDemoCurrentIndex = (): number => {
  return 0;
};

// 获取远程浏览器的根目录条目
export const getDemoRootEntries = (): DemoDirEntry[] => {
  return demoDataJson.rootEntries as DemoDirEntry[];
};

// 获取远程浏览器指定路径的条目
export const getDemoEntries = (path: string): DemoDirEntry[] => {
  const entries = demoDataJson.remoteBrowser[path as keyof typeof demoDataJson.remoteBrowser];
  if (!entries) return [];
  
  return entries.map(entry => ({
    ...entry,
    last_modified: Date.now(),
  }));
};
