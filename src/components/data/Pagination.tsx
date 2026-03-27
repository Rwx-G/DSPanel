import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const PAGE_SIZES = [25, 50, 100] as const;

interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const { t } = useTranslation(["components"]);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return (
    <div
      className="flex items-center justify-between gap-4 px-3 py-2 text-caption text-[var(--color-text-secondary)]"
      data-testid="pagination"
    >
      <span data-testid="pagination-info">
        {totalItems === 0
          ? t("components:pagination.noItems")
          : t("components:pagination.showing", { start: startItem, end: endItem, total: totalItems })}
      </span>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <span>{t("components:pagination.pageSize")}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-1 py-0.5 text-caption text-[var(--color-text-primary)]"
            data-testid="pagination-page-size"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(1)}
            disabled={isFirstPage}
            className="rounded p-1 hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t("components:pagination.firstPage")}
            data-testid="pagination-first"
          >
            <ChevronFirst size={16} />
          </button>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={isFirstPage}
            className="rounded p-1 hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t("components:pagination.previousPage")}
            data-testid="pagination-prev"
          >
            <ChevronLeft size={16} />
          </button>

          <span
            className="min-w-[60px] text-center text-[var(--color-text-primary)]"
            data-testid="pagination-page"
          >
            {currentPage} / {totalPages}
          </span>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={isLastPage}
            className="rounded p-1 hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t("components:pagination.nextPage")}
            data-testid="pagination-next"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={isLastPage}
            className="rounded p-1 hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t("components:pagination.lastPage")}
            data-testid="pagination-last"
          >
            <ChevronLast size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
