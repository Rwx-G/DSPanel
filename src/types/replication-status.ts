export type ReplicationPartnershipStatus =
  | "Healthy"
  | "Warning"
  | "Failed"
  | "Unknown";

export interface ReplicationPartnership {
  sourceDc: string;
  targetDc: string;
  namingContext: string;
  lastSyncTime: string | null;
  lastSyncResult: number;
  consecutiveFailures: number;
  lastSyncMessage: string | null;
  status: ReplicationPartnershipStatus;
  usnLastObjChangeSynced?: number | null;
  lastSyncAttempt?: string | null;
  transport?: string | null;
  replicaFlags?: number | null;
}
