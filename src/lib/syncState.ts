import type { SyncState } from "../types/tauri-commands";

export const SYNC_STATE_PATH = "sync_state.json";

export const isPlayableSyncedFile = (file: SyncState["synced_files"][number]) =>
  file.tag !== "metadata" &&
  !file.remote_path.toLowerCase().endsWith("file_index.json");

export function getUniquePlayableSyncedFiles(state: SyncState): SyncState["synced_files"] {
  const seen = new Set<string>();
  return state.synced_files.filter((file) => {
    if (!isPlayableSyncedFile(file)) return false;
    const key = `${file.remote_path}\n${file.local_path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
