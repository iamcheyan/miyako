import { invoke } from "@tauri-apps/api/core";
import { loadSmbConfig } from "./smbConfig";

/**
 * Registers the configured local music directory with the Rust `media://`
 * protocol so audio files under it can be streamed for playback. Safe to call
 * repeatedly; each distinct directory is only registered once unless forced
 * (e.g. after the user changes the localDir setting).
 */
const registeredDirs = new Set<string>();

export async function ensureMediaRoot(force = false): Promise<void> {
  const localDir = loadSmbConfig().localDir || "~/Music/NasSync";
  if (!force && registeredDirs.has(localDir)) return;
  try {
    await invoke("media_allow_root", { path: localDir });
    registeredDirs.add(localDir);
  } catch (e) {
    console.error("Failed to register media root:", e);
  }
}
