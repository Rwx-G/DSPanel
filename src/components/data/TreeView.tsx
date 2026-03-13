import { useState, useCallback, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  hasChildren?: boolean;
  icon?: ReactNode;
}

interface TreeViewProps {
  nodes: TreeNode[];
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  onExpand?: (id: string) => Promise<TreeNode[]> | void;
  multiSelect?: boolean;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onSelect?: (id: string) => void;
  onToggle: (id: string, node: TreeNode) => void;
  multiSelect: boolean;
}

function TreeNodeItem({
  node,
  depth,
  selectedIds,
  expandedIds,
  onSelect,
  onToggle,
  multiSelect,
}: TreeNodeItemProps) {
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const hasChildren =
    (node.children && node.children.length > 0) || node.hasChildren;

  return (
    <div data-testid={`tree-node-${node.id}`}>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors ${
          isSelected
            ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
            : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
        }`}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={() => onSelect?.(node.id)}
        data-testid={`tree-item-${node.id}`}
      >
        {multiSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect?.(node.id)}
            className="shrink-0"
            data-testid={`tree-checkbox-${node.id}`}
          />
        )}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id, node);
            }}
            className="shrink-0 rounded-sm p-0.5 hover:bg-[var(--color-surface-hover)] transition-transform"
            data-testid={`tree-toggle-${node.id}`}
          >
            {isExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        {node.icon && <span className="shrink-0">{node.icon}</span>}
        <span className="text-body truncate">{node.label}</span>
      </div>
      {isExpanded && node.children && (
        <div data-testid={`tree-children-${node.id}`}>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              onSelect={onSelect}
              onToggle={onToggle}
              multiSelect={multiSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  nodes,
  selectedIds = new Set(),
  onSelect,
  onExpand,
  multiSelect = false,
}: TreeViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback(
    async (id: string, node: TreeNode) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });

      if (!expandedIds.has(id) && node.hasChildren && !node.children?.length) {
        onExpand?.(id);
      }
    },
    [expandedIds, onExpand],
  );

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
      role="tree"
      data-testid="tree-view"
    >
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.id}
          node={node}
          depth={0}
          selectedIds={selectedIds}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={handleToggle}
          multiSelect={multiSelect}
        />
      ))}
    </div>
  );
}
