import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectResult, SmbConfig, SyncState } from "../types/tauri-commands";
import { getStorageManager } from "../lib/storage";
import "./Settings.css";

const STORAGE_KEY = "smb-config";
const STATE_PATH = "sync_state.json";

function Settings() {
  const [config, setConfig] = useState<SmbConfig>({
    server: "",
    share: "",
    username: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [, setConnectionId] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [syncStats, setSyncStats] = useState<{
    fileCount: number;
    totalSize: number;
  }>({ fileCount: 0, totalSize: 0 });
  const [showConfirmDialog, setShowConfirmDialog] = useState<string | null>(null);

  // Load saved config and sync stats on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig) as SmbConfig;
        setConfig(parsed);
      } catch (e) {
        console.error("Failed to parse saved config:", e);
      }
    }
    loadSyncStats();
  }, []);

  const loadSyncStats = async () => {
    try {
      const state = await invoke<SyncState>("sync_load_state", {
        statePath: STATE_PATH,
      });

      const fileCount = state.synced_files.length;
      const totalSize = state.synced_files.reduce((sum, file) => sum + file.size, 0);
      setSyncStats({ fileCount, totalSize });
    } catch (e) {
      console.error("Failed to load sync stats:", e);
    }
  };

  // Save config to localStorage
  const saveConfig = (newConfig: SmbConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
  };

  // Handle input changes
  const handleChange = (field: keyof SmbConfig, value: string) => {
    saveConfig({ ...config, [field]: value });
  };

  // Test connection
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await invoke<ConnectResult>("smb_connect", {
        server: config.server,
        share: config.share,
        username: config.username,
        password: config.password,
      });

      setConnectionId(result.connection_id);
      setTestResult({
        success: true,
        message: "连接成功！",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setConnectionId(null);
      setTestResult({
        success: false,
        message: `连接失败: ${errorMessage}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Clear sync data
  const handleClearSyncData = async () => {
    try {
      const storage = getStorageManager();
      await storage.clearRecent();
      await storage.clearHistory();
      await storage.clearPlaybackState();

      // Reset sync state by writing empty state
      await invoke("storage_write", {
        dir: "app_data",
        filename: "sync_state.json",
        content: JSON.stringify({ last_sync_time: null, synced_files: [] }),
      });

      setSyncStats({ fileCount: 0, totalSize: 0 });
      setShowConfirmDialog(null);
      alert("同步数据已清除");
    } catch (e) {
      console.error("Failed to clear sync data:", e);
      alert("清除失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // Clear playback history
  const handleClearHistory = async () => {
    try {
      const storage = getStorageManager();
      await storage.clearRecent();
      await storage.clearHistory();
      await storage.clearPlaybackState();
      setShowConfirmDialog(null);
      alert("播放历史已清除");
    } catch (e) {
      console.error("Failed to clear history:", e);
      alert("清除失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="settings-container">
      <h2>SMB 服务器配置</h2>

      <div className="settings-form">
        <div className="form-group">
          <label htmlFor="server">服务器地址</label>
          <input
            type="text"
            id="server"
            placeholder="例如: 192.168.1.100"
            value={config.server}
            onChange={(e) => handleChange("server", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="share">共享目录</label>
          <input
            type="text"
            id="share"
            placeholder="例如: music"
            value={config.share}
            onChange={(e) => handleChange("share", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="username">用户名</label>
          <input
            type="text"
            id="username"
            placeholder="SMB 用户名"
            value={config.username}
            onChange={(e) => handleChange("username", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">密码</label>
          <div className="password-input-container">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              placeholder="SMB 密码"
              value={config.password}
              onChange={(e) => handleChange("password", e.target.value)}
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "隐藏" : "显示"}
            </button>
          </div>
        </div>

        <button
          className="test-connection-btn"
          onClick={handleTestConnection}
          disabled={isTesting || !config.server || !config.share}
        >
          {isTesting ? "测试中..." : "测试连接"}
        </button>

        {testResult && (
          <div className={`test-result ${testResult.success ? "success" : "error"}`}>
            {testResult.message}
          </div>
        )}
      </div>

      <div className="sync-stats">
        <h3>同步数据</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">已同步文件数:</span>
            <span className="stat-value">{syncStats.fileCount}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">总大小:</span>
            <span className="stat-value">{formatSize(syncStats.totalSize)}</span>
          </div>
        </div>
      </div>

      <div className="danger-zone">
        <h3>数据管理</h3>
        <div className="danger-actions">
          <button
            className="danger-btn"
            onClick={() => setShowConfirmDialog("sync")}
          >
            清除同步数据
          </button>
          <button
            className="danger-btn"
            onClick={() => setShowConfirmDialog("history")}
          >
            清除播放历史
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="confirm-dialog-overlay">
          <div className="confirm-dialog">
            <h3>确认操作</h3>
            <p>
              {showConfirmDialog === "sync"
                ? "确定要清除所有同步数据吗？这将删除同步状态和播放记录。"
                : "确定要清除播放历史吗？这将删除最近播放和播放记录。"}
            </p>
            <div className="dialog-buttons">
              <button
                className="cancel-btn"
                onClick={() => setShowConfirmDialog(null)}
              >
                取消
              </button>
              <button
                className="confirm-btn"
                onClick={
                  showConfirmDialog === "sync"
                    ? handleClearSyncData
                    : handleClearHistory
                }
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
