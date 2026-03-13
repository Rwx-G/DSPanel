import { X } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";

export function TabBar() {
  const { openTabs, activeTabId, activateTab, closeTab } = useNavigation();

  return (
    <div
      className="flex h-9 items-center overflow-x-auto border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
      role="tablist"
      data-testid="tab-bar"
    >
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            className={`group flex h-full items-center gap-1 border-r border-[var(--color-border-subtle)] px-3 cursor-pointer select-none transition-colors duration-[var(--transition-fast)] ${
              isActive
                ? "bg-[var(--color-surface-bg)] border-b-2 border-b-[var(--color-primary)]"
                : "bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-hover)]"
            }`}
            role="tab"
            aria-selected={isActive}
            onClick={() => activateTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && !tab.isPinned) {
                closeTab(tab.id);
              }
            }}
            data-testid={`tab-${tab.moduleId}`}
          >
            <span className="text-caption truncate max-w-[120px]">
              {tab.title}
            </span>

            {!tab.isPinned && (
              <button
                className="ml-1 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-opacity"
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
  );
}
