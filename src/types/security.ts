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
  kerberoastable: boolean;
  asrepRoastable: boolean;
  reversibleEncryption: boolean;
  desOnly: boolean;
  constrainedDelegationTransition: boolean;
  hasSidHistory: boolean;
  isServiceAccount: boolean;
  inProtectedUsers: boolean;
  adminCountOrphaned: boolean;
  alerts: SecurityAlert[];
}

export interface DomainSecurityFindings {
  krbtgtPasswordAgeDays: number | null;
  lapsCoveragePercent: number | null;
  lapsDeployedCount: number;
  totalComputerCount: number;
  psoCount: number;
  domainFunctionalLevel: string | null;
  forestFunctionalLevel: string | null;
  ldapSigningEnforced: boolean | null;
  recycleBinEnabled: boolean | null;
  rbcdConfiguredCount: number;
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
  domainFindings: DomainSecurityFindings;
  summary: AlertSummary;
  scannedAt: string;
}

// Story 9.2: Domain Risk Score

export interface RiskFactor {
  id: string;
  name: string;
  score: number;
  weight: number;
  explanation: string;
  recommendations: string[];
}

export type RiskZone = "Red" | "Orange" | "Green";

export interface RiskScoreResult {
  totalScore: number;
  zone: RiskZone;
  factors: RiskFactor[];
  computedAt: string;
}

export interface RiskScoreHistory {
  date: string;
  totalScore: number;
}

// Story 9.3: Attack Detection

export type AttackType = "GoldenTicket" | "DCSync" | "DCShadow" | "AbnormalKerberos" | "PasswordSpray" | "PrivGroupChange";

export interface AttackAlert {
  attackType: AttackType;
  severity: AlertSeverity;
  timestamp: string;
  source: string;
  description: string;
  recommendation: string;
  eventId: number | null;
}

export interface AttackDetectionReport {
  alerts: AttackAlert[];
  timeWindowHours: number;
  scannedAt: string;
}

// Story 9.4: Escalation Paths

export type NodeType = "User" | "Group";
export type EdgeType = "Membership" | "Ownership" | "Delegation";

export interface GraphNode {
  dn: string;
  displayName: string;
  nodeType: NodeType;
  isPrivileged: boolean;
}

export interface GraphEdge {
  sourceDn: string;
  targetDn: string;
  edgeType: EdgeType;
}

export interface EscalationPath {
  nodes: string[];
  hopCount: number;
  isCritical: boolean;
}

export interface EscalationGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalPaths: EscalationPath[];
  computedAt: string;
}
