export interface DiskInfo {
  deviceId: string;
  totalGb: number;
  freeGb: number;
  usedPercent: number;
}

export interface ServiceInfo {
  name: string;
  displayName: string;
  state: string;
  startMode: string;
}

export interface SessionInfo {
  username: string;
  logonTime: string | null;
}

export interface SystemMetrics {
  cpuUsagePercent: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  disks: DiskInfo[];
  services: ServiceInfo[];
  sessions: SessionInfo[];
  timestamp: string;
  errorMessage: string | null;
}
