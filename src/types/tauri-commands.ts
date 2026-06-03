/**
 * Type definitions for Tauri commands
 */

export interface ConnectResult {
  connection_id: string;
}

export interface DirEntry {
  name: string;
  is_directory: boolean;
  size: number;
  last_modified?: number;
}

export interface DownloadResult {
  success: boolean;
  message: string;
}

export interface FileInfo {
  size: number;
  last_modified: number;
}

export interface SmbConfig {
  server: string;
  share: string;
  remotePath: string;
  username: string;
  password: string;
  localDir: string;
}

export interface ConnectionState {
  isConnected: boolean;
  connectionId: string | null;
  error: string | null;
}

// Sync engine types
export interface RemoteFile {
  remote_path: string;
  size: number;
  last_modified: number | null;
}

export type SyncActionType = "Download" | "Skip" | "Delete" | "LocalMove";

export interface SyncAction {
  remote_path: string;
  local_path: string;
  old_local_path: string | null;
  action: SyncActionType;
  reason: string;
  md5: string | null;
  tag: string | null;
}

export interface SyncedFile {
  remote_path: string;
  local_path: string;
  size: number;
  last_modified: number | null;
  md5: string | null;
  tag: string | null;
}

export interface SyncState {
  last_sync_time: number | null;
  synced_files: SyncedFile[];
}

// File index types
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
