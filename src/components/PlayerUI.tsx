import { useState, useEffect, useCallback } from "react";
import { getAudioPlayer, type PlayMode, type AudioPlayerState } from "../lib/audioPlayer";
import "./PlayerUI.css";

function PlayerUI() {
  const player = getAudioPlayer();
  const [state, setState] = useState<AudioPlayerState>(player.getState());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setState(player.getState());
  }, [player]);

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
  }, [player]);

  const handlePlayPause = useCallback(async () => {
    if (state.isPlaying) {
      player.pause();
    } else {
      if (!state.currentTrack && state.playlist.length > 0) {
        await player.playTrack(0);
      } else {
        await player.play();
      }
    }
  }, [state.isPlaying, state.currentTrack, state.playlist.length, player]);

  const handleNext = useCallback(async () => {
    await player.next();
  }, [player]);

  const handlePrevious = useCallback(async () => {
    await player.previous();
  }, [player]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    player.seekTo(time);
  }, [player]);

  const handleModeChange = useCallback(() => {
    const modes: PlayMode[] = ["sequential", "loop", "shuffle"];
    const currentIndex = modes.indexOf(state.playMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    player.setPlayMode(nextMode);
  }, [state.playMode, player]);

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

  const hasHistory = state.playlist.length > 0 && state.currentIndex >= 0;

  // 迷你播放器
  if (!isExpanded) {
    return (
      <div className="player-ui mini-only">
        <div className="mini-progress">
          <div
            className="mini-progress-fill"
            style={{
              width: `${state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0}%`,
            }}
          />
        </div>

        <div className="mini-bar">
          <div className="mini-info" onClick={() => setIsExpanded(true)}>
            <span className="mini-track-name">{currentTrackName}</span>
          </div>

          <div className="mini-controls">
            <button
              className="mini-btn"
              onClick={handlePrevious}
              disabled={!hasHistory}
            >
              <span className="material-symbols-outlined">skip_previous</span>
            </button>

            <button className="mini-btn play" onClick={handlePlayPause}>
              <span className="material-symbols-outlined">
                {state.isPlaying ? "pause" : "play_arrow"}
              </span>
            </button>

            <button
              className="mini-btn"
              onClick={handleNext}
              disabled={!hasHistory}
            >
              <span className="material-symbols-outlined">skip_next</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 展开的播放器
  return (
    <div className="player-ui expanded">
      <div className="expanded-container">
        {/* 顶部拖拽条 + 关闭按钮 */}
        <div className="expanded-header">
          <button className="close-btn" onClick={() => setIsExpanded(false)}>
            <span className="material-symbols-outlined">keyboard_arrow_down</span>
          </button>
        </div>

        {/* 封面区域 */}
        <div className="cover-area">
          <div className="cover-art">
            <span className="material-symbols-outlined">music_note</span>
          </div>
        </div>

        {/* 歌曲信息 */}
        <div className="track-section">
          <h2 className="track-title">{currentTrackName}</h2>
          {hasHistory && (
            <p className="track-status">
              {state.isPlaying ? "正在播放" : "已暂停"} · 上次听到 {formatTime(state.currentTime)}
            </p>
          )}
        </div>

        {/* 进度条 */}
        <div className="seek-section">
          <span className="seek-time">{formatTime(state.currentTime)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={state.duration || 0}
            value={state.currentTime}
            onChange={handleSeek}
          />
          <span className="seek-time">{formatTime(state.duration)}</span>
        </div>

        {/* 主控制 */}
        <div className="main-controls">
          <button className="ctrl-btn mode" onClick={handleModeChange}>
            <span className="material-symbols-outlined">{getModeIcon(state.playMode)}</span>
          </button>

          <button className="ctrl-btn" onClick={handlePrevious} disabled={!hasHistory}>
            <span className="material-symbols-outlined">skip_previous</span>
          </button>

          <button className="ctrl-btn play" onClick={handlePlayPause}>
            <span className="material-symbols-outlined">
              {state.isPlaying ? "pause" : "play_arrow"}
            </span>
          </button>

          <button className="ctrl-btn" onClick={handleNext} disabled={!hasHistory}>
            <span className="material-symbols-outlined">skip_next</span>
          </button>

          <button className="ctrl-btn mode" onClick={() => {}}>
            <span className="material-symbols-outlined">queue_music</span>
          </button>
        </div>

        {/* 音量控制 */}
        <div className="volume-section">
          <span className="material-symbols-outlined volume-icon">volume_down</span>
          <input
            type="range"
            className="volume-bar"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            onChange={(e) => player.setVolume(parseFloat(e.target.value))}
          />
          <span className="material-symbols-outlined volume-icon">volume_up</span>
        </div>

        {/* 播放列表 */}
        {state.playlist.length > 0 && (
          <div className="playlist-area">
            <h3 className="playlist-header">播放列表</h3>
            <div className="playlist-scroll">
              {state.playlist.map((track, index) => (
                <div
                  key={index}
                  className={`playlist-row ${index === state.currentIndex ? "active" : ""}`}
                  onClick={() => player.playTrack(index)}
                >
                  <span className="row-num">
                    {index === state.currentIndex && state.isPlaying ? (
                      <span className="material-symbols-outlined playing">equalizer</span>
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="row-name">{getFileName(track)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerUI;
