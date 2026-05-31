import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  RemoteFile,
  SyncAction,
  SyncState,
  SmbConfig,
} from "../types/tauri-commands";
import { loadSmbConfig } from "../lib/smbConfig";
import "./SyncPage.css";

const STATE_PATH = "sync_state.json";

interface SyncLog {
  time: string;
  message: string;
  type: "info" | "success" | "error";
}

// #region debug-point A:frontend-sync-stage
const DEBUG_SERVER_URL = "http://127.0.0.1:7778/event";
const DEBUG_SESSION_ID = "sync-scan-stall";

function reportDebugEvent(
  hypothesisId: "A" | "C" | "D" | "E",
  msg: string,
  data: Record<string, unknown>
) {
  fetch(DEBUG_SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: "pre-fix",
      hypothesisId,
      location: "src/components/SyncPage.tsx",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

function SyncPage() {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((message: string, type: SyncLog["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, message, type }]);
  }, []);

  // 加载配置并连接
  useEffect(() => {
    const config = loadSmbConfig();
    connectToSmb(config);
    loadSyncState();
  }, []);

  const connectToSmb = async (config: SmbConfig) => {
    try {
      const result = await invoke<{ connection_id: string }>("smb_connect", {
        server: config.server,
        share: config.share,
        username: config.username,
        password: config.password,
      });
      setConnectionId(result.connection_id);
      addLog("已连接到 SMB 服务器", "success");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setError(`连接失败: ${errorMessage}`);
      addLog(`连接失败: ${errorMessage}`, "error");
    }
  };

  const getLocalDir = (): string => {
    const config = loadSmbConfig();
    return config.localDir || "~/Music/NasSync";
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

  const handleStartSync = async () => {
    if (!connectionId) {
      setError("未连接到 SMB 服务器");
      return;
    }

    setIsSyncing(true);
    setError(null);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    try {
      // 步骤 1: 扫描远程目录
      addLog("开始扫描远程目录...");
      // #region debug-point A:scan-start
      reportDebugEvent("A", "sync scan started", {
        connectionId,
      });
      // #endregion
      const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
        connectionId,
        path: "",
      });
      // #region debug-point A:scan-finished
      reportDebugEvent("A", "sync scan finished", {
        remoteFileCount: remoteFiles.length,
      });
      // #endregion
      addLog(`扫描完成，找到 ${remoteFiles.length} 个音乐文件`, "success");

      // 步骤 2: 对比本地文件
      addLog("对比本地文件...");
      const localDir = getLocalDir();
      addLog(`本地目录: ${localDir}`);
      // #region debug-point C:compare-start
      reportDebugEvent("C", "sync compare started", {
        remoteFileCount: remoteFiles.length,
        localDir,
      });
      // #endregion
      const actions = await invoke<SyncAction[]>("sync_compare", {
        remoteFiles,
        localDir,
      });
      // #region debug-point C:compare-finished
      reportDebugEvent("C", "sync compare finished", {
        actionCount: actions.length,
      });
      // #endregion

      const toDownload = actions.filter((a) => a.action === "Download");
      const toSkip = actions.filter((a) => a.action === "Skip");
      // #region debug-point D:action-summary
      reportDebugEvent("D", "sync actions summarized", {
        toDownload: toDownload.length,
        toSkip: toSkip.length,
      });
      // #endregion
      addLog(`需要下载: ${toDownload.length} 个文件，跳过: ${toSkip.length} 个文件`);

      if (toDownload.length === 0) {
        addLog("所有文件已是最新，无需同步", "success");
        setIsSyncing(false);
        return;
      }

      // 步骤 3: 下载文件
      setProgress({ current: 0, total: toDownload.length });
      addLog("开始下载文件...");
      // #region debug-point E:download-start
      reportDebugEvent("E", "sync download started", {
        downloadCount: toDownload.length,
      });
      // #endregion

      const state = await invoke<SyncState>("sync_download", {
        connectionId,
        actions: toDownload,
        localDir,
        statePath: STATE_PATH,
      });

      setSyncState(state);
      // #region debug-point E:download-finished
      reportDebugEvent("E", "sync download finished", {
        syncedFileCount: state.synced_files.length,
        lastSyncTime: state.last_sync_time,
      });
      // #endregion
      addLog("同步完成！", "success");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // #region debug-point E:sync-failed
      reportDebugEvent("E", "sync failed", {
        errorMessage,
      });
      // #endregion
      setError(`同步失败: ${errorMessage}`);
      addLog(`同步失败: ${errorMessage}`, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return "从未";
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="sync-page">
      {/* 同步状态卡片 */}
      <div className="status-card">
        <div className="status-header">
          <div className="status-info">
            <span className="material-symbols-outlined status-icon">
              {connectionId ? "cloud_done" : "cloud_off"}
            </span>
            <div className="status-text">
              <span className="status-title">
                {connectionId ? "已连接" : "未连接"}
              </span>
              <span className="status-subtitle">
                {connectionId ? "NAS 服务器" : "请先配置 SMB 连接"}
              </span>
            </div>
          </div>

          <button
            className="sync-fab"
            onClick={handleStartSync}
            disabled={isSyncing || !connectionId}
          >
            <span className="material-symbols-outlined">
              {isSyncing ? "sync" : "sync"}
            </span>
          </button>
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
        <h3 className="section-title">同步信息</h3>
        <div className="stats-list">
          <div className="stat-row">
            <span className="material-symbols-outlined stat-icon">schedule</span>
            <span className="stat-label">上次同步</span>
            <span className="stat-value">
              {formatTime(syncState?.last_sync_time ?? null)}
            </span>
          </div>
          <div className="stat-row">
            <span className="material-symbols-outlined stat-icon">audio_file</span>
            <span className="stat-label">已同步文件</span>
            <span className="stat-value">
              {syncState?.synced_files?.length ?? 0} 个
            </span>
          </div>
        </div>
      </div>

      {/* 同步日志 */}
      <div className="log-section">
        <h3 className="section-title">同步日志</h3>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="log-empty">
              <span className="material-symbols-outlined">terminal</span>
              <span>暂无日志</span>
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
  );
}

export default SyncPage;
