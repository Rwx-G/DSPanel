export interface AttributeMetadata {
  attributeName: string;
  version: number;
  lastOriginatingChangeTime: string;
  lastOriginatingDsaDn: string;
  localUsn: number;
  originatingUsn: number;
}

export interface ReplicationMetadataResult {
  objectDn: string;
  attributes: AttributeMetadata[];
  isAvailable: boolean;
  message: string | null;
}

export interface AttributeChangeDiff {
  attributeName: string;
  versionBefore: number;
  versionAfter: number;
  changeTime: string;
}
