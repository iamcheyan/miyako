export const LIBRARY_SYNC_COMPLETE = "library-sync-complete";

export function notifyLibrarySyncComplete(): void {
  window.dispatchEvent(new Event(LIBRARY_SYNC_COMPLETE));
}