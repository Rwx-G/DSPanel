export type HealthLevel = "Healthy" | "Info" | "Warning" | "Critical";

export interface HealthFlag {
  name: string;
  severity: HealthLevel;
  description: string;
}

export interface AccountHealthStatus {
  level: HealthLevel;
  activeFlags: HealthFlag[];
}
