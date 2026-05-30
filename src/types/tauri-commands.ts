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
