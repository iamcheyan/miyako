import { useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import SyncPage from "./components/SyncPage";
import MusicLibrary from "./components/MusicLibrary";
import PlayerUI from "./components/PlayerUI";
import { getMediaSessionManager } from "./lib/mediaSession";
import "./App.css";

function App() {
  useEffect(() => {
    // Initialize MediaSession for lock screen/notification controls
    const mediaSession = getMediaSessionManager();
    mediaSession.initialize();
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        <div className="app-content">
          <Routes>
            <Route path="/" element={<MusicLibrary />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/remote" element={<RemoteBrowser />} />
          </Routes>
        </div>

        <PlayerUI />

        <nav className="bottom-nav">
          <NavLink
            to="/"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">🎵</span>
            <span className="nav-label">音乐库</span>
          </NavLink>
          <NavLink
            to="/sync"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">🔄</span>
            <span className="nav-label">同步</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">设置</span>
          </NavLink>
        </nav>
      </div>
    </BrowserRouter>
  );
}

export default App;
