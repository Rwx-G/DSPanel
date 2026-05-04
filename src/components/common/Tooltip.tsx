import { useState, useId, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

interface TooltipPosition {
  top: number;
  left: number;
}

const DEFAULT_TOOLTIP_WIDTH = 256;
const DEFAULT_INFO_WIDTH = 320;
const TOOLTIP_OFFSET = 4;
const VIEWPORT_PADDING = 4;
/**
 * Approximate height reserved for the tooltip card when deciding whether to
 * flip from below to above. Pure heuristic - the card has variable height,
 * but using a fixed budget keeps the math out of layout phase.
 */
const FLIP_HEIGHT_BUDGET = 100;
/**
 * Delay between blur and close so a click *inside* the popover (link, button)
 * registers before the popover unmounts. Matches the legacy GroupHygiene
 * implementation.
 */
const BLUR_CLOSE_DELAY_MS = 150;

function computeTooltipPosition(
  triggerRect: DOMRect,
  tooltipWidth: number,
): TooltipPosition {
  let left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
  let top = triggerRect.bottom + TOOLTIP_OFFSET;
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
  if (left + tooltipWidth > window.innerWidth - VIEWPORT_PADDING) {
    left = window.innerWidth - tooltipWidth - VIEWPORT_PADDING;
  }
  if (top + FLIP_HEIGHT_BUDGET > window.innerHeight) {
    top = triggerRect.top - TOOLTIP_OFFSET;
  }
  return { top, left };
}

interface TooltipProps {
  /** Content rendered inside the floating card. Falsy values render no popover. */
  content: ReactNode;
  /** Element wrapped by the tooltip trigger. */
  children: ReactNode;
  /** Width of the floating card in pixels. Default 256. */
  width?: number;
  /** Class applied to the inline trigger wrapper. */
  className?: string;
  /** Test id forwarded to the trigger wrapper. */
  testId?: string;
}

/**
 * Themed popup replacement for the native HTML `title` attribute. Renders
 * the floating card through a portal so it escapes overflow ancestors
 * (table cells, scroll containers).
 *
 * Opens on hover, focus, or keyboard tab to the trigger; closes on
 * mouseleave, blur, or Escape. The card uses DSPanel theme tokens
 * (`--color-surface-card`, `--color-border-default`, `--color-text-primary`)
 * so it follows the active theme instead of the user agent default.
 *
 * For an info-icon trigger with richer helper content, see `InfoTooltip`.
 */
export function Tooltip({
  content,
  children,
  width = DEFAULT_TOOLTIP_WIDTH,
  className,
  testId,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }
    setPosition(
      computeTooltipPosition(triggerRef.current.getBoundingClientRect(), width),
    );
  }, [open, width]);

  const hasContent =
    content !== null && content !== undefined && content !== "";

  if (!hasContent) {
    return <>{children}</>;
  }

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
        }
      }}
      tabIndex={0}
      aria-describedby={open ? tooltipId : undefined}
      data-testid={testId}
    >
      {children}
      {open &&
        position &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 text-caption text-[var(--color-text-primary)] shadow-lg"
            style={{ top: position.top, left: position.left, width }}
            data-testid="tooltip-card"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

interface InfoTooltipProps {
  /** Content rendered inside the popover when the icon is clicked. */
  children: ReactNode;
  /** Accessible label announced for the trigger button. */
  ariaLabel: string;
  /** Width of the popover card. Default 320 for richer helper content. */
  width?: number;
  /** Test id forwarded to the trigger button. */
  testId?: string;
}

/**
 * Clickable "i" icon paired with a themed popover. Use for rich inline help
 * (what / why / fix patterns) where a hover-only tooltip would hide too
 * quickly for the operator to read.
 *
 * Click toggles open/closed; blur closes after a short delay so a click on
 * an interactive element *inside* the popover (link, button) still
 * registers; Escape closes immediately. The popover is rendered through a
 * portal so it escapes overflow ancestors.
 */
export function InfoTooltip({
  children,
  ariaLabel,
  width = DEFAULT_INFO_WIDTH,
  testId,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }
    setPosition(
      computeTooltipPosition(triggerRef.current.getBoundingClientRect(), width),
    );
  }, [open, width]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        onClick={() => setOpen((prev) => !prev)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), BLUR_CLOSE_DELAY_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
          }
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? tooltipId : undefined}
        data-testid={testId}
      >
        <Info size={13} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 text-caption text-[var(--color-text-primary)] shadow-lg"
            style={{ top: position.top, left: position.left, width }}
            data-testid="info-tooltip-card"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
