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

use dspanel_lib::services::directory::DirectoryProvider;
use dspanel_lib::services::ldap_directory::{LdapDirectoryProvider, LdapTlsConfig};

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
