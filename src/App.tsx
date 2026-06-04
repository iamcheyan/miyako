import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom";
import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import MusicLibrary from "./components/MusicLibrary";
import RadioPage from "./components/RadioPage";
import PlayerUI from "./components/PlayerUI";
import Toast from "./components/Toast";
import { useToast } from "./lib/useToast";
import { getMediaSessionManager } from "./lib/mediaSession";
import { initBackgroundSync } from "./lib/backgroundSync";
import { APP_TOAST_EVENT, type AppToastDetail } from "./lib/toastBus";
import "./App.css";
import "./components/shared.css";

// 页面内容区域
function PageContent() {
  return (
    <div className="page-wrapper">
      <main className="page-content">
        <Routes>
          <Route path="/" element={<MusicLibrary />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/remote" element={<RemoteBrowser />} />
          <Route path="/radio" element={<RadioPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const { messages, addToast, removeToast } = useToast();

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
    const onAppToast = (event: Event) => {
      const detail = (event as CustomEvent<AppToastDetail>).detail;
      if (detail?.message) {
        addToast(detail.message, detail.type ?? "info", detail.duration);
      }
    };
    window.addEventListener(APP_TOAST_EVENT, onAppToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, onAppToast);
  }, [addToast]);

  useEffect(() => {
    const mediaSession = getMediaSessionManager();
    mediaSession.initialize();
    initBackgroundSync();

    const applySystemInsets = () => {
      if (window.StatusBarAndroid?.getTopInset) {
        return;
      }
      const root = document.documentElement;
      const app = document.querySelector<HTMLElement>(".app");
      const isAndroid = /Android/i.test(navigator.userAgent);
      const androidTopInset = window.StatusBarAndroid?.getTopInset?.();
      const androidBottomInset = window.StatusBarAndroid?.getBottomInset?.();
      const androidNavHeight = window.StatusBarAndroid?.getAndroidNavHeight?.();
      const topInset = isAndroid
        ? `${androidTopInset && androidTopInset > 0 ? androidTopInset : 24}px`
        : "max(env(safe-area-inset-top, 0px), 36px)";
      const bottomInset = isAndroid
        ? `${androidBottomInset && androidBottomInset > 0 ? androidBottomInset : 0}px`
        : "env(safe-area-inset-bottom, 0px)";
      const navHeight = isAndroid
        ? `${androidNavHeight && androidNavHeight > 0 ? androidNavHeight : 0}px`
        : "0px";

      if (isAndroid) {
        root.style.setProperty("--android-native-insets", "1");
        app?.style.setProperty("--android-native-insets", "1");
      }
      root.style.setProperty("--system-top-inset", topInset);
      root.style.setProperty("--system-bottom-inset", bottomInset);
      root.style.setProperty("--android-nav-height", navHeight);
      app?.style.setProperty("--system-top-inset", topInset);
      app?.style.setProperty("--system-bottom-inset", bottomInset);
      app?.style.setProperty("--android-nav-height", navHeight);
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
