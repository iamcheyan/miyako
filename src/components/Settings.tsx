import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ConnectResult, RemoteFile, SmbConfig, SyncAction, SyncState } from "../types/tauri-commands";
import { getStorageManager } from "../lib/storage";
import { DEFAULT_SMB_CONFIG, loadSmbConfig, saveSmbConfig } from "../lib/smbConfig";
import { ensureSmbConnection, getSmbSessionState, subscribeSmbSession, invalidateConnection } from "../lib/smbSession";
import { showStatusBar } from "../lib/androidStatusBar";
import "./Settings.css";

const STATE_PATH = "sync_state.json";

const LANGUAGES = [
  { code: "zh", name: "中文" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
];

interface SyncProgressPayload {
  current: number;
  total: number;
  message: string;
  remote_path: string | null;
}

function Settings() {
  const { t, i18n } = useTranslation();
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

  // Sync state
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [connectionState, setConnectionState] = useState(getSmbSessionState());
  const [syncError, setSyncError] = useState<string | null>(getSmbSessionState().error);

  // 显示状态栏
  useEffect(() => {
    showStatusBar();
  }, []);

  // 加载保存的配置
  useEffect(() => {
    setConfig(loadSmbConfig());
    loadSyncStats();
    loadSyncState();
    const unsubscribe = subscribeSmbSession((nextState) => {
      setConnectionState(nextState);
      setSyncError(nextState.error);
    });

    const smbConfig = loadSmbConfig();
    ensureSmbConnection(smbConfig).catch(() => {});

    return unsubscribe;
  }, []);

  // 监听同步进度
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

  const connectionId = connectionState.connectionId;

  const getLocalDir = (): string => {
    const smbConfig = loadSmbConfig();
    return smbConfig.localDir || "~/Music/NasSync";
  };

  const getRemotePath = (): string => {
    const smbConfig = loadSmbConfig();
    return smbConfig.remotePath || "";
  };

  const reconnectIfNeeded = async () => {
    if (connectionId) {
      return connectionId;
    }

    const smbConfig = loadSmbConfig();
    return ensureSmbConnection(smbConfig);
  };

  const handleStartSyncInternal = async (retryCount = 0) => {
    let activeConnectionId: string;
    try {
      activeConnectionId = await reconnectIfNeeded();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      setSyncError(`${t("sync.logs.connectFailed")} ${errorMessage}`);
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
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
      loadSyncStats();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      // 检测 SMB worker 崩溃错误，自动重连重试
      const isWorkerError = errorMessage.includes("Failed to send message to worker") ||
                           errorMessage.includes("Message processing failed");
      if (isWorkerError && retryCount < 2) {
        invalidateConnection();
        const smbConfig = loadSmbConfig();
        try {
          await ensureSmbConnection(smbConfig);
          setIsSyncing(false);
          handleStartSyncInternal(retryCount + 1);
          return;
        } catch {
          // 重连失败，显示错误
        }
      }
      setSyncError(`${t("sync.logs.syncFailed")} ${errorMessage}`);
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

  // 保存配置
  const saveConfig = (newConfig: SmbConfig) => {
    setConfig(newConfig);
    saveSmbConfig(newConfig);
  };

  // 处理输入变化
  const handleChange = (field: keyof SmbConfig, value: string) => {
    saveConfig({ ...config, [field]: value });
  };

  // 切换语言
  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  // 主题切换
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    return (localStorage.getItem("miyako_theme") as "light" | "dark" | "system") || "system";
  });

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    localStorage.setItem("miyako_theme", newTheme);
    if (newTheme === "light" || newTheme === "dark") {
      document.documentElement.setAttribute("data-theme", newTheme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
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
        message: t("settings.smb.testSuccess"),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTestResult({
        success: false,
        message: `${t("settings.smb.testError")}: ${errorMessage}`,
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
      alert(t("common.success"));
    } catch (e) {
      console.error("Failed to clear sync data:", e);
      alert(`${t("common.error")}: ${e instanceof Error ? e.message : String(e)}`);
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
      alert(t("common.success"));
    } catch (e) {
      console.error("Failed to clear history:", e);
      alert(`${t("common.error")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate("/");
  };

  return (
    <div className="settings-page">
      {/* 可滚动内容 */}
      <div className="settings-scroll">
        <header className="page-header">
          <button
            className="back-btn"
            type="button"
            onClick={handleBack}
            aria-label={t("common.back")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="page-title">{t("settings.title")}</h1>
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
          {syncError && (
            <div className="error-banner">
              <span className="material-symbols-outlined">error</span>
              <span>{syncError}</span>
            </div>
          )}
        </div>

        {/* 最近同步的歌曲 */}
        <div className="recent-sync-section">
          <h3 className="section-title">{t("sync.recentSync")}</h3>
          <div className="recent-sync-list">
            {syncState?.synced_files && syncState.synced_files.length > 0 ? (
              [...syncState.synced_files]
                .sort((a, b) => (b.last_modified || 0) - (a.last_modified || 0))
                .slice(0, 20)
                .map((file, index) => {
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

        {/* SMB 连接配置 */}
        <section className="settings-section">
          <h2 className="section-title">{t("settings.smb.title")}</h2>

          <div className="settings-list">
            <div className="setting-item">
              <label className="setting-label" htmlFor="server">{t("settings.smb.server")}</label>
              <input
                type="text"
                id="server"
                className="setting-input"
                placeholder={t("settings.smb.serverPlaceholder")}
                value={config.server}
                onChange={(e) => handleChange("server", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="share">{t("settings.smb.share")}</label>
              <input
                type="text"
                id="share"
                className="setting-input"
                placeholder={t("settings.smb.sharePlaceholder")}
                value={config.share}
                onChange={(e) => handleChange("share", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="remotePath">{t("settings.smb.remotePath")}</label>
              <input
                type="text"
                id="remotePath"
                className="setting-input"
                placeholder={t("settings.smb.remotePathPlaceholder")}
                value={config.remotePath}
                onChange={(e) => handleChange("remotePath", e.target.value)}
              />
              <span className="setting-hint">{t("settings.smb.remotePathPlaceholder")}</span>
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="username">{t("settings.smb.username")}</label>
              <input
                type="text"
                id="username"
                className="setting-input"
                placeholder={t("settings.smb.usernamePlaceholder")}
                value={config.username}
                onChange={(e) => handleChange("username", e.target.value)}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label" htmlFor="password">{t("settings.smb.password")}</label>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  className="setting-input"
                  placeholder={t("settings.smb.usernamePlaceholder")}
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
              <label className="setting-label" htmlFor="localDir">{t("settings.smb.localDir")}</label>
              <input
                type="text"
                id="localDir"
                className="setting-input"
                placeholder="~/Music/NasSync"
                value={config.localDir}
                onChange={(e) => handleChange("localDir", e.target.value)}
              />
              <span className="setting-hint">{t("settings.smb.localDir")}</span>
            </div>
          </div>

          <button
            className="test-btn"
            onClick={handleTestConnection}
            disabled={isTesting || !config.server || !config.share}
          >
            <span className="material-symbols-outlined">link</span>
            {isTesting ? t("settings.smb.testing") : t("settings.smb.testConnection")}
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
          <h2 className="section-title">{t("settings.stats.title")}</h2>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">folder</span>
              <div className="stat-info">
                <span className="stat-value">{syncStats.fileCount}</span>
                <span className="stat-label">{t("settings.stats.syncedFiles")}</span>
              </div>
            </div>

            <div className="stat-card">
              <span className="material-symbols-outlined stat-icon">database</span>
              <div className="stat-info">
                <span className="stat-value">{formatSize(syncStats.totalSize)}</span>
                <span className="stat-label">{t("settings.stats.totalSize")}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 数据管理 */}
        <section className="settings-section">
          <h2 className="section-title">{t("settings.dangerZone.title")}</h2>

          <div className="danger-list">
            <button
              className="danger-item"
              onClick={() => setShowConfirmDialog("sync")}
            >
              <span className="material-symbols-outlined danger-icon">delete_sweep</span>
              <div className="danger-info">
                <span className="danger-title">{t("settings.dangerZone.clearHistory")}</span>
                <span className="danger-desc">{t("settings.dangerZone.clearHistoryDesc")}</span>
              </div>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>

            <button
              className="danger-item"
              onClick={() => setShowConfirmDialog("history")}
            >
              <span className="material-symbols-outlined danger-icon">history</span>
              <div className="danger-info">
                <span className="danger-title">{t("settings.dangerZone.clearHistory")}</span>
                <span className="danger-desc">{t("settings.dangerZone.clearHistoryDesc")}</span>
              </div>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </section>

        {/* 主题设置 */}
        <section className="settings-section">
          <h2 className="section-title">{t("settings.theme.title")}</h2>

          <div className="language-options">
            {([
              { key: "light" as const, icon: "light_mode", label: t("settings.theme.light") },
              { key: "dark" as const, icon: "dark_mode", label: t("settings.theme.dark") },
              { key: "system" as const, icon: "contrast", label: t("settings.theme.system") },
            ]).map((opt) => (
              <button
                key={opt.key}
                className={`language-btn ${theme === opt.key ? "active" : ""}`}
                onClick={() => handleThemeChange(opt.key)}
              >
                <span className="language-name">
                  <span className="material-symbols-outlined" style={{ fontSize: 20, verticalAlign: "middle", marginRight: 8 }}>{opt.icon}</span>
                  {opt.label}
                </span>
                {theme === opt.key && (
                  <span className="material-symbols-outlined">check</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 语言设置 */}
        <section className="settings-section">
          <h2 className="section-title">{t("settings.language.title")}</h2>

          <div className="language-options">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                className={`language-btn ${i18n.language === lang.code ? "active" : ""}`}
                onClick={() => handleLanguageChange(lang.code)}
              >
                <span className="language-name">{lang.name}</span>
                {i18n.language === lang.code && (
                  <span className="material-symbols-outlined">check</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 底部间距 */}
        <div className="settings-bottom-spacer" />
      </div>

      {/* 确认对话框 */}
      {showConfirmDialog && (
        <div className="dialog-overlay" onClick={() => setShowConfirmDialog(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="dialog-title">{t("common.confirm")}</h3>
            <p className="dialog-text">
              {showConfirmDialog === "sync"
                ? t("settings.dangerZone.confirmClearHistory")
                : t("settings.dangerZone.confirmClearHistory")}
            </p>
            <div className="dialog-actions">
              <button
                className="dialog-btn cancel"
                onClick={() => setShowConfirmDialog(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="dialog-btn confirm"
                onClick={
                  showConfirmDialog === "sync"
                    ? handleClearSyncData
                    : handleClearHistory
                }
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
