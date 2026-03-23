export interface TopologyDcNode {
  hostname: string;
  siteName: string;
  isGc: boolean;
  isPdc: boolean;
  ipAddress: string | null;
  osVersion: string | null;
  fsmoRoles: string[];
  isOnline: boolean;
}

export interface TopologyReplicationLink {
  sourceDc: string;
  targetDc: string;
  status: string;
  lastSyncTime: string | null;
  errorCount: number;
}

export interface TopologySiteLink {
  name: string;
  sites: string[];
  cost: number;
  replInterval: number;
}

export interface SiteNode {
  name: string;
  location: string | null;
  dcs: TopologyDcNode[];
  subnets: string[];
}

export interface TopologyData {
  sites: SiteNode[];
  replicationLinks: TopologyReplicationLink[];
  siteLinks: TopologySiteLink[];
}
