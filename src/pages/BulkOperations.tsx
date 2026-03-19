import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GroupPicker, type GroupOption } from "@/components/form/GroupPicker";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useGroupSearch } from "@/hooks/useGroupSearch";
import { usePermissions } from "@/hooks/usePermissions";
import { parseCnFromDn } from "@/utils/dn";
import { formatCsv, downloadCsv } from "@/utils/csvExport";
import { extractErrorMessage } from "@/utils/errorMapping";
import { type DirectoryEntry } from "@/types/directory";
import {
  Trash2,
  UserPlus,
  ArrowRightLeft,
  CheckSquare,
  Eye,
  Play,
  AlertCircle,
  CheckCircle,
  RotateCcw,
  Copy,
  Download,
  Upload,
  FolderInput,
  FilePlus2,
  Users,
  Shield,
  ArrowLeft,
  Merge,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BulkOperationType =
  | "delete"
  | "add"
  | "transfer"
  | "export-csv"
  | "copy-memberships"
  | "update-manager"
  | "clone-group"
  | "merge-groups"
  | "import-csv"
  | "move-groups"
  | "create-groups";

export interface PlannedChange {
  memberDn: string;
  memberName: string;
  groupDn: string;
  groupName: string;
  action: "add" | "remove";
}

export interface BulkProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "failed" | "rolling-back";
  message: string;
}

interface OperationCard {
  id: BulkOperationType;
  label: string;
  icon: typeof Trash2;
  description: string;
  minPermission: string;
}

const OPERATION_CARDS: OperationCard[] = [
  {
    id: "transfer",
    label: "Transfer Members",
    icon: ArrowRightLeft,
    description: "Move members from one group to another",
    minPermission: "AccountOperator",
  },
  {
    id: "clone-group",
    label: "Clone Group",
    icon: Copy,
    description: "Create a copy of a group with its members",
    minPermission: "AccountOperator",
  },
  {
    id: "merge-groups",
    label: "Merge Groups",
    icon: Merge,
    description: "Combine members from multiple groups into one",
    minPermission: "AccountOperator",
  },
  {
    id: "copy-memberships",
    label: "Copy User Groups",
    icon: Users,
    description: "Copy group memberships from one user to another",
    minPermission: "HelpDesk",
  },
  {
    id: "import-csv",
    label: "Import CSV",
    icon: Upload,
    description: "Add members to a group from a CSV file",
    minPermission: "HelpDesk",
  },
  {
    id: "export-csv",
    label: "Export CSV",
    icon: Download,
    description: "Export group members to a CSV file",
    minPermission: "ReadOnly",
  },
  {
    id: "move-groups",
    label: "Move Groups",
    icon: FolderInput,
    description: "Move groups to a different OU",
    minPermission: "DomainAdmin",
  },
  {
    id: "create-groups",
    label: "Create Groups",
    icon: FilePlus2,
    description: "Bulk create groups from CSV template",
    minPermission: "AccountOperator",
  },
  {
    id: "update-manager",
    label: "Update Manager",
    icon: Shield,
    description: "Set the managedBy attribute on groups",
    minPermission: "AccountOperator",
  },
  {
    id: "delete",
    label: "Delete Members",
    icon: Trash2,
    description: "Remove members from a group",
    minPermission: "AccountOperator",
  },
  {
    id: "add",
    label: "Add Members",
    icon: UserPlus,
    description: "Add members to a target group",
    minPermission: "HelpDesk",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCsvRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  });
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BulkOperations() {
  const { hasPermission } = usePermissions();
  const searchGroups = useGroupSearch();

  const [selectedOp, setSelectedOp] = useState<BulkOperationType | null>(null);

  // Shared state for member-based operations
  const [sourceGroups, setSourceGroups] = useState<GroupOption[]>([]);
  const [targetGroups, setTargetGroups] = useState<GroupOption[]>([]);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [plannedChanges, setPlannedChanges] = useState<PlannedChange[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [progress, setProgress] = useState<BulkProgress>({
    current: 0,
    total: 0,
    status: "idle",
    message: "",
  });

  // Copy memberships state
  const [sourceUserQuery, setSourceUserQuery] = useState("");
  const [targetUserQuery, setTargetUserQuery] = useState("");
  const [sourceUser, setSourceUser] = useState<DirectoryEntry | null>(null);
  const [targetUser, setTargetUser] = useState<DirectoryEntry | null>(null);
  const [copyPreviewGroups, setCopyPreviewGroups] = useState<string[]>([]);

  // Clone group state
  const [cloneNewName, setCloneNewName] = useState("");
  const [cloneContainerDn, setCloneContainerDn] = useState("");

  // Import CSV state
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvResolvedUsers, setCsvResolvedUsers] = useState<DirectoryEntry[]>(
    [],
  );
  const [csvResolving, setCsvResolving] = useState(false);

  // Create groups CSV state
  const [createGroupsCsvData, setCreateGroupsCsvData] = useState<string[][]>(
    [],
  );

  // Update manager state
  const [managerQuery, setManagerQuery] = useState("");
  const [selectedManager, setSelectedManager] = useState<DirectoryEntry | null>(
    null,
  );

  // Move groups state - reuses targetGroups for OU picker input
  const [moveTargetOu, setMoveTargetOu] = useState("");

  // Reset all state when operation changes
  useEffect(() => {
    setSourceGroups([]);
    setTargetGroups([]);
    setMembers([]);
    setSelectedMembers(new Set());
    setPlannedChanges([]);
    setShowPreview(false);
    setProgress({ current: 0, total: 0, status: "idle", message: "" });
    setSourceUserQuery("");
    setTargetUserQuery("");
    setSourceUser(null);
    setTargetUser(null);
    setCopyPreviewGroups([]);
    setCloneNewName("");
    setCloneContainerDn("");
    setCsvData([]);
    setCsvResolvedUsers([]);
    setCreateGroupsCsvData([]);
    setManagerQuery("");
    setSelectedManager(null);
    setMoveTargetOu("");
  }, [selectedOp]);

  // Load members when source group changes (for member-based operations)
  useEffect(() => {
    if (sourceGroups.length === 0) {
      setMembers([]);
      setSelectedMembers(new Set());
      return;
    }

    const sourceGroup = sourceGroups[0];
    let cancelled = false;
    setMembersLoading(true);
    setSelectedMembers(new Set());

    invoke<DirectoryEntry[]>("get_group_members", {
      groupDn: sourceGroup.distinguishedName,
    })
      .then((result) => {
        if (!cancelled) {
          setMembers(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to load group members:", err);
          setMembers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceGroups]);

  const handleMemberSelect = useCallback((dn: string, checked: boolean) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(dn);
      } else {
        next.delete(dn);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedMembers(new Set(members.map((m) => m.distinguishedName)));
      } else {
        setSelectedMembers(new Set());
      }
    },
    [members],
  );

  const allSelected =
    members.length > 0 && selectedMembers.size === members.length;

  const getMemberName = useCallback(
    (dn: string): string => {
      const member = members.find((m) => m.distinguishedName === dn);
      return member?.displayName ?? member?.samAccountName ?? parseCnFromDn(dn);
    },
    [members],
  );

  // ---------------------------------------------------------------------------
  // Preview handlers
  // ---------------------------------------------------------------------------

  const handlePreview = useCallback(() => {
    const changes: PlannedChange[] = [];
    const selectedDns = Array.from(selectedMembers);

    if (selectedOp === "delete") {
      for (const source of sourceGroups) {
        for (const dn of selectedDns) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: source.distinguishedName,
            groupName: source.name,
            action: "remove",
          });
        }
      }
    } else if (selectedOp === "add") {
      for (const target of targetGroups) {
        for (const dn of selectedDns) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: target.distinguishedName,
            groupName: target.name,
            action: "add",
          });
        }
      }
    } else if (selectedOp === "transfer") {
      for (const dn of selectedDns) {
        for (const target of targetGroups) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: target.distinguishedName,
            groupName: target.name,
            action: "add",
          });
        }
        for (const source of sourceGroups) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: source.distinguishedName,
            groupName: source.name,
            action: "remove",
          });
        }
      }
    }

    setPlannedChanges(changes);
    setShowPreview(true);
  }, [selectedOp, sourceGroups, targetGroups, selectedMembers, getMemberName]);

  // ---------------------------------------------------------------------------
  // Execute handler (for add/remove based operations)
  // ---------------------------------------------------------------------------

  const handleExecute = useCallback(async () => {
    if (plannedChanges.length === 0) return;

    const completedOps: PlannedChange[] = [];
    const total = plannedChanges.length;

    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Starting...",
    });
    setShowPreview(false);

    for (let i = 0; i < plannedChanges.length; i++) {
      const change = plannedChanges[i];
      const actionLabel = change.action === "add" ? "Adding" : "Removing";
      setProgress({
        current: i,
        total,
        status: "running",
        message: `${actionLabel} ${change.memberName} ${change.action === "add" ? "to" : "from"} ${change.groupName}...`,
      });

      try {
        if (change.action === "add") {
          await invoke("add_user_to_group", {
            userDn: change.memberDn,
            groupDn: change.groupDn,
          });
        } else {
          await invoke("remove_group_member", {
            memberDn: change.memberDn,
            groupDn: change.groupDn,
          });
        }
        completedOps.push(change);
      } catch (err) {
        console.warn(`Bulk operation failed at step ${i + 1}:`, err);

        setProgress({
          current: i,
          total,
          status: "rolling-back",
          message: `Rolling back ${completedOps.length} completed operations...`,
        });

        for (let j = completedOps.length - 1; j >= 0; j--) {
          const completed = completedOps[j];
          try {
            if (completed.action === "add") {
              await invoke("remove_group_member", {
                memberDn: completed.memberDn,
                groupDn: completed.groupDn,
              });
            } else {
              await invoke("add_user_to_group", {
                userDn: completed.memberDn,
                groupDn: completed.groupDn,
              });
            }
          } catch (rollbackErr) {
            console.warn(`Rollback failed for step ${j}:`, rollbackErr);
          }
        }

        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed at step ${i + 1}. Rolled back ${completedOps.length} operations.`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully completed ${total} operations.`,
    });
    setPlannedChanges([]);
    setSelectedMembers(new Set());

    if (sourceGroups.length > 0) {
      try {
        const refreshed = await invoke<DirectoryEntry[]>("get_group_members", {
          groupDn: sourceGroups[0].distinguishedName,
        });
        setMembers(refreshed);
      } catch {
        // Ignore refresh errors
      }
    }
  }, [plannedChanges, sourceGroups]);

  // ---------------------------------------------------------------------------
  // Export CSV handler
  // ---------------------------------------------------------------------------

  const handleExportCsv = useCallback(async () => {
    if (members.length === 0) return;
    const headers = ["Display Name", "SAM Account Name", "Distinguished Name"];
    const rows = members.map((m) => [
      m.displayName ?? "",
      m.samAccountName ?? "",
      m.distinguishedName,
    ]);
    const csv = formatCsv(headers, rows);
    const groupName =
      sourceGroups.length > 0
        ? sourceGroups[0].name.replace(/[^a-zA-Z0-9]/g, "_")
        : "group";
    await downloadCsv(`${groupName}_members.csv`, csv);
    setProgress({
      current: 1,
      total: 1,
      status: "completed",
      message: `Exported ${members.length} members to CSV.`,
    });
  }, [members, sourceGroups]);

  // ---------------------------------------------------------------------------
  // Copy Memberships handlers
  // ---------------------------------------------------------------------------

  const handleSearchUser = useCallback(
    async (query: string, setter: (u: DirectoryEntry | null) => void) => {
      if (!query.trim()) return;
      try {
        const results = await invoke<DirectoryEntry[]>("search_users", {
          query,
        });
        if (results.length > 0) {
          setter(results[0]);
        }
      } catch (err) {
        console.warn("User search failed:", err);
      }
    },
    [],
  );

  const handleCopyPreview = useCallback(async () => {
    if (!sourceUser || !targetUser) return;
    const sourceUserGroups = sourceUser.attributes?.memberOf ?? [];
    const targetUserGroups = targetUser.attributes?.memberOf ?? [];
    const targetSet = new Set(targetUserGroups);
    const newGroups = sourceUserGroups.filter((g) => !targetSet.has(g));
    setCopyPreviewGroups(newGroups);
    setShowPreview(true);
  }, [sourceUser, targetUser]);

  const handleCopyExecute = useCallback(async () => {
    if (!targetUser || copyPreviewGroups.length === 0) return;
    const total = copyPreviewGroups.length;
    setShowPreview(false);
    setProgress({ current: 0, total, status: "running", message: "Starting..." });

    for (let i = 0; i < total; i++) {
      setProgress({
        current: i,
        total,
        status: "running",
        message: `Adding to group ${i + 1}/${total}...`,
      });
      try {
        await invoke("add_user_to_group", {
          userDn: targetUser.distinguishedName,
          groupDn: copyPreviewGroups[i],
        });
      } catch (err) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed at step ${i + 1}: ${extractErrorMessage(err)}`,
        });
        return;
      }
    }
    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully added ${targetUser.displayName ?? targetUser.samAccountName} to ${total} groups.`,
    });
  }, [targetUser, copyPreviewGroups]);

  // ---------------------------------------------------------------------------
  // Clone Group handler
  // ---------------------------------------------------------------------------

  const handleCloneExecute = useCallback(async () => {
    if (
      sourceGroups.length === 0 ||
      !cloneNewName.trim() ||
      !cloneContainerDn.trim()
    )
      return;

    setProgress({
      current: 0,
      total: 1,
      status: "running",
      message: "Creating group...",
    });

    try {
      const createdDn = await invoke<string>("create_group", {
        name: cloneNewName.trim(),
        containerDn: cloneContainerDn.trim(),
        scope: "Global",
        category: "Security",
        description: `Clone of ${sourceGroups[0].name}`,
      });

      // Add members
      const total = members.length;
      for (let i = 0; i < total; i++) {
        setProgress({
          current: i,
          total: total + 1,
          status: "running",
          message: `Adding member ${i + 1}/${total}...`,
        });
        try {
          await invoke("add_user_to_group", {
            userDn: members[i].distinguishedName,
            groupDn: createdDn,
          });
        } catch (err) {
          console.warn(`Failed to add member ${i}:`, err);
        }
      }

      setProgress({
        current: total + 1,
        total: total + 1,
        status: "completed",
        message: `Group "${cloneNewName}" created with ${total} members.`,
      });
    } catch (err) {
      setProgress({
        current: 0,
        total: 1,
        status: "failed",
        message: `Failed to create group: ${extractErrorMessage(err)}`,
      });
    }
  }, [sourceGroups, cloneNewName, cloneContainerDn, members]);

  // ---------------------------------------------------------------------------
  // Merge Groups handler
  // ---------------------------------------------------------------------------

  const handleMergeExecute = useCallback(async () => {
    if (sourceGroups.length === 0 || targetGroups.length === 0) return;

    setProgress({
      current: 0,
      total: 1,
      status: "running",
      message: "Loading members from all source groups...",
    });

    try {
      // Collect all unique members from all source groups
      const allMemberDns = new Set<string>();
      for (const sg of sourceGroups) {
        const sgMembers = await invoke<DirectoryEntry[]>("get_group_members", {
          groupDn: sg.distinguishedName,
        });
        for (const m of sgMembers) {
          allMemberDns.add(m.distinguishedName);
        }
      }

      // Get existing target members
      const targetMembers = await invoke<DirectoryEntry[]>(
        "get_group_members",
        { groupDn: targetGroups[0].distinguishedName },
      );
      const existingSet = new Set(targetMembers.map((m) => m.distinguishedName));

      const newMembers = Array.from(allMemberDns).filter(
        (dn) => !existingSet.has(dn),
      );

      const total = newMembers.length;
      for (let i = 0; i < total; i++) {
        setProgress({
          current: i,
          total,
          status: "running",
          message: `Adding member ${i + 1}/${total} to ${targetGroups[0].name}...`,
        });
        try {
          await invoke("add_user_to_group", {
            userDn: newMembers[i],
            groupDn: targetGroups[0].distinguishedName,
          });
        } catch (err) {
          console.warn(`Failed to add member:`, err);
        }
      }

      setProgress({
        current: total,
        total,
        status: "completed",
        message: `Merged ${total} new members into ${targetGroups[0].name}.`,
      });
    } catch (err) {
      setProgress({
        current: 0,
        total: 1,
        status: "failed",
        message: `Merge failed: ${extractErrorMessage(err)}`,
      });
    }
  }, [sourceGroups, targetGroups]);

  // ---------------------------------------------------------------------------
  // Import CSV handler
  // ---------------------------------------------------------------------------

  const handleCsvFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === "string") {
          const rows = parseCsvRows(text);
          setCsvData(rows);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleCsvResolve = useCallback(async () => {
    if (csvData.length === 0) return;
    setCsvResolving(true);

    // First row might be header - detect
    const startIdx =
      csvData[0]?.[0]?.toLowerCase() === "samaccountname" ? 1 : 0;
    const resolved: DirectoryEntry[] = [];

    for (let i = startIdx; i < csvData.length; i++) {
      const sam = csvData[i][0];
      if (!sam) continue;
      try {
        const results = await invoke<DirectoryEntry[]>("search_users", {
          query: sam,
        });
        const match = results.find(
          (r) =>
            r.samAccountName?.toLowerCase() === sam.toLowerCase() ||
            r.distinguishedName.toLowerCase().includes(sam.toLowerCase()),
        );
        if (match) {
          resolved.push(match);
        }
      } catch {
        // Skip unresolvable entries
      }
    }

    setCsvResolvedUsers(resolved);
    setCsvResolving(false);
    setShowPreview(true);
  }, [csvData]);

  const handleCsvImportExecute = useCallback(async () => {
    if (csvResolvedUsers.length === 0 || targetGroups.length === 0) return;

    const total = csvResolvedUsers.length;
    setShowPreview(false);
    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Starting import...",
    });

    for (let i = 0; i < total; i++) {
      setProgress({
        current: i,
        total,
        status: "running",
        message: `Adding ${csvResolvedUsers[i].displayName ?? csvResolvedUsers[i].samAccountName} to ${targetGroups[0].name}...`,
      });
      try {
        await invoke("add_user_to_group", {
          userDn: csvResolvedUsers[i].distinguishedName,
          groupDn: targetGroups[0].distinguishedName,
        });
      } catch (err) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed at step ${i + 1}: ${extractErrorMessage(err)}`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully imported ${total} members into ${targetGroups[0].name}.`,
    });
  }, [csvResolvedUsers, targetGroups]);

  // ---------------------------------------------------------------------------
  // Move Groups handler
  // ---------------------------------------------------------------------------

  const handleMoveExecute = useCallback(async () => {
    if (sourceGroups.length === 0 || !moveTargetOu.trim()) return;

    const total = sourceGroups.length;
    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Moving groups...",
    });

    for (let i = 0; i < total; i++) {
      setProgress({
        current: i,
        total,
        status: "running",
        message: `Moving ${sourceGroups[i].name}...`,
      });
      try {
        await invoke("move_object", {
          objectDn: sourceGroups[i].distinguishedName,
          targetContainerDn: moveTargetOu.trim(),
        });
      } catch (err) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed to move ${sourceGroups[i].name}: ${extractErrorMessage(err)}`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully moved ${total} group(s).`,
    });
  }, [sourceGroups, moveTargetOu]);

  // ---------------------------------------------------------------------------
  // Create Groups from CSV handler
  // ---------------------------------------------------------------------------

  const handleCreateGroupsCsvSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === "string") {
          const rows = parseCsvRows(text);
          setCreateGroupsCsvData(rows);
          setShowPreview(true);
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleCreateGroupsExecute = useCallback(async () => {
    if (createGroupsCsvData.length === 0) return;

    // Expected columns: name, description, scope, category, OU
    const startIdx =
      createGroupsCsvData[0]?.[0]?.toLowerCase() === "name" ? 1 : 0;
    const dataRows = createGroupsCsvData.slice(startIdx);
    const total = dataRows.length;

    setShowPreview(false);
    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Creating groups...",
    });

    for (let i = 0; i < total; i++) {
      const row = dataRows[i];
      const name = row[0] ?? "";
      const description = row[1] ?? "";
      const scope = row[2] ?? "Global";
      const category = row[3] ?? "Security";
      const containerDn = row[4] ?? "";

      if (!name || !containerDn) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Row ${i + 1}: missing name or OU.`,
        });
        return;
      }

      setProgress({
        current: i,
        total,
        status: "running",
        message: `Creating "${name}" (${i + 1}/${total})...`,
      });

      try {
        await invoke("create_group", {
          name,
          containerDn,
          scope,
          category,
          description,
        });
      } catch (err) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed to create "${name}": ${extractErrorMessage(err)}`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully created ${total} group(s).`,
    });
  }, [createGroupsCsvData]);

  // ---------------------------------------------------------------------------
  // Update Manager handler
  // ---------------------------------------------------------------------------

  const handleUpdateManagerExecute = useCallback(async () => {
    if (sourceGroups.length === 0 || !selectedManager) return;

    const total = sourceGroups.length;
    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Updating managed-by...",
    });

    for (let i = 0; i < total; i++) {
      setProgress({
        current: i,
        total,
        status: "running",
        message: `Updating ${sourceGroups[i].name}...`,
      });
      try {
        await invoke("update_managed_by", {
          groupDn: sourceGroups[i].distinguishedName,
          managerDn: selectedManager.distinguishedName,
        });
      } catch (err) {
        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed to update ${sourceGroups[i].name}: ${extractErrorMessage(err)}`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Manager updated on ${total} group(s).`,
    });
  }, [sourceGroups, selectedManager]);

  // ---------------------------------------------------------------------------
  // Computed state
  // ---------------------------------------------------------------------------

  const canPreview = useMemo(() => {
    if (!selectedOp) return false;
    if (
      selectedOp === "delete" ||
      selectedOp === "add" ||
      selectedOp === "transfer"
    ) {
      if (selectedMembers.size === 0) return false;
      if (sourceGroups.length === 0) return false;
      if (selectedOp !== "delete" && targetGroups.length === 0) return false;
      return true;
    }
    return false;
  }, [selectedMembers, sourceGroups, targetGroups, selectedOp]);

  const isRunning =
    progress.status === "running" || progress.status === "rolling-back";

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  // ---------------------------------------------------------------------------
  // Render: Operation Picker (no operation selected)
  // ---------------------------------------------------------------------------

  if (!selectedOp) {
    return (
      <div
        className="flex h-full flex-col gap-4 overflow-auto p-4"
        data-testid="bulk-operations"
      >
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Groups Bulk Operations
        </h2>

        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="operation-picker"
        >
          {OPERATION_CARDS.map((card) => {
            const Icon = card.icon;
            const permitted = hasPermission(card.minPermission);
            return (
              <button
                key={card.id}
                onClick={() => setSelectedOp(card.id)}
                disabled={!permitted}
                className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                  permitted
                    ? "border-[var(--color-border-default)] bg-[var(--color-surface-card)] hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-surface-default)] opacity-50 cursor-not-allowed"
                }`}
                data-testid={`op-card-${card.id}`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    size={18}
                    className="text-[var(--color-primary)]"
                  />
                  <span className="text-body font-medium text-[var(--color-text-primary)]">
                    {card.label}
                  </span>
                </div>
                <p className="text-caption text-[var(--color-text-secondary)]">
                  {card.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Operation Panel (after selecting an operation)
  // ---------------------------------------------------------------------------

  const isMemberOp =
    selectedOp === "delete" ||
    selectedOp === "add" ||
    selectedOp === "transfer";
  const canExecute = hasPermission("AccountOperator");

  return (
    <div
      className="flex h-full flex-col gap-4 overflow-auto p-4"
      data-testid="bulk-operations"
    >
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <button
          className="btn btn-sm btn-outline flex items-center gap-1.5"
          onClick={() => setSelectedOp(null)}
          disabled={isRunning}
          data-testid="bulk-back-btn"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {OPERATION_CARDS.find((c) => c.id === selectedOp)?.label ??
            "Bulk Operation"}
        </h2>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Member-based operations: delete, add, transfer                     */}
      {/* ----------------------------------------------------------------- */}
      {isMemberOp && (
        <>
          {/* Operation Type Selector */}
          <div data-testid="operation-type-selector">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Operation Type
            </label>
            <div className="flex gap-1">
              {(["delete", "add", "transfer"] as BulkOperationType[]).map(
                (op) => {
                  const icons: Record<string, typeof Trash2> = {
                    delete: Trash2,
                    add: UserPlus,
                    transfer: ArrowRightLeft,
                  };
                  const labels: Record<string, string> = {
                    delete: "Delete",
                    add: "Add",
                    transfer: "Transfer",
                  };
                  const Icon = icons[op];
                  const isActive = selectedOp === op;
                  return (
                    <button
                      key={op}
                      className={`btn btn-sm flex items-center gap-1.5 ${
                        isActive ? "btn-primary" : "btn-outline"
                      }`}
                      onClick={() => setSelectedOp(op)}
                      disabled={isRunning}
                      data-testid={`op-type-${op}`}
                    >
                      <Icon size={14} />
                      {labels[op]}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          {/* Group Selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div data-testid="source-group-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Source Group
              </label>
              <GroupPicker
                selectedGroups={sourceGroups}
                onSelectionChange={setSourceGroups}
                onSearch={searchGroups}
                placeholder="Search source group..."
                disabled={isRunning}
              />
            </div>
            <div data-testid="target-group-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Target Group
              </label>
              <GroupPicker
                selectedGroups={targetGroups}
                onSelectionChange={setTargetGroups}
                onSearch={searchGroups}
                placeholder="Search target group..."
                disabled={selectedOp === "delete" || isRunning}
              />
            </div>
          </div>

          {/* Member Selection */}
          <MemberList
            members={members}
            membersLoading={membersLoading}
            sourceGroupsEmpty={sourceGroups.length === 0}
            selectedMembers={selectedMembers}
            allSelected={allSelected}
            isRunning={isRunning}
            onMemberSelect={handleMemberSelect}
            onSelectAll={handleSelectAll}
            onExportCsv={handleExportCsv}
          />

          {/* Action Buttons */}
          {canExecute && (
            <div
              className="flex items-center gap-2"
              data-testid="bulk-action-buttons"
            >
              <button
                className="btn btn-outline btn-sm flex items-center gap-1.5"
                onClick={handlePreview}
                disabled={!canPreview || isRunning}
                data-testid="bulk-preview-btn"
              >
                <Eye size={14} />
                Preview
              </button>
              <button
                className="btn btn-primary btn-sm flex items-center gap-1.5"
                onClick={handleExecute}
                disabled={plannedChanges.length === 0 || isRunning}
                data-testid="bulk-execute-btn"
              >
                <Play size={14} />
                Execute
              </button>
            </div>
          )}

          {!canExecute && (
            <p
              className="text-caption text-[var(--color-text-secondary)]"
              data-testid="bulk-no-permission"
            >
              AccountOperator or higher permission required to execute bulk
              operations.
            </p>
          )}
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Export CSV                                                          */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "export-csv" && (
        <>
          <div data-testid="source-group-section">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Select Group to Export
            </label>
            <GroupPicker
              selectedGroups={sourceGroups}
              onSelectionChange={setSourceGroups}
              onSearch={searchGroups}
              placeholder="Search group..."
              disabled={isRunning}
            />
          </div>

          <MemberList
            members={members}
            membersLoading={membersLoading}
            sourceGroupsEmpty={sourceGroups.length === 0}
            selectedMembers={selectedMembers}
            allSelected={allSelected}
            isRunning={isRunning}
            onMemberSelect={handleMemberSelect}
            onSelectAll={handleSelectAll}
          />

          {members.length > 0 && (
            <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
              <button
                className="btn btn-primary btn-sm flex items-center gap-1.5"
                onClick={handleExportCsv}
                disabled={isRunning}
                data-testid="bulk-export-btn"
              >
                <Download size={14} />
                Export to CSV
              </button>
            </div>
          )}
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Copy User Memberships                                              */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "copy-memberships" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div data-testid="source-user-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Source User (copy from)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sourceUserQuery}
                  onChange={(e) => setSourceUserQuery(e.target.value)}
                  placeholder="SAM account name..."
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                  style={{ outline: "none", boxShadow: "none" }}
                  disabled={isRunning}
                  data-testid="copy-source-user-input"
                />
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() =>
                    handleSearchUser(sourceUserQuery, setSourceUser)
                  }
                  disabled={isRunning || !sourceUserQuery.trim()}
                  data-testid="copy-source-user-search"
                >
                  Search
                </button>
              </div>
              {sourceUser && (
                <p className="mt-1 text-caption text-[var(--color-text-secondary)]" data-testid="copy-source-user-result">
                  Found: {sourceUser.displayName ?? sourceUser.samAccountName}
                </p>
              )}
            </div>
            <div data-testid="target-user-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Target User (copy to)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targetUserQuery}
                  onChange={(e) => setTargetUserQuery(e.target.value)}
                  placeholder="SAM account name..."
                  className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                  style={{ outline: "none", boxShadow: "none" }}
                  disabled={isRunning}
                  data-testid="copy-target-user-input"
                />
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() =>
                    handleSearchUser(targetUserQuery, setTargetUser)
                  }
                  disabled={isRunning || !targetUserQuery.trim()}
                  data-testid="copy-target-user-search"
                >
                  Search
                </button>
              </div>
              {targetUser && (
                <p className="mt-1 text-caption text-[var(--color-text-secondary)]" data-testid="copy-target-user-result">
                  Found: {targetUser.displayName ?? targetUser.samAccountName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-outline btn-sm flex items-center gap-1.5"
              onClick={handleCopyPreview}
              disabled={!sourceUser || !targetUser || isRunning}
              data-testid="bulk-preview-btn"
            >
              <Eye size={14} />
              Preview
            </button>
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleCopyExecute}
              disabled={copyPreviewGroups.length === 0 || isRunning}
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Execute
            </button>
          </div>

          {showPreview && copyPreviewGroups.length > 0 && (
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
              data-testid="bulk-preview-panel"
            >
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                Groups to add ({copyPreviewGroups.length})
              </h3>
              <div className="max-h-48 overflow-auto">
                {copyPreviewGroups.map((dn) => (
                  <div
                    key={dn}
                    className="border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0"
                  >
                    <p className="text-body text-[var(--color-text-primary)]">
                      {parseCnFromDn(dn)}
                    </p>
                    <p className="text-caption text-[var(--color-text-secondary)]">
                      {dn}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showPreview && copyPreviewGroups.length === 0 && (
            <p className="text-caption text-[var(--color-text-secondary)]">
              Target user is already a member of all source user groups.
            </p>
          )}
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Clone Group                                                        */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "clone-group" && (
        <>
          <div data-testid="source-group-section">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Source Group
            </label>
            <GroupPicker
              selectedGroups={sourceGroups}
              onSelectionChange={setSourceGroups}
              onSearch={searchGroups}
              placeholder="Search source group..."
              disabled={isRunning}
            />
          </div>

          {members.length > 0 && (
            <p className="text-caption text-[var(--color-text-secondary)]">
              {members.length} members will be copied to the new group.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                New Group Name
              </label>
              <input
                type="text"
                value={cloneNewName}
                onChange={(e) => setCloneNewName(e.target.value)}
                placeholder="e.g. IT-Team-Copy"
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                style={{ outline: "none", boxShadow: "none" }}
                disabled={isRunning}
                data-testid="clone-name-input"
              />
            </div>
            <div>
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Target OU (DN)
              </label>
              <input
                type="text"
                value={cloneContainerDn}
                onChange={(e) => setCloneContainerDn(e.target.value)}
                placeholder="e.g. OU=Groups,DC=example,DC=com"
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                style={{ outline: "none", boxShadow: "none" }}
                disabled={isRunning}
                data-testid="clone-container-input"
              />
            </div>
          </div>

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleCloneExecute}
              disabled={
                sourceGroups.length === 0 ||
                !cloneNewName.trim() ||
                !cloneContainerDn.trim() ||
                isRunning
              }
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Clone Group
            </button>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Merge Groups                                                       */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "merge-groups" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div data-testid="source-group-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Source Groups (merge from)
              </label>
              <GroupPicker
                selectedGroups={sourceGroups}
                onSelectionChange={setSourceGroups}
                onSearch={searchGroups}
                placeholder="Search source groups..."
                disabled={isRunning}
              />
            </div>
            <div data-testid="target-group-section">
              <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
                Target Group (surviving)
              </label>
              <GroupPicker
                selectedGroups={targetGroups}
                onSelectionChange={setTargetGroups}
                onSearch={searchGroups}
                placeholder="Search target group..."
                disabled={isRunning}
              />
            </div>
          </div>

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleMergeExecute}
              disabled={
                sourceGroups.length === 0 ||
                targetGroups.length === 0 ||
                isRunning
              }
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Merge
            </button>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Import CSV                                                         */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "import-csv" && (
        <>
          <div data-testid="target-group-section">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Target Group
            </label>
            <GroupPicker
              selectedGroups={targetGroups}
              onSelectionChange={setTargetGroups}
              onSearch={searchGroups}
              placeholder="Search target group..."
              disabled={isRunning}
            />
          </div>

          <div>
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              CSV File (column: samAccountName or DN)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvFileSelect}
              disabled={isRunning}
              className="text-body text-[var(--color-text-primary)]"
              data-testid="csv-file-input"
            />
          </div>

          {csvData.length > 0 && (
            <p className="text-caption text-[var(--color-text-secondary)]">
              {csvData.length} rows loaded from CSV.
            </p>
          )}

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-outline btn-sm flex items-center gap-1.5"
              onClick={handleCsvResolve}
              disabled={csvData.length === 0 || csvResolving || isRunning}
              data-testid="bulk-preview-btn"
            >
              {csvResolving ? <LoadingSpinner size={14} /> : <Eye size={14} />}
              Resolve & Preview
            </button>
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleCsvImportExecute}
              disabled={
                csvResolvedUsers.length === 0 ||
                targetGroups.length === 0 ||
                isRunning
              }
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Import
            </button>
          </div>

          {showPreview && csvResolvedUsers.length > 0 && (
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
              data-testid="bulk-preview-panel"
            >
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                Resolved Users ({csvResolvedUsers.length})
              </h3>
              <div className="max-h-48 overflow-auto">
                {csvResolvedUsers.map((u) => (
                  <div
                    key={u.distinguishedName}
                    className="border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0"
                  >
                    <p className="text-body text-[var(--color-text-primary)]">
                      {u.displayName ?? u.samAccountName}
                    </p>
                    <p className="text-caption text-[var(--color-text-secondary)]">
                      {u.samAccountName}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Move Groups                                                        */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "move-groups" && (
        <>
          <div data-testid="source-group-section">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Groups to Move
            </label>
            <GroupPicker
              selectedGroups={sourceGroups}
              onSelectionChange={setSourceGroups}
              onSearch={searchGroups}
              placeholder="Search groups..."
              disabled={isRunning}
            />
          </div>

          <div>
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Target OU (DN)
            </label>
            <input
              type="text"
              value={moveTargetOu}
              onChange={(e) => setMoveTargetOu(e.target.value)}
              placeholder="e.g. OU=Groups,DC=example,DC=com"
              className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
              style={{ outline: "none", boxShadow: "none" }}
              disabled={isRunning}
              data-testid="move-target-ou-input"
            />
          </div>

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleMoveExecute}
              disabled={
                sourceGroups.length === 0 ||
                !moveTargetOu.trim() ||
                isRunning
              }
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Move
            </button>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create Groups from CSV                                             */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "create-groups" && (
        <>
          <div>
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              CSV File (columns: name, description, scope, category, OU)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleCreateGroupsCsvSelect}
              disabled={isRunning}
              className="text-body text-[var(--color-text-primary)]"
              data-testid="create-groups-csv-input"
            />
          </div>

          {showPreview && createGroupsCsvData.length > 0 && (
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
              data-testid="bulk-preview-panel"
            >
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                Groups to Create (
                {createGroupsCsvData[0]?.[0]?.toLowerCase() === "name"
                  ? createGroupsCsvData.length - 1
                  : createGroupsCsvData.length}
                )
              </h3>
              <div className="max-h-48 overflow-auto">
                {createGroupsCsvData
                  .slice(
                    createGroupsCsvData[0]?.[0]?.toLowerCase() === "name"
                      ? 1
                      : 0,
                  )
                  .map((row, idx) => (
                    <div
                      key={idx}
                      className="border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0"
                    >
                      <p className="text-body text-[var(--color-text-primary)]">
                        {row[0]}
                      </p>
                      <p className="text-caption text-[var(--color-text-secondary)]">
                        {row[2] ?? "Global"} / {row[3] ?? "Security"} in{" "}
                        {row[4] ?? "N/A"}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleCreateGroupsExecute}
              disabled={createGroupsCsvData.length === 0 || isRunning}
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Create Groups
            </button>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Update Manager                                                     */}
      {/* ----------------------------------------------------------------- */}
      {selectedOp === "update-manager" && (
        <>
          <div data-testid="source-group-section">
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              Groups to Update
            </label>
            <GroupPicker
              selectedGroups={sourceGroups}
              onSelectionChange={setSourceGroups}
              onSearch={searchGroups}
              placeholder="Search groups..."
              disabled={isRunning}
            />
          </div>

          <div>
            <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
              New Manager
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={managerQuery}
                onChange={(e) => setManagerQuery(e.target.value)}
                placeholder="SAM account name..."
                className="flex-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
                style={{ outline: "none", boxShadow: "none" }}
                disabled={isRunning}
                data-testid="manager-user-input"
              />
              <button
                className="btn btn-sm btn-outline"
                onClick={() =>
                  handleSearchUser(managerQuery, setSelectedManager)
                }
                disabled={isRunning || !managerQuery.trim()}
                data-testid="manager-user-search"
              >
                Search
              </button>
            </div>
            {selectedManager && (
              <p className="mt-1 text-caption text-[var(--color-text-secondary)]" data-testid="manager-user-result">
                Found:{" "}
                {selectedManager.displayName ?? selectedManager.samAccountName}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2" data-testid="bulk-action-buttons">
            <button
              className="btn btn-primary btn-sm flex items-center gap-1.5"
              onClick={handleUpdateManagerExecute}
              disabled={
                sourceGroups.length === 0 || !selectedManager || isRunning
              }
              data-testid="bulk-execute-btn"
            >
              <Play size={14} />
              Update Manager
            </button>
          </div>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Shared: Preview Dialog for member-based operations                  */}
      {/* ----------------------------------------------------------------- */}
      {isMemberOp && showPreview && plannedChanges.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="bulk-preview-panel"
        >
          <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
            Planned Changes ({plannedChanges.length})
          </h3>
          <div className="max-h-48 overflow-auto">
            {plannedChanges.map((change, index) => (
              <div
                key={`${change.action}-${change.memberDn}-${change.groupDn}`}
                className="flex items-start gap-2 border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0"
                data-testid={`planned-change-${index}`}
              >
                <span
                  className={`mt-0.5 shrink-0 text-caption font-medium ${
                    change.action === "add"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-error)]"
                  }`}
                >
                  {change.action === "add" ? "ADD" : "REMOVE"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body text-[var(--color-text-primary)]">
                    {change.memberName}
                  </p>
                  <p className="text-caption text-[var(--color-text-secondary)]">
                    {change.action === "add" ? "to" : "from"} {change.groupName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Shared: Progress Indicator                                         */}
      {/* ----------------------------------------------------------------- */}
      {progress.status !== "idle" && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="bulk-progress"
        >
          <div className="mb-2 flex items-center gap-2">
            {progress.status === "running" && <LoadingSpinner size={16} />}
            {progress.status === "completed" && (
              <CheckCircle size={16} className="text-[var(--color-success)]" />
            )}
            {progress.status === "failed" && (
              <AlertCircle size={16} className="text-[var(--color-error)]" />
            )}
            {progress.status === "rolling-back" && (
              <RotateCcw
                size={16}
                className="animate-spin text-[var(--color-warning)]"
              />
            )}
            <span className="text-body text-[var(--color-text-primary)]">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
            <div
              className={`h-full rounded-full transition-all ${
                progress.status === "failed"
                  ? "bg-[var(--color-error)]"
                  : progress.status === "rolling-back"
                    ? "bg-[var(--color-warning)]"
                    : "bg-[var(--color-primary)]"
              }`}
              style={{ width: `${progressPercent}%` }}
              data-testid="bulk-progress-bar"
            />
          </div>
          <p
            className="text-caption text-[var(--color-text-secondary)]"
            data-testid="bulk-progress-message"
          >
            {progress.message}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemberList sub-component
// ---------------------------------------------------------------------------

interface MemberListProps {
  members: DirectoryEntry[];
  membersLoading: boolean;
  sourceGroupsEmpty: boolean;
  selectedMembers: Set<string>;
  allSelected: boolean;
  isRunning: boolean;
  onMemberSelect: (dn: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onExportCsv?: () => void;
}

function MemberList({
  members,
  membersLoading,
  sourceGroupsEmpty,
  selectedMembers,
  allSelected,
  isRunning,
  onMemberSelect,
  onSelectAll,
  onExportCsv,
}: MemberListProps) {
  return (
    <div data-testid="member-selection-section">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-caption font-medium text-[var(--color-text-secondary)]">
          Members{members.length > 0 ? ` (${members.length})` : ""}
        </label>
        <div className="flex items-center gap-2">
          {members.length > 0 && onExportCsv && (
            <button
              className="btn btn-sm btn-outline flex items-center gap-1"
              onClick={onExportCsv}
              disabled={isRunning}
              data-testid="member-export-csv-btn"
            >
              <Download size={12} />
              CSV
            </button>
          )}
          {members.length > 0 && (
            <span className="text-caption text-[var(--color-text-secondary)]">
              {selectedMembers.size} selected
            </span>
          )}
        </div>
      </div>

      {membersLoading && <LoadingSpinner message="Loading members..." />}

      {!membersLoading && sourceGroupsEmpty && (
        <p className="text-caption text-[var(--color-text-secondary)]">
          Select a source group to load members
        </p>
      )}

      {!membersLoading && !sourceGroupsEmpty && members.length === 0 && (
        <p className="text-caption text-[var(--color-text-secondary)]">
          No members in selected group
        </p>
      )}

      {!membersLoading && members.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border-default)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-hover)] px-3 py-1.5">
            <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onSelectAll(e.target.checked)}
                disabled={isRunning}
                data-testid="bulk-select-all"
              />
              <CheckSquare size={14} />
              Select all
            </label>
          </div>
          <div className="max-h-60 overflow-auto" data-testid="member-list">
            {members.map((member) => {
              const name =
                member.displayName ??
                member.samAccountName ??
                parseCnFromDn(member.distinguishedName);
              const isSelected = selectedMembers.has(
                member.distinguishedName,
              );
              return (
                <label
                  key={member.distinguishedName}
                  className={`flex cursor-pointer items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 last:border-b-0 transition-colors hover:bg-[var(--color-surface-hover)] ${
                    isSelected ? "bg-[var(--color-primary-subtle)]" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) =>
                      onMemberSelect(
                        member.distinguishedName,
                        e.target.checked,
                      )
                    }
                    disabled={isRunning}
                    data-testid={`bulk-member-${name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-[var(--color-text-primary)]">
                      {name}
                    </p>
                    <p className="truncate text-caption text-[var(--color-text-secondary)]">
                      {member.samAccountName}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
