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

export interface RiskFinding {
  id: string;
  description: string;
  severity: AlertSeverity;
  pointsDeducted: number;
  remediation: string;
  complexity: "Easy" | "Medium" | "Hard";
  frameworkRef: string | null;
}

export type RemediationComplexity = "Easy" | "Medium" | "Hard";

export interface RiskFactor {
  id: string;
  name: string;
  score: number;
  weight: number;
  explanation: string;
  recommendations: string[];
  findings: RiskFinding[];
  impactIfFixed: number;
}

export type RiskZone = "Red" | "Orange" | "Green";

export interface RiskScoreResult {
  totalScore: number;
  zone: RiskZone;
  worstFactorName: string;
  worstFactorScore: number;
  factors: RiskFactor[];
  computedAt: string;
}

export interface RiskScoreHistory {
  date: string;
  totalScore: number;
}

// Story 9.3: Attack Detection

export type AttackType =
  | "GoldenTicket"
  | "DCSync"
  | "DCShadow"
  | "AbnormalKerberos"
  | "PasswordSpray"
  | "PrivGroupChange"
  | "Kerberoasting"
  | "AsrepRoasting"
  | "BruteForce"
  | "PassTheHash"
  | "ShadowCredentials"
  | "RbcdAbuse"
  | "AdminSdHolderTamper"
  | "SuspiciousAccountActivity";

export interface AttackAlert {
  attackType: AttackType;
  severity: AlertSeverity;
  timestamp: string;
  source: string;
  description: string;
  recommendation: string;
  eventId: number | null;
  mitreRef: string | null;
}

export interface AttackDetectionReport {
  alerts: AttackAlert[];
  timeWindowHours: number;
  scannedAt: string;
}

export interface AttackDetectionConfig {
  bruteForceThreshold: number;
  kerberoastingThreshold: number;
  excludedIps: string[];
  excludedAccounts: string[];
}

// Story 9.4: Escalation Paths

export type NodeType = "User" | "Group" | "Computer" | "GPO" | "CertTemplate";
export type EdgeType =
  | "Membership"
  | "Ownership"
  | "Delegation"
  | "UnconstrainedDeleg"
  | "RBCD"
  | "SIDHistory"
  | "GPLink"
  | "CertESC";

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
  label: string | null;
}

export interface EscalationPath {
  nodes: string[];
  hopCount: number;
  isCritical: boolean;
  riskScore: number;
  edgeTypes: string[];
}

export interface EscalationGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalPaths: EscalationPath[];
  computedAt: string;
}
