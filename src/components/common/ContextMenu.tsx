import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState(position);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!position || !menuRef.current) {
      setAdjustedPos(position);
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;

    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 4;
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 4;
    }

    setAdjustedPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [position]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!position) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [position, onClose]);

  const handleItemClick = useCallback(
    (item: ContextMenuItem) => {
      if (!item.disabled) {
        item.onClick();
        onClose();
      }
    },
    [onClose],
  );

  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] py-1 shadow-lg"
      style={{
        left: adjustedPos?.x ?? position.x,
        top: adjustedPos?.y ?? position.y,
      }}
      role="menu"
      data-testid="context-menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-body transition-colors ${
            item.disabled
              ? "cursor-not-allowed text-[var(--color-text-disabled)]"
              : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          }`}
          onClick={() => handleItemClick(item)}
          disabled={item.disabled}
          role="menuitem"
          data-testid={`context-menu-item-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {item.icon && (
            <span className="shrink-0 text-[var(--color-text-secondary)]">
              {item.icon}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
