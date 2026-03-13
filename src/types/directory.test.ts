import { describe, it, expect } from "vitest";
import { mapEntryToUser, type DirectoryEntry } from "./directory";

function makeEntry(overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    distinguishedName:
      "CN=John Doe,OU=Engineering,OU=Departments,DC=corp,DC=local",
    samAccountName: "jdoe",
    displayName: "John Doe",
    objectClass: "user",
    attributes: {
      givenName: ["John"],
      sn: ["Doe"],
      mail: ["john.doe@corp.local"],
      department: ["Engineering"],
      title: ["Senior Developer"],
      userAccountControl: ["512"],
      lockoutTime: ["0"],
      memberOf: [
        "CN=Domain Users,CN=Users,DC=corp,DC=local",
        "CN=Developers,OU=Groups,DC=corp,DC=local",
      ],
      badPwdCount: ["2"],
      whenCreated: ["2024-01-15T10:00:00Z"],
      whenChanged: ["2026-03-01T14:30:00Z"],
    },
    ...overrides,
  };
}

describe("mapEntryToUser", () => {
  it("maps basic identity fields", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.samAccountName).toBe("jdoe");
    expect(user.displayName).toBe("John Doe");
    expect(user.givenName).toBe("John");
    expect(user.surname).toBe("Doe");
    expect(user.email).toBe("john.doe@corp.local");
    expect(user.department).toBe("Engineering");
    expect(user.title).toBe("Senior Developer");
  });

  it("parses OU from distinguished name", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.organizationalUnit).toBe("Departments > Engineering");
  });

  it("maps enabled status from userAccountControl", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.enabled).toBe(true);
  });

  it("detects disabled account (UAC bit 0x0002)", () => {
    const user = mapEntryToUser(
      makeEntry({
        attributes: {
          ...makeEntry().attributes,
          userAccountControl: ["514"],
        },
      }),
    );
    expect(user.enabled).toBe(false);
  });

  it("detects locked out account", () => {
    const user = mapEntryToUser(
      makeEntry({
        attributes: {
          ...makeEntry().attributes,
          lockoutTime: ["133500000000000000"],
        },
      }),
    );
    expect(user.lockedOut).toBe(true);
  });

  it("detects not locked out when lockoutTime is 0", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.lockedOut).toBe(false);
  });

  it("maps memberOf as string array", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.memberOf).toHaveLength(2);
    expect(user.memberOf[0]).toContain("Domain Users");
  });

  it("maps bad password count", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.badPasswordCount).toBe(2);
  });

  it("maps date fields", () => {
    const user = mapEntryToUser(makeEntry());
    expect(user.whenCreated).toBe("2024-01-15T10:00:00Z");
    expect(user.whenChanged).toBe("2026-03-01T14:30:00Z");
  });

  it("handles missing optional attributes gracefully", () => {
    const user = mapEntryToUser(
      makeEntry({
        attributes: {},
      }),
    );
    expect(user.givenName).toBe("");
    expect(user.email).toBe("");
    expect(user.badPasswordCount).toBe(0);
    expect(user.memberOf).toEqual([]);
    expect(user.lastLogon).toBeNull();
  });

  it("handles null samAccountName", () => {
    const user = mapEntryToUser(makeEntry({ samAccountName: null }));
    expect(user.samAccountName).toBe("");
  });

  it("handles null displayName", () => {
    const user = mapEntryToUser(
      makeEntry({
        displayName: null,
        attributes: { displayName: ["Fallback"] },
      }),
    );
    expect(user.displayName).toBe("Fallback");
  });

  it("detects password never expires flag", () => {
    const user = mapEntryToUser(
      makeEntry({
        attributes: {
          ...makeEntry().attributes,
          userAccountControl: ["66048"],
        },
      }),
    );
    expect(user.passwordNeverExpires).toBe(true);
  });
});
