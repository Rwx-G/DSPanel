/**
 * Forest topology types mirrored from `src-tauri/src/services/forest.rs`.
 *
 * `get_forest_topology` returns the partitions discovered at connect time,
 * seed partition first. `forest-status-changed` (Story 15.6) pushes the
 * per-partition connection state; until that event fires every partition is
 * treated as connected.
 */

export interface DomainPartition {
  distinguishedName: string;
  dnsName: string;
  netbiosName: string | null;
  defaultDcFqdn: string | null;
}

export interface ForestTopology {
  partitions: DomainPartition[];
}

export type PartitionConnectionStatus =
  | { state: "connected" }
  | { state: "reconnecting" }
  | { state: "unreachable"; reason: string };

export type PartitionStatusMap = Record<string, PartitionConnectionStatus>;

export const EMPTY_FOREST_TOPOLOGY: ForestTopology = { partitions: [] };

export const CONNECTED_STATUS: PartitionConnectionStatus = {
  state: "connected",
};

/**
 * Single-domain rule shared by stories 15.2, 15.4 and 15.6: the Domain
 * column, the partition badge and the forest banner are hidden when the
 * forest exposes at most one partition (an empty topology counts as single).
 */
export function isSingleDomainForest(topology: ForestTopology): boolean {
  return topology.partitions.length <= 1;
}
