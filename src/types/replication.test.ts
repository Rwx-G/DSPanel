import { describe, it, expect } from "vitest";
import type {
  AttributeMetadata,
  ReplicationMetadataResult,
  AttributeChangeDiff,
} from "./replication";

describe("replication types", () => {
  it("AttributeMetadata can be constructed", () => {
    const meta: AttributeMetadata = {
      attributeName: "displayName",
      version: 3,
      lastOriginatingChangeTime: "2026-02-15T14:30:00Z",
      lastOriginatingDsaDn: "CN=DC1,DC=example,DC=com",
      localUsn: 67890,
      originatingUsn: 12345,
    };
    expect(meta.attributeName).toBe("displayName");
    expect(meta.version).toBe(3);
    expect(meta.localUsn).toBe(67890);
  });

  it("ReplicationMetadataResult available", () => {
    const result: ReplicationMetadataResult = {
      objectDn: "CN=Test,DC=example,DC=com",
      attributes: [
        {
          attributeName: "sn",
          version: 1,
          lastOriginatingChangeTime: "2026-01-01T00:00:00Z",
          lastOriginatingDsaDn: "",
          localUsn: 0,
          originatingUsn: 0,
        },
      ],
      isAvailable: true,
      message: null,
    };
    expect(result.isAvailable).toBe(true);
    expect(result.attributes).toHaveLength(1);
  });

  it("ReplicationMetadataResult not available", () => {
    const result: ReplicationMetadataResult = {
      objectDn: "CN=Test,DC=example,DC=com",
      attributes: [],
      isAvailable: false,
      message: "Metadata not available",
    };
    expect(result.isAvailable).toBe(false);
    expect(result.message).toBe("Metadata not available");
  });

  it("AttributeChangeDiff can be constructed", () => {
    const diff: AttributeChangeDiff = {
      attributeName: "title",
      versionBefore: 4,
      versionAfter: 5,
      changeTime: "2026-03-01T08:00:00Z",
    };
    expect(diff.attributeName).toBe("title");
    expect(diff.versionBefore).toBe(4);
    expect(diff.versionAfter).toBe(5);
  });

  it("AttributeMetadata with empty values", () => {
    const meta: AttributeMetadata = {
      attributeName: "unknown",
      version: 0,
      lastOriginatingChangeTime: "",
      lastOriginatingDsaDn: "",
      localUsn: 0,
      originatingUsn: 0,
    };
    expect(meta.lastOriginatingChangeTime).toBe("");
    expect(meta.version).toBe(0);
  });
});
