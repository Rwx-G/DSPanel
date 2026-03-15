import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ChevronDown, Users, User, AlertTriangle } from "lucide-react";
import { type DirectoryEntry } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

// Session-level cache shared across all GroupChainNode instances.
// Prevents redundant LDAP queries when the same group appears in multiple branches.
const groupMemberCache = new Map<string, DirectoryEntry[]>();

/** Clears the group member cache (call on page navigation or session reset). */
export function clearGroupMemberCache(): void {
  groupMemberCache.clear();
}

interface GroupChainNodeProps {
  groupDn: string;
  groupName: string;
  depth: number;
  ancestors: Set<string>;
}

function GroupChainNode({ groupDn, groupName, depth, ancestors }: GroupChainNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<DirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCircular = ancestors.has(groupDn.toLowerCase());

  const toggle = useCallback(async () => {
    if (isCircular) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (members !== null) {
      setExpanded(true);
      return;
    }
    // Check session cache first
    const cacheKey = groupDn.toLowerCase();
    const cached = groupMemberCache.get(cacheKey);
    if (cached) {
      setMembers(cached);
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DirectoryEntry[]>("get_group_members", {
        groupDn,
      });
      groupMemberCache.set(cacheKey, result);
      setMembers(result);
      setExpanded(true);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setLoading(false);
    }
  }, [expanded, members, groupDn, isCircular]);

  // Build ancestors set for children (current group added)
  const childAncestors = new Set(ancestors);
  childAncestors.add(groupDn.toLowerCase());

  return (
    <div data-testid={`group-chain-node-${groupName}`}>
      <button
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-caption rounded transition-colors ${
          isCircular
            ? "cursor-default opacity-70"
            : "hover:bg-[var(--color-surface-hover)] cursor-pointer"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggle}
        disabled={isCircular}
        data-testid={`group-chain-toggle-${groupName}`}
      >
        {isCircular ? (
          <AlertTriangle size={12} className="shrink-0 text-[var(--color-warning)]" />
        ) : loading ? (
          <LoadingSpinner size="sm" />
        ) : expanded ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--color-text-secondary)]" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-[var(--color-text-secondary)]" />
        )}
        <Users size={12} className="shrink-0 text-[var(--color-primary)]" />
        <span className="text-[var(--color-text-primary)] font-medium">{groupName}</span>
        {isCircular && (
          <span
            className="text-[11px] text-[var(--color-warning)] italic"
            data-testid={`circular-ref-${groupName}`}
          >
            (circular reference)
          </span>
        )}
      </button>
      {error && (
        <div
          className="text-[11px] text-[var(--color-error)]"
          style={{ paddingLeft: `${depth * 16 + 28}px` }}
        >
          {error}
        </div>
      )}
      {expanded && members && (() => {
        const sorted = [...members].sort((a, b) => {
          const aGroup = a.objectClass === "group" ? 0 : 1;
          const bGroup = b.objectClass === "group" ? 0 : 1;
          if (aGroup !== bGroup) return aGroup - bGroup;
          const aName = a.displayName ?? a.samAccountName ?? "";
          const bName = b.displayName ?? b.samAccountName ?? "";
          return aName.localeCompare(bName);
        });
        return (
        <div>
          {sorted.length === 0 && (
            <div
              className="text-[11px] text-[var(--color-text-secondary)]"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              No members
            </div>
          )}
          {sorted.map((member) => {
            const isGroup = member.objectClass === "group";
            const name = member.displayName ?? parseCnFromDn(member.distinguishedName);
            if (isGroup) {
              return (
                <GroupChainNode
                  key={member.distinguishedName}
                  groupDn={member.distinguishedName}
                  groupName={name}
                  depth={depth + 1}
                  ancestors={childAncestors}
                />
              );
            }
            return (
              <div
                key={member.distinguishedName}
                className="flex items-center gap-1.5 py-0.5 text-caption text-[var(--color-text-secondary)]"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                data-testid={`group-chain-member-${member.samAccountName}`}
              >
                <User size={12} className="shrink-0" />
                <span>{name}</span>
                {member.samAccountName && (
                  <span className="text-[11px]">({member.samAccountName})</span>
                )}
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}

interface GroupChainTreeProps {
  groupDn: string;
  groupName: string;
}

export function GroupChainTree({ groupDn, groupName }: GroupChainTreeProps) {
  return (
    <div
      className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-bg)] py-1"
      data-testid="group-chain-tree"
    >
      <GroupChainNode
        groupDn={groupDn}
        groupName={groupName}
        depth={0}
        ancestors={new Set()}
      />
    </div>
  );
}
