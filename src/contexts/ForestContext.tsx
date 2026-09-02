import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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

  const wasConnected = useRef(connected);
  useEffect(() => {
    // Only a false -> true transition (login prompt, reconnect) re-fetches;
    // the mount fetch above already covers the initial state.
    if (connected && !wasConnected.current) {
      void refresh();
    }
    wasConnected.current = connected;
  }, [refresh, connected]);

  useEffect(() => {
    // The backend emits this once the forest is (re)assembled in the
    // background, so the event carries fresh partition states and signals
    // that the topology itself may have grown. The initial read waits for
    // the subscription to be armed: a promotion landing in between would
    // otherwise be missed for the whole session. A rejected subscription is
    // tolerated: every partition then stays reported as connected.
    let active = true;
    const subscription = listen<PartitionStatusMap>(
      FOREST_STATUS_EVENT,
      (event) => {
        setReportedStatus(event.payload ?? {});
        void refresh();
      },
    ).catch((e) => {
      console.warn("Forest status subscription unavailable:", e);
      return () => {};
    });
    void subscription.then(() => {
      if (active) {
        void refresh();
      }
    });
    return () => {
      active = false;
      subscription.then((fn) => fn());
    };
  }, [refresh]);

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
