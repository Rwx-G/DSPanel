//! Integration tests for LdapDirectoryProvider against a real Active Directory.
//!
//! These tests require a running AD domain controller and are skipped by default.
//! They are gated by environment variables for three permission levels.
//!
//! # Prerequisites
//!
//! - Windows Server VM with AD DS role (Hyper-V, Internal switch)
//! - Domain populated with BadBlood for realistic test data
//! - Three test accounts: TestReadOnly, TestOperator (Account Operators),
//!   TestAdmin (Domain Admins + Enterprise Admins)
//!
//! # Running
//!
//! ```bash
//! # Read-only tests
//! export DSPANEL_LDAP_SERVER=172.31.72.165
//! export DSPANEL_LDAP_BIND_DN="CN=TestReadOnly,CN=Users,DC=dspanel,DC=local"
//! export DSPANEL_LDAP_BIND_PASSWORD="P@ssw0rd2026!"
//! cargo test --test ldap_integration -- --nocapture read_
//!
//! # Write tests (Account Operator)
//! export DSPANEL_LDAP_BIND_DN="CN=TestOperator,CN=Users,DC=dspanel,DC=local"
//! cargo test --test ldap_integration -- --nocapture write_
//!
//! # Admin tests (Domain Admin)
//! export DSPANEL_LDAP_BIND_DN="CN=TestAdmin,CN=Users,DC=dspanel,DC=local"
//! cargo test --test ldap_integration -- --nocapture admin_
//!
//! # All tests (use admin account for full coverage)
//! export DSPANEL_LDAP_BIND_DN="CN=TestAdmin,CN=Users,DC=dspanel,DC=local"
//! cargo test --test ldap_integration -- --nocapture
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use dspanel_lib::services::directory::DirectoryProvider;
use dspanel_lib::services::dc_health;
use dspanel_lib::services::ldap_directory::{LdapDirectoryProvider, LdapTlsConfig};
use dspanel_lib::services::replication_status;
use dspanel_lib::services::topology;

async fn create_connected_provider() -> Option<LdapDirectoryProvider> {
    let server = std::env::var("DSPANEL_LDAP_SERVER").ok()?;
    let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN").ok()?;
    let password = std::env::var("DSPANEL_LDAP_BIND_PASSWORD").ok()?;
    let use_tls = std::env::var("DSPANEL_LDAP_USE_TLS")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let skip_verify = std::env::var("DSPANEL_LDAP_TLS_SKIP_VERIFY")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let starttls = std::env::var("DSPANEL_LDAP_STARTTLS")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    let ca_cert_file = std::env::var("DSPANEL_LDAP_CA_CERT").ok();
    let tls_config = LdapTlsConfig {
        enabled: use_tls,
        starttls,
        skip_verify,
        ca_cert_file,
    };
    let provider =
        LdapDirectoryProvider::new_with_credentials(server, bind_dn, password, tls_config);
    provider
        .test_connection()
        .await
        .expect("test_connection failed");
    Some(provider)
}

macro_rules! skip_if_no_ad {
    () => {
        match create_connected_provider().await {
            Some(p) => p,
            None => {
                eprintln!("SKIPPED: DSPANEL_LDAP_SERVER not set");
                return;
            }
        }
    };
}

// =========================================================================
// READ OPERATIONS (TestReadOnly is sufficient)
// =========================================================================

#[tokio::test]
async fn read_connection_and_base_dn() {
    let provider = skip_if_no_ad!();
    assert!(provider.is_connected());
    assert!(provider.domain_name().is_some());
    let base = provider.base_dn();
    assert!(base.is_some(), "Base DN should be discovered");
    println!("Base DN: {}", base.unwrap());
}

#[tokio::test]
async fn read_browse_users_paged() {
    let provider = skip_if_no_ad!();
    let results = provider
        .browse_users(5000)
        .await
        .expect("browse_users failed");
    println!("Browsed {} users", results.len());
    assert!(results.len() > 100, "BadBlood should create >2000 users");
}

#[tokio::test]
async fn read_browse_groups() {
    let provider = skip_if_no_ad!();
    let results = provider
        .browse_groups(5000)
        .await
        .expect("browse_groups failed");
    println!("Browsed {} groups", results.len());
    assert!(results.len() > 50, "BadBlood should create >500 groups");
}

#[tokio::test]
async fn read_browse_computers() {
    let provider = skip_if_no_ad!();
    let results = provider
        .browse_computers(5000)
        .await
        .expect("browse_computers failed");
    println!("Browsed {} computers", results.len());
    assert!(results.len() >= 10, "BadBlood should create ~100 computers");
}

#[tokio::test]
async fn read_search_users_specific() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_users("testreadonly", 10)
        .await
        .expect("search_users failed");
    assert!(!results.is_empty(), "Should find testreadonly user");
    assert_eq!(results[0].sam_account_name.as_deref(), Some("testreadonly"));
}

#[tokio::test]
async fn read_search_users_wildcard() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_users("test", 50)
        .await
        .expect("search_users failed");
    println!("Found {} users matching 'test'", results.len());
    assert!(
        results.len() >= 3,
        "Should find testreadonly, testoperator, testadmin"
    );
}

#[tokio::test]
async fn read_search_groups() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_groups("admin", 50)
        .await
        .expect("search_groups failed");
    println!("Found {} groups matching 'admin'", results.len());
    assert!(!results.is_empty(), "Should find admin-related groups");
}

#[tokio::test]
async fn read_search_computers() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_computers("comp", 50)
        .await
        .expect("search_computers failed");
    println!("Found {} computers matching 'comp'", results.len());
}

#[tokio::test]
async fn read_get_user_by_identity() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user_by_identity failed");
    assert!(user.is_some(), "testreadonly should exist");
    let user = user.unwrap();
    // get_user_by_identity uses *, so should have many attributes
    assert!(
        user.attributes.len() > 20,
        "Wildcard fetch should return many attributes, got {}",
        user.attributes.len()
    );
    println!(
        "User {} has {} attributes",
        user.sam_account_name.as_deref().unwrap_or("?"),
        user.attributes.len()
    );
}

#[tokio::test]
async fn read_get_user_not_found() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("nonexistent_user_xyz_999")
        .await
        .expect("get_user_by_identity should not error for missing user");
    assert!(user.is_none(), "Nonexistent user should return None");
}

#[tokio::test]
async fn read_get_group_members() {
    let provider = skip_if_no_ad!();
    // Domain Admins should have at least testadmin
    let groups = provider
        .search_groups("Admins du domaine", 5)
        .await
        .expect("search failed");
    if groups.is_empty() {
        // Try English name
        let groups = provider
            .search_groups("Domain Admins", 5)
            .await
            .expect("search failed");
        if groups.is_empty() {
            eprintln!("SKIPPED: Could not find Domain Admins group");
            return;
        }
    }
    let group_dn = &groups[0].distinguished_name;
    let members = provider
        .get_group_members(group_dn, 200)
        .await
        .expect("get_group_members failed");
    println!("Domain Admins has {} members", members.len());
    assert!(!members.is_empty(), "Domain Admins should have members");
}

#[tokio::test]
async fn read_get_ou_tree() {
    let provider = skip_if_no_ad!();
    let tree = provider.get_ou_tree().await.expect("get_ou_tree failed");
    println!("OU tree has {} top-level nodes", tree.len());
    assert!(!tree.is_empty(), "OU tree should have nodes");
    for node in &tree {
        println!("  - {} ({})", node.name, node.distinguished_name);
    }
}

#[tokio::test]
async fn read_get_schema_attributes() {
    let provider = skip_if_no_ad!();
    let attrs = provider
        .get_schema_attributes()
        .await
        .expect("get_schema_attributes failed");
    println!("Schema has {} attributes", attrs.len());
    assert!(
        attrs.len() > 200,
        "AD schema should have hundreds of attributes, got {}",
        attrs.len()
    );
    assert!(
        attrs.contains(&"sAMAccountName".to_string()),
        "Schema should contain sAMAccountName"
    );
    assert!(
        attrs.contains(&"mail".to_string()),
        "Schema should contain mail"
    );
}

#[tokio::test]
async fn read_get_nested_groups() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testadmin")
        .await
        .expect("get_user failed");
    if let Some(user) = user {
        let nested = provider
            .get_nested_groups(&user.distinguished_name)
            .await
            .expect("get_nested_groups failed");
        println!("testadmin has {} nested group memberships", nested.len());
        assert!(
            !nested.is_empty(),
            "testadmin (Domain Admin) should have nested groups"
        );
    } else {
        eprintln!("SKIPPED: testadmin not found");
    }
}

#[tokio::test]
async fn read_consecutive_searches_stable() {
    let provider = skip_if_no_ad!();
    // Run multiple searches to verify connection pool stability
    for i in 0..5 {
        let results = provider
            .search_users("test", 10)
            .await
            .unwrap_or_else(|_| panic!("search #{} failed", i));
        assert!(!results.is_empty(), "Search #{} returned empty", i);
    }
    println!("5 consecutive searches completed successfully");
}

// =========================================================================
// WRITE OPERATIONS (TestOperator / AccountOperator required)
// =========================================================================

#[tokio::test]
async fn write_create_and_delete_group() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);
    let group_name = "DSPanel-IntTest-TempGroup";

    // Create
    let created_dn = provider
        .create_group(
            group_name,
            &container,
            "Global",
            "Security",
            "Integration test group",
        )
        .await;
    match created_dn {
        Ok(dn) => {
            println!("Created group: {}", dn);
            assert!(dn.contains(group_name));

            // Verify it exists
            let found = provider
                .search_groups(group_name, 5)
                .await
                .expect("search after create failed");
            assert!(!found.is_empty(), "Created group should be findable");

            // Delete
            provider
                .delete_object(&dn)
                .await
                .expect("delete_object failed");
            println!("Deleted group: {}", dn);

            // Verify deletion
            let found = provider
                .search_groups(group_name, 5)
                .await
                .expect("search after delete failed");
            assert!(found.is_empty(), "Deleted group should not be findable");
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

#[tokio::test]
async fn write_add_and_remove_group_member() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);
    let group_name = "DSPanel-IntTest-MemberGroup";

    // Create a temp group
    let group_dn = match provider
        .create_group(group_name, &container, "Global", "Security", "Member test")
        .await
    {
        Ok(dn) => dn,
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
            return;
        }
    };

    // Find testreadonly user
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    // Add member
    provider
        .add_user_to_group(&user.distinguished_name, &group_dn)
        .await
        .expect("add_user_to_group failed");
    println!("Added testreadonly to {}", group_name);

    // Verify membership
    let members = provider
        .get_group_members(&group_dn, 100)
        .await
        .expect("get_group_members failed");
    assert_eq!(members.len(), 1, "Group should have 1 member");

    // Remove member
    provider
        .remove_group_member(&group_dn, &user.distinguished_name)
        .await
        .expect("remove_group_member failed");
    println!("Removed testreadonly from {}", group_name);

    // Verify removal
    let members = provider
        .get_group_members(&group_dn, 100)
        .await
        .expect("get_group_members failed");
    assert!(members.is_empty(), "Group should be empty after removal");

    // Cleanup
    provider
        .delete_object(&group_dn)
        .await
        .expect("cleanup delete failed");
    println!("Cleaned up {}", group_name);
}

#[tokio::test]
async fn write_update_managed_by() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);
    let group_name = "DSPanel-IntTest-ManagedBy";

    // Create temp group
    let group_dn = match provider
        .create_group(
            group_name,
            &container,
            "Global",
            "Security",
            "ManagedBy test",
        )
        .await
    {
        Ok(dn) => dn,
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
            return;
        }
    };

    // Find a user to set as manager
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    // Set managedBy
    provider
        .update_managed_by(&group_dn, &user.distinguished_name)
        .await
        .expect("update_managed_by failed");
    println!("Set managedBy to testreadonly on {}", group_name);

    // Cleanup
    provider
        .delete_object(&group_dn)
        .await
        .expect("cleanup delete failed");
}

#[tokio::test]
async fn write_move_object() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let source = format!("CN=Users,{}", base_dn);
    let group_name = "DSPanel-IntTest-MoveGroup";

    // Create temp group in Users
    let group_dn = match provider
        .create_group(group_name, &source, "Global", "Security", "Move test")
        .await
    {
        Ok(dn) => dn,
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
            return;
        }
    };

    // Find an OU to move to
    let tree = provider.get_ou_tree().await.expect("get_ou_tree failed");
    if tree.is_empty() {
        // No OUs, just cleanup
        provider.delete_object(&group_dn).await.ok();
        eprintln!("SKIPPED: No OUs found for move test");
        return;
    }

    let target_ou = &tree[0].distinguished_name;
    provider
        .move_object(&group_dn, target_ou)
        .await
        .expect("move_object failed");
    let new_dn = format!("CN={},{}", group_name, target_ou);
    println!("Moved group to {}", new_dn);

    // Cleanup from new location
    provider
        .delete_object(&new_dn)
        .await
        .expect("cleanup delete from new location failed");
}

// =========================================================================
// ADMIN OPERATIONS (TestAdmin / DomainAdmin required)
// =========================================================================

#[tokio::test]
async fn admin_reset_password() {
    let provider = skip_if_no_ad!();

    // Reset testreadonly's password (then reset it back)
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    let result = provider
        .reset_password(&user.distinguished_name, "NewTempP@ss99!", false)
        .await;
    match result {
        Ok(()) => {
            println!("Password reset successful for testreadonly");
            // Reset back to original
            provider
                .reset_password(&user.distinguished_name, "P@ssw0rd2026!", false)
                .await
                .expect("Failed to restore original password");
            println!("Password restored to original");
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied or LDAPS required?): {}", e);
        }
    }
}

#[tokio::test]
async fn admin_disable_and_enable_account() {
    let provider = skip_if_no_ad!();

    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    // Disable
    let result = provider.disable_account(&user.distinguished_name).await;
    match result {
        Ok(()) => {
            println!("Account disabled");

            // Verify disabled
            let updated = provider
                .get_user_by_identity("testreadonly")
                .await
                .expect("get_user failed")
                .expect("user not found");
            let uac = updated
                .attributes
                .get("userAccountControl")
                .and_then(|v| v.first())
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            assert!(uac & 0x0002 != 0, "Account should be disabled");

            // Re-enable
            provider
                .enable_account(&user.distinguished_name)
                .await
                .expect("enable_account failed");
            println!("Account re-enabled");

            // Verify enabled
            let updated = provider
                .get_user_by_identity("testreadonly")
                .await
                .expect("get_user failed")
                .expect("user not found");
            let uac = updated
                .attributes
                .get("userAccountControl")
                .and_then(|v| v.first())
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);
            assert!(uac & 0x0002 == 0, "Account should be enabled");
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

// =========================================================================
// RESILIENCE
// =========================================================================

#[tokio::test]
async fn resilience_multiple_operations_after_idle() {
    let provider = skip_if_no_ad!();

    // First batch
    let r1 = provider
        .search_users("test", 10)
        .await
        .expect("search 1 failed");
    assert!(!r1.is_empty());

    // Simulate short idle (not a real 15min timeout, but validates the flow)
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Second batch
    let r2 = provider
        .browse_groups(20)
        .await
        .expect("browse groups failed");
    assert!(!r2.is_empty());

    let r3 = provider
        .browse_computers(20)
        .await
        .expect("browse computers failed");
    println!(
        "After idle: {} users, {} groups, {} computers",
        r1.len(),
        r2.len(),
        r3.len()
    );
}

// =========================================================================
// READ OPERATIONS - EXTENDED COVERAGE
// =========================================================================

#[tokio::test]
async fn read_get_current_user_groups() {
    let provider = skip_if_no_ad!();
    let groups = provider
        .get_current_user_groups()
        .await
        .expect("get_current_user_groups failed");
    println!("Current user belongs to {} groups", groups.len());
    assert!(
        !groups.is_empty(),
        "Bind user should belong to at least one group"
    );
    for g in &groups {
        println!("  - {}", g);
    }
}

#[tokio::test]
async fn read_get_cannot_change_password() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");
    let result = provider
        .get_cannot_change_password(&user.distinguished_name)
        .await;
    match result {
        Ok(cannot_change) => {
            println!(
                "testreadonly cannot change password: {}",
                cannot_change
            );
            // Just verify it returns a boolean without error
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

#[tokio::test]
async fn read_get_replication_metadata() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testadmin")
        .await
        .expect("get_user failed")
        .expect("testadmin not found");
    let metadata = provider
        .get_replication_metadata(&user.distinguished_name)
        .await
        .expect("get_replication_metadata failed");
    match metadata {
        Some(xml) => {
            println!(
                "Replication metadata length: {} chars",
                xml.len()
            );
            assert!(
                xml.contains("DS_REPL_ATTR_META_DATA")
                    || xml.contains("pszAttributeName")
                    || xml.contains('<'),
                "Metadata should contain XML-like replication data"
            );
        }
        None => {
            println!("No replication metadata returned (may require elevated permissions)");
        }
    }
}

#[tokio::test]
async fn read_browse_contacts() {
    let provider = skip_if_no_ad!();
    let results = provider
        .browse_contacts(100)
        .await
        .expect("browse_contacts failed");
    println!("Browsed {} contacts", results.len());
    // May be empty on a test domain - just verify no error
}

#[tokio::test]
async fn read_browse_printers() {
    let provider = skip_if_no_ad!();
    let results = provider
        .browse_printers(100)
        .await
        .expect("browse_printers failed");
    println!("Browsed {} printers", results.len());
    // May be empty on a test domain - just verify no error
}

#[tokio::test]
async fn read_search_contacts() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_contacts("*", 100)
        .await
        .expect("search_contacts failed");
    println!("Found {} contacts matching '*'", results.len());
    // May be empty - just verify no error
}

#[tokio::test]
async fn read_search_printers() {
    let provider = skip_if_no_ad!();
    let results = provider
        .search_printers("*", 100)
        .await
        .expect("search_printers failed");
    println!("Found {} printers matching '*'", results.len());
    // May be empty - just verify no error
}

#[tokio::test]
async fn read_is_recycle_bin_enabled() {
    let provider = skip_if_no_ad!();
    let enabled = provider
        .is_recycle_bin_enabled()
        .await
        .expect("is_recycle_bin_enabled failed");
    println!("Recycle Bin enabled: {}", enabled);
    assert!(
        enabled,
        "Modern AD (2016+) should have Recycle Bin enabled"
    );
}

#[tokio::test]
async fn read_get_deleted_objects() {
    let provider = skip_if_no_ad!();
    let deleted = provider
        .get_deleted_objects()
        .await
        .expect("get_deleted_objects failed");
    println!("Found {} deleted objects", deleted.len());
    // May be empty if nothing has been deleted - just verify no error
}

#[tokio::test]
async fn read_entry_rootdse() {
    let provider = skip_if_no_ad!();
    let entry = provider
        .read_entry("")
        .await
        .expect("read_entry('') failed");
    assert!(entry.is_some(), "rootDSE should always be readable");
    let entry = entry.unwrap();
    let has_naming_ctx = entry
        .attributes
        .contains_key("defaultNamingContext");
    assert!(
        has_naming_ctx,
        "rootDSE should contain defaultNamingContext"
    );
    println!(
        "rootDSE has {} attributes",
        entry.attributes.len()
    );
}

#[tokio::test]
async fn read_resolve_group_by_rid() {
    let provider = skip_if_no_ad!();
    // RID 512 = Domain Admins
    let group = provider
        .resolve_group_by_rid(512)
        .await
        .expect("resolve_group_by_rid failed");
    assert!(
        group.is_some(),
        "Domain Admins (RID 512) should always exist"
    );
    let group = group.unwrap();
    println!(
        "RID 512 resolved to: {} ({})",
        group.sam_account_name.as_deref().unwrap_or("?"),
        group.distinguished_name
    );
}

#[tokio::test]
async fn read_search_configuration() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    // Search for Sites in the Configuration partition
    let config_base = format!(
        "CN=Sites,CN=Configuration,{}",
        base_dn
    );
    let results = provider
        .search_configuration(&config_base, "(objectClass=site)")
        .await
        .expect("search_configuration failed");
    println!("Found {} sites", results.len());
    assert!(
        !results.is_empty(),
        "AD should have at least a Default-First-Site-Name"
    );
}

#[tokio::test]
async fn read_probe_effective_permissions() {
    let provider = skip_if_no_ad!();
    let (can_write_user, can_write_group, can_create) = provider
        .probe_effective_permissions()
        .await
        .expect("probe_effective_permissions failed");
    println!(
        "Permissions - write user attrs: {}, write group members: {}, create objects: {}",
        can_write_user, can_write_group, can_create
    );
    // Just verify it returns 3 booleans without error
}

// =========================================================================
// WRITE OPERATIONS - EXTENDED COVERAGE
// =========================================================================

#[tokio::test]
async fn write_create_and_delete_contact() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);

    let mut attrs = HashMap::new();
    attrs.insert("cn".to_string(), "DSPanel-IntTest-TempContact".to_string());
    attrs.insert(
        "displayName".to_string(),
        "DSPanel Integration Test Contact".to_string(),
    );
    attrs.insert(
        "mail".to_string(),
        "inttest@dspanel.local".to_string(),
    );

    let result = provider.create_contact(&container, &attrs).await;
    match result {
        Ok(dn) => {
            println!("Created contact: {}", dn);
            assert!(dn.contains("DSPanel-IntTest-TempContact"));

            // Verify it exists via browse
            let contacts = provider
                .browse_contacts(500)
                .await
                .expect("browse_contacts failed");
            let found = contacts
                .iter()
                .any(|c| c.distinguished_name == dn);
            assert!(found, "Created contact should appear in browse results");

            // Delete
            provider
                .delete_contact(&dn)
                .await
                .expect("delete_contact failed");
            println!("Deleted contact: {}", dn);
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

#[tokio::test]
async fn write_modify_attribute() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);
    let group_name = "DSPanel-IntTest-ModifyAttr";

    // Create a temp group to modify
    let group_dn = match provider
        .create_group(
            group_name,
            &container,
            "Global",
            "Security",
            "Modify attribute test",
        )
        .await
    {
        Ok(dn) => dn,
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
            return;
        }
    };

    // Modify description
    let new_desc = vec!["Updated by DSPanel integration test".to_string()];
    provider
        .modify_attribute(&group_dn, "description", &new_desc)
        .await
        .expect("modify_attribute failed");
    println!("Modified description on {}", group_name);

    // Verify by reading the group back
    let groups = provider
        .search_groups(group_name, 5)
        .await
        .expect("search after modify failed");
    assert!(!groups.is_empty(), "Group should still exist");

    // Cleanup
    provider
        .delete_object(&group_dn)
        .await
        .expect("cleanup delete failed");
    println!("Cleaned up {}", group_name);
}

#[tokio::test]
async fn write_set_password_flags() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    // Read current state of "cannot change password"
    let original = provider
        .get_cannot_change_password(&user.distinguished_name)
        .await
        .unwrap_or(false);

    // Set password never expires = false, user cannot change = true
    let result = provider
        .set_password_flags(&user.distinguished_name, false, true)
        .await;
    match result {
        Ok(()) => {
            println!("Set password flags on testreadonly");

            // Restore original flags
            provider
                .set_password_flags(
                    &user.distinguished_name,
                    false,
                    original,
                )
                .await
                .expect("Failed to restore password flags");
            println!("Restored password flags to original state");
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

// =========================================================================
// ADMIN OPERATIONS - EXTENDED COVERAGE
// =========================================================================

#[tokio::test]
async fn admin_unlock_account() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testreadonly")
        .await
        .expect("get_user failed")
        .expect("testreadonly not found");

    // Unlock should succeed even if the account is not locked
    let result = provider
        .unlock_account(&user.distinguished_name)
        .await;
    match result {
        Ok(()) => {
            println!("unlock_account succeeded for testreadonly");
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

#[tokio::test]
async fn admin_create_and_delete_user() {
    let provider = skip_if_no_ad!();
    let base_dn = provider.base_dn().expect("No base DN");
    let container = format!("CN=Users,{}", base_dn);

    let mut attributes = HashMap::new();
    attributes.insert(
        "displayName".to_string(),
        vec!["DSPanel Temp User".to_string()],
    );
    attributes.insert(
        "userPrincipalName".to_string(),
        vec!["DSPanel-IntTest-TempUser@dspanel.local".to_string()],
    );

    let result = provider
        .create_user(
            "DSPanel-IntTest-TempUser",
            &container,
            "DSPanel-IntTest-TempUser",
            "TempU$er123!",
            &attributes,
        )
        .await;
    match result {
        Ok(dn) => {
            println!("Created user: {}", dn);
            assert!(dn.contains("DSPanel-IntTest-TempUser"));

            // Verify the user exists
            let found = provider
                .get_user_by_identity("DSPanel-IntTest-TempUser")
                .await
                .expect("get_user_by_identity failed");
            assert!(found.is_some(), "Created user should be findable");

            // Delete
            provider
                .delete_object(&dn)
                .await
                .expect("delete_object failed");
            println!("Deleted user: {}", dn);

            // Verify deletion
            let found = provider
                .get_user_by_identity("DSPanel-IntTest-TempUser")
                .await
                .expect("get_user_by_identity failed");
            assert!(
                found.is_none(),
                "Deleted user should not be findable"
            );
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

#[tokio::test]
async fn admin_get_thumbnail_photo() {
    let provider = skip_if_no_ad!();
    let user = provider
        .get_user_by_identity("testadmin")
        .await
        .expect("get_user failed")
        .expect("testadmin not found");

    let result = provider
        .get_thumbnail_photo(&user.distinguished_name)
        .await;
    match result {
        Ok(photo) => {
            match photo {
                Some(base64_data) => {
                    println!(
                        "testadmin has a thumbnail photo ({} chars base64)",
                        base64_data.len()
                    );
                }
                None => {
                    println!("testadmin has no thumbnail photo set");
                }
            }
        }
        Err(e) => {
            eprintln!("SKIPPED (permission denied?): {}", e);
        }
    }
}

// =========================================================================
// DC HEALTH - READ OPERATIONS
// =========================================================================

#[tokio::test]
async fn read_dc_health_check() {
    let provider = skip_if_no_ad!();
    let provider: Arc<dyn DirectoryProvider> = Arc::new(provider);

    // Discover DCs first
    let dcs = dc_health::discover_domain_controllers(&*provider)
        .await
        .expect("discover_domain_controllers failed");
    println!("Discovered {} domain controller(s)", dcs.len());
    assert!(!dcs.is_empty(), "Should discover at least one DC");

    // Find DC1 (172.31.72.165) or use the first DC
    let dc = dcs
        .iter()
        .find(|d| d.hostname.contains("172.31.72.165") || d.hostname.to_lowercase().contains("dc1"))
        .unwrap_or(&dcs[0]);
    println!("Checking health of: {}", dc.hostname);

    let result = dc_health::check_dc_health(dc, &*provider, None).await;
    println!(
        "Overall status: {:?}, checks: {}",
        result.overall_status,
        result.checks.len()
    );
    assert!(
        !result.checks.is_empty(),
        "Health check should produce at least one check"
    );
    for check in &result.checks {
        println!(
            "  [{:?}] {} - {}",
            check.status,
            check.name,
            check.message
        );
    }
    assert!(
        !result.checked_at.is_empty(),
        "checked_at should be populated"
    );
}

#[tokio::test]
async fn read_dc_health_multiple_dcs() {
    let provider = skip_if_no_ad!();
    let provider: Arc<dyn DirectoryProvider> = Arc::new(provider);

    let results = dc_health::check_all_dc_health(provider.clone())
        .await
        .expect("check_all_dc_health failed");

    println!("Health results for {} DC(s)", results.len());
    assert!(
        !results.is_empty(),
        "Should get health results for at least one DC"
    );

    for result in &results {
        println!(
            "DC: {} | Site: {} | Status: {:?} | FSMO: {:?} | Checks: {}",
            result.dc.hostname,
            result.dc.site_name,
            result.overall_status,
            result.dc.fsmo_roles,
            result.checks.len()
        );
    }

    // Verify at least the connected DC is healthy or has checks
    let connected_dc = results
        .iter()
        .find(|r| r.checks.iter().any(|c| c.name == "LDAP"));
    assert!(
        connected_dc.is_some(),
        "At least one DC should have an LDAP check"
    );
}

#[tokio::test]
async fn read_replication_partnerships() {
    let provider = skip_if_no_ad!();
    let provider: Arc<dyn DirectoryProvider> = Arc::new(provider);

    let partnerships = replication_status::get_replication_partnerships(provider.clone())
        .await
        .expect("get_replication_partnerships failed");

    println!("Found {} replication partnership(s)", partnerships.len());
    // With two DCs we expect at least one replication partnership
    assert!(
        !partnerships.is_empty(),
        "Two-DC domain should have at least one replication partnership"
    );

    for p in &partnerships {
        println!(
            "  {} -> {} | NC: {} | Status: {:?}",
            p.source_dc, p.target_dc, p.naming_context, p.status
        );
    }
}

#[tokio::test]
async fn read_topology_data() {
    let provider = skip_if_no_ad!();
    let provider: Arc<dyn DirectoryProvider> = Arc::new(provider);

    let topo = topology::get_topology(provider.clone())
        .await
        .expect("get_topology failed");

    println!(
        "Topology: {} site(s), {} replication link(s), {} site link(s)",
        topo.sites.len(),
        topo.replication_links.len(),
        topo.site_links.len()
    );

    assert!(
        !topo.sites.is_empty(),
        "Should discover at least one AD site"
    );

    for site in &topo.sites {
        println!(
            "  Site: {} | DCs: {} | Subnets: {:?}",
            site.name,
            site.dcs.len(),
            site.subnets
        );
        for dc in &site.dcs {
            println!(
                "    DC: {} | GC: {} | FSMO: {:?}",
                dc.hostname, dc.is_gc, dc.fsmo_roles
            );
        }
    }

    if !topo.replication_links.is_empty() {
        println!("Replication links:");
        for link in &topo.replication_links {
            println!(
                "  {} -> {} | status: {:?}",
                link.source_dc, link.target_dc, link.status
            );
        }
    }
}
