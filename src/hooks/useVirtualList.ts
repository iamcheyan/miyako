import { useCallback, useEffect, useState } from "react";

interface VirtualListOptions {
  /** 渲染区上下各多渲染的行数（验收要求 ±20） */
  overscan?: number;
}

/**
 * 简单窗口化列表：只渲染可视区 ± overscan 行。
 *
 * 用法：把返回的 containerProps 展开到滚动容器上，
 * 用 totalHeight 撑出总高度，用 startIndex/endIndex 渲染区间。
 *
 * 前提：所有行高一致（itemHeight），行内容自身撑满高度。
 *
 * 滚动容器节点用 state 保存而不是 ref：组件可能在不同渲染分支
 * 挂不同的滚动容器（如 MusicLibrary 文件夹视图/文件视图），
 * effect 必须跟着真实节点重新订阅，而不是只在首挂载时取一次。
 */
export function useVirtualList(
  count: number,
  itemHeight: number,
  { overscan = 20 }: VirtualListOptions = {}
) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // 视口高度随容器尺寸变化（旋转屏幕、展开面板等）
  useEffect(() => {
    if (!container || typeof ResizeObserver === "undefined") return;

    setViewportHeight(container.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const onScroll = useCallback(() => {
    setScrollTop(container?.scrollTop ?? 0);
  }, [container]);

  const containerProps = { ref: setContainer, onScroll };

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    count,
    Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
  );

  return {
    containerProps,
    totalHeight: count * itemHeight,
    startIndex,
    endIndex,
  };
}
