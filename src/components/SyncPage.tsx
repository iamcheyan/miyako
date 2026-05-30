import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  RemoteFile,
  SyncAction,
  SyncState,
  SmbConfig,
} from "../types/tauri-commands";
import "./SyncPage.css";

const STORAGE_KEY = "smb-config";
const STATE_PATH = "sync_state.json";

interface SyncLog {
  time: string;
  message: string;
  type: "info" | "success" | "error";
}

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

  // Load saved config and connect on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig) as SmbConfig;
        connectToSmb(config);
      } catch (e) {
        console.error("Failed to parse saved config:", e);
      }
    }

    // Load sync state
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
      // Step 1: Scan remote directory
      addLog("开始扫描远程目录...");
      const remoteFiles = await invoke<RemoteFile[]>("sync_scan_remote", {
        connectionId,
        path: "",
      });
      addLog(`扫描完成，找到 ${remoteFiles.length} 个音乐文件`, "success");

      // Step 2: Compare with local
      addLog("对比本地文件...");
      const localDir = "/tmp/music_sync"; // TODO: Make this configurable
      const actions = await invoke<SyncAction[]>("sync_compare", {
        remoteFiles,
        localDir,
      });

      const toDownload = actions.filter((a) => a.action === "Download");
      const toSkip = actions.filter((a) => a.action === "Skip");
      addLog(`需要下载: ${toDownload.length} 个文件，跳过: ${toSkip.length} 个文件`);

      if (toDownload.length === 0) {
        addLog("所有文件已是最新，无需同步", "success");
        setIsSyncing(false);
        return;
      }

      // Step 3: Download files
      setProgress({ current: 0, total: toDownload.length });
      addLog("开始下载文件...");

      const state = await invoke<SyncState>("sync_download", {
        connectionId,
        actions: toDownload,
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
    if (!timestamp) return "从未";
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="sync-page">
      <div className="sync-header">
        <h2>同步管理</h2>
        <button
          className="sync-btn"
          onClick={handleStartSync}
          disabled={isSyncing || !connectionId}
        >
          {isSyncing ? "同步中..." : "开始同步"}
        </button>
      </div>

      {!connectionId && (
        <div className="sync-warning">
          请先在设置页面配置 SMB 连接
        </div>
      )}

      {error && <div className="sync-error">{error}</div>}

      <div className="sync-status">
        <div className="status-item">
          <span className="status-label">上次同步时间:</span>
          <span className="status-value">
            {formatTime(syncState?.last_sync_time ?? null)}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">已同步文件数:</span>
          <span className="status-value">
            {syncState?.synced_files?.length ?? 0}
          </span>
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
          <div className="progress-text">
            {progress.current} / {progress.total}
          </div>
        </div>
      )}

      <div className="sync-log">
        <h3>同步日志</h3>
        <div className="log-content">
          {logs.length === 0 && (
            <div className="log-empty">暂无日志</div>
          )}
          {logs.map((log, index) => (
            <div key={index} className={`log-entry log-${log.type}`}>
              <span className="log-time">{log.time}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SyncPage;
