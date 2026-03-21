use serde::{Deserialize, Serialize};

/// Represents an AD contact object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactInfo {
    /// The distinguished name of the contact.
    pub dn: String,
    /// The display name.
    pub display_name: String,
    /// First name (givenName).
    pub first_name: String,
    /// Last name (sn).
    pub last_name: String,
    /// Email address (mail).
    pub email: String,
    /// Phone number (telephoneNumber).
    pub phone: String,
    /// Mobile number (mobile).
    pub mobile: String,
    /// Company name (company).
    pub company: String,
    /// Department name (department).
    pub department: String,
    /// Description.
    pub description: String,
}
