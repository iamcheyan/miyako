import Settings from "./components/Settings";
import RemoteBrowser from "./components/RemoteBrowser";
import SyncPage from "./components/SyncPage";
import "./App.css";

function App() {
  return (
    <div className="app">
      <Settings />
      <SyncPage />
      <RemoteBrowser />
    </div>
  );
}

export default App;
