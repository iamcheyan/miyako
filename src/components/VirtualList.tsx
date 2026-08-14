import { memo } from "react";

interface VirtualItemsProps {
  /** 列表总高度（撑出滚动条） */
  totalHeight: number;
  startIndex: number;
  endIndex: number;
  itemHeight: number;
  /** 渲染 [startIndex, endIndex) 中的某一行 */
  render: (index: number) => React.ReactNode;
}

/**
 * 配合 useVirtualList 渲染窗口内的行：每行绝对定位到
 * index * itemHeight，行内容自行撑满高度（height: 100%）。
 */
export const VirtualItems = memo(function VirtualItems({
  totalHeight,
  startIndex,
  endIndex,
  itemHeight,
  render,
}: VirtualItemsProps) {
  const rows: React.ReactNode[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    rows.push(
      <div
        key={index}
        className="virtual-row"
        style={{
          position: "absolute",
          top: index * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        }}
      >
        {render(index)}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", height: totalHeight }}>{rows}</div>
  );
});
