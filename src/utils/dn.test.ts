import { describe, it, expect } from "vitest";
import { parseOuBreadcrumb, parseCnFromDn, formatOuPath } from "./dn";

describe("parseOuBreadcrumb", () => {
  it("extracts OU components in hierarchical order", () => {
    const dn = "CN=John Doe,OU=Engineering,OU=Departments,DC=corp,DC=local";
    expect(parseOuBreadcrumb(dn)).toEqual(["Departments", "Engineering"]);
  });

  it("returns single OU", () => {
    const dn = "CN=Admin,OU=Users,DC=corp,DC=local";
    expect(parseOuBreadcrumb(dn)).toEqual(["Users"]);
  });

  it("returns empty array when no OUs", () => {
    const dn = "CN=Admin,DC=corp,DC=local";
    expect(parseOuBreadcrumb(dn)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseOuBreadcrumb("")).toEqual([]);
  });

  it("handles deeply nested OUs", () => {
    const dn =
      "CN=User,OU=Team1,OU=Dev,OU=Engineering,OU=Departments,DC=corp,DC=local";
    expect(parseOuBreadcrumb(dn)).toEqual([
      "Departments",
      "Engineering",
      "Dev",
      "Team1",
    ]);
  });

  it("is case-insensitive for OU prefix", () => {
    const dn = "CN=User,ou=Users,Ou=Corp,DC=example,DC=com";
    expect(parseOuBreadcrumb(dn)).toEqual(["Corp", "Users"]);
  });
});

describe("parseCnFromDn", () => {
  it("extracts CN from a DN", () => {
    expect(parseCnFromDn("CN=Domain Admins,CN=Users,DC=corp,DC=local")).toBe(
      "Domain Admins",
    );
  });

  it("returns full string if no CN prefix", () => {
    expect(parseCnFromDn("OU=Users,DC=corp,DC=local")).toBe(
      "OU=Users,DC=corp,DC=local",
    );
  });

  it("returns empty string for empty input", () => {
    expect(parseCnFromDn("")).toBe("");
  });

  it("handles CN with special characters", () => {
    expect(parseCnFromDn("CN=Group (Test),OU=Groups,DC=corp,DC=local")).toBe(
      "Group (Test)",
    );
  });
});

describe("formatOuPath", () => {
  it("formats OU breadcrumb as path string", () => {
    const dn = "CN=John Doe,OU=Engineering,OU=Departments,DC=corp,DC=local";
    expect(formatOuPath(dn)).toBe("Departments > Engineering");
  });

  it("returns empty string when no OUs", () => {
    expect(formatOuPath("CN=Admin,DC=corp,DC=local")).toBe("");
  });

  it("returns single OU without separator", () => {
    expect(formatOuPath("CN=User,OU=Users,DC=corp,DC=local")).toBe("Users");
  });
});
