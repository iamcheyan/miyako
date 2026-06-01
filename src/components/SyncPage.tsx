import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type {
  RemoteFile,
  SyncAction,
  SyncState,
} from "../types/tauri-commands";
import { loadSmbConfig } from "../lib/smbConfig";
import { ensureSmbConnection, getSmbSessionState, subscribeSmbSession } from "../lib/smbSession";
import "./SyncPage.css";

const STATE_PATH = "sync_state.json";

interface SyncLog {
  time: string;
  message: string;
  type: "info" | "success" | "error";
}

interface SyncProgressPayload {
  current: number;
  total: number;
  message: string;
  remote_path: string | null;
}

function SyncPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [connectionState, setConnectionState] = useState(getSmbSessionState());
  const [error, setError] = useState<string | null>(getSmbSessionState().error);

  const addLog = useCallback((message: string, type: SyncLog["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, message, type }]);
  }, []);

  // 加载配置并连接
  useEffect(() => {
    const config = loadSmbConfig();
    loadSyncState();
    const unsubscribe = subscribeSmbSession((nextState) => {
      setConnectionState(nextState);
      setError(nextState.error);
    });

    ensureSmbConnection(config).catch(() => {});

    return unsubscribe;
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await getCurrentWindow().listen<SyncProgressPayload>(
        "sync-progress",
        (event) => {
          const payload = event.payload;
          setProgress({
            current: payload.current,
            total: payload.total,
          });
          addLog(payload.message);
        }
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [addLog]);

  useEffect(() => {
    if (connectionState.connectionId) {
      addLog(t("sync.logs.connected"), "success");
    } else if (connectionState.isConnecting) {
      addLog(t("sync.logs.connecting"));
    }
  }, [connectionState.connectionId, connectionState.isConnecting, addLog, t]);

  const connectionId = connectionState.connectionId;

  const getLocalDir = (): string => {
    const config = loadSmbConfig();
    return config.localDir || "~/Music/NasSync";
  };

  const getRemotePath = (): string => {
    const config = loadSmbConfig();
    return config.remotePath || "";
  };

  const loadSyncState = async () => {
    try {
      const state = await invoke<SyncState>("sync_load_state", {
        statePath: STATE_PATH,
      });
      setSyncState(state);
    } catch (e) {
      console.error("Failed to load sync state:", e);
    }
  };

  const reconnectIfNeeded = async () => {
    if (connectionId) {
      return connectionId;
    }

    const config = loadSmbConfig();
    return ensureSmbConnection(config);
  };

  const handleStartSync = async () => {
    let activeConnectionId: string;
    try {
      activeConnectionId = await reconnectIfNeeded();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(`${t("sync.logs.connectFailed")} ${errorMessage}`);
      return;
    }

    setIsSyncing(true);
    setError(null);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    try {
      // 步骤 1: 扫描远程目录
      addLog(t("sync.logs.startScan"));
      const remotePath = getRemotePath();
      addLog(`${t("sync.logs.remoteDir")} /${remotePath || ""}`);
      const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
        connectionId: activeConnectionId,
        path: remotePath,
      });
      addLog(t("sync.logs.scanComplete", { count: remoteFiles.length }), "success");

      // 步骤 2: 对比本地文件
      addLog(t("sync.logs.comparing"));
      const localDir = getLocalDir();
      addLog(`${t("sync.logs.localDir")} ${localDir}`);
      const actions = await invoke<SyncAction[]>("sync_compare", {
        remoteFiles,
        localDir,
      });

      const toDownload = actions.filter((a) => a.action === "Download");
      const toDelete = actions.filter((a) => a.action === "Delete");
      const toSkip = actions.filter((a) => a.action === "Skip");
      const toMove = actions.filter((a) => a.action === "LocalMove");
      addLog(t("sync.logs.needSync", { download: toDownload.length, move: toMove.length, delete: toDelete.length, skip: toSkip.length }));

      if (toDownload.length === 0 && toDelete.length === 0 && toMove.length === 0) {
        addLog(t("sync.logs.allUpToDate"), "success");
        setIsSyncing(false);
        return;
      }

      // 步骤 3: 下载、移动和删除文件
      const totalActions = toDownload.length + toDelete.length + toMove.length;
      setProgress({ current: 0, total: totalActions });
      addLog(t("sync.logs.startSync"));

      const state = await invoke<SyncState>("sync_download", {
        connectionId: activeConnectionId,
        actions: [...toDownload, ...toDelete, ...toMove],
        localDir,
        statePath: STATE_PATH,
      });

      setSyncState(state);
      addLog(t("sync.logs.syncComplete"), "success");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(`${t("sync.logs.syncFailed")} ${errorMessage}`);
      addLog(`${t("sync.logs.syncFailed")} ${errorMessage}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return t("sync.never");
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="sync-page">
      {/* 固定头部:状态卡片 + 错误提示 + 统计 */}
      <div className="sync-header">
        {/* 同步状态卡片 */}
        <div className="status-card">
          <div className="status-header">
            <div className="status-info">
              <span className="material-symbols-outlined status-icon">
                {connectionId ? "cloud_done" : "cloud_off"}
              </span>
              <div className="status-text">
                <span className="status-title">
                  {connectionId ? t("sync.connected") : connectionState.isConnecting ? t("sync.connecting") : t("sync.disconnected")}
                </span>
                <span className="status-subtitle">
                  {connectionId ? t("sync.nasServer") : connectionState.isConnecting ? t("sync.connectingTo") : t("sync.configureFirst")}
                </span>
              </div>
            </div>

            <div className="status-actions">
              {connectionId && (
                <button
                  className="browse-btn"
                  onClick={() => navigate("/remote")}
                  aria-label={t("sync.browseRemote")}
                >
                  <span className="material-symbols-outlined">folder_open</span>
                </button>
              )}

              <button
                className={`sync-fab ${isSyncing ? "syncing" : ""}`}
                onClick={handleStartSync}
                disabled={isSyncing || connectionState.isConnecting}
              >
                <span className="material-symbols-outlined">
                  {isSyncing ? "sync" : "sync"}
                </span>
              </button>
            </div>
          </div>

          {isSyncing && (
            <div className="sync-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="progress-text">
                {progress.current} / {progress.total}
              </span>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="error-banner">
            <span className="material-symbols-outlined">error</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 可滚动内容：同步日志 */}
      <div className="sync-scroll">
        <div className="log-section">
          <h3 className="section-title">{t("sync.syncLog")}</h3>
          <div className="log-list">
            {logs.length === 0 ? (
              <div className="log-empty">
                <span className="material-symbols-outlined">terminal</span>
                <span>{t("sync.noLogs")}</span>
              </div>
            ) : (
              // 只显示最新的一条日志
              (() => {
                const latestLog = logs[logs.length - 1];
                return (
                  <div className={`log-item log-${latestLog.type}`}>                  
                    <span className="log-time">{latestLog.time}</span>
                    <span className="log-message">{latestLog.message}</span>
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {/* 最后同步时间 */}
        <div className="last-sync-info">
          <span className="material-symbols-outlined">schedule</span>
          <span>{t("sync.lastSync")}: {formatTime(syncState?.last_sync_time ?? null)}</span>
        </div>
      </div>


    </div>
  );
}

export default SyncPage;
