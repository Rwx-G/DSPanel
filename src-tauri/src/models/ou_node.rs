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
