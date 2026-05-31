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
        return "repeat";
      case "loop":
        return "repeat_one";
      case "shuffle":
        return "shuffle";
    }
  };

  const currentTrackName = state.currentTrack
    ? getFileName(state.currentTrack)
    : "未选择歌曲";

  return (
    <div className={`player-ui ${isExpanded ? "expanded" : ""}`}>
      {/* 迷你播放器 - 底部停靠 */}
      <div className="mini-player">
        {/* 进度条 */}
        <div className="mini-progress">
          <div
            className="mini-progress-fill"
            style={{
              width: `${state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0}%`,
            }}
          />
        </div>

        <div className="mini-content" onClick={() => setIsExpanded(!isExpanded)}>
          <div className="mini-info">
            <span className="mini-track-name">{currentTrackName}</span>
            <span className="mini-time">
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
              aria-label="上一首"
            >
              <span className="material-symbols-outlined">skip_previous</span>
            </button>

            <button
              className="mini-btn play-btn"
              onClick={(e) => {
                e.stopPropagation();
                handlePlayPause();
              }}
              aria-label={state.isPlaying ? "暂停" : "播放"}
            >
              <span className="material-symbols-outlined">
                {state.isPlaying ? "pause" : "play_arrow"}
              </span>
            </button>

            <button
              className="mini-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              aria-label="下一首"
            >
              <span className="material-symbols-outlined">skip_next</span>
            </button>
          </div>
        </div>
      </div>

      {/* 展开的播放器 */}
      {isExpanded && (
        <div className="expanded-player" onClick={() => setIsExpanded(false)}>
          <div className="expanded-content" onClick={(e) => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <button className="close-btn" onClick={() => setIsExpanded(false)}>
              <span className="material-symbols-outlined">expand_more</span>
            </button>

            {/* 歌曲信息 */}
            <div className="track-info">
              <div className="track-icon">
                <span className="material-symbols-outlined">music_note</span>
              </div>
              <h3 className="track-name">{currentTrackName}</h3>
            </div>

            {/* 进度条 */}
            <div className="progress-section">
              <span className="time">{formatTime(state.currentTime)}</span>
              <input
                type="range"
                className="progress-slider"
                min={0}
                max={state.duration || 0}
                value={state.currentTime}
                onChange={handleSeek}
              />
              <span className="time">{formatTime(state.duration)}</span>
            </div>

            {/* 控制按钮 */}
            <div className="controls">
              <button className="control-btn" onClick={handleModeChange}>
                <span className="material-symbols-outlined">
                  {getModeIcon(state.playMode)}
                </span>
              </button>

              <button className="control-btn" onClick={handlePrevious}>
                <span className="material-symbols-outlined">skip_previous</span>
              </button>

              <button className="control-btn play-btn" onClick={handlePlayPause}>
                <span className="material-symbols-outlined">
                  {state.isPlaying ? "pause" : "play_arrow"}
                </span>
              </button>

              <button className="control-btn" onClick={handleNext}>
                <span className="material-symbols-outlined">skip_next</span>
              </button>

              <div className="volume-control">
                <span className="material-symbols-outlined">volume_up</span>
                <input
                  type="range"
                  className="volume-slider"
                  min={0}
                  max={1}
                  step={0.01}
                  value={state.volume}
                  onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlayerUI;
