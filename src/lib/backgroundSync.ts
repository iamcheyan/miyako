import { invoke } from "@tauri-apps/api/core";
import type { FileIndex, SyncAction, SyncState } from "../types/tauri-commands";
import { loadSmbConfig } from "./smbConfig";
import { ensureSmbConnection, getSmbSessionState } from "./smbSession";
import { shouldAutoSyncAsync } from "./deviceStatus";
import { SYNC_STATE_PATH } from "./syncState";
import {
  tryAcquireSyncLock,
  releaseSyncLock,
  isSyncInProgress,
} from "./syncCoordinator";
import { notifyLibrarySyncComplete } from "./libraryEvents";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * 初始化后台同步 - 自动启用，根据设备状态决定是否同步
 */
export function initBackgroundSync(): void {
  startBackgroundSync();
}

export function startBackgroundSync(): void {
  if (intervalId) return; // already running

  // Run immediately on start, then every 5 minutes
  runSync();
  intervalId = setInterval(runSync, SYNC_INTERVAL_MS);
}

export function stopBackgroundSync(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function runSync(): Promise<void> {
  if (isRunning || isSyncInProgress()) return;

  // 检查设备状态：充电 + WiFi + 可访问 NAS
  if (!(await shouldAutoSyncAsync())) {
    return;
  }

  const config = loadSmbConfig();
  if (!config.server || !config.share) return; // incomplete config, skip

  // Don't sync if there's already an active SMB connection from manual sync
  const session = getSmbSessionState();
  if (session.isConnecting) return;

  if (!tryAcquireSyncLock()) return;

  isRunning = true;

  try {
    const connectionId = await ensureSmbConnection(config);

    const remoteBasePath = config.remotePath?.trim() || "";

    // Use NAS file_index.json as the source of truth for file changes and metadata.
    const fileIndex = await invoke<FileIndex>("sync_download_file_index", {
      connectionId,
      remotePath: remoteBasePath,
    });

    const actions = await invoke<SyncAction[]>("sync_compare_with_index", {
      fileIndex,
      localDir: config.localDir || "~/Music/NasSync",
      statePath: SYNC_STATE_PATH,
      remotePath: remoteBasePath,
    });

    const toDownload = actions.filter((a) => a.action === "Download");
    const toDelete = actions.filter((a) => a.action === "Delete");
    const toMove = actions.filter((a) => a.action === "LocalMove");
    const toSkip = actions.filter((a) => a.action === "Skip");
    const indexDownloads = toDownload.filter((a) =>
      a.remote_path.endsWith("file_index.json")
    );
    const fileDownloads = toDownload.filter(
      (a) => !a.remote_path.endsWith("file_index.json")
    );

    if (actions.length === 0) {
      return;
    }

    await invoke<SyncState>("sync_download", {
      connectionId,
      actions: [
        ...toSkip,
        ...toMove,
        ...toDelete,
        ...indexDownloads,
        ...fileDownloads,
      ],
      localDir: config.localDir || "~/Music/NasSync",
      statePath: SYNC_STATE_PATH,
    });

    notifyLibrarySyncComplete();
  } catch (e) {
    console.error("[BackgroundSync] Sync failed:", e);
  } finally {
    isRunning = false;
    releaseSyncLock();
  }
}
