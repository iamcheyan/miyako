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

  // 全局拟物化跟随手指手势侧滑返回（卡片式拖拽移出）
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let isEdgeSwipe = false;
    let currentDragOffset = 0;

    const handleTouchStart = (e: TouchEvent) => {
      // 首页不允许侧滑返回
      if (window.location.pathname === "/") {
        isEdgeSwipe = false;
        return;
      }

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      // 判定为边缘滑动的阈值：距离屏幕最左侧边缘 24px 以内
      isEdgeSwipe = startX < 24;
      currentDragOffset = 0;

      if (isEdgeSwipe) {
        const pageWrapper = document.querySelector<HTMLElement>(".page-wrapper");
        if (pageWrapper) {
          pageWrapper.style.transition = "none";
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEdgeSwipe) return;
      const touch = e.touches[0];
      const diffX = touch.clientX - startX;
      const diffY = touch.clientY - startY;

      // 必须是向右滑动，且横向为主导
      if (diffX > 0 && Math.abs(diffX) > Math.abs(diffY)) {
        currentDragOffset = diffX;
        const maxDrag = window.innerWidth;
        const dragAmount = Math.min(maxDrag, currentDragOffset);

        const pageWrapper = document.querySelector<HTMLElement>(".page-wrapper");
        if (pageWrapper) {
          // 页面容器实时跟随手指滑动移出
          pageWrapper.style.transform = `translateX(${dragAmount}px)`;
          pageWrapper.style.boxShadow = `-8px 0 24px rgba(0, 0, 0, 0.15)`;
        }
      }
    };

    const handleTouchEnd = () => {
      if (!isEdgeSwipe) return;
      isEdgeSwipe = false;

      const pageWrapper = document.querySelector<HTMLElement>(".page-wrapper");
      if (!pageWrapper) return;

      const threshold = window.innerWidth * 0.35; // 35% 宽度作为回弹/返回分水岭
      pageWrapper.style.transition = "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease";

      if (currentDragOffset > threshold) {
        // 1. 成功返回：将页面完全滑出屏幕右侧
        pageWrapper.style.transform = "translateX(100%)";
        pageWrapper.style.boxShadow = "none";

        setTimeout(() => {
          window.history.back();
          // 返回路由变更后，静默将容器复原，为新页面入场做好准备
          const wrapper = document.querySelector<HTMLElement>(".page-wrapper");
          if (wrapper) {
            wrapper.style.transition = "none";
            wrapper.style.transform = "translateX(0)";
            wrapper.style.boxShadow = "none";
          }
        }, 300);
      } else {
        // 2. 撤销返回：Q弹回弹原位
        pageWrapper.style.transform = "translateX(0)";
        setTimeout(() => {
          const wrapper = document.querySelector<HTMLElement>(".page-wrapper");
          if (wrapper) {
            wrapper.style.boxShadow = "none";
          }
        }, 300);
      }
    };

    // 在 document 级别监听，确保手势全局平滑无卡顿
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        {/* 拟物化背景底牌 (Skeuomorphic underlay card) */}
        <div className="app-swipe-underlay">
          <div className="underlay-brand">
            <span className="material-symbols-outlined brand-icon">library_music</span>
            <span className="brand-text">Miyako Music</span>
          </div>
        </div>

        <Toast messages={messages} onRemove={removeToast} />

        <PageContent />

        <PlayerUI />
      </div>
    </BrowserRouter>
  );
}

export default App;
