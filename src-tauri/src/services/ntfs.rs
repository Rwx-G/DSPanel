use serde::{Deserialize, Serialize};

/// Represents a single Access Control Entry from an NTFS ACL.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AceEntry {
    pub trustee_sid: String,
    pub trustee_display_name: String,
    pub access_type: AceAccessType,
    pub permissions: Vec<String>,
    pub is_inherited: bool,
}

/// Allow or Deny access control.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AceAccessType {
    Allow,
    Deny,
}

/// Result of an NTFS permissions audit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NtfsAuditResult {
    pub path: String,
    pub aces: Vec<AceEntry>,
    pub errors: Vec<String>,
}

/// Per-user access indicator for an ACE.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum AccessIndicator {
    /// User is a member of the ACE trustee group and ACE is Allow
    Allowed,
    /// User is not a member of the ACE trustee group
    NoMatch,
    /// User is a member of the ACE trustee group and ACE is Deny
    Denied,
}

/// Cross-reference result for a single ACE against two users.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AceCrossReference {
    pub ace: AceEntry,
    pub user_a_access: AccessIndicator,
    pub user_b_access: AccessIndicator,
}

/// Validates that a string is a well-formed UNC path.
pub fn validate_unc_path(path: &str) -> Result<(), String> {
    if !path.starts_with("\\\\") {
        return Err("Path must start with \\\\".to_string());
    }
    let without_prefix = &path[2..];
    if without_prefix.is_empty() || !without_prefix.contains('\\') {
        return Err("Path must contain at least a server and share name".to_string());
    }
    // Reject path traversal segments
    if path.split('\\').any(|seg| seg == "..") {
        return Err("Path must not contain '..' traversal segments".to_string());
    }
    Ok(())
}

/// Maps file system access mask bits to human-readable permission names.
pub fn format_permissions(access_mask: u32) -> Vec<String> {
    let mut perms = Vec::new();

    // Full control
    if access_mask & 0x1F01FF == 0x1F01FF {
        perms.push("FullControl".to_string());
        return perms;
    }

    // Modify (includes read, write, execute, delete)
    if access_mask & 0x1301BF == 0x1301BF {
        perms.push("Modify".to_string());
        return perms;
    }

    // Read & Execute
    if access_mask & 0x1200A9 == 0x1200A9 {
        perms.push("ReadAndExecute".to_string());
    } else {
        if access_mask & 0x120089 == 0x120089 {
            perms.push("Read".to_string());
        }
        if access_mask & 0x000020 != 0 {
            perms.push("ExecuteFile".to_string());
        }
    }

    if access_mask & 0x120116 == 0x120116 {
        perms.push("Write".to_string());
    }

    if access_mask & 0x010000 != 0 {
        perms.push("Delete".to_string());
    }

    if access_mask & 0x040000 != 0 {
        perms.push("WriteDAC".to_string());
    }

    if access_mask & 0x080000 != 0 {
        perms.push("WriteOwner".to_string());
    }

    if perms.is_empty() {
        perms.push(format!("Special(0x{:X})", access_mask));
    }

    perms
}

/// Cross-references an ACE trustee against a user's group SIDs.
///
/// Checks if the trustee SID matches any SID in the user's group list
/// or the user's own SID.
pub fn check_user_access(ace: &AceEntry, user_sids: &[String]) -> AccessIndicator {
    let trustee_lower = ace.trustee_sid.to_lowercase();
    let is_member = user_sids
        .iter()
        .any(|sid| sid.to_lowercase() == trustee_lower);

    if !is_member {
        return AccessIndicator::NoMatch;
    }

    match ace.access_type {
        AceAccessType::Allow => AccessIndicator::Allowed,
        AceAccessType::Deny => AccessIndicator::Denied,
    }
}

/// Builds cross-reference results for a list of ACEs against two users.
pub fn cross_reference_aces(
    aces: &[AceEntry],
    user_a_sids: &[String],
    user_b_sids: &[String],
) -> Vec<AceCrossReference> {
    aces.iter()
        .map(|ace| AceCrossReference {
            ace: ace.clone(),
            user_a_access: check_user_access(ace, user_a_sids),
            user_b_access: check_user_access(ace, user_b_sids),
        })
        .collect()
}

/// Reads NTFS ACL from a UNC path using Windows API.
///
/// On non-Windows platforms, returns an error.
#[cfg(windows)]
#[allow(clippy::transmute_ptr_to_ref, clippy::missing_transmute_annotations)]
pub fn read_acl(path: &str) -> Result<Vec<AceEntry>, String> {
    use std::ptr;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACCESS_DENIED_ACE, ACE_HEADER, ACL as WinAcl,
        DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    };

    validate_unc_path(path)?;

    let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

    let mut sd: PSECURITY_DESCRIPTOR = PSECURITY_DESCRIPTOR(ptr::null_mut());
    let mut dacl_ptr: *mut WinAcl = ptr::null_mut();

    let result = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(wide_path.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut dacl_ptr),
            None,
            &mut sd,
        )
    };

    if result.is_err() {
        return Err(format!(
            "Failed to read ACL for {}: access denied or path not found",
            path
        ));
    }

    let mut entries = Vec::new();

    if !dacl_ptr.is_null() {
        let dacl = unsafe { &*dacl_ptr };
        let ace_count = dacl.AceCount as usize;
        let acl_bytes = dacl_ptr as *const u8;

        let mut offset = std::mem::size_of::<WinAcl>();
        for _ in 0..ace_count {
            let ace_header = unsafe { &*(acl_bytes.add(offset) as *const ACE_HEADER) };
            let ace_type = ace_header.AceType;
            let ace_size = ace_header.AceSize as usize;
            let is_inherited = (ace_header.AceFlags & 0x10) != 0; // INHERITED_ACE

            match ace_type {
                0 => {
                    // ACCESS_ALLOWED_ACE_TYPE
                    let ace = unsafe { &*(acl_bytes.add(offset) as *const ACCESS_ALLOWED_ACE) };
                    let sid_ptr = &ace.SidStart as *const u32;
                    let sid_raw = sid_ptr as *const std::ffi::c_void;
                    let sid_string = sid_to_string(sid_raw);
                    let display_name =
                        lookup_account_name(sid_raw).unwrap_or_else(|| sid_string.clone());
                    entries.push(AceEntry {
                        trustee_sid: sid_string,
                        trustee_display_name: display_name,
                        access_type: AceAccessType::Allow,
                        permissions: format_permissions(ace.Mask),
                        is_inherited,
                    });
                }
                1 => {
                    // ACCESS_DENIED_ACE_TYPE
                    let ace = unsafe { &*(acl_bytes.add(offset) as *const ACCESS_DENIED_ACE) };
                    let sid_ptr = &ace.SidStart as *const u32;
                    let sid_raw = sid_ptr as *const std::ffi::c_void;
                    let sid_string = sid_to_string(sid_raw);
                    let display_name =
                        lookup_account_name(sid_raw).unwrap_or_else(|| sid_string.clone());
                    entries.push(AceEntry {
                        trustee_sid: sid_string,
                        trustee_display_name: display_name,
                        access_type: AceAccessType::Deny,
                        permissions: format_permissions(ace.Mask),
                        is_inherited,
                    });
                }
                _ => {
                    // Skip other ACE types (audit, etc.)
                }
            }

            offset += ace_size;
        }
    }

    // Free the security descriptor
    if !sd.0.is_null() {
        unsafe {
            let _ = LocalFree(Some(std::mem::transmute(sd.0)));
        };
    }

    Ok(entries)
}

#[cfg(windows)]
#[allow(clippy::transmute_ptr_to_ref, clippy::missing_transmute_annotations)]
fn sid_to_string(sid: *const std::ffi::c_void) -> String {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::PSID;

    let mut string_sid = windows::core::PWSTR::null();
    let result = unsafe { ConvertSidToStringSidW(PSID(sid as *mut _), &mut string_sid) };

    if result.is_ok() {
        let s = unsafe { string_sid.to_string() }.unwrap_or_default();
        unsafe {
            let _ = windows::Win32::Foundation::LocalFree(Some(std::mem::transmute(string_sid.0)));
        };
        s
    } else {
        "Unknown SID".to_string()
    }
}

/// Resolves a SID to a DOMAIN\Username display name via LookupAccountSidW.
/// Falls back to the raw SID string if resolution fails.
#[cfg(windows)]
fn lookup_account_name(sid: *const std::ffi::c_void) -> Option<String> {
    use windows::Win32::Security::{LookupAccountSidW, PSID, SID_NAME_USE};

    let psid = PSID(sid as *mut _);

    // First call to get buffer sizes
    let mut name_len: u32 = 0;
    let mut domain_len: u32 = 0;
    let mut sid_type = SID_NAME_USE::default();

    let _ = unsafe {
        LookupAccountSidW(
            None,
            psid,
            windows::core::PWSTR::null(),
            &mut name_len,
            windows::core::PWSTR::null(),
            &mut domain_len,
            &mut sid_type,
        )
    };

    if name_len == 0 {
        return None;
    }

    let mut name_buf: Vec<u16> = vec![0; name_len as usize];
    let mut domain_buf: Vec<u16> = vec![0; domain_len as usize];

    let result = unsafe {
        LookupAccountSidW(
            None,
            psid,
            windows::core::PWSTR(name_buf.as_mut_ptr()),
            &mut name_len,
            windows::core::PWSTR(domain_buf.as_mut_ptr()),
            &mut domain_len,
            &mut sid_type,
        )
    };

    if result.is_ok() {
        let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
        let domain = String::from_utf16_lossy(&domain_buf[..domain_len as usize]);
        if domain.is_empty() {
            Some(name)
        } else {
            Some(format!("{}\\{}", domain, name))
        }
    } else {
        None
    }
}

#[cfg(not(windows))]
pub fn read_acl(_path: &str) -> Result<Vec<AceEntry>, String> {
    Err("NTFS ACL reading is only supported on Windows".to_string())
}

/// Returns demo ACL data for testing without a real UNC path.
///
/// Group names match those assigned to demo users (e.g. "IT Team",
/// "Engineering Team") so that "View group members" returns results.
#[cfg(feature = "demo")]
pub fn read_acl_demo(path: &str) -> Vec<AceEntry> {
    let seed = path
        .bytes()
        .fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));

    let mut aces = vec![
        AceEntry {
            trustee_sid: "S-1-5-32-544".to_string(),
            trustee_display_name: "BUILTIN\\Administrators".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["FullControl".to_string()],
            is_inherited: false,
        },
        AceEntry {
            trustee_sid: "S-1-5-18".to_string(),
            trustee_display_name: "NT AUTHORITY\\SYSTEM".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["FullControl".to_string()],
            is_inherited: false,
        },
        AceEntry {
            trustee_sid: "S-1-5-21-1234567890-9876543210-1111111111-513".to_string(),
            trustee_display_name: "CONTOSO\\Domain Users".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["ReadAndExecute".to_string()],
            is_inherited: true,
        },
        AceEntry {
            trustee_sid: "S-1-5-21-1234567890-9876543210-1111111111-1102".to_string(),
            trustee_display_name: "CONTOSO\\IT Team".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Modify".to_string()],
            is_inherited: true,
        },
        AceEntry {
            trustee_sid: "S-1-5-21-1234567890-9876543210-1111111111-1105".to_string(),
            trustee_display_name: "CONTOSO\\Finance Team".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string(), "Write".to_string()],
            is_inherited: false,
        },
    ];

    // Add a deny ACE for some paths
    if seed % 3 == 0 {
        aces.push(AceEntry {
            trustee_sid: "S-1-5-21-1234567890-9876543210-1111111111-1108".to_string(),
            trustee_display_name: "CONTOSO\\Sales Team".to_string(),
            access_type: AceAccessType::Deny,
            permissions: vec!["Write".to_string(), "Delete".to_string()],
            is_inherited: false,
        });
    }

    // Vary some ACEs based on path depth
    if path.matches('\\').count() > 4 {
        aces.push(AceEntry {
            trustee_sid: "S-1-5-21-1234567890-9876543210-1111111111-1106".to_string(),
            trustee_display_name: "CONTOSO\\Engineering Team".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Modify".to_string()],
            is_inherited: false,
        });
    }

    aces
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_unc_path_valid() {
        assert!(validate_unc_path("\\\\server\\share").is_ok());
        assert!(validate_unc_path("\\\\server\\share\\folder").is_ok());
        assert!(validate_unc_path("\\\\192.168.1.1\\data").is_ok());
    }

    #[test]
    fn test_validate_unc_path_no_prefix() {
        let result = validate_unc_path("C:\\folder");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with"));
    }

    #[test]
    fn test_validate_unc_path_missing_share() {
        let result = validate_unc_path("\\\\server");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("server and share"));
    }

    #[test]
    fn test_validate_unc_path_empty() {
        let result = validate_unc_path("");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_unc_path_single_slash() {
        let result = validate_unc_path("\\server\\share");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_unc_path_rejects_traversal() {
        let result = validate_unc_path("\\\\server\\share\\..\\..\\Windows\\System32");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    #[test]
    fn test_validate_unc_path_allows_dots_in_names() {
        assert!(validate_unc_path("\\\\server\\share\\folder.name").is_ok());
        assert!(validate_unc_path("\\\\server\\share\\.hidden").is_ok());
    }

    #[test]
    fn test_format_permissions_full_control() {
        let perms = format_permissions(0x1F01FF);
        assert_eq!(perms, vec!["FullControl"]);
    }

    #[test]
    fn test_format_permissions_modify() {
        let perms = format_permissions(0x1301BF);
        assert_eq!(perms, vec!["Modify"]);
    }

    #[test]
    fn test_format_permissions_read_and_execute() {
        let perms = format_permissions(0x1200A9);
        assert_eq!(perms, vec!["ReadAndExecute"]);
    }

    #[test]
    fn test_format_permissions_read() {
        let perms = format_permissions(0x120089);
        assert!(perms.contains(&"Read".to_string()));
    }

    #[test]
    fn test_format_permissions_write() {
        let perms = format_permissions(0x120116);
        assert!(perms.contains(&"Write".to_string()));
    }

    #[test]
    fn test_format_permissions_delete() {
        let perms = format_permissions(0x010000);
        assert!(perms.contains(&"Delete".to_string()));
    }

    #[test]
    fn test_format_permissions_special() {
        let perms = format_permissions(0x000001);
        assert!(perms[0].starts_with("Special"));
    }

    #[test]
    fn test_check_user_access_allowed() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-123".to_string(),
            trustee_display_name: "TestGroup".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let sids = vec!["S-1-5-21-123".to_string()];
        assert_eq!(check_user_access(&ace, &sids), AccessIndicator::Allowed);
    }

    #[test]
    fn test_check_user_access_denied() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-123".to_string(),
            trustee_display_name: "TestGroup".to_string(),
            access_type: AceAccessType::Deny,
            permissions: vec!["Write".to_string()],
            is_inherited: false,
        };
        let sids = vec!["S-1-5-21-123".to_string()];
        assert_eq!(check_user_access(&ace, &sids), AccessIndicator::Denied);
    }

    #[test]
    fn test_check_user_access_no_match() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-999".to_string(),
            trustee_display_name: "OtherGroup".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let sids = vec!["S-1-5-21-123".to_string()];
        assert_eq!(check_user_access(&ace, &sids), AccessIndicator::NoMatch);
    }

    #[test]
    fn test_check_user_access_case_insensitive() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-ABC".to_string(),
            trustee_display_name: "TestGroup".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let sids = vec!["s-1-5-21-abc".to_string()];
        assert_eq!(check_user_access(&ace, &sids), AccessIndicator::Allowed);
    }

    #[test]
    fn test_cross_reference_aces() {
        let aces = vec![
            AceEntry {
                trustee_sid: "S-1-5-21-100".to_string(),
                trustee_display_name: "GroupA".to_string(),
                access_type: AceAccessType::Allow,
                permissions: vec!["Read".to_string()],
                is_inherited: false,
            },
            AceEntry {
                trustee_sid: "S-1-5-21-200".to_string(),
                trustee_display_name: "GroupB".to_string(),
                access_type: AceAccessType::Deny,
                permissions: vec!["Write".to_string()],
                is_inherited: true,
            },
        ];

        let user_a_sids = vec!["S-1-5-21-100".to_string()]; // In GroupA only
        let user_b_sids = vec!["S-1-5-21-100".to_string(), "S-1-5-21-200".to_string()]; // In both

        let results = cross_reference_aces(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 2);

        // ACE 1: GroupA Allow
        assert_eq!(results[0].user_a_access, AccessIndicator::Allowed);
        assert_eq!(results[0].user_b_access, AccessIndicator::Allowed);

        // ACE 2: GroupB Deny
        assert_eq!(results[1].user_a_access, AccessIndicator::NoMatch);
        assert_eq!(results[1].user_b_access, AccessIndicator::Denied);
    }

    #[test]
    fn test_cross_reference_empty_aces() {
        let aces: Vec<AceEntry> = vec![];
        let results = cross_reference_aces(&aces, &[], &[]);
        assert!(results.is_empty());
    }

    #[test]
    fn test_ace_entry_serialization() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-123".to_string(),
            trustee_display_name: "Admins".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["FullControl".to_string()],
            is_inherited: false,
        };
        let json = serde_json::to_string(&ace).unwrap();
        assert!(json.contains("trusteeSid"));
        assert!(json.contains("trusteeDisplayName"));
        assert!(json.contains("accessType"));
        assert!(json.contains("isInherited"));
    }

    #[test]
    fn test_ntfs_audit_result_serialization() {
        let result = NtfsAuditResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![],
            errors: vec![],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("path"));
        assert!(json.contains("aces"));
        assert!(json.contains("errors"));
    }

    #[test]
    fn test_access_indicator_serialization() {
        let allowed = serde_json::to_string(&AccessIndicator::Allowed).unwrap();
        let denied = serde_json::to_string(&AccessIndicator::Denied).unwrap();
        let no_match = serde_json::to_string(&AccessIndicator::NoMatch).unwrap();
        assert!(allowed.contains("Allowed"));
        assert!(denied.contains("Denied"));
        assert!(no_match.contains("NoMatch"));
    }

    #[cfg(not(windows))]
    #[test]
    fn test_read_acl_not_windows() {
        let result = read_acl("\\\\server\\share");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("only supported on Windows"));
    }

    // -----------------------------------------------------------------------
    // format_permissions - additional coverage
    // -----------------------------------------------------------------------

    #[test]
    fn test_format_permissions_execute_file() {
        // ExecuteFile flag without ReadAndExecute
        let perms = format_permissions(0x000020);
        assert!(perms.contains(&"ExecuteFile".to_string()));
    }

    #[test]
    fn test_format_permissions_write_dac() {
        let perms = format_permissions(0x040000);
        assert!(perms.contains(&"WriteDAC".to_string()));
    }

    #[test]
    fn test_format_permissions_write_owner() {
        let perms = format_permissions(0x080000);
        assert!(perms.contains(&"WriteOwner".to_string()));
    }

    #[test]
    fn test_format_permissions_combined_read_write_delete() {
        // Read + Write + Delete combined
        let mask = 0x120089 | 0x120116 | 0x010000;
        let perms = format_permissions(mask);
        assert!(perms.contains(&"Read".to_string()));
        assert!(perms.contains(&"Write".to_string()));
        assert!(perms.contains(&"Delete".to_string()));
    }

    #[test]
    fn test_format_permissions_read_and_execute_includes_read() {
        // ReadAndExecute mask includes Read, so only ReadAndExecute should appear
        let perms = format_permissions(0x1200A9);
        assert_eq!(perms.len(), 1);
        assert_eq!(perms[0], "ReadAndExecute");
    }

    #[test]
    fn test_format_permissions_zero_returns_special() {
        let perms = format_permissions(0x000000);
        assert_eq!(perms.len(), 1);
        assert!(perms[0].starts_with("Special"));
    }

    #[test]
    fn test_format_permissions_full_control_overrides_others() {
        // Full control mask should return only FullControl
        let perms = format_permissions(0x1F01FF);
        assert_eq!(perms.len(), 1);
        assert_eq!(perms[0], "FullControl");
    }

    #[test]
    fn test_format_permissions_modify_overrides_read_write() {
        let perms = format_permissions(0x1301BF);
        assert_eq!(perms.len(), 1);
        assert_eq!(perms[0], "Modify");
    }

    // -----------------------------------------------------------------------
    // validate_unc_path - additional edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_unc_path_just_slashes() {
        let result = validate_unc_path("\\\\");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_unc_path_deep_path() {
        assert!(validate_unc_path("\\\\server\\share\\a\\b\\c\\d\\e").is_ok());
    }

    #[test]
    fn test_validate_unc_path_traversal_in_middle() {
        let result = validate_unc_path("\\\\server\\share\\a\\..\\b");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("traversal"));
    }

    // -----------------------------------------------------------------------
    // cross_reference_aces - more combinations
    // -----------------------------------------------------------------------

    #[test]
    fn test_cross_reference_aces_both_users_match() {
        let aces = vec![AceEntry {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "SharedGroup".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        }];

        let user_a_sids = vec!["S-1-5-21-100".to_string()];
        let user_b_sids = vec!["S-1-5-21-100".to_string()];

        let results = cross_reference_aces(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].user_a_access, AccessIndicator::Allowed);
        assert_eq!(results[0].user_b_access, AccessIndicator::Allowed);
    }

    #[test]
    fn test_cross_reference_aces_neither_user_matches() {
        let aces = vec![AceEntry {
            trustee_sid: "S-1-5-21-999".to_string(),
            trustee_display_name: "Unknown".to_string(),
            access_type: AceAccessType::Deny,
            permissions: vec!["Write".to_string()],
            is_inherited: false,
        }];

        let user_a_sids = vec!["S-1-5-21-100".to_string()];
        let user_b_sids = vec!["S-1-5-21-200".to_string()];

        let results = cross_reference_aces(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].user_a_access, AccessIndicator::NoMatch);
        assert_eq!(results[0].user_b_access, AccessIndicator::NoMatch);
    }

    #[test]
    fn test_cross_reference_aces_multiple_aces() {
        let aces = vec![
            AceEntry {
                trustee_sid: "S-1-5-21-100".to_string(),
                trustee_display_name: "GroupA".to_string(),
                access_type: AceAccessType::Allow,
                permissions: vec!["Read".to_string()],
                is_inherited: false,
            },
            AceEntry {
                trustee_sid: "S-1-5-21-200".to_string(),
                trustee_display_name: "GroupB".to_string(),
                access_type: AceAccessType::Allow,
                permissions: vec!["Write".to_string()],
                is_inherited: true,
            },
            AceEntry {
                trustee_sid: "S-1-5-21-300".to_string(),
                trustee_display_name: "GroupC".to_string(),
                access_type: AceAccessType::Deny,
                permissions: vec!["Delete".to_string()],
                is_inherited: false,
            },
        ];

        let user_a_sids = vec!["S-1-5-21-100".to_string(), "S-1-5-21-300".to_string()];
        let user_b_sids = vec!["S-1-5-21-200".to_string()];

        let results = cross_reference_aces(&aces, &user_a_sids, &user_b_sids);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].user_a_access, AccessIndicator::Allowed);
        assert_eq!(results[0].user_b_access, AccessIndicator::NoMatch);
        assert_eq!(results[1].user_a_access, AccessIndicator::NoMatch);
        assert_eq!(results[1].user_b_access, AccessIndicator::Allowed);
        assert_eq!(results[2].user_a_access, AccessIndicator::Denied);
        assert_eq!(results[2].user_b_access, AccessIndicator::NoMatch);
    }

    // -----------------------------------------------------------------------
    // check_user_access with multiple SIDs
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_user_access_multiple_sids() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-300".to_string(),
            trustee_display_name: "GroupC".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let sids = vec![
            "S-1-5-21-100".to_string(),
            "S-1-5-21-200".to_string(),
            "S-1-5-21-300".to_string(),
        ];
        assert_eq!(check_user_access(&ace, &sids), AccessIndicator::Allowed);
    }

    #[test]
    fn test_check_user_access_empty_sids() {
        let ace = AceEntry {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Group".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        assert_eq!(check_user_access(&ace, &[]), AccessIndicator::NoMatch);
    }

    // -----------------------------------------------------------------------
    // AceCrossReference serialization
    // -----------------------------------------------------------------------

    #[test]
    fn test_ace_cross_reference_serialization() {
        let xref = AceCrossReference {
            ace: AceEntry {
                trustee_sid: "S-1-5-21-100".to_string(),
                trustee_display_name: "Admins".to_string(),
                access_type: AceAccessType::Allow,
                permissions: vec!["Read".to_string()],
                is_inherited: false,
            },
            user_a_access: AccessIndicator::Allowed,
            user_b_access: AccessIndicator::NoMatch,
        };
        let json = serde_json::to_string(&xref).unwrap();
        assert!(json.contains("userAAccess"));
        assert!(json.contains("userBAccess"));
        assert!(json.contains("ace"));
    }

    // -----------------------------------------------------------------------
    // AceAccessType serialization/deserialization roundtrip
    // -----------------------------------------------------------------------

    #[test]
    fn test_ace_access_type_roundtrip() {
        let allow_json = serde_json::to_string(&AceAccessType::Allow).unwrap();
        let deny_json = serde_json::to_string(&AceAccessType::Deny).unwrap();
        let allow: AceAccessType = serde_json::from_str(&allow_json).unwrap();
        let deny: AceAccessType = serde_json::from_str(&deny_json).unwrap();
        assert_eq!(allow, AceAccessType::Allow);
        assert_eq!(deny, AceAccessType::Deny);
    }

    // -----------------------------------------------------------------------
    // AceEntry deserialization
    // -----------------------------------------------------------------------

    #[test]
    fn test_ace_entry_deserialization() {
        let json = r#"{
            "trusteeSid": "S-1-5-21-999",
            "trusteeDisplayName": "TestGroup",
            "accessType": "Deny",
            "permissions": ["Write", "Delete"],
            "isInherited": true
        }"#;
        let ace: AceEntry = serde_json::from_str(json).unwrap();
        assert_eq!(ace.trustee_sid, "S-1-5-21-999");
        assert_eq!(ace.access_type, AceAccessType::Deny);
        assert_eq!(ace.permissions.len(), 2);
        assert!(ace.is_inherited);
    }

    // -----------------------------------------------------------------------
    // NtfsAuditResult with errors
    // -----------------------------------------------------------------------

    #[test]
    fn test_ntfs_audit_result_with_errors() {
        let result = NtfsAuditResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![],
            errors: vec!["Error 1".to_string(), "Error 2".to_string()],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Error 1"));
        assert!(json.contains("Error 2"));
    }

    // -----------------------------------------------------------------------
    // AceEntry equality
    // -----------------------------------------------------------------------

    #[test]
    fn test_ace_entry_equality() {
        let a = AceEntry {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "G".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let b = a.clone();
        assert_eq!(a, b);
    }

    #[test]
    fn test_ace_entry_inequality_different_type() {
        let a = AceEntry {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "G".to_string(),
            access_type: AceAccessType::Allow,
            permissions: vec!["Read".to_string()],
            is_inherited: false,
        };
        let b = AceEntry {
            access_type: AceAccessType::Deny,
            ..a.clone()
        };
        assert_ne!(a, b);
    }
}
