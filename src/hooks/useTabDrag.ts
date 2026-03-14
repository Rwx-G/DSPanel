import { useRef, useCallback, useState } from "react";

interface DragState {
  tabId: string;
  startX: number;
  offsetX: number;
  tabIndex: number;
  tabWidths: number[];
  tabOffsets: number[];
}

interface UseTabDragOptions {
  tabCount: number;
  moveTab: (fromIndex: number, toIndex: number) => void;
  activateTab: (tabId: string) => void;
}

export function useTabDrag({
  tabCount,
  moveTab,
  activateTab,
}: UseTabDragOptions) {
  const dragRef = useRef<DragState | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const didDragRef = useRef(false);

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      tabId: string,
      tabIndex: number,
      containerEl: HTMLElement | null,
    ) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      if (!containerEl) return;

      const tabElements = Array.from(
        containerEl.querySelectorAll<HTMLElement>("[role='tab']"),
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

      const currentIndex = drag.tabIndex;
      const draggedWidth = drag.tabWidths[currentIndex];
      const draggedCenter =
        drag.tabOffsets[currentIndex] + draggedWidth / 2 + deltaX;

      if (deltaX > 0 && currentIndex < tabCount - 1) {
        const nextCenter =
          drag.tabOffsets[currentIndex + 1] +
          drag.tabWidths[currentIndex + 1] / 2;
        if (draggedCenter > nextCenter) {
          moveTab(currentIndex, currentIndex + 1);
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
    [tabCount, moveTab],
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setDragTabId(null);
    setDragDeltaX(0);
    didDragRef.current = false;
  }, []);

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      activateTab(tabId);
    },
    [activateTab],
  );

  return {
    dragTabId,
    dragDeltaX,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleTabClick,
  };
}
