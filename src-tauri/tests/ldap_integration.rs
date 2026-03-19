//! Integration tests for LdapDirectoryProvider against a real Active Directory.
//!
//! These tests require a running AD domain controller and are skipped by default.
//! They are gated by the `DSPANEL_LDAP_SERVER` environment variable.
//!
//! # Prerequisites
//!
//! - Windows Server VM with AD DS role (e.g., Hyper-V with Internal switch)
//! - Domain populated with BadBlood for realistic test data
//! - A test bind account with read access
//!
//! # Running
//!
//! ```bash
//! export DSPANEL_LDAP_SERVER=10.0.0.10
//! export DSPANEL_LDAP_BIND_DN="CN=TestBind,CN=Users,DC=lab,DC=dspanel,DC=local"
//! export DSPANEL_LDAP_BIND_PASSWORD="TestP@ss123"
//! cargo test --test ldap_integration -- --nocapture
//! ```

use dspanel_lib::services::ldap_directory::LdapDirectoryProvider;
use dspanel_lib::services::directory::DirectoryProvider;

/// Returns a configured provider from env vars, or None if not configured.
fn create_test_provider() -> Option<LdapDirectoryProvider> {
    let server = std::env::var("DSPANEL_LDAP_SERVER").ok()?;
    let bind_dn = std::env::var("DSPANEL_LDAP_BIND_DN").ok()?;
    let password = std::env::var("DSPANEL_LDAP_BIND_PASSWORD").ok()?;
    Some(LdapDirectoryProvider::new_with_credentials(server, bind_dn, password))
}

#[tokio::test]
async fn test_simple_bind_connection() {
    let Some(provider) = create_test_provider() else {
        eprintln!("SKIPPED: DSPANEL_LDAP_SERVER not set");
        return;
    };

    let connected = provider.test_connection().await.expect("test_connection should not error");
    assert!(connected, "Should connect to AD via simple bind");

    let domain = provider.domain_name();
    assert!(domain.is_some(), "Domain name should be set");
    println!("Connected to: {}", domain.unwrap());

    let base_dn = provider.base_dn();
    assert!(base_dn.is_some(), "Base DN should be discovered");
    println!("Base DN: {}", base_dn.unwrap());
}

#[tokio::test]
async fn test_search_users_simple_bind() {
    let Some(provider) = create_test_provider() else {
        eprintln!("SKIPPED: DSPANEL_LDAP_SERVER not set");
        return;
    };

    // Ensure connection is established
    provider.test_connection().await.expect("connection failed");

    let results = provider.search_users("testreadonly", 10).await.expect("search_users failed");
    println!("Found {} users matching 'testreadonly'", results.len());
    for user in &results {
        println!(
            "  - {} ({})",
            user.display_name.as_deref().unwrap_or("?"),
            user.sam_account_name.as_deref().unwrap_or("?")
        );
    }
}

#[tokio::test]
async fn test_browse_groups_simple_bind() {
    let Some(provider) = create_test_provider() else {
        eprintln!("SKIPPED: DSPANEL_LDAP_SERVER not set");
        return;
    };

    // Ensure connection is established
    provider.test_connection().await.expect("connection failed");

    let results = provider.browse_groups(20).await.expect("browse_groups failed");
    println!("Found {} groups", results.len());
    for group in &results {
        println!(
            "  - {} ({})",
            group.display_name.as_deref().unwrap_or("?"),
            group.sam_account_name.as_deref().unwrap_or("?")
        );
    }
    assert!(!results.is_empty(), "Should find at least one group in AD");
}
