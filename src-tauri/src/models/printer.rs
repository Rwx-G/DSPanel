use serde::{Deserialize, Serialize};

/// Represents an AD printer (printQueue) object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    /// The distinguished name of the printer.
    pub dn: String,
    /// Printer name (printerName / cn).
    pub name: String,
    /// Physical location (location).
    pub location: String,
    /// Print server name (serverName).
    pub server_name: String,
    /// UNC share path (uNCName).
    pub share_path: String,
    /// Driver name (driverName).
    pub driver_name: String,
    /// Description.
    pub description: String,
}
