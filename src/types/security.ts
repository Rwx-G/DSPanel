export type AlertSeverity = "Critical" | "High" | "Medium" | "Info";

export interface SecurityAlert {
  severity: AlertSeverity;
  message: string;
  alertType: string;
}

export interface PrivilegedAccountInfo {
  distinguishedName: string;
  samAccountName: string;
  displayName: string;
  privilegedGroups: string[];
  lastLogon: string | null;
  passwordAgeDays: number | null;
  passwordExpiryDate: string | null;
  enabled: boolean;
  passwordNeverExpires: boolean;
  alerts: SecurityAlert[];
}

export interface AlertSummary {
  critical: number;
  high: number;
  medium: number;
  info: number;
}

export interface PrivilegedAccountsReport {
  accounts: PrivilegedAccountInfo[];
  summary: AlertSummary;
  scannedAt: string;
}
