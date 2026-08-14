import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import type { ConnectResult, SmbConfig, SyncState } from "../types/tauri-commands";
import { getStorageManager } from "../lib/storage";
import { DEFAULT_SMB_CONFIG, loadSmbConfig, saveSmbConfig } from "../lib/smbConfig";
import { ensureMediaRoot } from "../lib/mediaRoot";

const STATE_PATH = "sync_state.json";

function Settings() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SmbConfig>(DEFAULT_SMB_CONFIG);
  const [showPassword, setShowPassword] = useState(false);
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

  // 加载保存的配置
  useEffect(() => {
    setConfig(loadSmbConfig());
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

  // 保存配置（localDir 变化后需重新注册 media:// 根目录）
  const saveConfig = (newConfig: SmbConfig) => {
    setConfig(newConfig);
    saveSmbConfig(newConfig);
    void ensureMediaRoot(true);
  };

  // 处理输入变化
  const handleChange = (field: keyof SmbConfig, value: string) => {
    saveConfig({ ...config, [field]: value });
  };

  // 测试连接
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      await invoke<ConnectResult>("smb_connect", {
        server: config.server,
        share: config.share,
        username: config.username,
        password: config.password,
      });

      setTestResult({
        success: true,
        message: "连接成功！",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: `连接失败: ${errorMessage}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  // 清除同步数据
  const handleClearSyncData = async () => {
    try {
      const storage = getStorageManager();
      await storage.clearRecent();
      await storage.clearHistory();
      await storage.clearPlaybackState();

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

  // 清除播放历史
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
    <div className="settings-page">
      {/* 固定标题栏 */}
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="page-title">设置</h1>
      </div>

      {/* 可滚动内容 */}
      <div className="settings-scroll">
        {/* SMB 连接配置 */}
        <section className="settings-section">
          <h2 className="section-title">SMB 服务器</h2>

          <div className="settings-list">
            <div className="setting-item">
              <label className="setting-label" htmlFor="server">服务器地址</label>
              <input
                type="text"
                id="server"
                className="setting-input"
                placeholder="192.168.1.100"
                value={config.server}
                onChange={(e) => handleChange("server", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="share">共享目录</label>
              <input
                type="text"
                id="share"
                className="setting-input"
                placeholder="NAS"
                value={config.share}
                onChange={(e) => handleChange("share", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="remotePath">远程子目录</label>
              <input
                type="text"
                id="remotePath"
                className="setting-input"
                placeholder="Music"
                value={config.remotePath}
                onChange={(e) => handleChange("remotePath", e.target.value)}
              />
              <span className="setting-hint">例如共享为 NAS、音乐在 NAS/Music 时，这里填 Music</span>
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="username">用户名</label>
              <input
                type="text"
                id="username"
                className="setting-input"
                placeholder="留空表示匿名访问"
                value={config.username}
                onChange={(e) => handleChange("username", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="password">密码</label>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  className="setting-input"
                  placeholder="留空表示匿名访问"
                  value={config.password}
                  onChange={(e) => handleChange("password", e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="localDir">本地同步目录</label>
              <input
                type="text"
                id="localDir"
                className="setting-input"
                placeholder="~/Music/NasSync"
                value={config.localDir}
                onChange={(e) => handleChange("localDir", e.target.value)}
              />
              <span className="setting-hint">音乐文件将同步到此目录</span>
            </div>
          </div>

          <button
            className="test-btn"
            onClick={handleTestConnection}
            disabled={isTesting || !config.server || !config.share}
          >
            <span className="material-symbols-outlined">link</span>
            {isTesting ? "测试中..." : "测试连接"}
          </button>

          {testResult && (
            <div className={`test-result ${testResult.success ? "success" : "error"}`}>
              <span className="material-symbols-outlined">
                {testResult.success ? "check_circle" : "error"}
              </span>
              {testResult.message}
            </div>
          )}
        </section>

        {/* 同步统计 */}
        <section className="settings-section">
          <h2 className="section-title">同步数据</h2>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">folder</span>
              <div className="stat-info">
                <span className="stat-value">{syncStats.fileCount}</span>
                <span className="stat-label">已同步文件</span>
              </div>
            </div>

            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">database</span>
              <div className="stat-info">
                <span className="stat-value">{formatSize(syncStats.totalSize)}</span>
                <span className="stat-label">总大小</span>
              </div>
            </div>
          </div>
        </section>

        {/* 数据管理 */}
        <section className="settings-section">
          <h2 className="section-title">数据管理</h2>

          <div className="danger-list">
            <button
              className="danger-item"
              onClick={() => setShowConfirmDialog("sync")}
            >
              <span className="material-symbols-outlined danger-icon">delete_sweep</span>
              <div className="danger-info">
                <span className="danger-title">清除同步数据</span>
                <span className="danger-desc">删除同步状态和本地文件</span>
              </div>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>

            <button
              className="danger-item"
              onClick={() => setShowConfirmDialog("history")}
            >
              <span className="material-symbols-outlined danger-icon">history</span>
              <div className="danger-info">
                <span className="danger-title">清除播放历史</span>
                <span className="danger-desc">删除最近播放和播放记录</span>
              </div>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </section>

        {/* 底部间距 */}
        <div className="settings-bottom-spacer" />
      </div>

      {/* 确认对话框 */}
      {showConfirmDialog && (
        <div className="dialog-overlay" onClick={() => setShowConfirmDialog(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="dialog-title">确认操作</h3>
            <p className="dialog-text">
              {showConfirmDialog === "sync"
                ? "确定要清除所有同步数据吗？这将删除同步状态和本地音乐文件。"
                : "确定要清除播放历史吗？这将删除所有播放记录。"}
            </p>
            <div className="dialog-actions">
              <button
                className="dialog-btn cancel"
                onClick={() => setShowConfirmDialog(null)}
              >
                取消
              </button>
              <button
                className="dialog-btn confirm"
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
