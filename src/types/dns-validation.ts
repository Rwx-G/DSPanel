export type DnsRecordStatus = "Pass" | "Fail" | "Warning";
export type ClockSkewStatus = "Ok" | "Warning" | "Critical";

export interface DnsValidationResult {
  recordName: string;
  expectedHosts: string[];
  actualHosts: string[];
  missingHosts: string[];
  extraHosts: string[];
  status: DnsRecordStatus;
}

export interface ClockSkewResult {
  dcHostname: string;
  dcTime: string;
  localTime: string;
  skewSeconds: number;
  status: ClockSkewStatus;
}

export interface DnsKerberosReport {
  dnsResults: DnsValidationResult[];
  clockSkewResults: ClockSkewResult[];
  checkedAt: string;
}
