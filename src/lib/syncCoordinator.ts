/** 防止设置页手动同步与后台定时同步同时跑 sync_download */
let syncInProgress = false;

export function tryAcquireSyncLock(): boolean {
  if (syncInProgress) return false;
  syncInProgress = true;
  return true;
}

export function releaseSyncLock(): void {
  syncInProgress = false;
}

export function isSyncInProgress(): boolean {
  return syncInProgress;
}