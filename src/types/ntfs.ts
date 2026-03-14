export type AceAccessType = "Allow" | "Deny";

export type AccessIndicator = "Allowed" | "NoMatch" | "Denied";

export interface AceEntry {
  trusteeSid: string;
  trusteeDisplayName: string;
  accessType: AceAccessType;
  permissions: string[];
  isInherited: boolean;
}

export interface NtfsAuditResult {
  path: string;
  aces: AceEntry[];
  errors: string[];
}

export interface AceCrossReference {
  ace: AceEntry;
  userAAccess: AccessIndicator;
  userBAccess: AccessIndicator;
}
