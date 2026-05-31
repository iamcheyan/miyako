import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import SyncPage from "./components/SyncPage";
import MusicLibrary from "./components/MusicLibrary";
import PlayerUI from "./components/PlayerUI";
import Toast, { useToast } from "./components/Toast";
import { getMediaSessionManager } from "./lib/mediaSession";
import "./App.css";

// Android 风格的顶部栏
function TopBar({ title, showBack = false }: { title: string; showBack?: boolean }) {
  const navigate = useNavigate();

  return (
    <header className="top-bar">
      {showBack ? (
        <button className="back-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
      ) : (
        <div className="top-bar-spacer" />
      )}
      <h1 className="top-bar-title">{title}</h1>
      <div className="top-bar-spacer" />
    </header>
  );
}

// 根据路径获取页面标题
function getPageTitle(pathname: string): string {
  switch (pathname) {
    case "/":
      return "音乐库";
    case "/sync":
      return "同步管理";
    case "/settings":
      return "设置";
    case "/remote":
      return "远程浏览";
    default:
      return "音乐播放器";
  }
}

// 判断是否是子页面（需要返回按钮）
function isSubPage(_pathname: string): boolean {
  // 目前所有页面都是一级页面，如果以后有子页面在这里添加
  return false;
}

// 页面内容区域
function PageContent() {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);
  const showBack = isSubPage(location.pathname);

  return (
    <div className="page-wrapper">
      <TopBar title={pageTitle} showBack={showBack} />
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

// 底部导航栏
function BottomNav() {
  const navItems = [
    { path: "/", icon: "music_note", label: "音乐库" },
    { path: "/sync", icon: "sync", label: "同步" },
    { path: "/settings", icon: "settings", label: "设置" },
  ];

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            `nav-item ${isActive ? "active" : ""}`
          }
        >
          <span className="material-symbols-outlined nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function App() {
  const { messages, removeToast } = useToast();

  useEffect(() => {
    const mediaSession = getMediaSessionManager();
    mediaSession.initialize();
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        <Toast messages={messages} onRemove={removeToast} />

        <PageContent />

        <PlayerUI />

        <BottomNav />
      </div>
    </BrowserRouter>
  );
}

export default App;
