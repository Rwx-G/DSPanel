import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import { type DirectoryComputer } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";

export function ComputerDetail({ computer }: { computer: DirectoryComputer }) {
  const [groupFilterText, setGroupFilterText] = useState("");
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [resolvedAddresses, setResolvedAddresses] = useState<string[]>([]);
  const [isResolvingDns, setIsResolvingDns] = useState(false);
  const dnsCacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!computer.dnsHostName) {
      setResolvedAddresses([]);
      setPingResult(null);
      return;
    }

    const cached = dnsCacheRef.current.get(computer.dnsHostName);
    if (cached) {
      setResolvedAddresses(cached);
      setPingResult(null);
      return;
    }

    setIsResolvingDns(true);
    setResolvedAddresses([]);
    setPingResult(null);

    invoke<string[]>("resolve_dns", { hostname: computer.dnsHostName })
      .then((addrs) => {
        dnsCacheRef.current.set(computer.dnsHostName!, addrs);
        setResolvedAddresses(addrs);
      })
      .catch(() => setResolvedAddresses(["DNS resolution failed"]))
      .finally(() => setIsResolvingDns(false));
  }, [computer.dnsHostName]);

  const handlePing = async () => {
    if (!computer.dnsHostName) return;
    setIsPinging(true);
    try {
      const result = await invoke<string>("ping_host", {
        hostname: computer.dnsHostName,
      });
      setPingResult(result);
    } catch {
      setPingResult("Unreachable (ping failed)");
    } finally {
      setIsPinging(false);
    }
  };

  const filteredGroups = computer.memberOf.filter((dn) =>
    parseCnFromDn(dn).toLowerCase().includes(groupFilterText.toLowerCase()),
  );

  const groupColumns: Column<{ name: string; dn: string }>[] = [
    { key: "name", header: "Group Name", sortable: true },
    { key: "dn", header: "Distinguished Name", sortable: true },
  ];

  const groupRows = filteredGroups.map((dn) => ({
    name: parseCnFromDn(dn),
    dn,
  }));

  const propertyGroups: PropertyGroup[] = [
    {
      category: "Identity",
      items: [
        { label: "Computer Name", value: computer.name },
        { label: "DNS Hostname", value: computer.dnsHostName },
        { label: "Operating System", value: computer.operatingSystem },
        { label: "OS Version", value: computer.osVersion },
      ],
    },
    {
      category: "Status",
      items: [
        {
          label: "Account Status",
          value: computer.enabled ? "Enabled" : "Disabled",
        },
        { label: "Last Logon", value: computer.lastLogon ?? "Never" },
      ],
    },
    {
      category: "Location",
      items: [
        { label: "OU Path", value: computer.organizationalUnit },
        {
          label: "Distinguished Name",
          value: computer.distinguishedName,
        },
      ],
    },
    {
      category: "Network",
      items: [
        {
          label: "IP Address(es)",
          value: isResolvingDns
            ? "Resolving..."
            : resolvedAddresses.length > 0
              ? resolvedAddresses.join(", ")
              : "N/A",
        },
        { label: "Ping", value: pingResult ?? "Not tested" },
      ],
    },
  ];

  return (
    <div className="space-y-4" data-testid="computer-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {computer.name}
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge
            text={computer.enabled ? "Enabled" : "Disabled"}
            variant={computer.enabled ? "success" : "error"}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{computer.dnsHostName}</span>
        {computer.dnsHostName && <CopyButton text={computer.dnsHostName} />}
      </div>

      <PropertyGrid groups={propertyGroups} />

      <div className="flex gap-2">
        <button
          className="btn-secondary"
          onClick={handlePing}
          disabled={isPinging || !computer.dnsHostName}
          data-testid="ping-button"
        >
          {isPinging ? "Pinging..." : "Ping"}
        </button>
        {pingResult && (
          <span
            className={`text-caption ${
              pingResult.startsWith("Reachable")
                ? "text-[var(--color-success)]"
                : "text-[var(--color-error)]"
            }`}
            data-testid="ping-result"
          >
            {pingResult}
          </span>
        )}
      </div>

      <div data-testid="computer-groups-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Group Memberships ({computer.memberOf.length})
        </h3>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={setGroupFilterText}
          placeholder="Filter groups..."
        />
        <DataTable
          columns={groupColumns}
          data={groupRows}
          rowKey={(row) => row.dn}
        />
      </div>
    </div>
  );
}
