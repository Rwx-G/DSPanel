export interface ExchangeMailboxInfo {
  mailboxGuid: string;
  recipientType: string;
  primarySmtpAddress: string;
  emailAliases: string[];
  forwardingAddress: string | null;
  delegates: string[];
}

/** Maps a numeric msExchRecipientTypeDetails value to a human-readable string. */
function mapRecipientType(value: number): string {
  const types: Record<number, string> = {
    1: "UserMailbox",
    2: "LinkedMailbox",
    4: "SharedMailbox",
    8: "LegacyMailbox",
    16: "RoomMailbox",
    32: "EquipmentMailbox",
    128: "MailUser",
  };
  return types[value] ?? "Unknown";
}

/**
 * Parses proxyAddresses into a primary SMTP address and a list of aliases.
 * "SMTP:" (uppercase) = primary, "smtp:" (lowercase) = alias.
 */
function parseProxyAddresses(
  proxyAddresses: string[],
): { primary: string; aliases: string[] } {
  let primary = "";
  const aliases: string[] = [];

  for (const addr of proxyAddresses) {
    if (addr.startsWith("SMTP:")) {
      primary = addr.substring(5);
    } else if (addr.startsWith("smtp:")) {
      aliases.push(addr.substring(5));
    }
  }

  return { primary, aliases };
}

/** Checks whether a set of raw attributes contains Exchange on-prem data. */
export function hasExchangeAttributes(
  attributes: Record<string, string[]>,
): boolean {
  const guid = attributes["msExchMailboxGuid"];
  return !!guid && guid.length > 0 && guid[0] !== "";
}

/**
 * Extracts ExchangeMailboxInfo from raw LDAP attributes.
 * Returns null if the user has no Exchange attributes.
 */
export function extractExchangeInfo(
  attributes: Record<string, string[]>,
): ExchangeMailboxInfo | null {
  if (!hasExchangeAttributes(attributes)) return null;

  const mailboxGuid = attributes["msExchMailboxGuid"]?.[0] ?? "";

  const recipientTypeRaw = parseInt(
    attributes["msExchRecipientTypeDetails"]?.[0] ?? "0",
    10,
  );
  const recipientType = mapRecipientType(
    isNaN(recipientTypeRaw) ? 0 : recipientTypeRaw,
  );

  const proxyAddresses = attributes["proxyAddresses"] ?? [];
  const { primary, aliases } = parseProxyAddresses(proxyAddresses);

  const forwardingRaw = attributes["altRecipient"]?.[0];
  const forwardingAddress =
    forwardingRaw && forwardingRaw !== "" ? forwardingRaw : null;

  const delegates = attributes["msExchDelegateListBL"] ?? [];

  return {
    mailboxGuid,
    recipientType,
    primarySmtpAddress: primary,
    emailAliases: aliases,
    forwardingAddress,
    delegates,
  };
}
