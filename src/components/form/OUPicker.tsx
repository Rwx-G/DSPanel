import { useState, useCallback, useMemo } from "react";
import { TreeView, type TreeNode } from "@/components/data/TreeView";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { useTranslation } from "react-i18next";

export interface OUNode {
  distinguishedName: string;
  name: string;
  children?: OUNode[];
  hasChildren?: boolean;
}

interface OUPickerProps {
  nodes: OUNode[];
  selectedOU?: string;
  onSelect: (distinguishedName: string) => void;
  onExpand?: (distinguishedName: string) => Promise<OUNode[]> | void;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
}

function ouNodesToTreeNodes(ous: OUNode[]): TreeNode[] {
  return ous.map((ou) => ({
    id: ou.distinguishedName,
    label: ou.name,
    children: ou.children ? ouNodesToTreeNodes(ou.children) : undefined,
    hasChildren: ou.hasChildren,
  }));
}

export function OUPicker({
  nodes,
  selectedOU,
  onSelect,
  onExpand,
  loading = false,
  error = false,
  disabled = false,
}: OUPickerProps) {
  const { t } = useTranslation(["components"]);
  const [_expandedIds] = useState<Set<string>>(new Set());

  const treeNodes = useMemo(() => ouNodesToTreeNodes(nodes), [nodes]);
  const selectedIds = useMemo(
    () => (selectedOU ? new Set([selectedOU]) : new Set<string>()),
    [selectedOU],
  );

  const handleExpand = useCallback(
    (id: string): Promise<TreeNode[]> | void => {
      if (!onExpand) return;
      const result = onExpand(id);
      if (!result) return;
      return result.then((nodes) => ouNodesToTreeNodes(nodes));
    },
    [onExpand],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-4" data-testid="ou-picker-loading">
        <LoadingSpinner message={t("components:ouPicker.loading")} />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="ou-picker-error">
        <EmptyState
          title={t("components:ouPicker.loadFailed")}
          description={t("components:ouPicker.loadFailedHint")}
        />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div data-testid="ou-picker-empty">
        <EmptyState title={t("components:ouPicker.noOus")} />
      </div>
    );
  }

  return (
    <div
      className={`${disabled ? "pointer-events-none opacity-50" : ""}`}
      data-testid="ou-picker"
    >
      {selectedOU && (
        <div
          className="mb-2 rounded-md bg-[var(--color-surface-hover)] px-3 py-1.5 text-caption text-[var(--color-text-secondary)] truncate"
          data-testid="ou-picker-selected"
          title={selectedOU}
        >
          {t("components:ouPicker.selected", { ou: selectedOU })}
        </div>
      )}
      <div className="max-h-64 overflow-auto">
        <TreeView
          nodes={treeNodes}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onExpand={handleExpand}
        />
      </div>
    </div>
  );
}
