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
