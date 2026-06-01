import { type ReactNode } from "react";
import "./PullToRefresh.css";

interface PullToRefreshProps {
  pullDistance: number;
  isRefreshing: boolean;
  children: ReactNode;
}

export function PullToRefresh({ pullDistance, isRefreshing, children }: PullToRefreshProps) {
  return (
    <>
      <div
        className="pull-to-refresh"
        style={{
          height: `${pullDistance}px`,
          opacity: pullDistance > 0 ? 1 : 0,
        }}
      >
        <div className={`refresh-spinner ${isRefreshing ? "spinning" : ""}`}>
          <span className="material-symbols-outlined">
            {isRefreshing ? "sync" : "arrow_downward"}
          </span>
        </div>
      </div>
      {children}
    </>
  );
}
