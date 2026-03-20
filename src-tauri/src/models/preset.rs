use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Type of preset: Onboarding (new user setup) or Offboarding (user departure).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PresetType {
    Onboarding,
    Offboarding,
}

/// A role-based preset stored as JSON on a configurable network share.
///
/// Each preset defines a template for onboarding or offboarding operations,
/// including target OU, AD group memberships, and user attributes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    /// Display name for the preset.
    pub name: String,
    /// Human-readable description of what this preset does.
    pub description: String,
    /// Whether this is an onboarding or offboarding preset.
    #[serde(rename = "type")]
    pub preset_type: PresetType,
    /// Target OU distinguished name (e.g., "OU=Developers,OU=Users,DC=contoso,DC=com").
    pub target_ou: String,
    /// List of AD group distinguished names to add/remove the user from.
    pub groups: Vec<String>,
    /// Additional LDAP attributes to set on the user (e.g., department, title).
    #[serde(default)]
    pub attributes: HashMap<String, String>,
    /// Runtime flag: true if the file's SHA-256 checksum does not match the
    /// last known checksum recorded by DSPanel. This indicates the preset was
    /// modified outside DSPanel (e.g., edited directly on the network share).
    /// Not persisted in preset JSON files.
    #[serde(default, skip_deserializing)]
    pub integrity_warning: bool,
}

impl Preset {
    /// Validates that the preset has all required fields populated.
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Preset name must not be empty".to_string());
        }
        if self.target_ou.trim().is_empty() {
            return Err("Target OU must not be empty".to_string());
        }
        if self.groups.is_empty() && self.attributes.is_empty() {
            return Err("Preset must have at least one group or attribute".to_string());
        }
        Ok(())
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    fn make_preset() -> Preset {
        Preset {
            name: "New Developer".to_string(),
            description: "Standard dev onboarding".to_string(),
            preset_type: PresetType::Onboarding,
            target_ou: "OU=Devs,DC=example,DC=com".to_string(),
            groups: vec!["CN=Developers,DC=example,DC=com".to_string()],
            attributes: HashMap::from([("department".to_string(), "Engineering".to_string())]),
            integrity_warning: false,
        }
    }

    #[test]
    fn test_preset_serialize_deserialize_roundtrip() {
        let preset = make_preset();
        let json = serde_json::to_string_pretty(&preset).unwrap();
        let deserialized: Preset = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "New Developer");
        assert_eq!(deserialized.preset_type, PresetType::Onboarding);
        assert_eq!(deserialized.groups.len(), 1);
        assert_eq!(
            deserialized.attributes.get("department").unwrap(),
            "Engineering"
        );
    }

    #[test]
    fn test_preset_json_field_names_are_camel_case() {
        let preset = make_preset();
        let json = serde_json::to_string(&preset).unwrap();
        assert!(json.contains("\"targetOu\""));
        assert!(json.contains("\"type\""));
        assert!(!json.contains("\"preset_type\""));
        assert!(!json.contains("\"target_ou\""));
    }

    #[test]
    fn test_preset_deserialize_from_spec_example() {
        let json = r#"{
            "name": "New Developer Onboarding",
            "description": "Standard setup for new developers",
            "type": "Onboarding",
            "targetOu": "OU=Developers,OU=Users,DC=contoso,DC=com",
            "groups": [
                "CN=Developers,OU=Groups,DC=contoso,DC=com",
                "CN=VPN-Users,OU=Groups,DC=contoso,DC=com"
            ],
            "attributes": {
                "department": "Engineering",
                "company": "Contoso Ltd",
                "title": "Software Developer"
            }
        }"#;
        let preset: Preset = serde_json::from_str(json).unwrap();
        assert_eq!(preset.name, "New Developer Onboarding");
        assert_eq!(preset.preset_type, PresetType::Onboarding);
        assert_eq!(preset.groups.len(), 2);
        assert_eq!(preset.attributes.len(), 3);
    }

    #[test]
    fn test_preset_deserialize_without_attributes() {
        let json = r#"{
            "name": "Basic",
            "description": "No extra attrs",
            "type": "Offboarding",
            "targetOu": "OU=Disabled,DC=example,DC=com",
            "groups": ["CN=Group1,DC=example,DC=com"]
        }"#;
        let preset: Preset = serde_json::from_str(json).unwrap();
        assert_eq!(preset.preset_type, PresetType::Offboarding);
        assert!(preset.attributes.is_empty());
    }

    #[test]
    fn test_preset_validate_valid() {
        let preset = make_preset();
        assert!(preset.validate().is_ok());
    }

    #[test]
    fn test_preset_validate_empty_name() {
        let mut preset = make_preset();
        preset.name = "  ".to_string();
        assert_eq!(
            preset.validate().unwrap_err(),
            "Preset name must not be empty"
        );
    }

    #[test]
    fn test_preset_validate_empty_target_ou() {
        let mut preset = make_preset();
        preset.target_ou = "".to_string();
        assert_eq!(
            preset.validate().unwrap_err(),
            "Target OU must not be empty"
        );
    }

    #[test]
    fn test_preset_validate_no_groups_no_attributes() {
        let mut preset = make_preset();
        preset.groups.clear();
        preset.attributes.clear();
        assert_eq!(
            preset.validate().unwrap_err(),
            "Preset must have at least one group or attribute"
        );
    }

    #[test]
    fn test_preset_validate_groups_only() {
        let mut preset = make_preset();
        preset.attributes.clear();
        assert!(preset.validate().is_ok());
    }

    #[test]
    fn test_preset_validate_attributes_only() {
        let mut preset = make_preset();
        preset.groups.clear();
        assert!(preset.validate().is_ok());
    }

    #[test]
    fn test_preset_type_clone() {
        let t = PresetType::Onboarding;
        let cloned = t.clone();
        assert_eq!(cloned, PresetType::Onboarding);
    }

    #[test]
    fn test_preset_debug_format() {
        let preset = make_preset();
        let debug = format!("{:?}", preset);
        assert!(debug.contains("New Developer"));
        assert!(debug.contains("Onboarding"));
    }
}
