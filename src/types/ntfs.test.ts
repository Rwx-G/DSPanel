import { describe, it, expect } from "vitest";
import type {
  AceEntry,
  AceAccessType,
  AccessIndicator,
  NtfsAuditResult,
  AceCrossReference,
} from "./ntfs";

describe("ntfs types", () => {
  it("AceEntry can be constructed", () => {
    const ace: AceEntry = {
      trusteeSid: "S-1-5-21-123",
      trusteeDisplayName: "Admins",
      accessType: "Allow",
      permissions: ["FullControl"],
      isInherited: false,
    };
    expect(ace.trusteeSid).toBe("S-1-5-21-123");
    expect(ace.accessType).toBe("Allow");
    expect(ace.permissions).toHaveLength(1);
  });

  it("AceAccessType accepts Allow and Deny", () => {
    const types: AceAccessType[] = ["Allow", "Deny"];
    expect(types).toHaveLength(2);
  });

  it("AccessIndicator accepts valid values", () => {
    const indicators: AccessIndicator[] = ["Allowed", "NoMatch", "Denied"];
    expect(indicators).toHaveLength(3);
  });

  it("NtfsAuditResult can be constructed", () => {
    const result: NtfsAuditResult = {
      path: "\\\\server\\share",
      aces: [],
      errors: [],
    };
    expect(result.path).toBe("\\\\server\\share");
    expect(result.aces).toHaveLength(0);
  });

  it("AceCrossReference can be constructed", () => {
    const ref: AceCrossReference = {
      ace: {
        trusteeSid: "S-1-5-21-123",
        trusteeDisplayName: "Users",
        accessType: "Allow",
        permissions: ["Read"],
        isInherited: true,
      },
      userAAccess: "Allowed",
      userBAccess: "NoMatch",
    };
    expect(ref.userAAccess).toBe("Allowed");
    expect(ref.userBAccess).toBe("NoMatch");
  });

  it("AceEntry with Deny type", () => {
    const ace: AceEntry = {
      trusteeSid: "S-1-5-21-999",
      trusteeDisplayName: "Blocked",
      accessType: "Deny",
      permissions: ["Write", "Delete"],
      isInherited: false,
    };
    expect(ace.accessType).toBe("Deny");
    expect(ace.permissions).toHaveLength(2);
  });

  it("NtfsAuditResult with errors", () => {
    const result: NtfsAuditResult = {
      path: "\\\\server\\share",
      aces: [],
      errors: ["Access denied on subfolder"],
    };
    expect(result.errors).toHaveLength(1);
  });
});
