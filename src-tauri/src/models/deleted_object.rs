use serde::{Deserialize, Serialize};

/// Represents a deleted AD object found in the Recycle Bin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedObject {
    /// The current DN of the deleted object (in Deleted Objects container).
    pub distinguished_name: String,
    /// The display name or CN of the object (with ADEL suffix stripped).
    pub name: String,
    /// The type of the object (user, computer, group, etc.).
    pub object_type: String,
    /// When the object was deleted (ISO 8601 string).
    pub deletion_date: String,
    /// The OU where the object was located before deletion.
    pub original_ou: String,
}
