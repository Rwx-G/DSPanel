import { describe, it, expect } from "vitest";
import {
  hasExchangeAttributes,
  extractExchangeInfo,
} from "./exchange";

describe("hasExchangeAttributes", () => {
  it("returns true when msExchMailboxGuid is present", () => {
    const attrs = { msExchMailboxGuid: ["abc-guid"] };
    expect(hasExchangeAttributes(attrs)).toBe(true);
  });

  it("returns false when msExchMailboxGuid is missing", () => {
    expect(hasExchangeAttributes({})).toBe(false);
  });

  it("returns false when msExchMailboxGuid is empty string", () => {
    const attrs = { msExchMailboxGuid: [""] };
    expect(hasExchangeAttributes(attrs)).toBe(false);
  });

  it("returns false when msExchMailboxGuid is empty array", () => {
    const attrs = { msExchMailboxGuid: [] as string[] };
    expect(hasExchangeAttributes(attrs)).toBe(false);
  });
});

describe("extractExchangeInfo", () => {
  it("returns null when no Exchange attributes", () => {
    expect(extractExchangeInfo({})).toBeNull();
  });

  it("extracts full Exchange info", () => {
    const attrs = {
      msExchMailboxGuid: ["abc-guid"],
      msExchRecipientTypeDetails: ["1"],
      proxyAddresses: [
        "SMTP:john@example.com",
        "smtp:j@example.com",
        "smtp:johnd@example.com",
        "X500:/o=ExchangeLabs",
      ],
      altRecipient: ["CN=Jane,OU=Users,DC=example,DC=com"],
      msExchDelegateListBL: [
        "CN=Alice,OU=Users,DC=example,DC=com",
        "CN=Bob,OU=Users,DC=example,DC=com",
      ],
    };
    const info = extractExchangeInfo(attrs);
    expect(info).not.toBeNull();
    expect(info!.mailboxGuid).toBe("abc-guid");
    expect(info!.recipientType).toBe("UserMailbox");
    expect(info!.primarySmtpAddress).toBe("john@example.com");
    expect(info!.emailAliases).toEqual(["j@example.com", "johnd@example.com"]);
    expect(info!.forwardingAddress).toBe(
      "CN=Jane,OU=Users,DC=example,DC=com",
    );
    expect(info!.delegates).toHaveLength(2);
  });

  it("handles minimal Exchange attributes", () => {
    const attrs = { msExchMailboxGuid: ["guid-only"] };
    const info = extractExchangeInfo(attrs);
    expect(info).not.toBeNull();
    expect(info!.mailboxGuid).toBe("guid-only");
    expect(info!.recipientType).toBe("Unknown");
    expect(info!.primarySmtpAddress).toBe("");
    expect(info!.emailAliases).toEqual([]);
    expect(info!.forwardingAddress).toBeNull();
    expect(info!.delegates).toEqual([]);
  });

  it("maps recipient type correctly", () => {
    const types: Record<string, string> = {
      "1": "UserMailbox",
      "2": "LinkedMailbox",
      "4": "SharedMailbox",
      "8": "LegacyMailbox",
      "16": "RoomMailbox",
      "32": "EquipmentMailbox",
      "128": "MailUser",
    };
    for (const [value, expected] of Object.entries(types)) {
      const attrs = {
        msExchMailboxGuid: ["guid"],
        msExchRecipientTypeDetails: [value],
      };
      const info = extractExchangeInfo(attrs);
      expect(info!.recipientType).toBe(expected);
    }
  });

  it("ignores non-SMTP proxy addresses", () => {
    const attrs = {
      msExchMailboxGuid: ["guid"],
      proxyAddresses: [
        "SMTP:primary@example.com",
        "X500:/o=ExchangeLabs",
        "SIP:user@example.com",
      ],
    };
    const info = extractExchangeInfo(attrs);
    expect(info!.primarySmtpAddress).toBe("primary@example.com");
    expect(info!.emailAliases).toEqual([]);
  });

  it("handles no primary SMTP address", () => {
    const attrs = {
      msExchMailboxGuid: ["guid"],
      proxyAddresses: ["smtp:alias@example.com"],
    };
    const info = extractExchangeInfo(attrs);
    expect(info!.primarySmtpAddress).toBe("");
    expect(info!.emailAliases).toEqual(["alias@example.com"]);
  });
});
