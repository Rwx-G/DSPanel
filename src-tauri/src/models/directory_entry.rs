use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Generic directory entry representing an AD object (user, computer, group).
///
/// This is the common data structure returned by `DirectoryProvider` search methods.
/// It provides a flexible attribute bag via `HashMap` for arbitrary LDAP attributes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub distinguished_name: String,
    pub sam_account_name: Option<String>,
    pub display_name: Option<String>,
    pub object_class: Option<String>,
    pub attributes: HashMap<String, Vec<String>>,
}

impl DirectoryEntry {
    /// Creates a new `DirectoryEntry` with the given DN and empty attributes.
    pub fn new(distinguished_name: String) -> Self {
        Self {
            distinguished_name,
            sam_account_name: None,
            display_name: None,
            object_class: None,
            attributes: HashMap::new(),
        }
    }

    /// Returns the first value of the named attribute, if present.
    pub fn get_attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .get(name)
            .and_then(|vals| vals.first())
            .map(|s| s.as_str())
    }

    /// Returns all values of the named attribute, or an empty slice.
    pub fn get_attribute_values(&self, name: &str) -> &[String] {
        self.attributes
            .get(name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("mail".to_string(), vec!["john@example.com".to_string()]);
        attrs.insert(
            "memberOf".to_string(),
            vec![
                "CN=Group1,DC=example,DC=com".to_string(),
                "CN=Group2,DC=example,DC=com".to_string(),
            ],
        );

        DirectoryEntry {
            distinguished_name: "CN=John Doe,OU=Users,DC=example,DC=com".to_string(),
            sam_account_name: Some("jdoe".to_string()),
            display_name: Some("John Doe".to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        }
    }

    #[test]
    fn test_new_creates_entry_with_dn_and_empty_attributes() {
        let entry = DirectoryEntry::new("CN=Test,DC=example,DC=com".to_string());
        assert_eq!(entry.distinguished_name, "CN=Test,DC=example,DC=com");
        assert!(entry.sam_account_name.is_none());
        assert!(entry.display_name.is_none());
        assert!(entry.object_class.is_none());
        assert!(entry.attributes.is_empty());
    }

    #[test]
    fn test_get_attribute_returns_first_value() {
        let entry = sample_entry();
        assert_eq!(entry.get_attribute("mail"), Some("john@example.com"));
    }

    #[test]
    fn test_get_attribute_returns_none_for_missing() {
        let entry = sample_entry();
        assert_eq!(entry.get_attribute("telephoneNumber"), None);
    }

    #[test]
    fn test_get_attribute_values_returns_all_values() {
        let entry = sample_entry();
        let groups = entry.get_attribute_values("memberOf");
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0], "CN=Group1,DC=example,DC=com");
        assert_eq!(groups[1], "CN=Group2,DC=example,DC=com");
    }

    #[test]
    fn test_get_attribute_values_returns_empty_for_missing() {
        let entry = sample_entry();
        let vals = entry.get_attribute_values("nonexistent");
        assert!(vals.is_empty());
    }

    #[test]
    fn test_serialization_roundtrip() {
        let entry = sample_entry();
        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: DirectoryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(entry, deserialized);
    }

    #[test]
    fn test_serialization_uses_camel_case() {
        let entry = sample_entry();
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("distinguishedName"));
        assert!(json.contains("samAccountName"));
        assert!(json.contains("displayName"));
        assert!(json.contains("objectClass"));
    }

    #[test]
    fn test_clone_produces_independent_copy() {
        let entry = sample_entry();
        let mut cloned = entry.clone();
        cloned.display_name = Some("Modified".to_string());
        assert_eq!(entry.display_name, Some("John Doe".to_string()));
        assert_eq!(cloned.display_name, Some("Modified".to_string()));
    }
}
