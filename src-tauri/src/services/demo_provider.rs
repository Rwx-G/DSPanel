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
            "jdoe",
            "John Doe",
            "IT",
            "Senior Engineer",
            "jdoe@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133510000000000000",
            "0",
        ),
        make_user(
            "asmith",
            "Alice Smith",
            "HR",
            "HR Manager",
            "asmith@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133505000000000000",
            "0",
        ),
        make_user(
            "bwilson",
            "Bob Wilson",
            "Finance",
            "Accountant",
            "bwilson@contoso.com",
            "514",
            "0", // Disabled (514 = 512 | 0x0002)
            "133400000000000000",
            "133480000000000000",
            "2",
        ),
        make_user(
            "cjones",
            "Carol Jones",
            "IT",
            "System Administrator",
            "cjones@contoso.com",
            "66048",
            "0", // 66048 = 512 | 0x10000 (DONT_EXPIRE_PASSWD)
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "dmartin",
            "David Martin",
            "Sales",
            "Account Executive",
            "dmartin@contoso.com",
            "512",
            "133512500000000000", // Locked out
            "133480000000000000",
            "133510000000000000",
            "5",
        ),
        make_user(
            "egupta",
            "Elena Gupta",
            "Engineering",
            "DevOps Lead",
            "egupta@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
    ]
}

fn sample_browse_users() -> Vec<DirectoryEntry> {
    let mut users = sample_users();
    users.extend(vec![
        make_user(
            "fchen",
            "Fiona Chen",
            "Engineering",
            "Frontend Developer",
            "fchen@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133511000000000000",
            "0",
        ),
        make_user(
            "gkumar",
            "Gaurav Kumar",
            "Engineering",
            "Backend Developer",
            "gkumar@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133512000000000000",
            "1",
        ),
        make_user(
            "hpark",
            "Hannah Park",
            "Marketing",
            "Brand Manager",
            "hpark@contoso.com",
            "512",
            "0",
            "133480000000000000",
            "133510000000000000",
            "0",
        ),
        make_user(
            "inovak",
            "Ivan Novak",
            "IT",
            "Network Engineer",
            "inovak@contoso.com",
            "66048",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "jlee",
            "Julia Lee",
            "Finance",
            "Financial Analyst",
            "jlee@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133511000000000000",
            "0",
        ),
        make_user(
            "kbrown",
            "Kevin Brown",
            "Sales",
            "Sales Director",
            "kbrown@contoso.com",
            "512",
            "0",
            "133480000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "lgarcia",
            "Laura Garcia",
            "HR",
            "Recruiter",
            "lgarcia@contoso.com",
            "514",
            "0",
            "133400000000000000",
            "133490000000000000",
            "0",
        ),
        make_user(
            "mwong",
            "Michael Wong",
            "Engineering",
            "QA Lead",
            "mwong@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "nsilva",
            "Nina Silva",
            "Marketing",
            "Content Strategist",
            "nsilva@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133510000000000000",
            "0",
        ),
        make_user(
            "omueller",
            "Oscar Mueller",
            "IT",
            "Security Analyst",
            "omueller@contoso.com",
            "512",
            "133512600000000000",
            "133500000000000000",
            "133512000000000000",
            "3",
        ),
        make_user(
            "pjohnson",
            "Patricia Johnson",
            "Finance",
            "Controller",
            "pjohnson@contoso.com",
            "66048",
            "0",
            "133400000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "qnguyen",
            "Quentin Nguyen",
            "Engineering",
            "SRE",
            "qnguyen@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "rthompson",
            "Rachel Thompson",
            "Sales",
            "Account Manager",
            "rthompson@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133511000000000000",
            "0",
        ),
        make_user(
            "sjackson",
            "Samuel Jackson",
            "IT",
            "Help Desk Lead",
            "sjackson@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "tanderson",
            "Tina Anderson",
            "HR",
            "Training Coordinator",
            "tanderson@contoso.com",
            "514",
            "0",
            "133400000000000000",
            "133480000000000000",
            "0",
        ),
        make_user(
            "uroberts",
            "Ulrich Roberts",
            "Engineering",
            "Data Engineer",
            "uroberts@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "vmorales",
            "Vanessa Morales",
            "Marketing",
            "Creative Director",
            "vmorales@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133510000000000000",
            "0",
        ),
        make_user(
            "wkim",
            "William Kim",
            "Finance",
            "Auditor",
            "wkim@contoso.com",
            "512",
            "0",
            "133490000000000000",
            "133511000000000000",
            "0",
        ),
        make_user(
            "xzhang",
            "Xin Zhang",
            "Engineering",
            "ML Engineer",
            "xzhang@contoso.com",
            "512",
            "0",
            "133500000000000000",
            "133512000000000000",
            "0",
        ),
        make_user(
            "yadams",
            "Yolanda Adams",
            "Sales",
            "VP Sales",
            "yadams@contoso.com",
            "66048",
            "0",
            "133400000000000000",
            "133512000000000000",
            "0",
        ),
    ]);
    // Sort by display name for browse consistency
    users.sort_by(|a, b| {
        let da = a.display_name.as_deref().unwrap_or("");
        let db = b.display_name.as_deref().unwrap_or("");
        da.cmp(db)
    });
    users
}

fn sample_group_entries() -> Vec<DirectoryEntry> {
    vec![
        make_group("IT-Admins", "IT Team", "IT"),
        make_group("IT-Support", "IT Team", "IT"),
        make_group("Dev-Frontend", "Engineering Team", "Engineering"),
        make_group("Dev-Backend", "Engineering Team", "Engineering"),
        make_group("Finance-Analysts", "Finance Team", "Finance"),
        make_group("Sales-EMEA", "Sales Team", "Sales"),
    ]
}

fn make_group(name: &str, parent_group: &str, _dept: &str) -> DirectoryEntry {
    let mut attrs = HashMap::new();
    attrs.insert(
        "memberOf".to_string(),
        vec![format!(
            "CN={},OU=Groups,DC=contoso,DC=com",
            parent_group
        )],
    );
    DirectoryEntry {
        distinguished_name: format!("CN={},OU=Groups,DC=contoso,DC=com", name),
        sam_account_name: Some(name.to_string()),
        display_name: Some(name.to_string()),
        object_class: Some("group".to_string()),
        attributes: attrs,
    }
}

fn dn_seed(dn: &str) -> u64 {
    dn.bytes().fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64))
}

fn sample_replication_metadata_for(object_dn: &str) -> String {
    let seed = dn_seed(object_dn);
    // Vary dates and versions per user using the seed
    let day_offset = (seed % 28) as u32 + 1;
    let hour = (seed % 20) as u32 + 4;
    let v_base = (seed % 5) as u64;
    let dc = if seed % 2 == 0 { "DC01" } else { "DC02" };
    let dc_alt = if seed % 2 == 0 { "DC02" } else { "DC01" };
    let usn_base = 10000 + (seed % 50000);

    let attrs: Vec<(&str, u64, String, &str, u64)> = vec![
        ("sAMAccountName",      1,              format!("2024-06-{}T{:02}:12:00Z", (day_offset % 28) + 1, hour), dc, usn_base),
        ("userPrincipalName",   1,              format!("2024-06-{}T{:02}:12:00Z", (day_offset % 28) + 1, hour), dc, usn_base + 1),
        ("mail",                v_base + 1,     format!("2025-{:02}-{}T{:02}:00:00Z", (seed % 10) + 1, (day_offset % 27) + 1, (hour + 3) % 24), dc_alt, usn_base + 5000),
        ("displayName",         v_base + 2,     format!("2025-{:02}-{}T{:02}:30:00Z", (seed % 8) + 3, (day_offset % 26) + 1, (hour + 5) % 24), dc_alt, usn_base + 15000),
        ("department",          v_base + 1,     format!("2025-{:02}-{}T{:02}:20:00Z", (seed % 6) + 5, (day_offset % 25) + 1, (hour + 2) % 24), dc, usn_base + 12000),
        ("title",               v_base + 3,     format!("2026-01-{}T{:02}:45:00Z", (day_offset % 28) + 1, (hour + 1) % 24), dc, usn_base + 30000),
        ("userAccountControl",  v_base + 2,     format!("2026-01-{}T{:02}:30:00Z", ((day_offset + 5) % 28) + 1, (hour + 4) % 24), dc, usn_base + 28000),
        ("pwdLastSet",          v_base + 4,     format!("2026-02-{}T{:02}:00:00Z", (day_offset % 27) + 1, (hour + 6) % 24), dc, usn_base + 40000),
        ("memberOf",            v_base + 5,     format!("2026-02-{}T{:02}:45:00Z", ((day_offset + 10) % 27) + 1, (hour + 3) % 24), dc, usn_base + 42000),
        ("lastLogonTimestamp",  v_base + 8,     format!("2026-03-{}T{:02}:15:00Z", (day_offset % 13) + 1, (hour + 7) % 24), dc_alt, usn_base + 50000),
        ("whenChanged",        v_base + 10,     format!("2026-03-{}T{:02}:15:00Z", (day_offset % 13) + 1, (hour + 7) % 24), dc_alt, usn_base + 50001),
    ];

    attrs
        .iter()
        .map(|(name, ver, time, originating_dc, usn)| {
            format!(
                r#"<DS_REPL_ATTR_META_DATA>
    <pszAttributeName>{}</pszAttributeName>
    <dwVersion>{}</dwVersion>
    <ftimeLastOriginatingChange>{}</ftimeLastOriginatingChange>
    <pszLastOriginatingDsaDN>CN={},OU=Domain Controllers,DC=contoso,DC=com</pszLastOriginatingDsaDN>
    <usnOriginatingChange>{}</usnOriginatingChange>
    <usnLocalChange>{}</usnLocalChange>
</DS_REPL_ATTR_META_DATA>"#,
                name, ver, time, originating_dc, usn, usn + 300
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn sample_computers() -> Vec<DirectoryEntry> {
    vec![
        make_computer(
            "WS-PC001",
            "PC001.contoso.com",
            "Windows 11 Enterprise",
            "10.0 (22631)",
        ),
        make_computer(
            "WS-PC002",
            "PC002.contoso.com",
            "Windows 11 Enterprise",
            "10.0 (22631)",
        ),
        make_computer(
            "SRV-DC01",
            "DC01.contoso.com",
            "Windows Server 2022",
            "10.0 (20348)",
        ),
        make_computer(
            "SRV-FILE01",
            "FILE01.contoso.com",
            "Windows Server 2022",
            "10.0 (20348)",
        ),
    ]
}

fn make_user(
    sam: &str,
    display: &str,
    dept: &str,
    title: &str,
    mail: &str,
    uac: &str,
    lockout_time: &str,
    pwd_last_set: &str,
    last_logon: &str,
    bad_pwd_count: &str,
) -> DirectoryEntry {
    let mut attrs = HashMap::new();
    attrs.insert("displayName".to_string(), vec![display.to_string()]);
    attrs.insert("sAMAccountName".to_string(), vec![sam.to_string()]);
    attrs.insert(
        "userPrincipalName".to_string(),
        vec![format!("{}@contoso.com", sam)],
    );
    attrs.insert(
        "givenName".to_string(),
        vec![display.split(' ').next().unwrap_or("").to_string()],
    );
    attrs.insert(
        "sn".to_string(),
        vec![display.split(' ').last().unwrap_or("").to_string()],
    );
    attrs.insert("mail".to_string(), vec![mail.to_string()]);
    attrs.insert("department".to_string(), vec![dept.to_string()]);
    attrs.insert("title".to_string(), vec![title.to_string()]);
    attrs.insert("userAccountControl".to_string(), vec![uac.to_string()]);
    attrs.insert("lockoutTime".to_string(), vec![lockout_time.to_string()]);
    attrs.insert("pwdLastSet".to_string(), vec![pwd_last_set.to_string()]);
    attrs.insert("lastLogon".to_string(), vec![last_logon.to_string()]);
    attrs.insert("badPwdCount".to_string(), vec![bad_pwd_count.to_string()]);
    attrs.insert(
        "whenCreated".to_string(),
        vec!["2024-01-15T08:00:00Z".to_string()],
    );
    attrs.insert(
        "whenChanged".to_string(),
        vec!["2026-03-10T14:30:00Z".to_string()],
    );
    attrs.insert(
        "memberOf".to_string(),
        vec![
            "CN=Domain Users,CN=Users,DC=contoso,DC=com".to_string(),
            format!("CN={} Team,OU=Groups,DC=contoso,DC=com", dept),
        ],
    );

    // Token groups: SIDs of all groups the user is a member of (used for ACL cross-reference)
    let dept_group_sid = match dept {
        "IT" => "S-1-5-21-1234567890-9876543210-1111111111-1102",
        "Finance" => "S-1-5-21-1234567890-9876543210-1111111111-1105",
        "Engineering" => "S-1-5-21-1234567890-9876543210-1111111111-1106",
        "Sales" => "S-1-5-21-1234567890-9876543210-1111111111-1108",
        "Marketing" => "S-1-5-21-1234567890-9876543210-1111111111-1109",
        "HR" => "S-1-5-21-1234567890-9876543210-1111111111-1110",
        _ => "S-1-5-21-1234567890-9876543210-1111111111-1199",
    };
    attrs.insert(
        "tokenGroups".to_string(),
        vec![
            "S-1-5-21-1234567890-9876543210-1111111111-513".to_string(), // Domain Users
            dept_group_sid.to_string(),
        ],
    );

    // Advanced/extended attributes (typically hidden in basic AD explorers)
    attrs.insert("cn".to_string(), vec![display.to_string()]);
    attrs.insert(
        "objectGUID".to_string(),
        vec![format!(
            "a1b2c3d4-e5f6-7890-{:04x}-abcdef012345",
            sam.len() * 1000
        )],
    );
    attrs.insert(
        "objectSid".to_string(),
        vec![format!(
            "S-1-5-21-1234567890-9876543210-1111111111-{}",
            1100 + sam.len()
        )],
    );
    attrs.insert("adminCount".to_string(), vec!["0".to_string()]);
    attrs.insert(
        "logonCount".to_string(),
        vec![format!("{}", sam.len() * 47)],
    );
    attrs.insert(
        "telephoneNumber".to_string(),
        vec![format!("+1-555-01{:02}", sam.len())],
    );
    attrs.insert(
        "physicalDeliveryOfficeName".to_string(),
        vec!["Building A - Floor 3".to_string()],
    );
    attrs.insert(
        "streetAddress".to_string(),
        vec!["123 Corporate Blvd".to_string()],
    );
    attrs.insert("l".to_string(), vec!["Seattle".to_string()]);
    attrs.insert("st".to_string(), vec!["WA".to_string()]);
    attrs.insert("postalCode".to_string(), vec!["98101".to_string()]);
    attrs.insert("co".to_string(), vec!["United States".to_string()]);
    attrs.insert("company".to_string(), vec!["Contoso Ltd.".to_string()]);
    attrs.insert(
        "manager".to_string(),
        vec![format!(
            "CN=Manager of {},OU={},OU=Users,DC=contoso,DC=com",
            display, dept
        )],
    );
    attrs.insert("directReports".to_string(), vec![]);
    attrs.insert("homeDrive".to_string(), vec!["H:".to_string()]);
    attrs.insert(
        "homeDirectory".to_string(),
        vec![format!("\\\\fileserver\\homes\\{}", sam)],
    );
    attrs.insert("scriptPath".to_string(), vec!["logon.bat".to_string()]);
    attrs.insert(
        "profilePath".to_string(),
        vec![format!("\\\\fileserver\\profiles\\{}", sam)],
    );
    attrs.insert(
        "extensionAttribute1".to_string(),
        vec![format!("EMP-{:05}", sam.len() * 1234)],
    );
    attrs.insert("extensionAttribute2".to_string(), vec![dept.to_string()]);
    attrs.insert(
        "extensionAttribute5".to_string(),
        vec![format!("SAP-{}", sam.to_uppercase())],
    );
    attrs.insert(
        "msDS-UserPasswordExpiryTimeComputed".to_string(),
        vec!["133600000000000000".to_string()],
    );
    attrs.insert(
        "msDS-PrincipalName".to_string(),
        vec![format!("CONTOSO\\{}", sam)],
    );

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
    attrs.insert(
        "operatingSystemVersion".to_string(),
        vec![os_ver.to_string()],
    );
    attrs.insert("userAccountControl".to_string(), vec!["4096".to_string()]);
    attrs.insert(
        "lastLogon".to_string(),
        vec!["133512000000000000".to_string()],
    );
    attrs.insert("objectClass".to_string(), vec!["computer".to_string()]);
    attrs.insert(
        "memberOf".to_string(),
        vec!["CN=Domain Computers,CN=Users,DC=contoso,DC=com".to_string()],
    );

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
        Ok(sample_browse_users()
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

    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
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

    async fn search_groups(
        &self,
        _filter: &str,
        _max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        Ok(vec![])
    }

    async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        Ok(sample_browse_users()
            .into_iter()
            .take(max_results)
            .collect())
    }

    async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        Ok(sample_computers().into_iter().take(max_results).collect())
    }

    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        Ok(sample_browse_users()
            .into_iter()
            .find(|u| u.sam_account_name.as_deref() == Some(sam_account_name)))
    }

    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        // Search users, computers, and sub-groups for members of this group
        let mut members: Vec<DirectoryEntry> = sample_browse_users()
            .into_iter()
            .chain(sample_computers().into_iter())
            .chain(sample_group_entries().into_iter())
            .filter(|entry| {
                entry
                    .get_attribute_values("memberOf")
                    .iter()
                    .any(|m| m == group_dn)
            })
            .take(max_results)
            .collect();

        // Sort by display name for consistent ordering
        members.sort_by(|a, b| {
            let da = a.display_name.as_deref().unwrap_or("");
            let db = b.display_name.as_deref().unwrap_or("");
            da.cmp(db)
        });

        Ok(members)
    }

    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        // Return DomainAdmin group so permission detection grants full access
        Ok(vec![
            "CN=Domain Admins,CN=Users,DC=contoso,DC=com".to_string(),
            "CN=DSPanel-Admins,OU=Groups,DC=contoso,DC=com".to_string(),
        ])
    }

    async fn reset_password(
        &self,
        user_dn: &str,
        _new_password: &str,
        _must_change: bool,
    ) -> Result<()> {
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

    async fn get_cannot_change_password(&self, _user_dn: &str) -> Result<bool> {
        Ok(false)
    }

    async fn set_password_flags(&self, user_dn: &str, pne: bool, uccp: bool) -> Result<()> {
        tracing::info!(target_dn = %user_dn, pne, uccp, "DEMO: password flags simulated");
        Ok(())
    }

    async fn add_user_to_group(&self, user_dn: &str, group_dn: &str) -> Result<()> {
        tracing::info!(user_dn = %user_dn, group_dn = %group_dn, "DEMO: add user to group simulated");
        Ok(())
    }

    async fn get_replication_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        Ok(Some(sample_replication_metadata_for(object_dn)))
    }
}
