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
  last_modified: number;
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
  username: string;
  password: string;
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

export type SyncActionType = "Download" | "Skip";

export interface SyncAction {
  remote_path: string;
  local_path: string;
  action: SyncActionType;
  reason: string;
}

export interface SyncedFile {
  remote_path: string;
  local_path: string;
  size: number;
  last_modified: number | null;
}

export interface SyncState {
  last_sync_time: number | null;
  synced_files: SyncedFile[];
}
