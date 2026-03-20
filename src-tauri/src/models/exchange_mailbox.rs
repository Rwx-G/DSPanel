use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Exchange on-premises mailbox information extracted from LDAP msExch* attributes.
///
/// All fields are read-only and derived from the user's LDAP attributes.
/// The struct is only populated when the user has Exchange attributes present.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeMailboxInfo {
    pub mailbox_guid: String,
    pub recipient_type: String,
    pub primary_smtp_address: String,
    pub email_aliases: Vec<String>,
    pub forwarding_address: Option<String>,
    pub delegates: Vec<String>,
}

/// Maps a numeric `msExchRecipientTypeDetails` value to a human-readable string.
pub fn map_recipient_type(value: i64) -> &'static str {
    match value {
        1 => "UserMailbox",
        2 => "LinkedMailbox",
        4 => "SharedMailbox",
        8 => "LegacyMailbox",
        16 => "RoomMailbox",
        32 => "EquipmentMailbox",
        128 => "MailUser",
        _ => "Unknown",
    }
}

/// Parses `proxyAddresses` into a primary SMTP address and a list of aliases.
///
/// Convention: "SMTP:" (uppercase) prefix = primary address, "smtp:" (lowercase) = alias.
/// Non-SMTP entries (e.g., "X500:", "SIP:") are ignored.
pub fn parse_proxy_addresses(proxy_addresses: &[String]) -> (String, Vec<String>) {
    let mut primary = String::new();
    let mut aliases = Vec::new();

    for addr in proxy_addresses {
        if let Some(stripped) = addr.strip_prefix("SMTP:") {
            primary = stripped.to_string();
        } else if let Some(stripped) = addr.strip_prefix("smtp:") {
            aliases.push(stripped.to_string());
        }
    }

    (primary, aliases)
}

/// Checks whether a set of LDAP attributes contains Exchange on-prem data.
///
/// Returns `true` if `msExchMailboxGuid` is present and non-empty.
pub fn has_exchange_attributes(attributes: &HashMap<String, Vec<String>>) -> bool {
    attributes
        .get("msExchMailboxGuid")
        .map(|v| !v.is_empty() && !v[0].is_empty())
        .unwrap_or(false)
}

/// Extracts `ExchangeMailboxInfo` from raw LDAP attributes.
///
/// Returns `None` if the user has no Exchange attributes (no `msExchMailboxGuid`).
pub fn extract_exchange_info(
    attributes: &HashMap<String, Vec<String>>,
) -> Option<ExchangeMailboxInfo> {
    if !has_exchange_attributes(attributes) {
        return None;
    }

    let mailbox_guid = attributes
        .get("msExchMailboxGuid")
        .and_then(|v| v.first())
        .cloned()
        .unwrap_or_default();

    let recipient_type_raw = attributes
        .get("msExchRecipientTypeDetails")
        .and_then(|v| v.first())
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let recipient_type = map_recipient_type(recipient_type_raw).to_string();

    let proxy_addresses = attributes
        .get("proxyAddresses")
        .cloned()
        .unwrap_or_default();
    let (primary_smtp_address, email_aliases) = parse_proxy_addresses(&proxy_addresses);

    let forwarding_address = attributes
        .get("altRecipient")
        .and_then(|v| v.first())
        .cloned()
        .filter(|s| !s.is_empty());

    let delegates = attributes
        .get("msExchDelegateListBL")
        .cloned()
        .unwrap_or_default();

    Some(ExchangeMailboxInfo {
        mailbox_guid,
        recipient_type,
        primary_smtp_address,
        email_aliases,
        forwarding_address,
        delegates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_exchange_attributes() -> HashMap<String, Vec<String>> {
        let mut attrs = HashMap::new();
        attrs.insert(
            "msExchMailboxGuid".to_string(),
            vec!["abc123-guid".to_string()],
        );
        attrs.insert(
            "msExchRecipientTypeDetails".to_string(),
            vec!["1".to_string()],
        );
        attrs.insert(
            "proxyAddresses".to_string(),
            vec![
                "SMTP:john.doe@example.com".to_string(),
                "smtp:j.doe@example.com".to_string(),
                "smtp:johnd@example.com".to_string(),
                "X500:/o=ExchangeLabs/ou=Exchange Administrative Group".to_string(),
            ],
        );
        attrs.insert(
            "altRecipient".to_string(),
            vec!["CN=Jane Smith,OU=Users,DC=example,DC=com".to_string()],
        );
        attrs.insert(
            "msExchDelegateListBL".to_string(),
            vec![
                "CN=Alice,OU=Users,DC=example,DC=com".to_string(),
                "CN=Bob,OU=Users,DC=example,DC=com".to_string(),
            ],
        );
        attrs
    }

    #[test]
    fn test_map_recipient_type_known_values() {
        assert_eq!(map_recipient_type(1), "UserMailbox");
        assert_eq!(map_recipient_type(2), "LinkedMailbox");
        assert_eq!(map_recipient_type(4), "SharedMailbox");
        assert_eq!(map_recipient_type(8), "LegacyMailbox");
        assert_eq!(map_recipient_type(16), "RoomMailbox");
        assert_eq!(map_recipient_type(32), "EquipmentMailbox");
        assert_eq!(map_recipient_type(128), "MailUser");
    }

    #[test]
    fn test_map_recipient_type_unknown() {
        assert_eq!(map_recipient_type(0), "Unknown");
        assert_eq!(map_recipient_type(999), "Unknown");
    }

    #[test]
    fn test_parse_proxy_addresses_extracts_primary_and_aliases() {
        let addrs = vec![
            "SMTP:john.doe@example.com".to_string(),
            "smtp:j.doe@example.com".to_string(),
            "smtp:johnd@example.com".to_string(),
        ];
        let (primary, aliases) = parse_proxy_addresses(&addrs);
        assert_eq!(primary, "john.doe@example.com");
        assert_eq!(aliases, vec!["j.doe@example.com", "johnd@example.com"]);
    }

    #[test]
    fn test_parse_proxy_addresses_ignores_non_smtp() {
        let addrs = vec![
            "SMTP:primary@example.com".to_string(),
            "X500:/o=ExchangeLabs".to_string(),
            "SIP:user@example.com".to_string(),
        ];
        let (primary, aliases) = parse_proxy_addresses(&addrs);
        assert_eq!(primary, "primary@example.com");
        assert!(aliases.is_empty());
    }

    #[test]
    fn test_parse_proxy_addresses_empty_input() {
        let (primary, aliases) = parse_proxy_addresses(&[]);
        assert_eq!(primary, "");
        assert!(aliases.is_empty());
    }

    #[test]
    fn test_parse_proxy_addresses_no_primary() {
        let addrs = vec!["smtp:alias@example.com".to_string()];
        let (primary, aliases) = parse_proxy_addresses(&addrs);
        assert_eq!(primary, "");
        assert_eq!(aliases, vec!["alias@example.com"]);
    }

    #[test]
    fn test_has_exchange_attributes_true() {
        let attrs = make_exchange_attributes();
        assert!(has_exchange_attributes(&attrs));
    }

    #[test]
    fn test_has_exchange_attributes_false_when_missing() {
        let attrs = HashMap::new();
        assert!(!has_exchange_attributes(&attrs));
    }

    #[test]
    fn test_has_exchange_attributes_false_when_empty_value() {
        let mut attrs = HashMap::new();
        attrs.insert("msExchMailboxGuid".to_string(), vec!["".to_string()]);
        assert!(!has_exchange_attributes(&attrs));
    }

    #[test]
    fn test_has_exchange_attributes_false_when_empty_vec() {
        let mut attrs = HashMap::new();
        attrs.insert("msExchMailboxGuid".to_string(), vec![]);
        assert!(!has_exchange_attributes(&attrs));
    }

    #[test]
    fn test_extract_exchange_info_full() {
        let attrs = make_exchange_attributes();
        let info = extract_exchange_info(&attrs).unwrap();
        assert_eq!(info.mailbox_guid, "abc123-guid");
        assert_eq!(info.recipient_type, "UserMailbox");
        assert_eq!(info.primary_smtp_address, "john.doe@example.com");
        assert_eq!(
            info.email_aliases,
            vec!["j.doe@example.com", "johnd@example.com"]
        );
        assert_eq!(
            info.forwarding_address,
            Some("CN=Jane Smith,OU=Users,DC=example,DC=com".to_string())
        );
        assert_eq!(info.delegates.len(), 2);
    }

    #[test]
    fn test_extract_exchange_info_none_when_no_exchange() {
        let attrs = HashMap::new();
        assert!(extract_exchange_info(&attrs).is_none());
    }

    #[test]
    fn test_extract_exchange_info_minimal() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "msExchMailboxGuid".to_string(),
            vec!["guid-only".to_string()],
        );
        let info = extract_exchange_info(&attrs).unwrap();
        assert_eq!(info.mailbox_guid, "guid-only");
        assert_eq!(info.recipient_type, "Unknown");
        assert_eq!(info.primary_smtp_address, "");
        assert!(info.email_aliases.is_empty());
        assert!(info.forwarding_address.is_none());
        assert!(info.delegates.is_empty());
    }

    #[test]
    fn test_extract_exchange_info_shared_mailbox() {
        let mut attrs = HashMap::new();
        attrs.insert(
            "msExchMailboxGuid".to_string(),
            vec!["shared-guid".to_string()],
        );
        attrs.insert(
            "msExchRecipientTypeDetails".to_string(),
            vec!["4".to_string()],
        );
        let info = extract_exchange_info(&attrs).unwrap();
        assert_eq!(info.recipient_type, "SharedMailbox");
    }

    #[test]
    fn test_serialization_roundtrip() {
        let attrs = make_exchange_attributes();
        let info = extract_exchange_info(&attrs).unwrap();
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: ExchangeMailboxInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info, deserialized);
    }

    #[test]
    fn test_serialization_uses_camel_case() {
        let attrs = make_exchange_attributes();
        let info = extract_exchange_info(&attrs).unwrap();
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("mailboxGuid"));
        assert!(json.contains("recipientType"));
        assert!(json.contains("primarySmtpAddress"));
        assert!(json.contains("emailAliases"));
        assert!(json.contains("forwardingAddress"));
    }
}
