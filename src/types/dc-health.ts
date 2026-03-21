export type DcHealthLevel = "Healthy" | "Warning" | "Critical" | "Unknown";

export interface DomainControllerInfo {
  hostname: string;
  siteName: string;
  isGlobalCatalog: boolean;
  serverDn: string;
}

export interface DcHealthCheck {
  name: string;
  status: DcHealthLevel;
  message: string;
  value: string | null;
}

export interface DcHealthResult {
  dc: DomainControllerInfo;
  overallStatus: DcHealthLevel;
  checks: DcHealthCheck[];
  checkedAt: string;
}
