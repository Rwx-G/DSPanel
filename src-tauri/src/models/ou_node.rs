use serde::{Deserialize, Serialize};

/// Represents an Organizational Unit node in the AD tree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OUNode {
    pub distinguished_name: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<OUNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_children: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node() -> OUNode {
        OUNode {
            distinguished_name: "OU=Users,DC=example,DC=com".to_string(),
            name: "Users".to_string(),
            children: None,
            has_children: Some(true),
        }
    }

    #[test]
    fn test_serialization_roundtrip() {
        let node = sample_node();
        let json = serde_json::to_string(&node).unwrap();
        let deserialized: OUNode = serde_json::from_str(&json).unwrap();
        assert_eq!(node, deserialized);
    }

    #[test]
    fn test_serialization_uses_camel_case() {
        let node = sample_node();
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("distinguishedName"));
        assert!(json.contains("hasChildren"));
        // Ensure snake_case variants are absent
        assert!(!json.contains("distinguished_name"));
        assert!(!json.contains("has_children"));
    }

    #[test]
    fn test_skip_serializing_if_none_children() {
        let node = sample_node();
        let json = serde_json::to_string(&node).unwrap();
        assert!(!json.contains("children"));
    }

    #[test]
    fn test_skip_serializing_if_none_has_children() {
        let node = OUNode {
            distinguished_name: "OU=Test,DC=example,DC=com".to_string(),
            name: "Test".to_string(),
            children: None,
            has_children: None,
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(!json.contains("hasChildren"));
    }

    #[test]
    fn test_nested_children_serialize_correctly() {
        let child = OUNode {
            distinguished_name: "OU=Admins,OU=Users,DC=example,DC=com".to_string(),
            name: "Admins".to_string(),
            children: None,
            has_children: Some(false),
        };
        let parent = OUNode {
            distinguished_name: "OU=Users,DC=example,DC=com".to_string(),
            name: "Users".to_string(),
            children: Some(vec![child.clone()]),
            has_children: Some(true),
        };
        let json = serde_json::to_string(&parent).unwrap();
        let deserialized: OUNode = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.children.as_ref().unwrap().len(), 1);
        assert_eq!(deserialized.children.as_ref().unwrap()[0], child);
    }

    #[test]
    fn test_clone_produces_independent_copy() {
        let node = sample_node();
        let mut cloned = node.clone();
        cloned.name = "Modified".to_string();
        assert_eq!(node.name, "Users");
        assert_eq!(cloned.name, "Modified");
    }
}
