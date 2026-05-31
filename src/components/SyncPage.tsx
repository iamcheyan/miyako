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
      addLog("已连接到 SMB 服务器", "success");
    } else if (connectionState.isConnecting) {
      addLog("正在连接到 SMB 服务器...");
    }
  }, [connectionState.connectionId, connectionState.isConnecting, addLog]);

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
      setError(`连接失败: ${errorMessage}`);
      return;
    }

    setIsSyncing(true);
    setError(null);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    try {
      // 步骤 1: 扫描远程目录
      addLog("开始扫描远程目录...");
      const remotePath = getRemotePath();
      addLog(`远程目录: /${remotePath || ""}`);
      const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
        connectionId: activeConnectionId,
        path: remotePath,
      });
      addLog(`扫描完成，找到 ${remoteFiles.length} 个音乐文件`, "success");

      // 步骤 2: 对比本地文件
      addLog("对比本地文件...");
      const localDir = getLocalDir();
      addLog(`本地目录: ${localDir}`);
      const actions = await invoke<SyncAction[]>("sync_compare", {
        remoteFiles,
        localDir,
      });

      const toDownload = actions.filter((a) => a.action === "Download");
      const toDelete = actions.filter((a) => a.action === "Delete");
      const toSkip = actions.filter((a) => a.action === "Skip");
      addLog(`需要下载: ${toDownload.length} 个，删除: ${toDelete.length} 个，跳过: ${toSkip.length} 个`);

      if (toDownload.length === 0 && toDelete.length === 0) {
        addLog("所有文件已是最新，无需同步", "success");
        setIsSyncing(false);
        return;
      }

      // 步骤 3: 下载和删除文件
      const totalActions = toDownload.length + toDelete.length;
      setProgress({ current: 0, total: totalActions });
      addLog("开始同步文件...");

      const state = await invoke<SyncState>("sync_download", {
        connectionId: activeConnectionId,
        actions: [...toDownload, ...toDelete],
        localDir,
        statePath: STATE_PATH,
      });

      setSyncState(state);
      addLog("同步完成！", "success");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(`同步失败: ${errorMessage}`);
      addLog(`同步失败: ${errorMessage}`, "error");
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
      {/* 固定标题栏 */}
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="page-title">{t("sync.title")}</h1>
      </div>

      {/* 固定头部：状态卡片 + 错误提示 + 统计 */}
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
              <button
                className="settings-btn"
                onClick={() => navigate("/settings")}
                aria-label={t("sync.settings")}
              >
                <span className="material-symbols-outlined">settings</span>
              </button>
              <button
                className="sync-fab"
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

        {/* 同步统计 */}
        <div className="stats-section">
          <h3 className="section-title">{t("sync.syncInfo")}</h3>
          <div className="stats-list">
            <div className="stat-row">
              <span className="material-symbols-outlined stat-icon">schedule</span>
              <span className="stat-label">{t("sync.lastSync")}</span>
              <span className="stat-value">
                {formatTime(syncState?.last_sync_time ?? null)}
              </span>
            </div>
            <div className="stat-row">
              <span className="material-symbols-outlined stat-icon">audio_file</span>
              <span className="stat-label">{t("sync.syncedFiles")}</span>
              <span className="stat-value">
                {syncState?.synced_files?.length ?? 0} {t("sync.files")}
              </span>
            </div>
          </div>
        </div>
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
              logs.map((log, index) => (
                <div key={index} className={`log-item log-${log.type}`}>
                  <span className="log-time">{log.time}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>


    </div>
  );
}

export default SyncPage;
