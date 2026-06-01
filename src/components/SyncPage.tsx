import { useState, useEffect } from "react";
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
import { ensureSmbConnection, getSmbSessionState, subscribeSmbSession, invalidateConnection } from "../lib/smbSession";
import { showStatusBar } from "../lib/androidStatusBar";
import "./SyncPage.css";

const STATE_PATH = "sync_state.json";

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
  const [connectionState, setConnectionState] = useState(getSmbSessionState());
  const [error, setError] = useState<string | null>(getSmbSessionState().error);

  // 显示状态栏
  useEffect(() => {
    showStatusBar();
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
        }
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

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

  const handleStartSyncInternal = async (retryCount = 0) => {
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
    setProgress({ current: 0, total: 0 });

    try {
      // 步骤 1: 扫描远程目录
      const remotePath = getRemotePath();
      const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
        connectionId: activeConnectionId,
        path: remotePath,
      });

      // 步骤 2: 对比本地文件
      const localDir = getLocalDir();
      const actions = await invoke<SyncAction[]>("sync_compare", {
        remoteFiles,
        localDir,
      });

      const toDownload = actions.filter((a) => a.action === "Download");
      const toDelete = actions.filter((a) => a.action === "Delete");
      const toMove = actions.filter((a) => a.action === "LocalMove");

      if (toDownload.length === 0 && toDelete.length === 0 && toMove.length === 0) {
        setIsSyncing(false);
        return;
      }

      // 步骤 3: 下载、移动和删除文件
      const totalActions = toDownload.length + toDelete.length + toMove.length;
      setProgress({ current: 0, total: totalActions });

      const state = await invoke<SyncState>("sync_download", {
        connectionId: activeConnectionId,
        actions: [...toDownload, ...toDelete, ...toMove],
        localDir,
        statePath: STATE_PATH,
      });

      setSyncState(state);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // 检测 SMB worker 崩溃错误，自动重连重试
      const isWorkerError = errorMessage.includes("Failed to send message to worker") ||
                           errorMessage.includes("Message processing failed");
      if (isWorkerError && retryCount < 2) {
        invalidateConnection();
        const config = loadSmbConfig();
        try {
          await ensureSmbConnection(config);
          setIsSyncing(false);
          handleStartSyncInternal(retryCount + 1);
          return;
        } catch {
          // 重连失败，显示错误
        }
      }
      setError(`${t("sync.logs.syncFailed")} ${errorMessage}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleStartSync = () => {
    handleStartSyncInternal(0);
  };

  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return t("sync.never");
    return new Date(timestamp * 1000).toLocaleString();
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  };

  return (
    <div className="sync-page">
      {/* 可滚动内容 */}
      <div className="sync-scroll">
        <header className="page-header">
          <button
            className="back-btn"
            type="button"
            onClick={handleBack}
            aria-label={t("common.back")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="page-title">{t("sync.title")}</h1>
        </header>

        {/* 同步状态 + 错误提示 */}
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

        {/* 最近同步的歌曲 */}
        <div className="recent-sync-section">
          <h3 className="section-title">{t("sync.recentSync")}</h3>
          <div className="recent-sync-list">
            {syncState?.synced_files && syncState.synced_files.length > 0 ? (
              // 按 last_modified 倒序，显示最近同步的歌曲
              [...syncState.synced_files]
                .sort((a, b) => (b.last_modified || 0) - (a.last_modified || 0))
                .slice(0, 20)
                .map((file, index) => {
                  // 从 remote_path 提取歌曲名（去掉文件夹路径）
                  const songName = file.remote_path.split('/').pop() || file.remote_path;
                  const timeStr = file.last_modified
                    ? new Date(file.last_modified * 1000).toLocaleTimeString()
                    : '';
                  return (
                    <div className="recent-sync-item" key={index}>
                      <span className="recent-sync-time">{timeStr}</span>
                      <span className="recent-sync-name">{songName}</span>
                    </div>
                  );
                })
            ) : (
              <div className="log-empty">
                <span className="material-symbols-outlined">music_note</span>
                <span>{t("sync.noRecentSync")}</span>
              </div>
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
