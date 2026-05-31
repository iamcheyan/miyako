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

  useEffect(() => {
    const mediaSession = getMediaSessionManager();
    mediaSession.initialize();

    // Android Tauri runs edge-to-edge, and some WebViews report
    // safe-area-inset-bottom as 0 even with 3-button navigation.
    const detectAndroidNavHeight = () => {
      const root = document.documentElement;
      const app = document.querySelector<HTMLElement>(".app");
      const isAndroid = /Android/i.test(navigator.userAgent);
      const screenHeight = window.screen.height;
      const windowHeight = window.innerHeight;
      const diff = screenHeight - windowHeight;
      const navHeight = diff > 0 && diff < 200 ? diff : isAndroid ? 48 : 0;

      root.style.setProperty("--android-nav-height", `${navHeight}px`);
      app?.style.setProperty("--android-nav-height", `${navHeight}px`);
    };

    detectAndroidNavHeight();
    window.addEventListener("resize", detectAndroidNavHeight);

    return () => {
      window.removeEventListener("resize", detectAndroidNavHeight);
    };
  }, []);

  // 全局边缘右滑返回手势（模拟安卓/iOS系统侧滑返回）
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let isEdgeSwipe = false;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      // 判定为边缘滑动的阈值：距离屏幕最左侧边缘 24px 以内
      isEdgeSwipe = startX < 24;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isEdgeSwipe) return;
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - startX;
      const diffY = touch.clientY - startY;

      // 边缘滑动向右拖拽（从左向右滑动），距离大于 50px，且垂直偏移较小，触发返回
      if (diffX > 50 && Math.abs(diffY) < 40) {
        window.history.back();
      }
      isEdgeSwipe = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
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
