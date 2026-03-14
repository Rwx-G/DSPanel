import { describe, it, expect } from "vitest";
import type {
  PathAclResult,
  AclConflict,
  NtfsAnalysisResult,
} from "./ntfs-analyzer";

describe("ntfs-analyzer types", () => {
  it("PathAclResult can be constructed", () => {
    const result: PathAclResult = {
      path: "\\\\server\\share",
      aces: [],
      error: null,
    };
    expect(result.path).toBe("\\\\server\\share");
    expect(result.aces).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it("PathAclResult with error", () => {
    const result: PathAclResult = {
      path: "\\\\server\\denied",
      aces: [],
      error: "Access denied",
    };
    expect(result.error).toBe("Access denied");
  });

  it("AclConflict can be constructed", () => {
    const conflict: AclConflict = {
      trusteeSid: "S-1-5-21-100",
      trusteeDisplayName: "Admins",
      allowPath: "\\\\server\\share",
      denyPath: "\\\\server\\share\\sub",
      allowPermissions: ["Read"],
      denyPermissions: ["Read"],
    };
    expect(conflict.trusteeSid).toBe("S-1-5-21-100");
    expect(conflict.allowPath).not.toBe(conflict.denyPath);
  });

  it("NtfsAnalysisResult can be constructed", () => {
    const result: NtfsAnalysisResult = {
      paths: [],
      conflicts: [],
      totalAces: 0,
      totalPathsScanned: 0,
      totalErrors: 0,
    };
    expect(result.totalAces).toBe(0);
    expect(result.totalPathsScanned).toBe(0);
  });

  it("NtfsAnalysisResult with data", () => {
    const result: NtfsAnalysisResult = {
      paths: [
        {
          path: "\\\\server\\share",
          aces: [
            {
              trusteeSid: "S-1-5-21-100",
              trusteeDisplayName: "Admins",
              accessType: "Allow",
              permissions: ["FullControl"],
              isInherited: false,
            },
          ],
          error: null,
        },
      ],
      conflicts: [],
      totalAces: 1,
      totalPathsScanned: 1,
      totalErrors: 0,
    };
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].aces).toHaveLength(1);
  });
});
