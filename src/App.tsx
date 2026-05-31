import { useEffect, useState } from "react";
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

// 路由页面的快照生命周期容器，在页面即将卸载的一瞬间捕获 DOM 作为滑动返回底图
function SwipeablePage({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return () => {
      const pageContent = document.querySelector(".page-content");
      if (pageContent) {
        const scrollEl = pageContent.querySelector(".library-scroll, .settings-scroll, .sync-scroll, .remote-scroll");
        const scrollTop = scrollEl ? scrollEl.scrollTop : 0;

        window.dispatchEvent(new CustomEvent("update_underlay", {
          detail: {
            html: pageContent.innerHTML,
            scrollTop: scrollTop
          }
        }));
      }
    };
  }, []);

  return <>{children}</>;
}

// 页面内容区域
function PageContent() {
  return (
    <div className="page-wrapper">
      <main className="page-content">
        <Routes>
          <Route path="/" element={<SwipeablePage><MusicLibrary /></SwipeablePage>} />
          <Route path="/sync" element={<SwipeablePage><SyncPage /></SwipeablePage>} />
          <Route path="/settings" element={<SwipeablePage><Settings /></SwipeablePage>} />
          <Route path="/remote" element={<SwipeablePage><RemoteBrowser /></SwipeablePage>} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const { messages, removeToast } = useToast();
  const [underlayHtml, setUnderlayHtml] = useState("");
  const [underlayScrollTop, setUnderlayScrollTop] = useState(0);

  useEffect(() => {
    const handleUpdateUnderlay = (e: any) => {
      setUnderlayHtml(e.detail.html);
      setUnderlayScrollTop(e.detail.scrollTop);
    };
    window.addEventListener("update_underlay" as any, handleUpdateUnderlay);
    return () => {
      window.removeEventListener("update_underlay" as any, handleUpdateUnderlay);
    };
  }, []);

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
        const underlayPage = document.querySelector<HTMLElement>(".underlay-page-content");
        const underlayMask = document.querySelector<HTMLElement>(".underlay-dim-mask");
        
        if (pageWrapper) {
          pageWrapper.style.transition = "none";
        }
        if (underlayPage) {
          underlayPage.style.transition = "none";
        }
        if (underlayMask) {
          underlayMask.style.transition = "none";
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
        const underlayPage = document.querySelector<HTMLElement>(".underlay-page-content");
        const underlayMask = document.querySelector<HTMLElement>(".underlay-dim-mask");

        if (pageWrapper) {
          // 页面容器实时跟随手指滑动移出
          pageWrapper.style.transform = `translateX(${dragAmount}px)`;
          pageWrapper.style.boxShadow = `-8px 0 24px rgba(0, 0, 0, 0.2)`;
        }

        // 实时视差与面罩淡出：完美拟合 Android Predictive Back 物理引擎
        const progress = dragAmount / window.innerWidth; // 0 到 1
        if (underlayPage) {
          // 底牌随着拖拽进度，从 0.97 缓缓放大到 1.0 满尺寸，实现极其真实的立体层级浮出！
          const scale = 0.97 + (0.03 * progress);
          const brightness = 0.7 + (0.3 * progress);
          underlayPage.style.transform = `scale(${scale})`;
          underlayPage.style.filter = `brightness(${brightness}) blur(${0.5 * (1 - progress)}px)`;
        }
        if (underlayMask) {
          // 暗色面罩随着拖拽进度缓缓淡出（由 100% 降为 0%），露出下方清晰的底图
          underlayMask.style.opacity = `${1 - progress}`;
        }
      }
    };

    const handleTouchEnd = () => {
      if (!isEdgeSwipe) return;
      isEdgeSwipe = false;

      const pageWrapper = document.querySelector<HTMLElement>(".page-wrapper");
      const underlayPage = document.querySelector<HTMLElement>(".underlay-page-content");
      const underlayMask = document.querySelector<HTMLElement>(".underlay-dim-mask");
      if (!pageWrapper) return;

      const threshold = window.innerWidth * 0.35; // 35% 宽度作为回弹/返回分水岭
      
      pageWrapper.style.transition = "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease";
      if (underlayPage) {
        underlayPage.style.transition = "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease";
      }
      if (underlayMask) {
        underlayMask.style.transition = "opacity 0.3s ease";
      }

      if (currentDragOffset > threshold) {
        // 1. 成功返回：将页面完全滑出屏幕右侧，同时底页放大至 1.0，暗色遮罩全透明
        pageWrapper.style.transform = "translateX(100%)";
        pageWrapper.style.boxShadow = "none";
        
        if (underlayPage) {
          underlayPage.style.transform = "scale(1)";
          underlayPage.style.filter = "brightness(1) blur(0px)";
        }
        if (underlayMask) {
          underlayMask.style.opacity = "0";
        }

        setTimeout(() => {
          window.history.back();
          // 返回路由变更后，静默将容器复原，为新页面入场做好准备
          const wrapper = document.querySelector<HTMLElement>(".page-wrapper");
          const uPage = document.querySelector<HTMLElement>(".underlay-page-content");
          const uMask = document.querySelector<HTMLElement>(".underlay-dim-mask");
          if (wrapper) {
            wrapper.style.transition = "none";
            wrapper.style.transform = "translateX(0)";
            wrapper.style.boxShadow = "none";
          }
          if (uPage) {
            uPage.style.transition = "none";
            uPage.style.transform = "scale(0.97)";
            uPage.style.filter = "brightness(0.7) blur(0.5px)";
          }
          if (uMask) {
            uMask.style.transition = "none";
            uMask.style.opacity = "1";
          }
        }, 300);
      } else {
        // 2. 撤销返回：Q弹回弹原位，底牌回归 0.97 视差，遮罩恢复
        pageWrapper.style.transform = "translateX(0)";
        if (underlayPage) {
          underlayPage.style.transform = "scale(0.97)";
          underlayPage.style.filter = "brightness(0.7) blur(0.5px)";
        }
        if (underlayMask) {
          underlayMask.style.opacity = "1";
        }
        
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
        {/* 拟物化背景底牌 (完美还原上一个页面的 DOM 与滚动快照，实现原生级层级透出) */}
        <div className="app-swipe-underlay">
          {underlayHtml ? (
            <div 
              className="page-content underlay-page-content" 
              dangerouslySetInnerHTML={{ __html: underlayHtml }}
              ref={(el) => {
                if (el && underlayScrollTop !== undefined) {
                  const scrollEl = el.querySelector(".library-scroll, .settings-scroll, .sync-scroll, .remote-scroll");
                  if (scrollEl) {
                    scrollEl.scrollTop = underlayScrollTop;
                  }
                }
              }}
            />
          ) : (
            <div className="underlay-brand">
              <span className="material-symbols-outlined brand-icon">library_music</span>
              <span className="brand-text">Miyako Music</span>
            </div>
          )}
          <div className="underlay-dim-mask" />
        </div>

        <Toast messages={messages} onRemove={removeToast} />

        <PageContent />

        <PlayerUI />
      </div>
    </BrowserRouter>
  );
}

export default App;
