import { useEffect } from "react";
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
    <div className="app">
      <Settings />
      <SyncPage />
      <MusicLibrary />
      <RemoteBrowser />
      <PlayerUI />
    </div>
  );
}

export default App;
