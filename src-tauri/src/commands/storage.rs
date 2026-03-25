use tauri::State;

use crate::error::AppError;
use crate::models::{DeletedObject, ExchangeOnlineInfo, ObjectSnapshot, Preset, SnapshotDiff};
use crate::services::app_settings::AppSettings;
use crate::services::permissions::PermissionMappings;
use crate::services::update::{self, UpdateInfo};
use crate::services::PermissionLevel;
use crate::state::AppState;

use super::capture_snapshot;

// ---------------------------------------------------------------------------
// Recycle Bin commands
// ---------------------------------------------------------------------------

/// Checks whether the AD Recycle Bin feature is enabled. Requires DomainAdmin.
pub(crate) async fn is_recycle_bin_enabled_inner(state: &AppState) -> Result<bool, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Recycle Bin access requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    provider
        .is_recycle_bin_enabled()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Lists deleted objects from the AD Recycle Bin. Requires DomainAdmin.
pub(crate) async fn get_deleted_objects_inner(
    state: &AppState,
) -> Result<Vec<DeletedObject>, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Recycle Bin access requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    provider
        .get_deleted_objects()
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Restores a deleted object from the Recycle Bin. Requires DomainAdmin.
pub(crate) async fn restore_deleted_object_inner(
    state: &AppState,
    deleted_dn: &str,
    target_ou_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Restoring objects requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider
        .restore_deleted_object(deleted_dn, target_ou_dn)
        .await
    {
        Ok(()) => {
            state.audit_service.log_success(
                "ObjectRestored",
                deleted_dn,
                &format!("Restored to {}", target_ou_dn),
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "RestoreObjectFailed",
                deleted_dn,
                &format!("Failed to restore: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Contact and Printer Management - inner functions
// ---------------------------------------------------------------------------

/// Creates a new contact. Requires AccountOperator permission.
pub(crate) async fn create_contact_inner(
    state: &AppState,
    container_dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact creation requires AccountOperator permission or higher".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider.create_contact(container_dn, attrs).await {
        Ok(dn) => {
            state.audit_service.log_success(
                "ContactCreated",
                &dn,
                &format!("Contact created in {}", container_dn),
            );
            Ok(dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactCreateFailed",
                container_dn,
                &format!("Failed to create contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Updates an existing contact. Requires AccountOperator permission.
pub(crate) async fn update_contact_inner(
    state: &AppState,
    dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact modification requires AccountOperator permission or higher".to_string(),
        ));
    }

    capture_snapshot(state, dn, "ContactUpdate").await;

    let provider = state.directory_provider.clone();
    match provider.update_contact(dn, attrs).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ContactUpdated", dn, "Contact updated");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactUpdateFailed",
                dn,
                &format!("Failed to update contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Deletes a contact. Requires AccountOperator permission.
pub(crate) async fn delete_contact_inner(state: &AppState, dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Contact deletion requires AccountOperator permission or higher".to_string(),
        ));
    }

    capture_snapshot(state, dn, "ContactDelete").await;

    let provider = state.directory_provider.clone();
    match provider.delete_contact(dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ContactDeleted", dn, "Contact deleted");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ContactDeleteFailed",
                dn,
                &format!("Failed to delete contact: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Creates a new printer. Requires DomainAdmin permission.
pub(crate) async fn create_printer_inner(
    state: &AppState,
    container_dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<String, AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer creation requires DomainAdmin permission".to_string(),
        ));
    }

    let provider = state.directory_provider.clone();
    match provider.create_printer(container_dn, attrs).await {
        Ok(dn) => {
            state.audit_service.log_success(
                "PrinterCreated",
                &dn,
                &format!("Printer created in {}", container_dn),
            );
            Ok(dn)
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterCreateFailed",
                container_dn,
                &format!("Failed to create printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Updates an existing printer. Requires DomainAdmin permission.
pub(crate) async fn update_printer_inner(
    state: &AppState,
    dn: &str,
    attrs: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer modification requires DomainAdmin permission".to_string(),
        ));
    }

    capture_snapshot(state, dn, "PrinterUpdate").await;

    let provider = state.directory_provider.clone();
    match provider.update_printer(dn, attrs).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("PrinterUpdated", dn, "Printer updated");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterUpdateFailed",
                dn,
                &format!("Failed to update printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Deletes a printer. Requires DomainAdmin permission.
pub(crate) async fn delete_printer_inner(state: &AppState, dn: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Printer deletion requires DomainAdmin permission".to_string(),
        ));
    }

    capture_snapshot(state, dn, "PrinterDelete").await;

    let provider = state.directory_provider.clone();
    match provider.delete_printer(dn).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("PrinterDeleted", dn, "Printer deleted");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "PrinterDeleteFailed",
                dn,
                &format!("Failed to delete printer: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Thumbnail Photo
// ---------------------------------------------------------------------------

/// Gets the thumbnailPhoto attribute as base64-encoded bytes. ReadOnly access.
pub(crate) async fn get_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<Option<String>, AppError> {
    let provider = state.directory_provider.clone();
    provider
        .get_thumbnail_photo(user_dn)
        .await
        .map_err(|e| AppError::Directory(e.to_string()))
}

/// Sets the thumbnailPhoto attribute from base64-encoded JPEG bytes.
/// Requires AccountOperator+.
/// Maximum thumbnail photo size in bytes (100 KB - AD limit).
const MAX_THUMBNAIL_PHOTO_BYTES: usize = 102_400;

pub(crate) async fn set_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
    photo_base64: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Setting thumbnail photo requires AccountOperator permission or higher".to_string(),
        ));
    }

    // Validate decoded size before sending to LDAP
    let decoded_size = photo_base64.len() * 3 / 4;
    if decoded_size > MAX_THUMBNAIL_PHOTO_BYTES {
        return Err(AppError::Validation(format!(
            "Photo exceeds maximum size of {}KB (got ~{}KB)",
            MAX_THUMBNAIL_PHOTO_BYTES / 1024,
            decoded_size / 1024
        )));
    }

    capture_snapshot(state, user_dn, "SetThumbnailPhoto").await;

    let provider = state.directory_provider.clone();
    match provider.set_thumbnail_photo(user_dn, photo_base64).await {
        Ok(()) => {
            state
                .audit_service
                .log_success("ThumbnailPhotoSet", user_dn, "Thumbnail photo set");
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ThumbnailPhotoSetFailed",
                user_dn,
                &format!("Failed to set thumbnail photo: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

/// Removes the thumbnailPhoto attribute. Requires AccountOperator+.
pub(crate) async fn remove_thumbnail_photo_inner(
    state: &AppState,
    user_dn: &str,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Removing thumbnail photo requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .snapshot_service
        .capture(user_dn, "RemoveThumbnailPhoto");

    let provider = state.directory_provider.clone();
    match provider.remove_thumbnail_photo(user_dn).await {
        Ok(()) => {
            state.audit_service.log_success(
                "ThumbnailPhotoRemoved",
                user_dn,
                "Thumbnail photo removed",
            );
            Ok(())
        }
        Err(e) => {
            state.audit_service.log_failure(
                "ThumbnailPhotoRemoveFailed",
                user_dn,
                &format!("Failed to remove thumbnail photo: {}", e),
            );
            Err(AppError::Directory(e.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Preset management - inner functions
// ---------------------------------------------------------------------------

/// Returns the configured preset storage path.
pub(crate) fn get_preset_path_inner(state: &AppState) -> Option<String> {
    state
        .preset_service
        .get_path()
        .map(|p| p.to_string_lossy().to_string())
}

/// Validates and sets the preset storage path, loads presets and starts watching.
pub(crate) fn set_preset_path_inner(state: &AppState, path: &str) -> Result<(), AppError> {
    state
        .preset_service
        .configure_path(path)
        .map_err(AppError::Configuration)
}

/// Tests whether a path is a valid, accessible directory.
pub(crate) fn test_preset_path_inner(path: &str) -> Result<bool, AppError> {
    match crate::services::PresetService::validate_path(path) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Returns all loaded presets.
pub(crate) fn list_presets_inner(state: &AppState) -> Vec<Preset> {
    state.preset_service.load_all()
}

/// Saves a preset to disk. Requires AccountOperator permission.
pub(crate) fn save_preset_inner(state: &AppState, preset: &Preset) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Managing presets requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .preset_service
        .save(preset)
        .map_err(AppError::Configuration)?;

    state.audit_service.log_success(
        "PresetSaved",
        &preset.name,
        &format!("Preset '{}' saved", preset.name),
    );

    Ok(())
}

/// Accepts a preset whose checksum has changed (user acknowledges external modification).
pub(crate) fn accept_preset_checksum_inner(state: &AppState, name: &str) -> Result<(), AppError> {
    state
        .preset_service
        .accept_checksum(name)
        .map_err(AppError::Configuration)?;

    state.audit_service.log_success(
        "PresetChecksumAccepted",
        name,
        &format!(
            "Preset '{}' checksum accepted after external modification",
            name
        ),
    );

    Ok(())
}

/// Deletes a preset by name. Requires AccountOperator permission.
pub(crate) fn delete_preset_inner(state: &AppState, name: &str) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::AccountOperator)
    {
        return Err(AppError::PermissionDenied(
            "Managing presets requires AccountOperator permission or higher".to_string(),
        ));
    }

    state
        .preset_service
        .delete(name)
        .map_err(AppError::Configuration)?;

    state
        .audit_service
        .log_success("PresetDeleted", name, &format!("Preset '{}' deleted", name));

    Ok(())
}

// ---------------------------------------------------------------------------
// Object Snapshot - inner functions
// ---------------------------------------------------------------------------

/// Captures a full snapshot of an AD object before modification.
/// Fetches current attributes from directory and stores in SQLite.
pub(crate) async fn capture_object_snapshot_inner(
    state: &AppState,
    object_dn: &str,
    operation_type: &str,
) -> Result<i64, AppError> {
    let provider = state.directory_provider.clone();
    let operator = provider
        .authenticated_user()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "Unknown".to_string()));

    // Extract CN and search for the object
    let cn = object_dn
        .split(',')
        .next()
        .and_then(|part| {
            part.strip_prefix("CN=")
                .or_else(|| part.strip_prefix("cn="))
        })
        .unwrap_or("");

    let attrs_json = if !cn.is_empty() {
        let entries = provider.search_users(cn, 5).await.unwrap_or_default();
        entries
            .iter()
            .find(|e| e.distinguished_name == object_dn)
            .map(|entry| {
                serde_json::to_string(&entry.attributes).unwrap_or_else(|_| "{}".to_string())
            })
            .unwrap_or_else(|| "{}".to_string())
    } else {
        "{}".to_string()
    };
    let id =
        state
            .object_snapshot_service
            .capture(object_dn, operation_type, &attrs_json, &operator);
    Ok(id)
}

/// Gets snapshot history for an object. ReadOnly access.
pub(crate) fn get_snapshot_history_inner(state: &AppState, object_dn: &str) -> Vec<ObjectSnapshot> {
    state.object_snapshot_service.get_history(object_dn)
}

/// Gets a specific snapshot by ID. ReadOnly access.
pub(crate) fn get_snapshot_inner(state: &AppState, id: i64) -> Option<ObjectSnapshot> {
    state.object_snapshot_service.get_snapshot(id)
}

/// Computes diff between a snapshot and current object state.
/// Requires ReadOnly access.
pub(crate) async fn compute_snapshot_diff_inner(
    state: &AppState,
    snapshot_id: i64,
) -> Result<Vec<SnapshotDiff>, AppError> {
    let snapshot = state
        .object_snapshot_service
        .get_snapshot(snapshot_id)
        .ok_or_else(|| AppError::Validation("Snapshot not found".to_string()))?;

    // Parse stored attributes
    let stored_attrs: std::collections::HashMap<String, Vec<String>> =
        serde_json::from_str(&snapshot.attributes_json).unwrap_or_default();

    // Fetch current state from directory by extracting CN and searching
    let provider = state.directory_provider.clone();
    let cn = snapshot
        .object_dn
        .split(',')
        .next()
        .and_then(|part| {
            part.strip_prefix("CN=")
                .or_else(|| part.strip_prefix("cn="))
        })
        .unwrap_or("");

    let current_attrs: std::collections::HashMap<String, Vec<String>> = if !cn.is_empty() {
        let entries = provider.search_users(cn, 10).await.unwrap_or_default();
        entries
            .iter()
            .find(|e| e.distinguished_name == snapshot.object_dn)
            .map(|e| e.attributes.clone())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    // Build diff - collect all attribute names from both sides
    let mut all_keys: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for key in stored_attrs.keys() {
        all_keys.insert(key.clone());
    }
    for key in current_attrs.keys() {
        all_keys.insert(key.clone());
    }

    let diffs: Vec<SnapshotDiff> = all_keys
        .into_iter()
        .map(|attr| {
            let snap_val = stored_attrs.get(&attr).map(|v| v.join("; "));
            let curr_val = current_attrs.get(&attr).map(|v| v.join("; "));
            let changed = snap_val != curr_val;
            SnapshotDiff {
                attribute: attr,
                snapshot_value: snap_val,
                current_value: curr_val,
                changed,
            }
        })
        .collect();

    Ok(diffs)
}

/// Restores an object from a snapshot. Requires DomainAdmin.
/// Applies the snapshot's attribute values back to the object.
pub(crate) async fn restore_from_snapshot_inner(
    state: &AppState,
    snapshot_id: i64,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Restoring from snapshot requires DomainAdmin permission".to_string(),
        ));
    }

    let snapshot = state
        .object_snapshot_service
        .get_snapshot(snapshot_id)
        .ok_or_else(|| AppError::Validation("Snapshot not found".to_string()))?;

    let stored_attrs: std::collections::HashMap<String, Vec<String>> =
        serde_json::from_str(&snapshot.attributes_json).unwrap_or_default();

    // Read-only / system attributes that cannot be modified via LDAP
    const SKIP_ATTRS: &[&str] = &[
        "objectClass",
        "objectGuid",
        "objectSid",
        "objectCategory",
        "distinguishedName",
        "cn",
        "name",
        "whenCreated",
        "whenChanged",
        "uSNCreated",
        "uSNChanged",
        "instanceType",
        "objectVersion",
        "pwdLastSet",
        "badPwdCount",
        "badPasswordTime",
        "lastLogon",
        "lastLogonTimestamp",
        "lastLogoff",
        "logonCount",
        "accountExpires",
        "primaryGroupID",
        "sAMAccountType",
        "isCriticalSystemObject",
        "dSCorePropagationData",
        "memberOf",
    ];

    let provider = state.directory_provider.clone();
    let dn = &snapshot.object_dn;

    // Fetch current attributes to detect what needs to be cleared
    let cn = dn
        .split(',')
        .next()
        .and_then(|part| {
            part.strip_prefix("CN=")
                .or_else(|| part.strip_prefix("cn="))
        })
        .unwrap_or("");
    let current_attrs: std::collections::HashMap<String, Vec<String>> = if !cn.is_empty() {
        let entries = provider.search_users(cn, 10).await.unwrap_or_default();
        entries
            .iter()
            .find(|e| e.distinguished_name == *dn)
            .map(|e| e.attributes.clone())
            .unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    // 1. Restore attributes that exist in the snapshot
    for (attr_name, values) in &stored_attrs {
        if SKIP_ATTRS
            .iter()
            .any(|&s| s.eq_ignore_ascii_case(attr_name))
        {
            continue;
        }
        if let Err(e) = provider.modify_attribute(dn, attr_name, values).await {
            state.audit_service.log_failure(
                "SnapshotRestoreFailed",
                dn,
                &format!(
                    "Failed to restore attribute '{}' from snapshot {}: {}",
                    attr_name, snapshot_id, e
                ),
            );
            return Err(AppError::Directory(format!(
                "Failed to restore attribute '{}': {}",
                attr_name, e
            )));
        }
    }

    // 2. Clear attributes that exist now but were absent in the snapshot
    for attr_name in current_attrs.keys() {
        if SKIP_ATTRS
            .iter()
            .any(|&s| s.eq_ignore_ascii_case(attr_name))
        {
            continue;
        }
        if !stored_attrs.contains_key(attr_name) {
            // Attribute was added after snapshot - clear it
            let _ = provider.modify_attribute(dn, attr_name, &[]).await;
        }
    }

    state.audit_service.log_success(
        "SnapshotRestored",
        dn,
        &format!(
            "Object restored from snapshot {} ({} attributes)",
            snapshot_id,
            stored_attrs.len()
        ),
    );

    Ok(())
}

/// Cleans up expired snapshots. Returns count deleted.
pub(crate) fn cleanup_snapshots_inner(state: &AppState, retention_days: i64) -> usize {
    state
        .object_snapshot_service
        .cleanup_expired(retention_days)
}

// ---------------------------------------------------------------------------
// Credential store - inner functions
// ---------------------------------------------------------------------------

/// Stores a credential in the OS-native secure storage.
pub(crate) fn store_credential_inner(
    state: &AppState,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    state
        .credential_store
        .store(key, value)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Retrieves a credential from the OS-native secure storage.
pub(crate) fn get_credential_inner(
    state: &AppState,
    key: &str,
) -> Result<Option<String>, AppError> {
    state
        .credential_store
        .retrieve(key)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Deletes a credential from the OS-native secure storage.
pub(crate) fn delete_credential_inner(state: &AppState, key: &str) -> Result<(), AppError> {
    state
        .credential_store
        .delete(key)
        .map_err(|e| AppError::Internal(e.to_string()))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Checks whether the AD Recycle Bin feature is enabled.
#[tauri::command]
pub async fn is_recycle_bin_enabled(state: State<'_, AppState>) -> Result<bool, AppError> {
    is_recycle_bin_enabled_inner(&state).await
}

/// Lists deleted objects from the AD Recycle Bin.
#[tauri::command]
pub async fn get_deleted_objects(
    state: State<'_, AppState>,
) -> Result<Vec<DeletedObject>, AppError> {
    get_deleted_objects_inner(&state).await
}

/// Restores a deleted object from the Recycle Bin.
#[tauri::command]
pub async fn restore_deleted_object(
    deleted_dn: String,
    target_ou_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    restore_deleted_object_inner(&state, &deleted_dn, &target_ou_dn).await
}

/// Creates a new contact. Requires AccountOperator+.
#[tauri::command]
pub async fn create_contact(
    container_dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_contact_inner(&state, &container_dn, &attrs).await
}

/// Updates an existing contact. Requires AccountOperator+.
#[tauri::command]
pub async fn update_contact(
    dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_contact_inner(&state, &dn, &attrs).await
}

/// Deletes a contact. Requires AccountOperator+.
#[tauri::command]
pub async fn delete_contact(dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_contact_inner(&state, &dn).await
}

/// Creates a new printer. Requires DomainAdmin.
#[tauri::command]
pub async fn create_printer(
    container_dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    create_printer_inner(&state, &container_dn, &attrs).await
}

/// Updates an existing printer. Requires DomainAdmin.
#[tauri::command]
pub async fn update_printer(
    dn: String,
    attrs: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    update_printer_inner(&state, &dn, &attrs).await
}

/// Deletes a printer. Requires DomainAdmin.
#[tauri::command]
pub async fn delete_printer(dn: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_printer_inner(&state, &dn).await
}

/// Gets the thumbnail photo for a user. ReadOnly access.
#[tauri::command]
pub async fn get_thumbnail_photo(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    get_thumbnail_photo_inner(&state, &user_dn).await
}

/// Sets the thumbnail photo for a user. Requires AccountOperator+.
#[tauri::command]
pub async fn set_thumbnail_photo(
    user_dn: String,
    photo_base64: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    set_thumbnail_photo_inner(&state, &user_dn, &photo_base64).await
}

/// Removes the thumbnail photo for a user. Requires AccountOperator+.
#[tauri::command]
pub async fn remove_thumbnail_photo(
    user_dn: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    remove_thumbnail_photo_inner(&state, &user_dn).await
}

/// Returns the configured preset storage path.
#[tauri::command]
pub fn get_preset_path(state: State<'_, AppState>) -> Option<String> {
    get_preset_path_inner(&state)
}

/// Validates and sets the preset storage path.
#[tauri::command]
pub fn set_preset_path(path: String, state: State<'_, AppState>) -> Result<(), AppError> {
    set_preset_path_inner(&state, &path)
}

/// Tests whether a path is a valid, accessible directory for presets.
#[tauri::command]
pub fn test_preset_path(path: String) -> Result<bool, AppError> {
    test_preset_path_inner(&path)
}

/// Returns all available presets.
#[tauri::command]
pub fn list_presets(state: State<'_, AppState>) -> Vec<Preset> {
    list_presets_inner(&state)
}

/// Saves a preset to disk. Requires AccountOperator+.
#[tauri::command]
pub fn save_preset(preset: Preset, state: State<'_, AppState>) -> Result<(), AppError> {
    save_preset_inner(&state, &preset)
}

/// Deletes a preset by name. Requires AccountOperator+.
#[tauri::command]
pub fn delete_preset(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_preset_inner(&state, &name)
}

/// Accepts a preset whose checksum has changed (user acknowledges external modification).
#[tauri::command]
pub fn accept_preset_checksum(name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    accept_preset_checksum_inner(&state, &name)
}

/// Captures a full snapshot of an AD object.
#[tauri::command]
pub async fn capture_object_snapshot(
    object_dn: String,
    operation_type: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    capture_object_snapshot_inner(&state, &object_dn, &operation_type).await
}

/// Gets snapshot history for an object DN.
#[tauri::command]
pub fn get_snapshot_history(object_dn: String, state: State<'_, AppState>) -> Vec<ObjectSnapshot> {
    get_snapshot_history_inner(&state, &object_dn)
}

/// Gets a specific snapshot by ID.
#[tauri::command]
pub fn get_snapshot(id: i64, state: State<'_, AppState>) -> Option<ObjectSnapshot> {
    get_snapshot_inner(&state, id)
}

/// Computes diff between a snapshot and current object state.
#[tauri::command]
pub async fn compute_snapshot_diff(
    snapshot_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<SnapshotDiff>, AppError> {
    compute_snapshot_diff_inner(&state, snapshot_id).await
}

/// Restores an object from a snapshot. Requires DomainAdmin.
#[tauri::command]
pub async fn restore_from_snapshot(
    snapshot_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    restore_from_snapshot_inner(&state, snapshot_id).await
}

/// Cleans up expired snapshots. Returns count deleted.
#[tauri::command]
pub fn cleanup_snapshots(retention_days: i64, state: State<'_, AppState>) -> usize {
    cleanup_snapshots_inner(&state, retention_days)
}

/// Deletes a single snapshot by ID.
#[tauri::command]
pub fn delete_snapshot(snapshot_id: i64, state: State<'_, AppState>) -> bool {
    state.object_snapshot_service.delete_snapshot(snapshot_id)
}

/// Returns the current application settings.
#[tauri::command]
pub fn get_app_settings(state: State<'_, AppState>) -> AppSettings {
    state.app_settings.get()
}

/// Updates application settings and persists to disk.
///
/// If Graph settings changed, also updates the GraphExchangeService config.
/// The client secret is read from the credential store, not from settings JSON.
#[tauri::command]
pub fn set_app_settings(settings: AppSettings, state: State<'_, AppState>) {
    // Read client secret from credential store (not from settings JSON)
    let client_secret = state
        .credential_store
        .retrieve("graph_client_secret")
        .unwrap_or(None);
    let graph_config = crate::services::graph_exchange::GraphConfig {
        tenant_id: settings.graph_tenant_id.clone().unwrap_or_default(),
        client_id: settings.graph_client_id.clone().unwrap_or_default(),
        client_secret,
    };
    state.graph_exchange.set_config(graph_config);
    state.app_settings.update(settings);
}

// ---------------------------------------------------------------------------
// Permission mapping commands
// ---------------------------------------------------------------------------

/// Returns the current custom permission mappings from preset storage.
pub(crate) fn get_permission_mappings_inner(state: &AppState) -> PermissionMappings {
    let preset_path = state.preset_service.get_path();
    match preset_path {
        Some(path) => PermissionMappings::load_from(&path)
            .ok()
            .flatten()
            .unwrap_or_default(),
        None => PermissionMappings::default(),
    }
}

/// Validates, saves, and applies new permission mappings. Requires DomainAdmin.
pub(crate) fn set_permission_mappings_inner(
    state: &AppState,
    mappings: &PermissionMappings,
) -> Result<(), AppError> {
    if !state
        .permission_service
        .has_permission(PermissionLevel::DomainAdmin)
    {
        return Err(AppError::PermissionDenied(
            "Permission mapping changes require DomainAdmin permission".to_string(),
        ));
    }

    let preset_path = state.preset_service.get_path().ok_or_else(|| {
        AppError::Configuration(
            "Preset storage path is not configured. Configure it in Settings first.".to_string(),
        )
    })?;

    // Save to preset share
    mappings
        .save_to(&preset_path)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Apply to permission service (re-merge from defaults + custom)
    state.permission_service.apply_custom_mappings(mappings);

    // Audit the change
    let detail = format!(
        "Permission mappings updated: {} levels with groups configured",
        mappings.mappings.values().filter(|g| !g.is_empty()).count()
    );
    state
        .audit_service
        .log_success("PermissionMappingUpdate", "rbac-mappings.json", &detail);

    Ok(())
}

/// Validates that an AD group DN exists by searching for it.
pub(crate) async fn validate_group_exists_inner(
    state: &AppState,
    group_dn: &str,
) -> Result<bool, AppError> {
    let provider = state.directory_provider.clone();
    // Extract CN from DN to search
    let cn = group_dn
        .split(',')
        .next()
        .and_then(|part| {
            part.strip_prefix("CN=")
                .or_else(|| part.strip_prefix("cn="))
        })
        .unwrap_or("");

    if cn.is_empty() {
        return Ok(false);
    }

    match provider.search_groups(cn, 5).await {
        Ok(results) => Ok(results.iter().any(|g| g.distinguished_name == group_dn)),
        Err(_) => Ok(false),
    }
}

/// Returns the current custom permission mappings.
#[tauri::command]
pub fn get_permission_mappings(state: State<'_, AppState>) -> PermissionMappings {
    get_permission_mappings_inner(&state)
}

/// Saves new permission mappings. Requires DomainAdmin.
#[tauri::command]
pub fn set_permission_mappings(
    mappings: PermissionMappings,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    set_permission_mappings_inner(&state, &mappings)
}

/// Validates that an AD group exists by DN.
#[tauri::command]
pub async fn validate_group_exists(
    group_dn: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    validate_group_exists_inner(&state, &group_dn).await
}

// ---------------------------------------------------------------------------
// Update check commands
// ---------------------------------------------------------------------------

/// Checks GitHub for a newer version. Returns UpdateInfo if available, null otherwise.
///
/// Respects frequency settings and skip logic. Fails silently on network errors.
pub(crate) async fn check_for_update_inner(state: &AppState) -> Option<UpdateInfo> {
    let settings = state.app_settings.get();
    let update_settings = settings.update.unwrap_or_default();

    // Check frequency
    let frequency = update_settings
        .check_frequency
        .as_deref()
        .unwrap_or("startup");
    if !update::should_check(frequency, update_settings.last_check_timestamp.as_deref()) {
        return None;
    }

    // Fetch latest release
    let info = update::fetch_latest_release(&state.http_client).await?;

    // Update last check timestamp
    {
        let mut current = state.app_settings.get();
        let mut us = current.update.unwrap_or_default();
        us.last_check_timestamp = Some(chrono::Utc::now().to_rfc3339());
        current.update = Some(us);
        state.app_settings.update(current);
    }

    // Check if this version was skipped
    if let Some(ref skipped) = update_settings.skipped_version {
        if skipped == &info.version {
            tracing::debug!(version = %info.version, "Update skipped by user");
            return None;
        }
    }

    // Check if it's actually newer
    let current_version = env!("CARGO_PKG_VERSION");
    if update::is_newer(current_version, &info.version) {
        tracing::info!(
            current = current_version,
            available = %info.version,
            "Newer version available"
        );
        Some(info)
    } else {
        None
    }
}

/// Persists a version as "skipped" so it won't be shown again.
pub(crate) fn skip_update_version_inner(state: &AppState, version: &str) {
    let mut settings = state.app_settings.get();
    let mut us = settings.update.unwrap_or_default();
    us.skipped_version = Some(version.to_string());
    settings.update = Some(us);
    state.app_settings.update(settings);
    tracing::info!(version = version, "Update version skipped by user");
}

/// Checks GitHub for a newer version.
#[tauri::command]
pub async fn check_for_update(
    state: State<'_, AppState>,
) -> Result<Option<UpdateInfo>, AppError> {
    Ok(check_for_update_inner(&state).await)
}

/// Marks a version as skipped.
#[tauri::command]
pub fn skip_update_version(version: String, state: State<'_, AppState>) {
    skip_update_version_inner(&state, &version)
}

/// Stores a credential in the OS-native secure storage.
#[tauri::command]
pub fn store_credential(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    store_credential_inner(&state, &key, &value)
}

/// Retrieves a credential from the OS-native secure storage.
/// Returns null if the credential does not exist.
#[tauri::command]
pub fn get_credential(key: String, state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    get_credential_inner(&state, &key)
}

/// Deletes a credential from the OS-native secure storage.
#[tauri::command]
pub fn delete_credential(key: String, state: State<'_, AppState>) -> Result<(), AppError> {
    delete_credential_inner(&state, &key)
}

/// Tests the Microsoft Graph API connection with the current settings.
#[tauri::command]
pub async fn test_graph_connection(state: State<'_, AppState>) -> Result<bool, AppError> {
    if !state.graph_exchange.is_configured() {
        return Err(AppError::Validation(
            "Graph integration is not configured. Set tenant ID and client ID in settings."
                .to_string(),
        ));
    }
    state
        .graph_exchange
        .test_connection(&state.http_client)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Fetches Exchange Online information for a user by UPN.
#[tauri::command]
pub async fn get_exchange_online_info(
    user_principal_name: String,
    state: State<'_, AppState>,
) -> Result<Option<ExchangeOnlineInfo>, AppError> {
    if !state.graph_exchange.is_configured() {
        return Ok(None);
    }
    state
        .graph_exchange
        .get_exchange_online_info(&state.http_client, &user_principal_name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Returns whether Graph integration is configured.
#[tauri::command]
pub fn is_graph_configured(state: State<'_, AppState>) -> bool {
    state.graph_exchange.is_configured()
}

/// Opens a native save file dialog and writes content to the selected path.
///
/// Returns the path the file was saved to, or None if the user cancelled.
#[tauri::command]
pub async fn save_file_dialog(
    content: String,
    default_name: String,
    filter_name: String,
    filter_extensions: Vec<String>,
) -> Result<Option<String>, AppError> {
    let ext_refs: Vec<&str> = filter_extensions.iter().map(|s| s.as_str()).collect();
    let dialog = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &ext_refs);

    let handle = dialog.save_file().await;

    match handle {
        Some(file) => {
            let path = file.path().to_string_lossy().to_string();
            tokio::fs::write(file.path(), content.as_bytes())
                .await
                .map_err(|e| AppError::Internal(format!("Failed to write file: {}", e)))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Exports tabular data to the specified format via a save file dialog.
///
/// Supports CSV, HTML, PDF, and XLSX. For text formats (CSV, HTML), the generated
/// content is written as UTF-8. For binary formats (PDF, XLSX), raw bytes are written.
#[tauri::command]
pub async fn export_table(
    columns: Vec<crate::services::export::ColumnDefinition>,
    rows: Vec<crate::services::export::ExportRow>,
    format: String,
    title: String,
    default_name: String,
    csv_options: Option<crate::services::export::CsvOptions>,
) -> Result<Option<String>, AppError> {
    use crate::services::export;

    let (data, filter_name, filter_ext): (Vec<u8>, &str, &str) = match format.as_str() {
        "csv" => {
            let opts = csv_options.unwrap_or_default();
            let bytes = export::export_to_csv(&columns, &rows, &opts)?;
            (bytes, "CSV files", "csv")
        }
        "html" => {
            let html = export::export_to_html(&columns, &rows, &title)?;
            (html.into_bytes(), "HTML files", "html")
        }
        "pdf" => {
            let bytes = export::export_to_pdf(&columns, &rows, &title)?;
            (bytes, "PDF files", "pdf")
        }
        "xlsx" => {
            let bytes = export::export_to_xlsx(&columns, &rows, &title)?;
            (bytes, "Excel files", "xlsx")
        }
        _ => {
            return Err(AppError::Validation(format!(
                "Unsupported export format: {format}"
            )));
        }
    };

    let dialog = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter(filter_name, &[filter_ext]);

    let handle = dialog.save_file().await;

    match handle {
        Some(file) => {
            let path = file.path().to_string_lossy().to_string();
            tokio::fs::write(file.path(), &data)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Opens a native folder picker dialog and returns the selected path, or None if cancelled.
#[tauri::command]
pub async fn pick_folder_dialog() -> Result<Option<String>, AppError> {
    let handle = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(handle.map(|f| f.path().to_string_lossy().to_string()))
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DirectoryEntry;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::PermissionConfig;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn make_state() -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_user_entry(sam: &str, display: &str) -> DirectoryEntry {
        let mut attrs = HashMap::new();
        attrs.insert("mail".to_string(), vec![format!("{}@example.com", sam)]);
        DirectoryEntry {
            distinguished_name: format!("CN={},OU=Users,DC=example,DC=com", display),
            sam_account_name: Some(sam.to_string()),
            display_name: Some(display.to_string()),
            object_class: Some("user".to_string()),
            attributes: attrs,
        }
    }

    fn make_state_with_users(users: Vec<DirectoryEntry>) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_users(users));
        AppState::new_for_test(provider, PermissionConfig::default())
    }

    fn make_state_with_level(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    fn make_state_with_level_and_provider(
        level: PermissionLevel,
    ) -> (AppState, Arc<MockDirectoryProvider>) {
        let provider = Arc::new(MockDirectoryProvider::new());
        let provider_ref = Arc::clone(&provider);
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        (state, provider_ref)
    }

    fn make_state_with_level_and_failure(level: PermissionLevel) -> AppState {
        let provider = Arc::new(MockDirectoryProvider::new().with_failure());
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state.permission_service.set_level(level);
        state
    }

    // -----------------------------------------------------------------------
    // recycle bin tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_is_recycle_bin_enabled_requires_domain_admin() {
        let state = make_state();
        let result = is_recycle_bin_enabled_inner(&state).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_is_recycle_bin_enabled_returns_true() {
        let (state, _) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let result = is_recycle_bin_enabled_inner(&state).await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn test_get_deleted_objects_requires_domain_admin() {
        let state = make_state();
        let result = get_deleted_objects_inner(&state).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_get_deleted_objects_returns_list() {
        use crate::models::DeletedObject;

        let provider =
            Arc::new(
                MockDirectoryProvider::new().with_deleted_objects(vec![DeletedObject {
                    distinguished_name: "CN=Test\\0ADEL:abc,CN=Deleted Objects,DC=example,DC=com"
                        .to_string(),
                    name: "Test".to_string(),
                    object_type: "user".to_string(),
                    deletion_date: "2026-03-20".to_string(),
                    original_ou: "OU=Users,DC=example,DC=com".to_string(),
                }]),
            );
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        state
            .permission_service
            .set_level(PermissionLevel::DomainAdmin);

        let result = get_deleted_objects_inner(&state).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Test");
    }

    #[tokio::test]
    async fn test_restore_deleted_object_requires_domain_admin() {
        let state = make_state();
        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn test_restore_deleted_object_success_and_audit() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);

        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_ok());

        let calls = provider.restore_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=Test,CN=Deleted Objects,DC=example,DC=com");
        assert_eq!(calls[0].1, "OU=Users,DC=example,DC=com");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ObjectRestored"));
    }

    #[tokio::test]
    async fn test_restore_deleted_object_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::DomainAdmin);

        let result = restore_deleted_object_inner(
            &state,
            "CN=Test,CN=Deleted Objects,DC=example,DC=com",
            "OU=Users,DC=example,DC=com",
        )
        .await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "RestoreObjectFailed"));
    }

    // -----------------------------------------------------------------------
    // Contact management tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_create_contact_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let attrs = HashMap::new();
        let result = create_contact_inner(&state, "OU=Contacts,DC=example,DC=com", &attrs).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_contact_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let mut attrs = HashMap::new();
        attrs.insert("displayName".to_string(), "New Contact".to_string());
        let result = create_contact_inner(&state, "OU=Contacts,DC=example,DC=com", &attrs).await;
        assert!(result.is_ok());
        let dn = result.unwrap();
        assert!(dn.contains("New Contact"));

        let calls = provider.create_contact_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ContactCreated"));
    }

    #[tokio::test]
    async fn test_delete_contact_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result = delete_contact_inner(&state, "CN=Old,OU=Contacts,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    // -----------------------------------------------------------------------
    // Printer management tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_create_printer_requires_domain_admin() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let attrs = HashMap::new();
        let result = create_printer_inner(&state, "OU=Printers,DC=example,DC=com", &attrs).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_delete_printer_requires_domain_admin() {
        let state = make_state_with_level(PermissionLevel::AccountOperator);
        let result =
            delete_printer_inner(&state, "CN=OldPrinter,OU=Printers,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    // -----------------------------------------------------------------------
    // Thumbnail Photo tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_get_thumbnail_photo_returns_none() {
        let state = make_state();
        let result = get_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_get_thumbnail_photo_returns_photo() {
        let provider = Arc::new(
            MockDirectoryProvider::new()
                .with_thumbnail_photo("CN=John,OU=Users,DC=example,DC=com", "dGVzdA=="),
        );
        let state = AppState::new_for_test(provider, PermissionConfig::default());
        let result = get_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Some("dGVzdA==".to_string()));
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_ok());

        let calls = provider.set_photo_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=John,OU=Users,DC=example,DC=com");
        assert_eq!(calls[0].1, "dGVzdA==");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ThumbnailPhotoSet"));
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_requires_account_operator() {
        let state = make_state(); // ReadOnly
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("AccountOperator"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_success_and_audit() {
        let (state, provider) =
            make_state_with_level_and_provider(PermissionLevel::AccountOperator);
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_ok());

        let calls = provider.remove_photo_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], "CN=John,OU=Users,DC=example,DC=com");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "ThumbnailPhotoRemoved"));
    }

    #[tokio::test]
    async fn test_set_thumbnail_photo_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);
        let result =
            set_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com", "dGVzdA==")
                .await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries
            .iter()
            .any(|e| e.action == "ThumbnailPhotoSetFailed"));
    }

    #[tokio::test]
    async fn test_remove_thumbnail_photo_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::AccountOperator);
        let result =
            remove_thumbnail_photo_inner(&state, "CN=John,OU=Users,DC=example,DC=com").await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries
            .iter()
            .any(|e| e.action == "ThumbnailPhotoRemoveFailed"));
    }

    // -----------------------------------------------------------------------
    // Preset command tests
    // -----------------------------------------------------------------------

    fn make_state_with_preset_dir(level: PermissionLevel) -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (state, _) = make_state_with_level_and_provider(level);
        state
            .preset_service
            .configure_path(dir.path().to_str().unwrap())
            .unwrap();
        (state, dir)
    }

    fn make_test_preset() -> Preset {
        use crate::models::PresetType;
        Preset {
            name: "Test Preset".to_string(),
            description: "For testing".to_string(),
            preset_type: PresetType::Onboarding,
            target_ou: "OU=Test,DC=example,DC=com".to_string(),
            groups: vec!["CN=Group1,DC=example,DC=com".to_string()],
            attributes: std::collections::HashMap::new(),
            integrity_warning: false,
        }
    }

    #[test]
    fn test_get_preset_path_inner_none_by_default() {
        let state = make_state();
        assert!(get_preset_path_inner(&state).is_none());
    }

    #[test]
    fn test_set_and_get_preset_path() {
        let dir = tempfile::tempdir().unwrap();
        let state = make_state();
        set_preset_path_inner(&state, dir.path().to_str().unwrap()).unwrap();
        let path = get_preset_path_inner(&state);
        assert!(path.is_some());
    }

    #[test]
    fn test_set_preset_path_invalid() {
        let state = make_state();
        let result = set_preset_path_inner(&state, "/nonexistent/12345");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Configuration(_)));
    }

    #[test]
    fn test_test_preset_path_valid() {
        let dir = tempfile::tempdir().unwrap();
        let result = test_preset_path_inner(dir.path().to_str().unwrap()).unwrap();
        assert!(result);
    }

    #[test]
    fn test_test_preset_path_invalid() {
        let result = test_preset_path_inner("/nonexistent/12345").unwrap();
        assert!(!result);
    }

    #[test]
    fn test_list_presets_empty() {
        let state = make_state();
        assert!(list_presets_inner(&state).is_empty());
    }

    #[test]
    fn test_save_preset_requires_account_operator() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::HelpDesk);
        let result = save_preset_inner(&state, &make_test_preset());
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[test]
    fn test_save_preset_success() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        let presets = list_presets_inner(&state);
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].name, "Test Preset");
    }

    #[test]
    fn test_save_preset_audits() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "PresetSaved"));
    }

    #[test]
    fn test_delete_preset_requires_account_operator() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::HelpDesk);
        let result = delete_preset_inner(&state, "Test");
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[test]
    fn test_delete_preset_success() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        assert_eq!(list_presets_inner(&state).len(), 1);

        delete_preset_inner(&state, "Test Preset").unwrap();
        assert!(list_presets_inner(&state).is_empty());
    }

    #[test]
    fn test_delete_preset_audits() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        save_preset_inner(&state, &make_test_preset()).unwrap();
        delete_preset_inner(&state, "Test Preset").unwrap();
        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "PresetDeleted"));
    }

    #[test]
    fn test_delete_preset_nonexistent() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        let result = delete_preset_inner(&state, "Nonexistent");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // credential store tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_store_and_get_credential() {
        let state = make_state();
        store_credential_inner(&state, "graph_client_secret", "test-secret").unwrap();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, Some("test-secret".to_string()));
    }

    #[test]
    fn test_get_credential_missing_returns_none() {
        let state = make_state();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_delete_credential() {
        let state = make_state();
        store_credential_inner(&state, "graph_client_secret", "test-secret").unwrap();
        delete_credential_inner(&state, "graph_client_secret").unwrap();
        let retrieved = get_credential_inner(&state, "graph_client_secret").unwrap();
        assert_eq!(retrieved, None);
    }

    #[test]
    fn test_store_credential_rejects_invalid_key() {
        let state = make_state();
        let result = store_credential_inner(&state, "bad_key", "value");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_credential_rejects_invalid_key() {
        let state = make_state();
        let result = get_credential_inner(&state, "bad_key");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Object Snapshot command tests
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_capture_object_snapshot_stores_snapshot() {
        let users = vec![make_user_entry("jdoe", "John Doe")];
        let state = make_state_with_users(users);
        let id = capture_object_snapshot_inner(
            &state,
            "CN=John Doe,OU=Users,DC=example,DC=com",
            "ModifyAttribute",
        )
        .await
        .unwrap();
        assert!(id > 0);
        assert_eq!(state.object_snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_capture_object_snapshot_empty_when_no_entry() {
        let state = make_state();
        let id = capture_object_snapshot_inner(&state, "CN=Unknown", "Op")
            .await
            .unwrap();
        assert!(id > 0);
        let snapshot = state.object_snapshot_service.get_snapshot(id).unwrap();
        assert_eq!(snapshot.attributes_json, "{}");
    }

    #[test]
    fn test_get_snapshot_history_returns_ordered_list() {
        let state = make_state();
        state
            .object_snapshot_service
            .capture("dn1", "Op1", r#"{"a":"1"}"#, "test");
        state
            .object_snapshot_service
            .capture("dn1", "Op2", r#"{"a":"2"}"#, "test");
        state
            .object_snapshot_service
            .capture("dn2", "Op3", r#"{"a":"3"}"#, "test");

        let history = get_snapshot_history_inner(&state, "dn1");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].operation_type, "Op2");
        assert_eq!(history[1].operation_type, "Op1");
    }

    #[test]
    fn test_get_snapshot_returns_by_id() {
        let state = make_state();
        let id = state
            .object_snapshot_service
            .capture("dn1", "Op1", r#"{"key":"val"}"#, "test");
        let snapshot = get_snapshot_inner(&state, id).unwrap();
        assert_eq!(snapshot.object_dn, "dn1");
        assert_eq!(snapshot.attributes_json, r#"{"key":"val"}"#);
    }

    #[test]
    fn test_get_snapshot_returns_none_for_missing() {
        let state = make_state();
        assert!(get_snapshot_inner(&state, 999).is_none());
    }

    #[test]
    fn test_cleanup_snapshots_removes_old_entries() {
        let state = make_state();
        // Insert an old snapshot manually
        {
            let conn = state.object_snapshot_service.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO object_snapshots (object_dn, operation_type, timestamp, operator, attributes_json)
                 VALUES ('old_dn', 'OldOp', '2020-01-01T00:00:00Z', 'test', '{}')",
                [],
            )
            .unwrap();
        }
        state
            .object_snapshot_service
            .capture("new_dn", "NewOp", "{}", "test");
        assert_eq!(state.object_snapshot_service.count(), 2);

        let deleted = cleanup_snapshots_inner(&state, 30);
        assert_eq!(deleted, 1);
        assert_eq!(state.object_snapshot_service.count(), 1);
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_requires_domain_admin() {
        let state = make_state(); // ReadOnly by default
        state
            .object_snapshot_service
            .capture("dn1", "Op", r#"{"cn":["Test"]}"#, "test");
        let result = restore_from_snapshot_inner(&state, 1).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::PermissionDenied(msg) => {
                assert!(msg.contains("DomainAdmin"));
            }
            other => panic!("Expected PermissionDenied, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_success_and_audit() {
        let (state, provider) = make_state_with_level_and_provider(PermissionLevel::DomainAdmin);
        let id = state.object_snapshot_service.capture(
            "CN=Test,DC=example,DC=com",
            "ModifyAttribute",
            r#"{"mail":["test@example.com"]}"#,
            "TestAdmin",
        );
        let result = restore_from_snapshot_inner(&state, id).await;
        assert!(result.is_ok());

        let calls = provider.modify_attribute_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "CN=Test,DC=example,DC=com");
        assert_eq!(calls[0].1, "mail");

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "SnapshotRestored"));
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_not_found() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let result = restore_from_snapshot_inner(&state, 999).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("not found"));
            }
            other => panic!("Expected Validation, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_restore_from_snapshot_failure_audits() {
        let state = make_state_with_level_and_failure(PermissionLevel::DomainAdmin);
        let id = state.object_snapshot_service.capture(
            "CN=Fail,DC=example,DC=com",
            "Op",
            r#"{"givenName":["Fail"],"sn":["Test"]}"#,
            "TestAdmin",
        );
        let result = restore_from_snapshot_inner(&state, id).await;
        assert!(result.is_err());

        let entries = state.audit_service.get_entries();
        assert!(entries.iter().any(|e| e.action == "SnapshotRestoreFailed"));
    }

    #[tokio::test]
    async fn test_compute_snapshot_diff_not_found() {
        let state = make_state();
        let result = compute_snapshot_diff_inner(&state, 999).await;
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // permission mapping tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_permission_mappings_empty_when_no_preset_path() {
        let state = make_state();
        let result = get_permission_mappings_inner(&state);
        assert!(result.is_empty());
    }

    #[test]
    fn test_get_permission_mappings_empty_when_no_file() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::DomainAdmin);
        let result = get_permission_mappings_inner(&state);
        assert!(result.is_empty());
    }

    #[test]
    fn test_set_permission_mappings_requires_domain_admin() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::AccountOperator);
        let mappings = PermissionMappings::default();
        let result = set_permission_mappings_inner(&state, &mappings);
        assert!(matches!(result.unwrap_err(), AppError::PermissionDenied(_)));
    }

    #[test]
    fn test_set_permission_mappings_requires_preset_path() {
        let state = make_state_with_level(PermissionLevel::DomainAdmin);
        let mappings = PermissionMappings::default();
        let result = set_permission_mappings_inner(&state, &mappings);
        assert!(matches!(result.unwrap_err(), AppError::Configuration(_)));
    }

    #[test]
    fn test_set_permission_mappings_saves_and_loads() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::DomainAdmin);
        let mut m = std::collections::HashMap::new();
        m.insert(
            PermissionLevel::HelpDesk,
            vec!["CN=IT-Support,OU=Groups,DC=contoso,DC=com".to_string()],
        );
        let mappings = PermissionMappings { mappings: m };
        set_permission_mappings_inner(&state, &mappings).unwrap();

        // Verify saved by loading
        let loaded = get_permission_mappings_inner(&state);
        assert_eq!(
            loaded
                .mappings
                .get(&PermissionLevel::HelpDesk)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn test_set_permission_mappings_audits() {
        let (state, _dir) = make_state_with_preset_dir(PermissionLevel::DomainAdmin);
        let mappings = PermissionMappings::default();
        set_permission_mappings_inner(&state, &mappings).unwrap();

        let entries = state.audit_service.get_entries();
        assert!(entries
            .iter()
            .any(|e| e.action == "PermissionMappingUpdate"));
    }

    #[tokio::test]
    async fn test_validate_group_exists_returns_false_for_empty() {
        let state = make_state();
        let result = validate_group_exists_inner(&state, "").await.unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn test_validate_group_exists_returns_false_for_nonexistent() {
        let state = make_state();
        let result =
            validate_group_exists_inner(&state, "CN=NonexistentGroup,OU=Groups,DC=example,DC=com")
                .await
                .unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn test_compute_snapshot_diff_returns_diffs() {
        let state = make_state();
        state.object_snapshot_service.capture(
            "CN=Test",
            "Op",
            r#"{"mail":["old@example.com"],"cn":["Test"]}"#,
            "TestAdmin",
        );
        let diffs = compute_snapshot_diff_inner(&state, 1).await.unwrap();
        assert!(!diffs.is_empty());
        assert!(diffs.iter().any(|d| d.attribute == "mail"));
    }
}
