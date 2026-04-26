import { describe, it, expect } from "vitest";
import { isSystemSpn } from "./spn";

/**
 * Tests mirror src-tauri/src/services/spn.rs::tests verbatim. Same input
 * strings, same expected booleans. If you change one list, change both.
 */
describe("isSystemSpn", () => {
  // --- Each prefix is correctly classified as system ---

  it.each([
    ["HOST/dc01.corp.local"],
    ["host/dc01.corp.local"],
    ["Host/dc01.corp.local"],
  ])("HOST is system: %s", (spn) => {
    expect(isSystemSpn(spn)).toBe(true);
  });

  it("RestrictedKrbHost is system", () => {
    expect(isSystemSpn("RestrictedKrbHost/dc01.corp.local")).toBe(true);
    expect(isSystemSpn("restrictedkrbhost/dc01.corp.local")).toBe(true);
  });

  it("cifs is system", () => {
    expect(isSystemSpn("cifs/fileserver.corp.local")).toBe(true);
    expect(isSystemSpn("CIFS/fileserver.corp.local")).toBe(true);
  });

  it("ldap is system", () => {
    expect(isSystemSpn("ldap/dc01.corp.local")).toBe(true);
    expect(isSystemSpn("LDAP/dc01.corp.local")).toBe(true);
  });

  it("GC is system", () => {
    expect(isSystemSpn("GC/dc01.corp.local")).toBe(true);
    expect(isSystemSpn("gc/dc01.corp.local")).toBe(true);
  });

  it("kadmin is system", () => {
    expect(isSystemSpn("kadmin/changepw")).toBe(true);
  });

  it("krbtgt is system", () => {
    expect(isSystemSpn("krbtgt/CORP.LOCAL")).toBe(true);
  });

  it("wsman is system", () => {
    expect(isSystemSpn("wsman/dc01.corp.local")).toBe(true);
    expect(isSystemSpn("WSMAN/dc01.corp.local")).toBe(true);
  });

  it("TERMSRV is system", () => {
    expect(isSystemSpn("TERMSRV/rdp01.corp.local")).toBe(true);
    expect(isSystemSpn("termsrv/rdp01.corp.local")).toBe(true);
  });

  it("cluster mgmt is system", () => {
    expect(isSystemSpn("MSServerClusterMgmtAPI/cluster01.corp.local")).toBe(
      true,
    );
    expect(isSystemSpn("MSServerCluster/cluster01.corp.local")).toBe(true);
  });

  it("DNS is system", () => {
    expect(isSystemSpn("DNS/dc01.corp.local")).toBe(true);
    expect(isSystemSpn("dns/dc01.corp.local")).toBe(true);
  });

  // --- User-defined SPNs are correctly classified as non-system ---

  it("MSSQLSvc is not system", () => {
    expect(isSystemSpn("MSSQLSvc/db.corp.local:1433")).toBe(false);
    expect(isSystemSpn("MSSQLSvc/db.corp.local")).toBe(false);
  });

  it("HTTP is not system", () => {
    expect(isSystemSpn("HTTP/web1.corp.local")).toBe(false);
    expect(isSystemSpn("http/web1.corp.local")).toBe(false);
  });

  it("arbitrary user service is not system", () => {
    expect(isSystemSpn("MyService/app1.corp.local")).toBe(false);
    expect(isSystemSpn("FtpSvc/files.corp.local")).toBe(false);
    expect(isSystemSpn("CustomApp/srv01")).toBe(false);
  });

  it("host substring in user prefix is not system", () => {
    // Defense against substring-style false positives - the prefix must
    // equal the system word, not just contain it.
    expect(isSystemSpn("MyHostService/x.corp.local")).toBe(false);
    expect(isSystemSpn("hostnamed/x.corp.local")).toBe(false);
  });

  // --- Malformed inputs ---

  it("empty string is not system", () => {
    expect(isSystemSpn("")).toBe(false);
  });

  it("no slash with system prefix is system (conservative bias)", () => {
    expect(isSystemSpn("HOST")).toBe(true);
    expect(isSystemSpn("krbtgt")).toBe(true);
  });

  it("no slash with unknown prefix is not system", () => {
    expect(isSystemSpn("just-a-prefix")).toBe(false);
    expect(isSystemSpn("randomstring")).toBe(false);
  });

  it("only slash is not system", () => {
    // Prefix is "" which matches nothing in the list.
    expect(isSystemSpn("/anything")).toBe(false);
  });
});
