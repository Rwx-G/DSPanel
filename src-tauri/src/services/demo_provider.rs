/// Demo directory provider with realistic sample data.
///
/// Compiled only when the `demo` feature is enabled.
/// Provides fake AD users, computers, and groups for UI testing
/// without requiring a real Active Directory connection.
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;

use crate::models::DirectoryEntry;
use crate::services::directory::DirectoryProvider;

pub struct DemoDirectoryProvider;

impl DemoDirectoryProvider {
    pub fn new() -> Self {
        tracing::info!("DEMO MODE: using DemoDirectoryProvider with sample data");
        Self
    }
}

fn sample_users() -> Vec<DirectoryEntry> {
    vec![
        make_user(
            "jdoe", "John Doe", "IT", "Senior Engineer",
            "jdoe@contoso.com", "512", "0",
            "133500000000000000", "133510000000000000", "0",
        ),
        make_user(
            "asmith", "Alice Smith", "HR", "HR Manager",
            "asmith@contoso.com", "512", "0",
            "133490000000000000", "133505000000000000", "0",
        ),
        make_user(
            "bwilson", "Bob Wilson", "Finance", "Accountant",
            "bwilson@contoso.com", "514", "0", // Disabled (514 = 512 | 0x0002)
            "133400000000000000", "133480000000000000", "2",
        ),
        make_user(
            "cjones", "Carol Jones", "IT", "System Administrator",
            "cjones@contoso.com", "66048", "0", // 66048 = 512 | 0x10000 (DONT_EXPIRE_PASSWD)
            "133500000000000000", "133512000000000000", "0",
        ),
        make_user(
            "dmartin", "David Martin", "Sales", "Account Executive",
            "dmartin@contoso.com", "512", "133512500000000000", // Locked out
            "133480000000000000", "133510000000000000", "5",
        ),
        make_user(
            "egupta", "Elena Gupta", "Engineering", "DevOps Lead",
            "egupta@contoso.com", "512", "0",
            "133500000000000000", "133512000000000000", "0",
        ),
    ]
}

fn sample_computers() -> Vec<DirectoryEntry> {
    vec![
        make_computer("WS-PC001", "PC001.contoso.com", "Windows 11 Enterprise", "10.0 (22631)"),
        make_computer("WS-PC002", "PC002.contoso.com", "Windows 11 Enterprise", "10.0 (22631)"),
        make_computer("SRV-DC01", "DC01.contoso.com", "Windows Server 2022", "10.0 (20348)"),
        make_computer("SRV-FILE01", "FILE01.contoso.com", "Windows Server 2022", "10.0 (20348)"),
    ]
}

fn make_user(
    sam: &str, display: &str, dept: &str, title: &str,
    mail: &str, uac: &str, lockout_time: &str,
    pwd_last_set: &str, last_logon: &str, bad_pwd_count: &str,
) -> DirectoryEntry {
    let mut attrs = HashMap::new();
    attrs.insert("displayName".to_string(), vec![display.to_string()]);
    attrs.insert("sAMAccountName".to_string(), vec![sam.to_string()]);
    attrs.insert("userPrincipalName".to_string(), vec![format!("{}@contoso.com", sam)]);
    attrs.insert("givenName".to_string(), vec![display.split(' ').next().unwrap_or("").to_string()]);
    attrs.insert("sn".to_string(), vec![display.split(' ').last().unwrap_or("").to_string()]);
    attrs.insert("mail".to_string(), vec![mail.to_string()]);
    attrs.insert("department".to_string(), vec![dept.to_string()]);
    attrs.insert("title".to_string(), vec![title.to_string()]);
    attrs.insert("userAccountControl".to_string(), vec![uac.to_string()]);
    attrs.insert("lockoutTime".to_string(), vec![lockout_time.to_string()]);
    attrs.insert("pwdLastSet".to_string(), vec![pwd_last_set.to_string()]);
    attrs.insert("lastLogon".to_string(), vec![last_logon.to_string()]);
    attrs.insert("badPwdCount".to_string(), vec![bad_pwd_count.to_string()]);
    attrs.insert("whenCreated".to_string(), vec!["2024-01-15T08:00:00Z".to_string()]);
    attrs.insert("whenChanged".to_string(), vec!["2026-03-10T14:30:00Z".to_string()]);
    attrs.insert("memberOf".to_string(), vec![
        "CN=Domain Users,CN=Users,DC=contoso,DC=com".to_string(),
        format!("CN={} Team,OU=Groups,DC=contoso,DC=com", dept),
    ]);

    DirectoryEntry {
        distinguished_name: format!("CN={},OU={},OU=Users,DC=contoso,DC=com", display, dept),
        sam_account_name: Some(sam.to_string()),
        display_name: Some(display.to_string()),
        object_class: Some("user".to_string()),
        attributes: attrs,
    }
}

fn make_computer(name: &str, dns: &str, os: &str, os_ver: &str) -> DirectoryEntry {
    let mut attrs = HashMap::new();
    attrs.insert("dNSHostName".to_string(), vec![dns.to_string()]);
    attrs.insert("operatingSystem".to_string(), vec![os.to_string()]);
    attrs.insert("operatingSystemVersion".to_string(), vec![os_ver.to_string()]);
    attrs.insert("userAccountControl".to_string(), vec!["4096".to_string()]);
    attrs.insert("lastLogon".to_string(), vec!["133512000000000000".to_string()]);
    attrs.insert("objectClass".to_string(), vec!["computer".to_string()]);

    DirectoryEntry {
        distinguished_name: format!("CN={},OU=Computers,DC=contoso,DC=com", name),
        sam_account_name: Some(format!("{}$", name)),
        display_name: Some(name.to_string()),
        object_class: Some("computer".to_string()),
        attributes: attrs,
    }
}

#[async_trait]
impl DirectoryProvider for DemoDirectoryProvider {
    fn is_connected(&self) -> bool {
        true
    }

    fn domain_name(&self) -> Option<&str> {
        Some("CONTOSO.COM")
    }

    fn base_dn(&self) -> Option<String> {
        Some("DC=contoso,DC=com".to_string())
    }

    async fn test_connection(&self) -> Result<bool> {
        Ok(true)
    }

    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let lower = filter.to_lowercase();
        Ok(sample_users()
            .into_iter()
            .filter(|u| {
                let sam = u.sam_account_name.as_deref().unwrap_or("").to_lowercase();
                let display = u.display_name.as_deref().unwrap_or("").to_lowercase();
                let mail = u.get_attribute("mail").unwrap_or("").to_lowercase();
                sam.contains(&lower) || display.contains(&lower) || mail.contains(&lower)
            })
            .take(max_results)
            .collect())
    }

    async fn search_computers(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let lower = filter.to_lowercase();
        Ok(sample_computers()
            .into_iter()
            .filter(|c| {
                let name = c.display_name.as_deref().unwrap_or("").to_lowercase();
                let dns = c.get_attribute("dNSHostName").unwrap_or("").to_lowercase();
                name.contains(&lower) || dns.contains(&lower)
            })
            .take(max_results)
            .collect())
    }

    async fn search_groups(&self, _filter: &str, _max_results: usize) -> Result<Vec<DirectoryEntry>> {
        Ok(vec![])
    }

    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        Ok(sample_users()
            .into_iter()
            .find(|u| u.sam_account_name.as_deref() == Some(sam_account_name)))
    }

    async fn get_group_members(&self, _group_dn: &str, _max_results: usize) -> Result<Vec<DirectoryEntry>> {
        Ok(vec![])
    }

    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        // Return DomainAdmin group so permission detection grants full access
        Ok(vec![
            "CN=Domain Admins,CN=Users,DC=contoso,DC=com".to_string(),
            "CN=DSPanel-Admins,OU=Groups,DC=contoso,DC=com".to_string(),
        ])
    }

    async fn reset_password(&self, user_dn: &str, _new_password: &str, _must_change: bool) -> Result<()> {
        tracing::info!(target_dn = %user_dn, "DEMO: password reset simulated");
        Ok(())
    }

    async fn unlock_account(&self, user_dn: &str) -> Result<()> {
        tracing::info!(target_dn = %user_dn, "DEMO: account unlock simulated");
        Ok(())
    }

    async fn enable_account(&self, user_dn: &str) -> Result<()> {
        tracing::info!(target_dn = %user_dn, "DEMO: account enable simulated");
        Ok(())
    }

    async fn disable_account(&self, user_dn: &str) -> Result<()> {
        tracing::info!(target_dn = %user_dn, "DEMO: account disable simulated");
        Ok(())
    }

    async fn set_password_flags(&self, user_dn: &str, pne: bool, uccp: bool) -> Result<()> {
        tracing::info!(target_dn = %user_dn, pne, uccp, "DEMO: password flags simulated");
        Ok(())
    }
}
