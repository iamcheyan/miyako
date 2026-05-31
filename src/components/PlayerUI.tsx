import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { getAudioPlayer, type PlayMode, type AudioPlayerState } from "../lib/audioPlayer";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import "./PlayerUI.css";

function PlayerUI() {
  const { t } = useTranslation();
  const player = getAudioPlayer();
  const [state, setState] = useState<AudioPlayerState>(player.getState());
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const pushStateRef = useRef(false);
  const trackTitleRef = useRef<HTMLHeadingElement>(null);
  const dragStartRef = useRef<{ y: number; time: number } | null>(null);
  const defaultScrollRef = useRef<HTMLDivElement>(null);
  const favoritesScrollRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const [playlistTab, setPlaylistTab] = useState<'default' | 'favorites'>('default');
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const handlePlaylistTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handlePlaylistTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swipeStartRef.current) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - swipeStartRef.current.x;
    const diffY = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;

    // 水平滑动大于 50px，且垂直偏移小于 40px，判定为横滑
    if (Math.abs(diffX) > 50 && Math.abs(diffY) < 40) {
      if (diffX < 0) {
        setPlaylistTab('favorites');
      } else {
        setPlaylistTab('default');
      }
    }
  }, []);

  useEffect(() => {
    setState(player.getState());
  }, [player]);

  // 更新收藏状态
  useEffect(() => {
    if (state.currentTrack) {
      setIsFavorited(isFavorite(state.currentTrack));
    }
  }, [state.currentTrack]);

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

  // 当 currentIndex 改变或从暂停切换到播放时，自动将当前歌曲滚动到播放列表居中位置
  const prevIndexRef = useRef(state.currentIndex);
  const prevIsPlayingRef = useRef(state.isPlaying);
  useEffect(() => {
    const wasPaused = !prevIsPlayingRef.current;
    const isNowPlaying = state.isPlaying;
    const justResumed = wasPaused && isNowPlaying;
    
    // 计算歌曲切换的索引跨度
    const indexDiff = Math.abs(state.currentIndex - prevIndexRef.current);
    
    // 更新 refs
    prevIsPlayingRef.current = state.isPlaying;
    prevIndexRef.current = state.currentIndex;
    
    const activeScrollRef = playlistTab === "default" ? defaultScrollRef : favoritesScrollRef;
    // 仅在展开状态下执行滚动
    if (isExpanded && activeRowRef.current && activeScrollRef.current) {
      const container = activeScrollRef.current;
      const element = activeRowRef.current;
      
      // 1. 获取元素相对于滚动容器的精确相对 Top 位置，避免 offsetParent 导致的高度错乱
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const elementTopRelative = elementRect.top - containerRect.top + container.scrollTop;
      
      const containerHeight = container.clientHeight;
      const elementHeight = element.clientHeight;
      
      // 2. 计算居中滚动位置
      let scrollTo = elementTopRelative - containerHeight / 2 + elementHeight / 2;
      
      // 3. 边界避让与安全限制：防止滚出可见视口
      const maxScrollTop = Math.max(0, container.scrollHeight - containerHeight);
      scrollTo = Math.max(0, Math.min(maxScrollTop, scrollTo));
      
      // 4. 智能滚动模式决策：
      // 如果跨度较大（比如超过8个切歌位置），Android WebView 在平滑滚动时会因为渲染饱和而发生白屏或短暂消失现象。
      // 此时直接“瞬移（instant）”过去，用户体验最为流畅，完全不会有任何视觉卡顿。
      const scrollBehavior = (justResumed || indexDiff > 8) ? "instant" : "smooth";
      
      container.scrollTo({
        top: scrollTo,
        behavior: scrollBehavior as ScrollBehavior
      });
    }
  }, [state.currentIndex, state.isPlaying, isExpanded]);

  // 处理关闭播放器
  const handleClosePlayer = useCallback(() => {
    setIsExpanded(false);
    setDragOffset(0);
    setIsDragging(false);
  }, []);

  // 拖拽手势处理
  const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { y: clientY, time: Date.now() };
    setIsDragging(true);
  }, []);

  const handleDragMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!dragStartRef.current) return;
    
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const offset = clientY - dragStartRef.current.y;
    
    // 只允许向下拖拽
    if (offset > 0) {
      setDragOffset(offset);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    
    const elapsed = Date.now() - dragStartRef.current.time;
    const velocity = dragOffset / (elapsed || 1);
    
    // 如果拖拽超过 100px 或者速度够快，关闭播放器
    if (dragOffset > 100 || velocity > 0.5) {
      handleClosePlayer();
    } else {
      // 否则回弹
      setDragOffset(0);
    }
    
    dragStartRef.current = null;
    setIsDragging(false);
  }, [dragOffset, handleClosePlayer]);

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

  // 检测标题是否溢出（标题宽度超过容器宽度时自动滚动）
  useEffect(() => {
    if (trackTitleRef.current) {
      const title = trackTitleRef.current;
      const section = title.parentElement;
      if (section) {
        setTitleOverflow(title.scrollWidth > section.clientWidth);
      }
    }
  }, [state.currentTrack]);

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

  const handleToggleFavorite = useCallback(() => {
    if (state.currentTrack) {
      const newState = toggleFavorite(state.currentTrack);
      setIsFavorited(newState);
    }
  }, [state.currentTrack]);

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

  const favoritedItems = state.playlist
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(item => isFavorite(item.track));

  const currentTrackName = state.currentTrack
    ? getFileName(state.currentTrack)
    : "未选择歌曲";

  const hasHistory = state.playlist.length > 0 && state.currentIndex >= 0;
  const progress = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;

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
  const containerStyle: CSSProperties = isDragging
    ? { transform: `translateY(${dragOffset}px)`, transition: 'none' }
    : {};

  return (
    <div className={`player-ui expanded ${isDragging ? 'dragging' : ''}`}>
      <div className="expanded-container" style={containerStyle}>
        {/* 顶部：信号 + 歌曲名 + 关闭按钮 */}
        <div
          className="expanded-header"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
          onMouseDown={handleDragStart}
          onMouseMove={isDragging ? handleDragMove : undefined}
          onMouseUp={handleDragEnd}
          onMouseLeave={isDragging ? handleDragEnd : undefined}
        >
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
            <h2 ref={trackTitleRef} className={`track-title ${titleOverflow ? 'scrolling' : ''}`}>{currentTrackName}</h2>
          </div>
          <button className="expanded-close-btn" onClick={handleClosePlayer}>
            <span className="material-symbols-outlined">expand_more</span>
          </button>
        </div>

        {/* 中间：播放列表，填满剩余空间，可滚动，支持左右滑动手势切换默认/收藏 */}
        <div
          className="expanded-playlist"
          onTouchStart={handlePlaylistTouchStart}
          onTouchEnd={handlePlaylistTouchEnd}
        >
          <h3 className="playlist-header">
            <div className="playlist-tabs">
              <span
                className={`playlist-tab ${playlistTab === 'default' ? 'active' : ''}`}
                onClick={() => setPlaylistTab('default')}
              >
                {t("player.playlist")}
              </span>
              <span className="playlist-tab-separator">|</span>
              <span
                className={`playlist-tab ${playlistTab === 'favorites' ? 'active' : ''}`}
                style={{ color: playlistTab === 'favorites' ? '#ff2d55' : undefined }}
                onClick={() => setPlaylistTab('favorites')}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>favorite</span>
                {t("musicLibrary.quickActions.favorites")}
              </span>
            </div>
          </h3>
          
          <div className="playlist-slider-wrapper">
            <div
              className="playlist-slider-content"
              style={{ transform: `translateX(${playlistTab === 'default' ? '0%' : '-50%'})` }}
            >
              {/* 页面 1：默认全部歌曲 */}
              <div className="playlist-slider-page">
                <div className="playlist-scroll" ref={defaultScrollRef}>
                  {state.playlist.length === 0 ? (
                    <div className="playlist-empty">
                      <span className="material-symbols-outlined">queue_music</span>
                      <span>{t("player.emptyPlaylist")}</span>
                    </div>
                  ) : (
                    state.playlist.map((track, index) => (
                      <div
                        key={index}
                        ref={playlistTab === 'default' && index === state.currentIndex ? activeRowRef : undefined}
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
                    ))
                  )}
                </div>
              </div>

              {/* 页面 2：红心收藏歌曲 */}
              <div className="playlist-slider-page">
                <div className="playlist-scroll" ref={favoritesScrollRef}>
                  {favoritedItems.length === 0 ? (
                    <div className="playlist-empty">
                      <span className="material-symbols-outlined">favorite</span>
                      <span>{t("musicLibrary.searchNoResults")}</span>
                    </div>
                  ) : (
                    favoritedItems.map((item) => (
                      <div
                        key={item.originalIndex}
                        ref={playlistTab === 'favorites' && item.originalIndex === state.currentIndex ? activeRowRef : undefined}
                        className={`playlist-row ${item.originalIndex === state.currentIndex ? "active" : ""}`}
                        onClick={() => player.playTrack(item.originalIndex)}
                      >
                        <span className="row-num">
                          {item.originalIndex === state.currentIndex && state.isPlaying ? (
                            <span className="material-symbols-outlined playing">equalizer</span>
                          ) : (
                            item.originalIndex + 1
                          )}
                        </span>
                        <span className="row-name">{getFileName(item.track)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部：进度条 + 控制，固定在屏幕底部 */}
        <div className="expanded-controls">
          {/* 进度条 */}
          <div className="seek-section">
            <span className="seek-time">{formatTime(state.currentTime)}</span>
            <input
              type="range"
              className="seek-bar"
              style={{ "--seek-progress": `${progress}%` } as CSSProperties}
              min={0}
              max={state.duration || 0}
              value={state.currentTime}
              onInput={handleSeek}
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

            <button
              className={`ctrl-btn favorite ${isFavorited ? "active" : ""}`}
              onClick={handleToggleFavorite}
              disabled={!state.currentTrack}
            >
              <span className="material-symbols-outlined">
                {isFavorited ? "favorite" : "favorite_border"}
              </span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default PlayerUI;
