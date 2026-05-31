import type { SmbConfig } from "../types/tauri-commands";

export const SMB_CONFIG_STORAGE_KEY = "smb-config";

// Read from environment variables, fallback to empty strings
export const DEFAULT_SMB_CONFIG: SmbConfig = {
  server: import.meta.env.VITE_SMB_SERVER || "",
  share: import.meta.env.VITE_SMB_SHARE || "",
  remotePath: import.meta.env.VITE_SMB_REMOTE_PATH || "",
  username: import.meta.env.VITE_SMB_USERNAME || "",
  password: import.meta.env.VITE_SMB_PASSWORD || "",
  localDir: import.meta.env.VITE_SMB_LOCAL_DIR || "~/Music/NasSync",
};

export function loadSmbConfig(): SmbConfig {
  const savedConfig = localStorage.getItem(SMB_CONFIG_STORAGE_KEY);
  if (!savedConfig) {
    localStorage.setItem(
      SMB_CONFIG_STORAGE_KEY,
      JSON.stringify(DEFAULT_SMB_CONFIG)
    );
    return DEFAULT_SMB_CONFIG;
  }

  try {
    const parsed = JSON.parse(savedConfig) as Partial<SmbConfig>;
    const mergedConfig: SmbConfig = {
      server: parsed.server?.trim() || DEFAULT_SMB_CONFIG.server,
      share: parsed.share?.trim() || DEFAULT_SMB_CONFIG.share,
      remotePath: parsed.remotePath?.trim() || DEFAULT_SMB_CONFIG.remotePath,
      username: parsed.username?.trim() || DEFAULT_SMB_CONFIG.username,
      password: parsed.password || DEFAULT_SMB_CONFIG.password,
      localDir: parsed.localDir?.trim() || DEFAULT_SMB_CONFIG.localDir,
    };

    // Persist merged defaults so existing installs get newly added fields.
    if (JSON.stringify(parsed) !== JSON.stringify(mergedConfig)) {
      localStorage.setItem(
        SMB_CONFIG_STORAGE_KEY,
        JSON.stringify(mergedConfig)
      );
    }

    return mergedConfig;
  } catch (error) {
    console.error("Failed to parse saved SMB config:", error);
    localStorage.setItem(
      SMB_CONFIG_STORAGE_KEY,
      JSON.stringify(DEFAULT_SMB_CONFIG)
    );
    return DEFAULT_SMB_CONFIG;
  }
}

export function saveSmbConfig(config: SmbConfig): void {
  localStorage.setItem(SMB_CONFIG_STORAGE_KEY, JSON.stringify(config));
}
