import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, ChevronDown, Users, User } from "lucide-react";
import { type DirectoryEntry } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

interface GroupChainNodeProps {
  groupDn: string;
  groupName: string;
  depth: number;
}

function GroupChainNode({ groupDn, groupName, depth }: GroupChainNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<DirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (members !== null) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DirectoryEntry[]>("get_group_members", {
        groupDn,
      });
      setMembers(result);
      setExpanded(true);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setLoading(false);
    }
  }, [expanded, members, groupDn]);

  return (
    <div data-testid={`group-chain-node-${groupName}`}>
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-caption hover:bg-[var(--color-surface-hover)] rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={toggle}
        data-testid={`group-chain-toggle-${groupName}`}
      >
        {loading ? (
          <LoadingSpinner size="sm" />
        ) : expanded ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--color-text-secondary)]" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-[var(--color-text-secondary)]" />
        )}
        <Users size={12} className="shrink-0 text-[var(--color-primary)]" />
        <span className="text-[var(--color-text-primary)] font-medium">{groupName}</span>
      </button>
      {error && (
        <div
          className="text-[11px] text-[var(--color-error)]"
          style={{ paddingLeft: `${depth * 16 + 28}px` }}
        >
          {error}
        </div>
      )}
      {expanded && members && (
        <div>
          {members.length === 0 && (
            <div
              className="text-[11px] text-[var(--color-text-secondary)]"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              No members
            </div>
          )}
          {members.map((member) => {
            const isGroup = member.objectClass === "group";
            const name = member.displayName ?? parseCnFromDn(member.distinguishedName);
            if (isGroup) {
              return (
                <GroupChainNode
                  key={member.distinguishedName}
                  groupDn={member.distinguishedName}
                  groupName={name}
                  depth={depth + 1}
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
      )}
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
      <GroupChainNode groupDn={groupDn} groupName={groupName} depth={0} />
    </div>
  );
}
