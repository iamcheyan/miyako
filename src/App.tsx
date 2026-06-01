import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";
import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import SyncPage from "./components/SyncPage";
import MusicLibrary from "./components/MusicLibrary";
import PlayerUI from "./components/PlayerUI";
import Toast, { useToast } from "./components/Toast";
import { getMediaSessionManager } from "./lib/mediaSession";
import { initBackgroundSync } from "./lib/backgroundSync";
import "./App.css";
import "./components/shared.css";

// 页面内容区域
function PageContent() {
  return (
    <div className="page-wrapper">
      <main className="page-content">
        <Routes>
          <Route path="/" element={<MusicLibrary />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/remote" element={<RemoteBrowser />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const { messages, removeToast } = useToast();

  // 主题初始化
  useEffect(() => {
    const saved = localStorage.getItem("miyako_theme") as "light" | "dark" | "system" | null;
    const theme = saved || "system";
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, []);

  useEffect(() => {
    const mediaSession = getMediaSessionManager();
    mediaSession.initialize();
    initBackgroundSync();

    const applySystemInsets = () => {
      const root = document.documentElement;
      const app = document.querySelector<HTMLElement>(".app");
      const isAndroid = /Android/i.test(navigator.userAgent);
      const androidTopInset = window.StatusBarAndroid?.getTopInset?.();
      const androidBottomInset = window.StatusBarAndroid?.getBottomInset?.();
      const topInset = isAndroid
        ? `${androidTopInset && androidTopInset > 0 ? androidTopInset : 24}px`
        : "max(env(safe-area-inset-top, 0px), 36px)";
      const bottomInset = isAndroid
        ? `${androidBottomInset && androidBottomInset > 0 ? androidBottomInset : 0}px`
        : "env(safe-area-inset-bottom, 0px)";

      if (isAndroid) {
        root.style.setProperty("--android-native-insets", "1");
        app?.style.setProperty("--android-native-insets", "1");
      }
      root.style.setProperty("--system-top-inset", topInset);
      root.style.setProperty("--system-bottom-inset", bottomInset);
      root.style.setProperty("--android-nav-height", "0px");
      app?.style.setProperty("--system-top-inset", topInset);
      app?.style.setProperty("--system-bottom-inset", bottomInset);
      app?.style.setProperty("--android-nav-height", "0px");
    };

    applySystemInsets();
    window.addEventListener("resize", applySystemInsets);

    return () => {
      window.removeEventListener("resize", applySystemInsets);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        <Toast messages={messages} onRemove={removeToast} />

        <PageContent />

        <PlayerUI />
      </div>
    </BrowserRouter>
  );
}

export default App;
