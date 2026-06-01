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

    // Keep system-bar spacing adaptive. Do not force a fixed Android
    // navigation height: gesture-navigation devices often need 0px.
    const detectAndroidNavHeight = () => {
      const root = document.documentElement;
      const app = document.querySelector<HTMLElement>(".app");
      const isAndroid = /Android/i.test(navigator.userAgent);
      const visualViewport = window.visualViewport;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const screenDiff = window.screen.height - window.innerHeight;
      const visualDiff =
        window.innerHeight - viewportHeight - (visualViewport?.offsetTop ?? 0);
      const navHeight = isAndroid
        ? Math.max(
            ...[screenDiff, visualDiff]
              .filter((value) => value > 0 && value < 160)
              .map((value) => Math.round(value))
          )
        : 0;
      const navHeightPx = Number.isFinite(navHeight) ? navHeight : 0;
      const topInset = isAndroid
        ? "0px"
        : "max(env(safe-area-inset-top, 0px), 36px)";

      root.style.setProperty("--system-top-inset", topInset);
      root.style.setProperty("--android-nav-height", `${navHeightPx}px`);
      app?.style.setProperty("--system-top-inset", topInset);
      app?.style.setProperty("--android-nav-height", `${navHeightPx}px`);
    };

    detectAndroidNavHeight();
    window.addEventListener("resize", detectAndroidNavHeight);
    window.visualViewport?.addEventListener("resize", detectAndroidNavHeight);
    window.visualViewport?.addEventListener("scroll", detectAndroidNavHeight);

    return () => {
      window.removeEventListener("resize", detectAndroidNavHeight);
      window.visualViewport?.removeEventListener("resize", detectAndroidNavHeight);
      window.visualViewport?.removeEventListener("scroll", detectAndroidNavHeight);
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
