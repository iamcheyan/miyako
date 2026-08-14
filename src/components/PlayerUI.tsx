import { memo, useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { getAudioPlayer, type PlayMode, type AudioPlayerState } from "../lib/audioPlayer";
import "./PlayerUI.css";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getFileName(path: string): string {
  const parts = path.split("/").pop() || path;
  const lastDot = parts.lastIndexOf(".");
  return lastDot > 0 ? parts.substring(0, lastDot) : parts;
}

/**
 * 进度条区块。timeupdate 高频更新只重渲染这里，
 * 不触发整个播放列表 reconciliation。
 */
const SeekSection = memo(function SeekSection({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (e: React.FormEvent<HTMLInputElement>) => void;
}) {
  const progressPercent =
    duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="seek-section">
      <span className="seek-time">{formatTime(currentTime)}</span>
      <input
        type="range"
        className="seek-bar"
        style={{ "--seek-progress": `${progressPercent}%` } as CSSProperties}
        min={0}
        max={duration || 0}
        value={currentTime}
        onInput={onSeek}
      />
      <span className="seek-time">{formatTime(duration)}</span>
    </div>
  );
});

/**
 * 播放列表区块。memo 后，timeupdate 引发的 PlayerUI 重渲染
 * 会因 props 不变而跳过整列表。
 */
const Playlist = memo(function Playlist({
  playlist,
  currentIndex,
  isPlaying,
  onSelectTrack,
}: {
  playlist: string[];
  currentIndex: number;
  isPlaying: boolean;
  onSelectTrack: (index: number) => void;
}) {
  if (playlist.length === 0) {
    return (
      <div className="playlist-empty">
        <span className="material-symbols-outlined">queue_music</span>
        <span>暂无播放列表</span>
      </div>
    );
  }

  return (
    <>
      {playlist.map((track, index) => (
        <div
          key={index}
          className={`playlist-row ${index === currentIndex ? "active" : ""}`}
          onClick={() => onSelectTrack(index)}
        >
          <span className="row-num">
            {index === currentIndex && isPlaying ? (
              <span className="material-symbols-outlined playing">equalizer</span>
            ) : (
              index + 1
            )}
          </span>
          <span className="row-name">{getFileName(track)}</span>
        </div>
      ))}
    </>
  );
});
function PlayerUI() {
  const player = getAudioPlayer();
  const [state, setState] = useState<AudioPlayerState>(player.getState());
  const [progress, setProgress] = useState({
    currentTime: player.getCurrentTime(),
    duration: player.getDuration(),
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const pushStateRef = useRef(false);

  useEffect(() => {
    setState(player.getState());
  }, [player]);

  // 展开播放器时拦截安卓返回键：先收起播放器，而不是退出页面
  useEffect(() => {
    if (!isExpanded) {
      pushStateRef.current = false;
      return;
    }

    // 压入一个假的历史记录，这样返回键会触发 popstate
    window.history.pushState({ playerExpanded: true }, "");
    pushStateRef.current = true;

    const handlePopState = (e: PopStateEvent) => {
      // 检查是否是我们压入的状态
      if (e.state?.playerExpanded) {
        // 收起播放器，阻止默认的返回导航
        setIsExpanded(false);
        pushStateRef.current = false;
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isExpanded]);

  // 播放进度（timeupdate 高频）与结构性状态（曲目/播放列表）分离，
  // 避免每秒多次触发整个播放列表 reconciliation
  useEffect(() => {
    const updateState = () => {
      setState(player.getState());
    };
    const updateProgress = () => {
      setProgress({
        currentTime: player.getCurrentTime(),
        duration: player.getDuration(),
      });
    };
    const updateMetadata = () => {
      updateState();
      updateProgress();
    };

    player.on("play", updateState);
    player.on("pause", updateState);
    player.on("stop", updateState);
    player.on("ended", updateState);
    player.on("loadedmetadata", updateMetadata);
    player.on("timeupdate", updateProgress);

    return () => {
      player.off("play", updateState);
      player.off("pause", updateState);
      player.off("stop", updateState);
      player.off("ended", updateState);
      player.off("loadedmetadata", updateMetadata);
      player.off("timeupdate", updateProgress);
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

  const handleSeek = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    const time = parseFloat((e.target as HTMLInputElement).value);
    player.seekTo(time);
  }, [player]);

  const handleModeChange = useCallback(() => {
    const modes: PlayMode[] = ["sequential", "loop", "shuffle"];
    const currentIndex = modes.indexOf(state.playMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    player.setPlayMode(nextMode);
  }, [state.playMode, player]);

  const handleSelectTrack = useCallback(
    (index: number) => {
      player.playTrack(index);
    },
    [player]
  );


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
              width: `${progress.duration > 0 ? (progress.currentTime / progress.duration) * 100 : 0}%`,
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
        {/* 顶部：歌曲名 + 状态 */}
        <div className="expanded-header">
          <div className={`signal-mark ${state.isPlaying ? 'playing' : 'paused'}`} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="track-section">
            <h2 className="track-title">{currentTrackName}</h2>
            {hasHistory && (
              <p className="track-status">
                {state.isPlaying ? "正在播放" : "已暂停"} · {formatTime(progress.currentTime)}
              </p>
            )}
          </div>
        </div>

        {/* 中间：播放列表，填满剩余空间，可滚动 */}
        <div className="expanded-playlist">
          <h3 className="playlist-header">播放列表</h3>
          <div className="playlist-scroll">
            <Playlist
              playlist={state.playlist}
              currentIndex={state.currentIndex}
              isPlaying={state.isPlaying}
              onSelectTrack={handleSelectTrack}
            />
          </div>
        </div>

        {/* 底部：进度条 + 控制，固定在屏幕底部 */}
        <div className="expanded-controls">
          {/* 进度条（独立 memo 组件：timeupdate 只重渲染这里） */}
          <SeekSection
            currentTime={progress.currentTime}
            duration={progress.duration}
            onSeek={handleSeek}
          />

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

            <div className="ctrl-spacer" aria-hidden="true" />
          </div>

        </div>
      </div>
    </div>
  );
}

export default PlayerUI;
