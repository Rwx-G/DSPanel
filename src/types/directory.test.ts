import { describe, it, expect } from "vitest";
import {
  mapEntryToUser,
  mapEntryToComputer,
  type DirectoryEntry,
} from "./directory";

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

function makeComputerEntry(
  overrides: Partial<DirectoryEntry> = {},
): DirectoryEntry {
  return {
    distinguishedName: "CN=WS001,OU=Workstations,OU=Computers,DC=corp,DC=local",
    samAccountName: "WS001$",
    displayName: "WS001",
    objectClass: "computer",
    attributes: {
      dNSHostName: ["ws001.corp.local"],
      operatingSystem: ["Windows 11 Enterprise"],
      operatingSystemVersion: ["10.0 (22631)"],
      userAccountControl: ["4096"],
      lastLogon: ["2026-03-12T08:00:00Z"],
      memberOf: [
        "CN=Domain Computers,CN=Users,DC=corp,DC=local",
        "CN=Workstations,OU=Groups,DC=corp,DC=local",
      ],
    },
    ...overrides,
  };
}

describe("mapEntryToComputer", () => {
  it("maps basic identity fields", () => {
    const computer = mapEntryToComputer(makeComputerEntry());
    expect(computer.name).toBe("WS001");
    expect(computer.dnsHostName).toBe("ws001.corp.local");
    expect(computer.operatingSystem).toBe("Windows 11 Enterprise");
    expect(computer.osVersion).toBe("10.0 (22631)");
  });

  it("parses OU from distinguished name", () => {
    const computer = mapEntryToComputer(makeComputerEntry());
    expect(computer.organizationalUnit).toBe("Computers > Workstations");
  });

  it("maps enabled status from userAccountControl", () => {
    const computer = mapEntryToComputer(makeComputerEntry());
    expect(computer.enabled).toBe(true);
  });

  it("detects disabled computer", () => {
    const computer = mapEntryToComputer(
      makeComputerEntry({
        attributes: {
          ...makeComputerEntry().attributes,
          userAccountControl: ["4098"],
        },
      }),
    );
    expect(computer.enabled).toBe(false);
  });

  it("maps memberOf as string array", () => {
    const computer = mapEntryToComputer(makeComputerEntry());
    expect(computer.memberOf).toHaveLength(2);
  });

  it("maps lastLogon", () => {
    const computer = mapEntryToComputer(makeComputerEntry());
    expect(computer.lastLogon).toBe("2026-03-12T08:00:00Z");
  });

  it("handles missing optional attributes", () => {
    const computer = mapEntryToComputer(makeComputerEntry({ attributes: {} }));
    expect(computer.dnsHostName).toBe("");
    expect(computer.operatingSystem).toBe("");
    expect(computer.lastLogon).toBeNull();
    expect(computer.memberOf).toEqual([]);
  });

  it("strips $ suffix from samAccountName for name", () => {
    const computer = mapEntryToComputer(
      makeComputerEntry({ displayName: null }),
    );
    expect(computer.name).toBe("WS001");
  });
});
