import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ConnectResult, SmbConfig, SyncState } from "../types/tauri-commands";
import { getStorageManager } from "../lib/storage";
import { DEFAULT_SMB_CONFIG, loadSmbConfig, saveSmbConfig } from "../lib/smbConfig";
import "./Settings.css";

const STATE_PATH = "sync_state.json";

const LANGUAGES = [
  { code: "zh", name: "中文" },
  { code: "en", name: "English" },
  { code: "ja", name: "日本語" },
];

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

  return (
    <div className="settings-page">
      {/* 固定标题栏 */}
      <div className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="page-title">{t("settings.title")}</h1>
      </div>

      {/* 可滚动内容 */}
      <div className="settings-scroll">
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
