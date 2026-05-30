import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import SyncPage from "./components/SyncPage";
import MusicLibrary from "./components/MusicLibrary";
import PlayerUI from "./components/PlayerUI";
import "./App.css";

function App() {
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
