import { invoke } from "@tauri-apps/api/core";
import type { SmbConfig, ConnectResult } from "../types/tauri-commands";

export interface SmbSessionState {
  connectionId: string | null;
  isConnecting: boolean;
  error: string | null;
}

const listeners = new Set<(state: SmbSessionState) => void>();

let state: SmbSessionState = {
  connectionId: null,
  isConnecting: false,
  error: null,
};

let activeConfigKey: string | null = null;
let pendingConnection: Promise<string> | null = null;

function getConfigKey(config: SmbConfig): string {
  return [
    config.server.trim(),
    config.share.trim(),
    config.username.trim(),
    config.password,
  ].join("|");
}

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}

export function getSmbSessionState(): SmbSessionState {
  return state;
}

export function subscribeSmbSession(
  listener: (state: SmbSessionState) => void
): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function ensureSmbConnection(config: SmbConfig): Promise<string> {
  const configKey = getConfigKey(config);

  if (state.connectionId && activeConfigKey === configKey) {
    return state.connectionId;
  }

  if (pendingConnection && activeConfigKey === configKey) {
    return pendingConnection;
  }

  activeConfigKey = configKey;
  state = {
    connectionId: state.connectionId && activeConfigKey === configKey ? state.connectionId : null,
    isConnecting: true,
    error: null,
  };
  notify();

  pendingConnection = invoke<ConnectResult>("smb_connect", {
    server: config.server,
    share: config.share,
    username: config.username,
    password: config.password,
  })
    .then((result) => {
      state = {
        connectionId: result.connection_id,
        isConnecting: false,
        error: null,
      };
      notify();
      return result.connection_id;
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state = {
        connectionId: null,
        isConnecting: false,
        error: `连接失败: ${errorMessage}`,
      };
      notify();
      throw error;
    })
    .finally(() => {
      pendingConnection = null;
    });

  return pendingConnection;
}
