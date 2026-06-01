import { useState, useCallback, useRef } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
  damping?: number;
}

interface UsePullToRefreshReturn {
  pullDistance: number;
  isRefreshing: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

export function usePullToRefresh({
  onRefresh,
  threshold = 60,
  maxPull = 120,
  damping = 0.5,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (scrollRef.current && scrollRef.current.scrollTop === 0 && !isRefreshing) {
        touchStartY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    },
    [isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const distance = currentY - touchStartY.current;

      if (distance > 0) {
        const dampedDistance = Math.min(distance * damping, maxPull);
        setPullDistance(dampedDistance);
      }
    },
    [isRefreshing, damping, maxPull]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance > threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(50);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, threshold, onRefresh]);

  return {
    pullDistance,
    isRefreshing,
    scrollRef,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
