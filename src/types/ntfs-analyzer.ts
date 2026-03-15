import { type AceEntry } from "./ntfs";

export interface PathAclResult {
  path: string;
  aces: AceEntry[];
  error: string | null;
}

export interface AclConflict {
  trusteeSid: string;
  trusteeDisplayName: string;
  allowPath: string;
  denyPath: string;
  allowPermissions: string[];
  denyPermissions: string[];
}

export interface NtfsAnalysisResult {
  paths: PathAclResult[];
  conflicts: AclConflict[];
  totalAces: number;
  totalPathsScanned: number;
  totalErrors: number;
}
