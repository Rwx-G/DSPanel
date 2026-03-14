import { useRef, useEffect, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";

interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize: number;
  itemKey: (item: T, index: number) => string | number;
  loading?: boolean;
  loadingMore?: boolean;
  emptyMessage?: string;
  className?: string;
  overscan?: number;
  onEndReached?: () => void;
}

export function VirtualizedList<T>({
  items,
  renderItem,
  estimateSize,
  itemKey,
  loading = false,
  loadingMore = false,
  emptyMessage = "No items",
  className,
  overscan = 5,
  onEndReached,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => itemKey(items[index], index),
  });

  // Trigger onEndReached when last virtual item is visible
  const virtualItems = virtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];

  useEffect(() => {
    if (!lastItem || !onEndReached) return;
    if (lastItem.index >= items.length - 1) {
      onEndReached();
    }
  }, [lastItem?.index, items.length, onEndReached]);

  if (loading) {
    return (
      <div
        className="flex justify-center py-8"
        data-testid="virtualized-list-loading"
      >
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div data-testid="virtualized-list-empty">
        <EmptyState title={emptyMessage} />
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className ?? ""}`}
      data-testid="virtualized-list"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-testid="virtualized-list-item"
            data-index={virtualItem.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
      {loadingMore && (
        <div
          className="flex justify-center py-2"
          data-testid="virtualized-list-loading-more"
        >
          <LoadingSpinner message="Loading more..." />
        </div>
      )}
    </div>
  );
}
