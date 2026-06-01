import { invoke } from "@tauri-apps/api/core";
import type { RemoteFile, SyncAction, SyncState } from "../types/tauri-commands";
import { loadSmbConfig } from "./smbConfig";
import { ensureSmbConnection, getSmbSessionState } from "./smbSession";

const STORAGE_KEY = "background-sync-enabled";
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STATE_PATH = "sync_state.json";

let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function isBackgroundSyncEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setBackgroundSyncEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  if (enabled) {
    startBackgroundSync();
  } else {
    stopBackgroundSync();
  }
}

export function initBackgroundSync(): void {
  if (isBackgroundSyncEnabled()) {
    startBackgroundSync();
  }
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
  if (isRunning) return; // skip if already syncing

  const config = loadSmbConfig();
  if (!config.server || !config.share) return; // incomplete config, skip

  // Don't sync if there's already an active SMB connection from manual sync
  const session = getSmbSessionState();
  if (session.isConnecting) return;

  isRunning = true;

  try {
    const connectionId = await ensureSmbConnection(config);

    // Scan remote
    const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
      connectionId,
      path: config.remotePath || "",
    });

    // Compare
    const actions = await invoke<SyncAction[]>("sync_compare", {
      remoteFiles,
      localDir: config.localDir || "~/Music/NasSync",
    });

    const toDownload = actions.filter((a) => a.action === "Download");
    const toDelete = actions.filter((a) => a.action === "Delete");
    const toMove = actions.filter((a) => a.action === "LocalMove");

    if (toDownload.length === 0 && toDelete.length === 0 && toMove.length === 0) {
      console.log("[BackgroundSync] Already up to date");
      return;
    }

    // Download
    console.log(`[BackgroundSync] Syncing: ${toDownload.length} download, ${toMove.length} move, ${toDelete.length} delete`);
    await invoke<SyncState>("sync_download", {
      connectionId,
      actions: [...toDownload, ...toDelete, ...toMove],
      localDir: config.localDir || "~/Music/NasSync",
      statePath: STATE_PATH,
    });

    console.log("[BackgroundSync] Sync complete");
  } catch (e) {
    console.error("[BackgroundSync] Sync failed:", e);
  } finally {
    isRunning = false;
  }
}
