/// Windows Security Descriptor DACL manipulation for AD objects.
///
/// Implements minimal binary parsing of the Windows SECURITY_DESCRIPTOR format
/// (MS-DTYP 2.4.6) to add or remove deny ACEs for the "Change Password" extended
/// right on AD user objects.
///
/// The "User Cannot Change Password" flag is enforced via two deny ACEs in the DACL:
/// - Deny "Change Password" to "Everyone" (S-1-1-0)
/// - Deny "Change Password" to "SELF" (S-1-5-10)
///
/// Extended right GUID: ab721a53-1e2f-11d0-9819-00aa0040529b (User-Change-Password)
use anyhow::Result;

/// GUID for the "Change Password" (User-Change-Password) extended right.
const CHANGE_PASSWORD_GUID: [u8; 16] = [
    0x53, 0x1a, 0x72, 0xab, // Data1 LE: ab721a53
    0x2f, 0x1e, // Data2 LE: 1e2f
    0xd0, 0x11, // Data3 LE: 11d0
    0x98, 0x19, // Data4[0..2]
    0x00, 0xaa, 0x00, 0x40, 0x52, 0x9b, // Data4[2..8]
];

/// SID for "Everyone" (S-1-1-0)
const SID_EVERYONE: &[u8] = &[
    0x01, // Revision
    0x01, // SubAuthorityCount
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, // IdentifierAuthority = 1
    0x00, 0x00, 0x00, 0x00, // SubAuthority[0] = 0
];

/// SID for "SELF" (S-1-5-10)
const SID_SELF: &[u8] = &[
    0x01, // Revision
    0x01, // SubAuthorityCount
    0x00, 0x00, 0x00, 0x00, 0x00, 0x05, // IdentifierAuthority = 5
    0x0a, 0x00, 0x00, 0x00, // SubAuthority[0] = 10
];

/// ACE type for ACCESS_DENIED_OBJECT_ACE (0x06)
const ACCESS_DENIED_OBJECT_ACE_TYPE: u8 = 0x06;

/// ADS_RIGHT_DS_CONTROL_ACCESS (0x00000100) - extended right access mask
const ADS_RIGHT_DS_CONTROL_ACCESS: u32 = 0x00000100;

/// ACE_OBJECT_TYPE_PRESENT flag (0x01)
const ACE_OBJECT_TYPE_PRESENT: u32 = 0x01;

/// Builds a deny ACE for the Change Password extended right targeting a specific SID.
fn build_deny_change_password_ace(sid: &[u8]) -> Vec<u8> {
    // ACCESS_DENIED_OBJECT_ACE structure:
    // Header: Type(1) + Flags(1) + Size(2)
    // Mask(4) + ObjectFlags(4) + ObjectType(16) + SID(variable)
    let ace_size: u16 = (4 + 4 + 4 + 16 + sid.len()) as u16;
    let mut ace = Vec::with_capacity(ace_size as usize);

    // ACE Header
    ace.push(ACCESS_DENIED_OBJECT_ACE_TYPE); // Type
    ace.push(0x00); // Flags (no inheritance)
    ace.extend_from_slice(&ace_size.to_le_bytes()); // Size

    // ACCESS_DENIED_OBJECT_ACE body
    ace.extend_from_slice(&ADS_RIGHT_DS_CONTROL_ACCESS.to_le_bytes()); // Mask
    ace.extend_from_slice(&ACE_OBJECT_TYPE_PRESENT.to_le_bytes()); // Flags: ObjectType present
    ace.extend_from_slice(&CHANGE_PASSWORD_GUID); // ObjectType GUID
    ace.extend_from_slice(sid); // SID

    ace
}

/// Checks if an ACE is a deny-change-password ACE for a given SID.
fn is_deny_change_password_ace(ace_data: &[u8], target_sid: &[u8]) -> bool {
    if ace_data.len() < 28 + target_sid.len() {
        return false;
    }
    // Check type
    if ace_data[0] != ACCESS_DENIED_OBJECT_ACE_TYPE {
        return false;
    }
    // Check mask = ADS_RIGHT_DS_CONTROL_ACCESS
    let mask = u32::from_le_bytes([ace_data[4], ace_data[5], ace_data[6], ace_data[7]]);
    if mask != ADS_RIGHT_DS_CONTROL_ACCESS {
        return false;
    }
    // Check ObjectType GUID
    let guid_start = 12;
    let guid_end = guid_start + 16;
    if ace_data[guid_start..guid_end] != CHANGE_PASSWORD_GUID {
        return false;
    }
    // Check SID
    let sid_start = guid_end;
    if ace_data.len() < sid_start + target_sid.len() {
        return false;
    }
    ace_data[sid_start..sid_start + target_sid.len()] == *target_sid
}

/// Reads the current state of the "User Cannot Change Password" flag from a security descriptor.
///
/// Returns `true` if both deny ACEs (Everyone and SELF for Change Password) are present.
pub fn is_cannot_change_password(sd_bytes: &[u8]) -> Result<bool> {
    if sd_bytes.len() < 20 {
        anyhow::bail!("Security descriptor too short ({} bytes)", sd_bytes.len());
    }

    let dacl_offset =
        u32::from_le_bytes([sd_bytes[16], sd_bytes[17], sd_bytes[18], sd_bytes[19]]) as usize;

    if dacl_offset == 0 {
        return Ok(false); // No DACL means no deny ACEs
    }

    if dacl_offset >= sd_bytes.len() || dacl_offset + 8 > sd_bytes.len() {
        anyhow::bail!("Invalid DACL offset {} in security descriptor", dacl_offset);
    }

    let acl_size =
        u16::from_le_bytes([sd_bytes[dacl_offset + 2], sd_bytes[dacl_offset + 3]]) as usize;
    let ace_count =
        u16::from_le_bytes([sd_bytes[dacl_offset + 4], sd_bytes[dacl_offset + 5]]) as usize;

    let acl_data_end = dacl_offset + acl_size;
    if acl_data_end > sd_bytes.len() {
        anyhow::bail!("DACL extends beyond security descriptor bounds");
    }

    let mut pos = dacl_offset + 8;
    let mut has_everyone_deny = false;
    let mut has_self_deny = false;

    for _ in 0..ace_count {
        if pos + 4 > sd_bytes.len() {
            break;
        }
        let ace_size = u16::from_le_bytes([sd_bytes[pos + 2], sd_bytes[pos + 3]]) as usize;
        if pos + ace_size > sd_bytes.len() {
            break;
        }
        let ace_data = &sd_bytes[pos..pos + ace_size];

        if is_deny_change_password_ace(ace_data, SID_EVERYONE) {
            has_everyone_deny = true;
        }
        if is_deny_change_password_ace(ace_data, SID_SELF) {
            has_self_deny = true;
        }

        if has_everyone_deny && has_self_deny {
            return Ok(true);
        }

        pos += ace_size;
    }

    Ok(false)
}

/// Modifies a binary security descriptor to set or clear the "User Cannot Change Password" flag.
///
/// When `deny` is true, adds deny ACEs for Everyone and SELF.
/// When `deny` is false, removes those ACEs.
///
/// Returns the modified security descriptor bytes.
pub fn set_cannot_change_password(sd_bytes: &[u8], deny: bool) -> Result<Vec<u8>> {
    // SECURITY_DESCRIPTOR_RELATIVE structure (MS-DTYP 2.4.6)
    // Revision(1) + Sbz1(1) + Control(2) + OffsetOwner(4) + OffsetGroup(4)
    // + OffsetSacl(4) + OffsetDacl(4) = 20 bytes header
    if sd_bytes.len() < 20 {
        anyhow::bail!("Security descriptor too short ({} bytes)", sd_bytes.len());
    }

    let dacl_offset =
        u32::from_le_bytes([sd_bytes[16], sd_bytes[17], sd_bytes[18], sd_bytes[19]]) as usize;

    if dacl_offset == 0 {
        if !deny {
            // No DACL and we want to allow - nothing to do
            return Ok(sd_bytes.to_vec());
        }
        anyhow::bail!("No DACL present in security descriptor; cannot add deny ACEs");
    }

    if dacl_offset >= sd_bytes.len() || dacl_offset + 8 > sd_bytes.len() {
        anyhow::bail!("Invalid DACL offset {} in security descriptor", dacl_offset);
    }

    // ACL structure: Revision(1) + Sbz1(1) + AclSize(2) + AceCount(2) + Sbz2(2)
    let acl_size =
        u16::from_le_bytes([sd_bytes[dacl_offset + 2], sd_bytes[dacl_offset + 3]]) as usize;
    let ace_count =
        u16::from_le_bytes([sd_bytes[dacl_offset + 4], sd_bytes[dacl_offset + 5]]) as usize;

    // Parse existing ACEs
    let acl_data_start = dacl_offset + 8;
    let acl_data_end = dacl_offset + acl_size;
    if acl_data_end > sd_bytes.len() {
        anyhow::bail!("DACL extends beyond security descriptor bounds");
    }

    let mut kept_aces: Vec<Vec<u8>> = Vec::new();
    let mut pos = acl_data_start;
    let mut removed_count = 0u16;

    for _ in 0..ace_count {
        if pos + 4 > sd_bytes.len() {
            break;
        }
        let ace_size = u16::from_le_bytes([sd_bytes[pos + 2], sd_bytes[pos + 3]]) as usize;
        if pos + ace_size > sd_bytes.len() {
            break;
        }
        let ace_data = &sd_bytes[pos..pos + ace_size];

        let is_target = is_deny_change_password_ace(ace_data, SID_EVERYONE)
            || is_deny_change_password_ace(ace_data, SID_SELF);

        if is_target {
            removed_count += 1;
        } else {
            kept_aces.push(ace_data.to_vec());
        }

        pos += ace_size;
    }

    // Build new ACE list
    if deny {
        // Add deny ACEs at the beginning (deny ACEs should come first in DACL)
        let everyone_ace = build_deny_change_password_ace(SID_EVERYONE);
        let self_ace = build_deny_change_password_ace(SID_SELF);
        kept_aces.insert(0, self_ace);
        kept_aces.insert(0, everyone_ace);
    }

    // Rebuild the DACL
    let new_ace_count = kept_aces.len() as u16;
    let new_aces_size: usize = kept_aces.iter().map(|a| a.len()).sum();
    let new_acl_size = (8 + new_aces_size) as u16;

    let mut new_acl = Vec::with_capacity(new_acl_size as usize);
    new_acl.push(sd_bytes[dacl_offset]); // ACL Revision
    new_acl.push(0); // Sbz1
    new_acl.extend_from_slice(&new_acl_size.to_le_bytes());
    new_acl.extend_from_slice(&new_ace_count.to_le_bytes());
    new_acl.extend_from_slice(&[0, 0]); // Sbz2
    for ace in &kept_aces {
        new_acl.extend_from_slice(ace);
    }

    // Rebuild the full security descriptor
    let old_acl_size = acl_size;
    let size_diff = new_acl.len() as i64 - old_acl_size as i64;

    let mut result = Vec::with_capacity((sd_bytes.len() as i64 + size_diff) as usize);
    result.extend_from_slice(&sd_bytes[..dacl_offset]);
    result.extend_from_slice(&new_acl);
    if acl_data_end < sd_bytes.len() {
        result.extend_from_slice(&sd_bytes[dacl_offset + old_acl_size..]);
    }

    // Update offsets that come after the DACL if they shifted
    if size_diff != 0 {
        // Owner offset
        let owner_off = u32::from_le_bytes([result[4], result[5], result[6], result[7]]);
        if owner_off > dacl_offset as u32 && owner_off != 0 {
            let new_off = (owner_off as i64 + size_diff) as u32;
            result[4..8].copy_from_slice(&new_off.to_le_bytes());
        }
        // Group offset
        let group_off = u32::from_le_bytes([result[8], result[9], result[10], result[11]]);
        if group_off > dacl_offset as u32 && group_off != 0 {
            let new_off = (group_off as i64 + size_diff) as u32;
            result[8..12].copy_from_slice(&new_off.to_le_bytes());
        }
        // SACL offset
        let sacl_off = u32::from_le_bytes([result[12], result[13], result[14], result[15]]);
        if sacl_off > dacl_offset as u32 && sacl_off != 0 {
            let new_off = (sacl_off as i64 + size_diff) as u32;
            result[12..16].copy_from_slice(&new_off.to_le_bytes());
        }
    }

    tracing::info!(
        deny,
        removed_count,
        new_ace_count,
        "DACL modified for User Cannot Change Password"
    );

    Ok(result)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a minimal valid security descriptor with an empty DACL.
    fn make_minimal_sd() -> Vec<u8> {
        let mut sd = vec![0u8; 20];
        sd[0] = 0x01; // Revision
        sd[2] = 0x04; // Control: SE_DACL_PRESENT (low byte)
        sd[3] = 0x80; // Control: SE_SELF_RELATIVE (high byte)
        // DACL offset = 20 (right after header)
        sd[16] = 20;
        sd[17] = 0;
        sd[18] = 0;
        sd[19] = 0;

        // Empty DACL: Revision(1) + Sbz1(1) + AclSize(2) + AceCount(2) + Sbz2(2)
        sd.push(0x02); // ACL Revision
        sd.push(0x00); // Sbz1
        sd.extend_from_slice(&8u16.to_le_bytes()); // AclSize = 8 (header only)
        sd.extend_from_slice(&0u16.to_le_bytes()); // AceCount = 0
        sd.extend_from_slice(&0u16.to_le_bytes()); // Sbz2

        sd
    }

    #[test]
    fn test_add_deny_aces_to_empty_dacl() {
        let sd = make_minimal_sd();
        let result = set_cannot_change_password(&sd, true).unwrap();

        // Should have added 2 ACEs
        let dacl_offset = 20;
        let ace_count = u16::from_le_bytes([result[dacl_offset + 4], result[dacl_offset + 5]]);
        assert_eq!(ace_count, 2);
    }

    #[test]
    fn test_remove_deny_aces_from_empty_dacl() {
        let sd = make_minimal_sd();
        let result = set_cannot_change_password(&sd, false).unwrap();

        // Should still have 0 ACEs
        let dacl_offset = 20;
        let ace_count = u16::from_le_bytes([result[dacl_offset + 4], result[dacl_offset + 5]]);
        assert_eq!(ace_count, 0);
    }

    #[test]
    fn test_add_then_remove_roundtrip() {
        let sd = make_minimal_sd();

        // Add deny ACEs
        let with_deny = set_cannot_change_password(&sd, true).unwrap();
        let dacl_offset = 20;
        let count_after_add =
            u16::from_le_bytes([with_deny[dacl_offset + 4], with_deny[dacl_offset + 5]]);
        assert_eq!(count_after_add, 2);

        // Remove deny ACEs
        let without_deny = set_cannot_change_password(&with_deny, false).unwrap();
        let count_after_remove =
            u16::from_le_bytes([without_deny[dacl_offset + 4], without_deny[dacl_offset + 5]]);
        assert_eq!(count_after_remove, 0);
    }

    #[test]
    fn test_idempotent_add() {
        let sd = make_minimal_sd();
        let first = set_cannot_change_password(&sd, true).unwrap();
        let second = set_cannot_change_password(&first, true).unwrap();

        // Should still have exactly 2 ACEs (old ones removed, new ones added)
        let dacl_offset = 20;
        let count = u16::from_le_bytes([second[dacl_offset + 4], second[dacl_offset + 5]]);
        assert_eq!(count, 2);
    }

    #[test]
    fn test_rejects_too_short_sd() {
        let sd = vec![0u8; 10];
        assert!(set_cannot_change_password(&sd, true).is_err());
    }

    #[test]
    fn test_no_dacl_remove_is_noop() {
        let mut sd = vec![0u8; 20];
        sd[0] = 0x01;
        // DACL offset = 0 (no DACL)
        let result = set_cannot_change_password(&sd, false).unwrap();
        assert_eq!(result, sd);
    }

    #[test]
    fn test_no_dacl_add_fails() {
        let mut sd = vec![0u8; 20];
        sd[0] = 0x01;
        assert!(set_cannot_change_password(&sd, true).is_err());
    }

    #[test]
    fn test_build_deny_ace_format() {
        let ace = build_deny_change_password_ace(SID_EVERYONE);
        assert_eq!(ace[0], ACCESS_DENIED_OBJECT_ACE_TYPE);
        let size = u16::from_le_bytes([ace[2], ace[3]]);
        assert_eq!(size as usize, ace.len());
        let mask = u32::from_le_bytes([ace[4], ace[5], ace[6], ace[7]]);
        assert_eq!(mask, ADS_RIGHT_DS_CONTROL_ACCESS);
    }

    #[test]
    fn test_is_deny_change_password_ace_detects_correctly() {
        let ace = build_deny_change_password_ace(SID_EVERYONE);
        assert!(is_deny_change_password_ace(&ace, SID_EVERYONE));
        assert!(!is_deny_change_password_ace(&ace, SID_SELF));
    }

    #[test]
    fn test_preserves_existing_non_target_aces() {
        let mut sd = make_minimal_sd();

        // Manually add a non-target ACE (type 0x00 = ACCESS_ALLOWED_ACE)
        let fake_ace = vec![0x00, 0x00, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00];
        let dacl_start = 20;
        // Update ACL size and count
        let new_acl_size = 8u16 + fake_ace.len() as u16;
        sd[dacl_start + 2] = new_acl_size as u8;
        sd[dacl_start + 3] = (new_acl_size >> 8) as u8;
        sd[dacl_start + 4] = 1; // 1 ACE
        sd.extend_from_slice(&fake_ace);

        // Add deny ACEs
        let result = set_cannot_change_password(&sd, true).unwrap();
        let count = u16::from_le_bytes([result[dacl_start + 4], result[dacl_start + 5]]);
        // 2 deny + 1 existing = 3
        assert_eq!(count, 3);

        // Remove deny ACEs
        let result2 = set_cannot_change_password(&result, false).unwrap();
        let count2 = u16::from_le_bytes([result2[dacl_start + 4], result2[dacl_start + 5]]);
        // Only the original fake ACE remains
        assert_eq!(count2, 1);
    }

    // --- is_cannot_change_password tests ---

    #[test]
    fn test_is_cannot_change_password_false_on_empty_dacl() {
        let sd = make_minimal_sd();
        assert!(!is_cannot_change_password(&sd).unwrap());
    }

    #[test]
    fn test_is_cannot_change_password_true_after_deny() {
        let sd = make_minimal_sd();
        let modified = set_cannot_change_password(&sd, true).unwrap();
        assert!(is_cannot_change_password(&modified).unwrap());
    }

    #[test]
    fn test_is_cannot_change_password_false_after_remove() {
        let sd = make_minimal_sd();
        let with_deny = set_cannot_change_password(&sd, true).unwrap();
        let without_deny = set_cannot_change_password(&with_deny, false).unwrap();
        assert!(!is_cannot_change_password(&without_deny).unwrap());
    }

    #[test]
    fn test_is_cannot_change_password_false_with_only_everyone() {
        // Build SD with only the Everyone deny ACE (not SELF)
        let mut sd = make_minimal_sd();
        let everyone_ace = build_deny_change_password_ace(SID_EVERYONE);
        let dacl_start = 20;
        let new_acl_size = 8u16 + everyone_ace.len() as u16;
        sd[dacl_start + 2] = new_acl_size as u8;
        sd[dacl_start + 3] = (new_acl_size >> 8) as u8;
        sd[dacl_start + 4] = 1;
        sd.extend_from_slice(&everyone_ace);

        // Only one deny ACE - both are required for "cannot change password"
        assert!(!is_cannot_change_password(&sd).unwrap());
    }

    #[test]
    fn test_is_cannot_change_password_rejects_too_short() {
        let sd = vec![0u8; 10];
        assert!(is_cannot_change_password(&sd).is_err());
    }

    #[test]
    fn test_is_cannot_change_password_no_dacl_returns_false() {
        let mut sd = vec![0u8; 20];
        sd[0] = 0x01;
        // DACL offset = 0 (no DACL)
        assert!(!is_cannot_change_password(&sd).unwrap());
    }

    #[test]
    fn test_is_cannot_change_password_invalid_dacl_offset() {
        let mut sd = vec![0u8; 20];
        sd[0] = 0x01;
        // DACL offset points beyond SD
        sd[16] = 0xFF;
        assert!(is_cannot_change_password(&sd).is_err());
    }

    #[test]
    fn test_build_deny_ace_self_format() {
        let ace = build_deny_change_password_ace(SID_SELF);
        assert_eq!(ace[0], ACCESS_DENIED_OBJECT_ACE_TYPE);
        let size = u16::from_le_bytes([ace[2], ace[3]]);
        assert_eq!(size as usize, ace.len());
        // Verify GUID at offset 12
        assert_eq!(&ace[12..28], &CHANGE_PASSWORD_GUID);
    }

    #[test]
    fn test_is_deny_ace_too_short_returns_false() {
        let short_ace = vec![0u8; 10];
        assert!(!is_deny_change_password_ace(&short_ace, SID_EVERYONE));
    }

    #[test]
    fn test_is_deny_ace_wrong_type_returns_false() {
        let mut ace = build_deny_change_password_ace(SID_EVERYONE);
        ace[0] = 0x00; // Change type to ACCESS_ALLOWED
        assert!(!is_deny_change_password_ace(&ace, SID_EVERYONE));
    }

    #[test]
    fn test_is_deny_ace_wrong_mask_returns_false() {
        let mut ace = build_deny_change_password_ace(SID_EVERYONE);
        ace[4] = 0x00; // Corrupt mask
        ace[5] = 0x00;
        ace[6] = 0x00;
        ace[7] = 0x00;
        assert!(!is_deny_change_password_ace(&ace, SID_EVERYONE));
    }

    #[test]
    fn test_is_deny_ace_wrong_guid_returns_false() {
        let mut ace = build_deny_change_password_ace(SID_EVERYONE);
        ace[12] = 0xFF; // Corrupt GUID
        assert!(!is_deny_change_password_ace(&ace, SID_EVERYONE));
    }

    #[test]
    fn test_set_deny_updates_offsets_after_dacl() {
        // Build SD with owner offset after DACL
        let mut sd = make_minimal_sd();
        // Set owner offset to point after the DACL (at end of SD)
        let owner_off = sd.len() as u32;
        sd[4..8].copy_from_slice(&owner_off.to_le_bytes());
        // Add a dummy owner SID placeholder
        sd.extend_from_slice(&[
            0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        ]);

        let result = set_cannot_change_password(&sd, true).unwrap();

        // Owner offset should have shifted by the size of 2 added ACEs
        let new_owner_off = u32::from_le_bytes([result[4], result[5], result[6], result[7]]);
        assert!(new_owner_off > owner_off);
    }
}
