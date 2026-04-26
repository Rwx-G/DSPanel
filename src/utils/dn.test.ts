import { describe, it, expect } from "vitest";
import {
  parseOuBreadcrumb,
  parseCnFromDn,
  formatOuPath,
  extractForeignSidFromDn,
} from "./dn";

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

describe("extractForeignSidFromDn", () => {
  it("extracts SID from a standard FSP DN", () => {
    expect(
      extractForeignSidFromDn(
        "CN=S-1-5-21-1234567890-987654321-1111111111-1234,CN=ForeignSecurityPrincipals,DC=corp,DC=local",
      ),
    ).toBe("S-1-5-21-1234567890-987654321-1111111111-1234");
  });

  it("matches case-insensitively on cn= and the container name", () => {
    expect(
      extractForeignSidFromDn(
        "cn=S-1-5-21-1-2-3-1000,cn=foreignsecurityprincipals,dc=corp,dc=local",
      ),
    ).toBe("S-1-5-21-1-2-3-1000");
  });

  it("matches well-known short SIDs (e.g. AuthenticatedUsers)", () => {
    expect(
      extractForeignSidFromDn(
        "CN=S-1-5-11,CN=ForeignSecurityPrincipals,DC=corp,DC=local",
      ),
    ).toBe("S-1-5-11");
  });

  it("returns null for a regular user DN", () => {
    expect(
      extractForeignSidFromDn("CN=John Doe,OU=Users,DC=corp,DC=local"),
    ).toBeNull();
  });

  it("does not match the FSP container DN itself", () => {
    expect(
      extractForeignSidFromDn(
        "CN=ForeignSecurityPrincipals,DC=corp,DC=local",
      ),
    ).toBeNull();
  });

  it("rejects non-SID values inside the FSP container", () => {
    expect(
      extractForeignSidFromDn(
        "CN=Alice,CN=ForeignSecurityPrincipals,DC=corp,DC=local",
      ),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractForeignSidFromDn("")).toBeNull();
  });

  it("handles multilevel domain DN suffixes", () => {
    expect(
      extractForeignSidFromDn(
        "CN=S-1-5-21-9-9-9-500,CN=ForeignSecurityPrincipals,DC=ad,DC=corp,DC=local",
      ),
    ).toBe("S-1-5-21-9-9-9-500");
  });
});
