import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CONNECTED_STATUS,
  EMPTY_FOREST_TOPOLOGY,
  isSingleDomainForest,
  type ForestTopology,
  type PartitionStatusMap,
} from "@/types/forest";

export const FOREST_STATUS_EVENT = "forest-status-changed";

interface ForestState {
  forestTopology: ForestTopology;
  /** Connection state per partition DNS name. Defaults every partition to connected. */
  partitionStatus: PartitionStatusMap;
  /** Single source of truth for hiding multi-domain UI affordances. */
  isSingleDomainForest: boolean;
  /** DNS name of the operator's own partition (first topology entry). */
  seedDnsName: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ForestContext = createContext<ForestState | null>(null);

export function useForest(): ForestState {
  const ctx = useContext(ForestContext);
  if (!ctx) {
    throw new Error("useForest must be used within ForestProvider");
  }
  return ctx;
}

interface ForestProviderProps {
  children: ReactNode;
  /**
   * Connection flag of the seed partition. The topology is re-fetched each
   * time it flips, so a late login or reconnect refreshes the partition list.
   */
  connected?: boolean;
}

export function ForestProvider({
  children,
  connected = false,
}: ForestProviderProps) {
  const [forestTopology, setForestTopology] = useState<ForestTopology>(
    EMPTY_FOREST_TOPOLOGY,
  );
  const [reportedStatus, setReportedStatus] = useState<PartitionStatusMap>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const topology = await invoke<ForestTopology | undefined>(
        "get_forest_topology",
      );
      setForestTopology(
        topology && Array.isArray(topology.partitions)
          ? topology
          : EMPTY_FOREST_TOPOLOGY,
      );
    } catch (e) {
      console.warn("Failed to load forest topology:", e);
      setForestTopology(EMPTY_FOREST_TOPOLOGY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, connected]);

  useEffect(() => {
    // The event ships with Story 15.6. Until then no event arrives and every
    // partition stays reported as connected; a rejected subscription is
    // tolerated for the same reason.
    const unlisten = listen<PartitionStatusMap>(
      FOREST_STATUS_EVENT,
      (event) => {
        setReportedStatus(event.payload ?? {});
      },
    ).catch((e) => {
      console.warn("Forest status subscription unavailable:", e);
      return () => {};
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const partitionStatus = useMemo<PartitionStatusMap>(() => {
    const status: PartitionStatusMap = {};
    for (const partition of forestTopology.partitions) {
      status[partition.dnsName] =
        reportedStatus[partition.dnsName] ?? CONNECTED_STATUS;
    }
    return status;
  }, [forestTopology, reportedStatus]);

  const value = useMemo<ForestState>(
    () => ({
      forestTopology,
      partitionStatus,
      isSingleDomainForest: isSingleDomainForest(forestTopology),
      seedDnsName: forestTopology.partitions[0]?.dnsName ?? null,
      loading,
      refresh,
    }),
    [forestTopology, partitionStatus, loading, refresh],
  );

  return (
    <ForestContext.Provider value={value}>{children}</ForestContext.Provider>
  );
}
