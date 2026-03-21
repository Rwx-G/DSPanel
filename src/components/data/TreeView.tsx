import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
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

/** Build a map of childId -> parentId by walking the tree. */
function buildParentMap(
  nodes: TreeNode[],
  parentId: string | null = null,
  map: Map<string, string> = new Map(),
): Map<string, string> {
  for (const node of nodes) {
    if (parentId !== null) {
      map.set(node.id, parentId);
    }
    if (node.children) {
      buildParentMap(node.children, node.id, map);
    }
  }
  return map;
}

/** Collect all ancestor IDs for a set of selected node IDs. */
function getAncestorIds(
  selectedIds: Set<string>,
  parentMap: Map<string, string>,
): Set<string> {
  const ancestors = new Set<string>();
  for (const id of selectedIds) {
    let current = parentMap.get(id);
    while (current !== undefined) {
      ancestors.add(current);
      current = parentMap.get(current);
    }
  }
  return ancestors;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedIds: Set<string>;
  ancestorOfSelectedIds: Set<string>;
  expandedIds: Set<string>;
  onSelect?: (id: string) => void;
  onToggle: (id: string, node: TreeNode) => void;
  multiSelect: boolean;
}

function TreeNodeItem({
  node,
  depth,
  selectedIds,
  ancestorOfSelectedIds,
  expandedIds,
  onSelect,
  onToggle,
  multiSelect,
}: TreeNodeItemProps) {
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const isAncestorOfSelected = ancestorOfSelectedIds.has(node.id);
  const hasChildren =
    (node.children && node.children.length > 0) || node.hasChildren;
  const itemRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the selected node when first rendered
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isSelected]);

  return (
    <div
      data-testid={`tree-node-${node.id}`}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
    >
      <div
        ref={itemRef}
        className={`relative flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors ${
          isSelected
            ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)] font-medium"
            : isAncestorOfSelected
              ? "bg-[var(--color-surface-ancestor)] text-[var(--color-text-secondary)] font-medium"
              : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
        }`}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={() => onSelect?.(node.id)}
        data-testid={`tree-item-${node.id}`}
      >
        {/* Ancestry indicator bar */}
        {isAncestorOfSelected && !isSelected && (
          <span className="absolute left-0 top-0 h-full w-[3px] bg-[var(--color-text-secondary)] opacity-50" />
        )}
        {multiSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect?.(node.id)}
            className="shrink-0"
            aria-label={`Select ${node.label}`}
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
            aria-label={
              isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`
            }
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
              ancestorOfSelectedIds={ancestorOfSelectedIds}
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
  const initialExpandDone = useRef(false);

  const parentMap = useMemo(() => buildParentMap(nodes), [nodes]);
  const ancestorOfSelectedIds = useMemo(
    () => getAncestorIds(selectedIds, parentMap),
    [selectedIds, parentMap],
  );

  // Auto-expand ancestors of the initial selection so the selected node is visible
  useEffect(() => {
    if (initialExpandDone.current || ancestorOfSelectedIds.size === 0) return;
    initialExpandDone.current = true;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const id of ancestorOfSelectedIds) next.add(id);
      return next;
    });
  }, [ancestorOfSelectedIds]);

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
          ancestorOfSelectedIds={ancestorOfSelectedIds}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={handleToggle}
          multiSelect={multiSelect}
        />
      ))}
    </div>
  );
}
