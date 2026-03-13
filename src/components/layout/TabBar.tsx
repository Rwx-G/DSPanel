import { useRef, useCallback, useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface DragState {
  tabId: string;
  startX: number;
  offsetX: number;
  tabIndex: number;
  tabWidths: number[];
  tabOffsets: number[];
}

export function TabBar() {
  const { openTabs, activeTabId, activateTab, closeTab, closeAllTabs, moveTab } =
    useNavigation();

  const hasTabs = openTabs.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const didDragRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollIndicators = useCallback(() => {
    const el = tabsRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollIndicators();
  }, [openTabs.length, updateScrollIndicators]);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollIndicators);
    const ro = new ResizeObserver(updateScrollIndicators);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollIndicators);
      ro.disconnect();
    };
  }, [updateScrollIndicators]);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === "left" ? -150 : 150, behavior: "smooth" });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const closeOtherTabs = useCallback(
    (keepTabId: string) => {
      const tabsToClose = openTabs.filter(
        (t) => t.id !== keepTabId && !t.isPinned,
      );
      for (const tab of tabsToClose) {
        closeTab(tab.id);
      }
      activateTab(keepTabId);
    },
    [openTabs, closeTab, activateTab],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, tabId: string, tabIndex: number) => {
      // Only left mouse button
      if (e.button !== 0) return;
      // Don't drag from close button
      if ((e.target as HTMLElement).closest("button")) return;

      const container = containerRef.current;
      if (!container) return;

      const tabElements = Array.from(
        container.querySelectorAll<HTMLElement>("[role='tab']"),
      );
      const tabWidths = tabElements.map((el) => el.offsetWidth);
      const tabOffsets = tabElements.map((el) => el.offsetLeft);

      dragRef.current = {
        tabId,
        startX: e.clientX,
        offsetX: 0,
        tabIndex,
        tabWidths,
        tabOffsets,
      };
      didDragRef.current = false;

      setDragTabId(tabId);
      setDragDeltaX(0);

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.startX;
      drag.offsetX = deltaX;
      setDragDeltaX(deltaX);

      if (Math.abs(deltaX) > 3) {
        didDragRef.current = true;
      }

      // Compute the center of the dragged tab in its current visual position
      const currentIndex = drag.tabIndex;
      const draggedWidth = drag.tabWidths[currentIndex];
      const draggedCenter =
        drag.tabOffsets[currentIndex] + draggedWidth / 2 + deltaX;

      // Check if we should swap with a neighbor
      if (deltaX > 0 && currentIndex < openTabs.length - 1) {
        const nextCenter =
          drag.tabOffsets[currentIndex + 1] +
          drag.tabWidths[currentIndex + 1] / 2;
        if (draggedCenter > nextCenter) {
          moveTab(currentIndex, currentIndex + 1);
          // Update drag state to reflect the swap
          drag.tabOffsets[currentIndex + 1] = drag.tabOffsets[currentIndex];
          drag.tabOffsets[currentIndex] =
            drag.tabOffsets[currentIndex] + drag.tabWidths[currentIndex + 1];
          [drag.tabWidths[currentIndex], drag.tabWidths[currentIndex + 1]] = [
            drag.tabWidths[currentIndex + 1],
            drag.tabWidths[currentIndex],
          ];
          drag.startX += drag.tabWidths[currentIndex];
          drag.tabIndex = currentIndex + 1;
          setDragDeltaX(e.clientX - drag.startX);
        }
      } else if (deltaX < 0 && currentIndex > 0) {
        const prevCenter =
          drag.tabOffsets[currentIndex - 1] +
          drag.tabWidths[currentIndex - 1] / 2;
        if (draggedCenter < prevCenter) {
          moveTab(currentIndex, currentIndex - 1);
          drag.tabOffsets[currentIndex - 1] =
            drag.tabOffsets[currentIndex - 1] + drag.tabWidths[currentIndex];
          drag.tabOffsets[currentIndex] =
            drag.tabOffsets[currentIndex] - drag.tabWidths[currentIndex - 1];
          [drag.tabWidths[currentIndex], drag.tabWidths[currentIndex - 1]] = [
            drag.tabWidths[currentIndex - 1],
            drag.tabWidths[currentIndex],
          ];
          drag.startX -= drag.tabWidths[currentIndex];
          drag.tabIndex = currentIndex - 1;
          setDragDeltaX(e.clientX - drag.startX);
        }
      }
    },
    [openTabs.length, moveTab],
  );

  const handlePointerUp = useCallback(() => {
    const wasDragging = didDragRef.current;
    dragRef.current = null;
    setDragTabId(null);
    setDragDeltaX(0);

    // If we dragged, prevent the click from activating the tab
    if (wasDragging) {
      // The click event fires after pointerup, so we use a short flag
      didDragRef.current = false;
    }
  }, []);

  const handleTabClick = useCallback(
    (tabId: string) => {
      // Skip activation if this was a drag gesture
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      activateTab(tabId);
    },
    [activateTab],
  );

  return (
    <div
      ref={containerRef}
      className={`flex items-center border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)] transition-[height,opacity] duration-200 ease-in-out ${
        hasTabs ? "h-9 opacity-100" : "h-0 opacity-0 border-b-0"
      }`}
      role="tablist"
      data-testid="tab-bar"
    >
      {canScrollLeft && (
        <button
          className="flex h-full w-6 shrink-0 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          onClick={() => scrollTabs("left")}
          aria-label="Scroll tabs left"
          data-testid="tab-scroll-left"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      <div
        ref={tabsRef}
        className="flex flex-1 items-center overflow-x-auto scrollbar-none"
      >
      {openTabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isDragging = tab.id === dragTabId;

        return (
          <div
            key={tab.id}
            className={`group relative flex h-full items-center gap-1.5 border-r border-[var(--color-border-subtle)] px-3 select-none transition-colors duration-150 ${
              isDragging ? "z-10 cursor-grabbing shadow-md" : "cursor-grab"
            } ${
              isActive
                ? "bg-[var(--color-surface-bg)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            }`}
            style={{
              transform: isDragging ? `translateX(${dragDeltaX}px)` : undefined,
            }}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleTabClick(tab.id)}
            onPointerDown={(e) => handlePointerDown(e, tab.id, index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && !tab.isPinned) {
                closeTab(tab.id);
              }
            }}
            data-testid={`tab-${tab.moduleId}`}
          >
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-primary)]" />
            )}
            <span className="text-caption truncate max-w-[120px]">
              {tab.title}
            </span>

            {!tab.isPinned && (
              <button
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-opacity duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Close ${tab.title}`}
                data-testid={`tab-close-${tab.moduleId}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      </div>
      {canScrollRight && (
        <button
          className="flex h-full w-6 shrink-0 items-center justify-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          onClick={() => scrollTabs("right")}
          aria-label="Scroll tabs right"
          data-testid="tab-scroll-right"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Tab options"
          data-testid="tab-context-menu"
        >
          <button
            role="menuitem"
            className="flex w-full items-center px-3 py-1.5 text-caption text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            onClick={() => {
              closeTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            data-testid="tab-ctx-close"
          >
            Close
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center px-3 py-1.5 text-caption text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            onClick={() => {
              closeOtherTabs(contextMenu.tabId);
              setContextMenu(null);
            }}
            data-testid="tab-ctx-close-others"
          >
            Close Others
          </button>
          <div className="mx-2 my-1 border-t border-[var(--color-border-subtle)]" role="separator" />
          <button
            role="menuitem"
            className="flex w-full items-center px-3 py-1.5 text-caption text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
            data-testid="tab-ctx-close-all"
          >
            Close All
          </button>
        </div>
      )}
    </div>
  );
}
