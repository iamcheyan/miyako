import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectResult, SmbConfig } from "../types/tauri-commands";
import "./Settings.css";

const STORAGE_KEY = "smb-config";

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

  // Load saved config on mount
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
  }, []);

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
    </div>
  );
}

export default Settings;
