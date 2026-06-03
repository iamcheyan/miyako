// 演示数据 - 仅用于测试UI，不影响真实数据
// 使用 ?demo=true URL参数启用
// 直接读取项目根目录的 file_index.json 作为数据源

import demoDataJson from "../data/demo-data.json";

export interface DemoMusicFile {
  name: string;
  remotePath: string;
  localPath: string;
  size: number;
  md5?: string;
  tag?: string;
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

export interface FileIndexEntry {
  md5: string;
  path: string;
  size: number;
  tag: string | null;
}

export interface FileIndex {
  generated_at: number;
  file_count: number;
  files: FileIndexEntry[];
}

// 缓存 file_index.json 数据
let cachedFileIndex: FileIndex | null = null;

// 检查是否启用演示模式
export const isDemoMode = (): boolean => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "true";
};

// 加载 file_index.json（直接从项目根目录读取）
const loadFileIndex = async (): Promise<FileIndex> => {
  if (cachedFileIndex) return cachedFileIndex;

  try {
    // 直接 fetch 项目根目录的 file_index.json
    const response = await fetch("/file_index.json");
    if (!response.ok) {
      throw new Error(`Failed to load file_index.json: ${response.status}`);
    }
    cachedFileIndex = await response.json();
    return cachedFileIndex!;
  } catch (e) {
    console.error("Failed to load file_index.json:", e);
    // 返回空数据
    return { generated_at: 0, file_count: 0, files: [] };
  }
};

// 获取演示文件夹数据（从 file_index.json 转换）
export const getDemoFolders = async (): Promise<{ folders: DemoFolder[]; rootFiles: DemoMusicFile[] }> => {
  const fileIndex = await loadFileIndex();
  const folderMap = new Map<string, DemoMusicFile[]>();
  const rootFiles: DemoMusicFile[] = [];

  for (const file of fileIndex.files) {
    // 去掉 /Music/ 前缀，获取相对路径
    let relativePath = file.path;
    if (relativePath.startsWith("/Music/")) {
      relativePath = relativePath.substring(7);
    } else if (relativePath.startsWith("Music/")) {
      relativePath = relativePath.substring(6);
    }

    const pathParts = relativePath.split("/").filter(p => p);
    const fileName = pathParts.pop() || "";
    const folderPath = pathParts.length > 0 ? pathParts.join("/") : null;

    const musicFile: DemoMusicFile = {
      name: fileName,
      remotePath: relativePath,
      localPath: `/demo/${relativePath}`,
      size: file.size,
      md5: file.md5,
      tag: file.tag || undefined,
    };

    if (folderPath) {
      // 文件在子目录中
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, []);
      }
      folderMap.get(folderPath)!.push(musicFile);
    } else {
      // 文件在根目录
      rootFiles.push(musicFile);
    }
  }

  const folders: DemoFolder[] = [];
  for (const [path, files] of folderMap.entries()) {
    const name = path.split("/").pop() || path;
    folders.push({ name, path, files });
  }

  return { folders, rootFiles };
};

// 获取演示播放列表数据（用于PlayerUI）
export const getDemoPlaylist = async (): Promise<string[]> => {
  const fileIndex = await loadFileIndex();
  return fileIndex.files.map(f => {
    let relativePath = f.path;
    if (relativePath.startsWith("/Music/")) {
      relativePath = relativePath.substring(7);
    } else if (relativePath.startsWith("Music/")) {
      relativePath = relativePath.substring(6);
    }
    return `/demo/${relativePath}`;
  });
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

// 获取演示文件索引
export const getDemoFileIndex = async (): Promise<FileIndex> => {
  return await loadFileIndex();
};

// 清除缓存（用于刷新数据）
export const clearFileIndexCache = (): void => {
  cachedFileIndex = null;
};
