import { useState, useEffect, useCallback } from "react";
import { getAudioPlayer, type PlayMode, type AudioPlayerState } from "../lib/audioPlayer";
import "./PlayerUI.css";

interface PlayerUIProps {
  tracks?: string[];
  currentIndex?: number;
}

function PlayerUI({ tracks = [], currentIndex = 0 }: PlayerUIProps) {
  const player = getAudioPlayer();
  const [state, setState] = useState<AudioPlayerState>(player.getState());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (tracks.length > 0) {
      player.loadPlaylist(tracks, currentIndex);
    }
  }, [tracks, currentIndex]);

  useEffect(() => {
    const updateState = () => {
      setState(player.getState());
    };

    player.on("play", updateState);
    player.on("pause", updateState);
    player.on("stop", updateState);
    player.on("ended", updateState);
    player.on("timeupdate", updateState);
    player.on("loadedmetadata", updateState);

    return () => {
      player.off("play", updateState);
      player.off("pause", updateState);
      player.off("stop", updateState);
      player.off("ended", updateState);
      player.off("timeupdate", updateState);
      player.off("loadedmetadata", updateState);
    };
  }, []);

  const handlePlayPause = useCallback(async () => {
    if (state.isPlaying) {
      player.pause();
    } else {
      await player.play();
    }
  }, [state.isPlaying]);

  const handleStop = useCallback(() => {
    player.stop();
  }, []);

  const handleNext = useCallback(async () => {
    await player.next();
  }, []);

  const handlePrevious = useCallback(async () => {
    await player.previous();
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    player.seekTo(time);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    player.setVolume(volume);
  }, []);

  const handleModeChange = useCallback(() => {
    const modes: PlayMode[] = ["sequential", "loop", "shuffle"];
    const currentIndex = modes.indexOf(state.playMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    player.setPlayMode(nextMode);
  }, [state.playMode]);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getFileName = (path: string): string => {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1];
    const lastDot = fileName.lastIndexOf(".");
    return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  };

  const getModeIcon = (mode: PlayMode): string => {
    switch (mode) {
      case "sequential":
        return "↻";
      case "loop":
        return "🔁";
      case "shuffle":
        return "🔀";
    }
  };

  const currentTrackName = state.currentTrack
    ? getFileName(state.currentTrack)
    : "未选择歌曲";

  return (
    <div className={`player-ui ${isExpanded ? "expanded" : ""}`}>
      {/* Mini player */}
      <div className="mini-player" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="mini-player-info">
          <span className="mini-track-name">{currentTrackName}</span>
          <span className="mini-track-time">
            {formatTime(state.currentTime)} / {formatTime(state.duration)}
          </span>
        </div>
        <div className="mini-controls">
          <button
            className="mini-btn"
            onClick={(e) => {
              e.stopPropagation();
              handlePrevious();
            }}
          >
            ⏮
          </button>
          <button
            className="mini-btn play-btn"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayPause();
            }}
          >
            {state.isPlaying ? "⏸" : "▶"}
          </button>
          <button
            className="mini-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
          >
            ⏭
          </button>
        </div>
      </div>

      {/* Expanded player */}
      {isExpanded && (
        <div className="expanded-player">
          <div className="track-info">
            <h3 className="track-name">{currentTrackName}</h3>
            <p className="track-mode">
              {getModeIcon(state.playMode)}{" "}
              {state.playMode === "sequential"
                ? "顺序播放"
                : state.playMode === "loop"
                  ? "单曲循环"
                  : "随机播放"}
            </p>
          </div>

          <div className="progress-section">
            <span className="time">{formatTime(state.currentTime)}</span>
            <input
              type="range"
              className="progress-bar"
              min={0}
              max={state.duration || 0}
              value={state.currentTime}
              onChange={handleSeek}
            />
            <span className="time">{formatTime(state.duration)}</span>
          </div>

          <div className="controls">
            <button className="control-btn" onClick={handleModeChange}>
              {getModeIcon(state.playMode)}
            </button>
            <button className="control-btn" onClick={handlePrevious}>
              ⏮
            </button>
            <button className="control-btn play-btn" onClick={handlePlayPause}>
              {state.isPlaying ? "⏸" : "▶"}
            </button>
            <button className="control-btn" onClick={handleStop}>
              ⏹
            </button>
            <button className="control-btn" onClick={handleNext}>
              ⏭
            </button>
            <div className="volume-control">
              <span className="volume-icon">🔊</span>
              <input
                type="range"
                className="volume-bar"
                min={0}
                max={1}
                step={0.01}
                value={state.volume}
                onChange={handleVolumeChange}
              />
            </div>
          </div>

          {state.playlist.length > 0 && (
            <div className="playlist-section">
              <h4>播放列表</h4>
              <ul className="playlist">
                {state.playlist.map((track, index) => (
                  <li
                    key={index}
                    className={`playlist-item ${index === state.currentIndex ? "active" : ""}`}
                    onClick={() => player.playTrack(index)}
                  >
                    <span className="playlist-number">{index + 1}</span>
                    <span className="playlist-name">{getFileName(track)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PlayerUI;
