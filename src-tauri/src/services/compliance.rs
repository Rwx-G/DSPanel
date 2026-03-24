use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::directory::DirectoryProvider;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// Mapping of a check to a specific framework control.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkMapping {
    pub standard: String,
    pub control_ref: String,
}

/// A compliance check definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceCheck {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: String,
    pub query_scope: String,
    pub query_attributes: Vec<String>,
    pub frameworks: Vec<FrameworkMapping>,
    pub remediation: String,
}

/// Result of a single check after scanning.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub check_id: String,
    pub title: String,
    pub description: String,
    pub severity: String,
    pub finding_count: usize,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub frameworks: Vec<FrameworkMapping>,
    pub remediation: String,
}

/// Score for a single framework derived from check results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkScore {
    pub standard: String,
    pub score: u32,
    pub total_checks: usize,
    pub checks_with_findings: usize,
    pub control_refs: Vec<String>,
}

/// Full result of a compliance scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceScanResult {
    pub scanned_at: String,
    pub generator: String,
    pub total_accounts_scanned: usize,
    pub global_score: u32,
    pub total_findings: usize,
    pub framework_scores: Vec<FrameworkScore>,
    pub checks: Vec<CheckResult>,
}

// ---------------------------------------------------------------------------
// Supported frameworks
// ---------------------------------------------------------------------------

pub const FRAMEWORKS: &[&str] = &[
    "GDPR",
    "HIPAA",
    "SOX",
    "PCI-DSS v4.0",
    "ISO 27001",
    "NIST 800-53",
    "CIS v8",
    "NIS2",
    "ANSSI",
];

// ---------------------------------------------------------------------------
// Check definitions
// ---------------------------------------------------------------------------

pub fn builtin_checks() -> Vec<ComplianceCheck> {
    vec![
        ComplianceCheck {
            id: "privileged_accounts".into(),
            title: "Privileged Accounts".into(),
            description: "Accounts with administrative privileges (adminCount=1). Excessive \
                privileged accounts increase the risk of unauthorized access and lateral movement."
                .into(),
            severity: "High".into(),
            query_scope: "privilegedAccounts".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(),
                "lastLogonTimestamp".into(), "pwdLastSet".into(), "whenCreated".into(),
            ],
            frameworks: vec![
                fm("GDPR", "Art. 32(2) - Security of processing"),
                fm("HIPAA", "164.312(a)(1) - Access control"),
                fm("SOX", "ITGC APD - Provisioning"),
                fm("PCI-DSS v4.0", "Req. 7.2.1 - Access control model"),
                fm("ISO 27001", "A.8.2 - Privileged access rights"),
                fm("NIST 800-53", "AC-6 - Least privilege"),
                fm("CIS v8", "5.1 - Inventory of accounts"),
                fm("NIS2", "Art. 21(2)(i) - Access control policies"),
                fm("ANSSI", "R.27 - Limiter les droits d'administration"),
            ],
            remediation: "[High] Review all privileged accounts quarterly and document business justification.\n\
                Get-ADUser -Filter {AdminCount -eq 1} | Select-Object SamAccountName, Enabled, LastLogonDate"
                .into(),
        },
        ComplianceCheck {
            id: "inactive_accounts".into(),
            title: "Inactive Accounts (>90 days)".into(),
            description: "Accounts that have not logged in for more than 90 days. Dormant accounts \
                are prime targets for credential stuffing and lateral movement attacks."
                .into(),
            severity: "High".into(),
            query_scope: "inactiveAccounts".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "lastLogonTimestamp".into(),
            ],
            frameworks: vec![
                fm("GDPR", "Art. 5(1)(e) - Storage limitation"),
                fm("HIPAA", "164.308(a)(3)(ii)(C) - Termination procedures"),
                fm("PCI-DSS v4.0", "Req. 8.2.6 - Inactive accounts"),
                fm("ISO 27001", "A.5.18 - Access rights review"),
                fm("NIST 800-53", "AC-2(3) - Disable inactive accounts"),
                fm("CIS v8", "5.3 - Disable dormant accounts"),
                fm("NIS2", "Art. 21(2)(i) - Access control"),
                fm("ANSSI", "R.30 - Desactiver les comptes inutilises"),
            ],
            remediation: "[High] Disable inactive accounts within 90 days:\n\
                Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount"
                .into(),
        },
        ComplianceCheck {
            id: "password_not_required".into(),
            title: "Password Not Required (PASSWD_NOTREQD)".into(),
            description: "Accounts with the PASSWD_NOTREQD flag set, allowing empty passwords. \
                This is a critical authentication failure that would result in automatic FAIL in most audits."
                .into(),
            severity: "Critical".into(),
            query_scope: "passwordNotRequired".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "userAccountControl".into(),
            ],
            frameworks: vec![
                fm("GDPR", "Art. 32(1)(b) - Ongoing confidentiality"),
                fm("HIPAA", "164.312(d) - Authentication"),
                fm("SOX", "ITGC APD - Authentication"),
                fm("PCI-DSS v4.0", "Req. 8.3.1 - Authentication factors"),
                fm("ISO 27001", "A.8.5 - Secure authentication"),
                fm("NIST 800-53", "IA-5 - Authenticator management"),
                fm("CIS v8", "5.2 - Use unique passwords"),
                fm("NIS2", "Art. 21(2)(j) - Multi-factor authentication"),
                fm("ANSSI", "R.22 - Politique de mot de passe"),
            ],
            remediation: "[Critical - FAIL if not fixed] Remove PASSWD_NOTREQD flag and set passwords:\n\
                Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false"
                .into(),
        },
        ComplianceCheck {
            id: "reversible_encryption".into(),
            title: "Reversible Password Encryption".into(),
            description: "Accounts storing passwords with reversible encryption, allowing recovery \
                in clear text. This defeats the purpose of password hashing."
                .into(),
            severity: "Critical".into(),
            query_scope: "reversibleEncryption".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "userAccountControl".into(),
            ],
            frameworks: vec![
                fm("GDPR", "Art. 32(1)(a) - Encryption"),
                fm("HIPAA", "164.312(a)(2)(iv) - Encryption and decryption"),
                fm("PCI-DSS v4.0", "Req. 8.3.2 - Strong cryptography"),
                fm("ISO 27001", "A.8.24 - Use of cryptography"),
                fm("NIST 800-53", "IA-5(1)(h) - Password-based authentication"),
                fm("CIS v8", "3.11 - Encrypt sensitive data at rest"),
                fm("NIS2", "Art. 21(2)(h) - Cryptography and encryption"),
                fm("ANSSI", "R.22 - Politique de mot de passe"),
            ],
            remediation: "[Critical] Remove reversible encryption:\n\
                Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | \
                Set-ADUser -AllowReversiblePasswordEncryption $false"
                .into(),
        },
        ComplianceCheck {
            id: "password_expired".into(),
            title: "Stale Passwords (>90 days)".into(),
            description: "Accounts whose passwords have not been changed in over 90 days. Stale \
                passwords increase the window for credential compromise."
                .into(),
            severity: "Medium".into(),
            query_scope: "passwordExpired".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "pwdLastSet".into(),
            ],
            frameworks: vec![
                fm("GDPR", "Art. 5(1)(f) - Integrity and confidentiality"),
                fm("SOX", "ITGC APD - Periodic review"),
                fm("PCI-DSS v4.0", "Req. 8.3.9 - Password rotation"),
                fm("ISO 27001", "A.5.17 - Authentication information"),
                fm("CIS v8", "5.2 - Use unique passwords"),
                fm("NIS2", "Art. 21(2)(g) - Basic cyber hygiene"),
                fm("ANSSI", "R.22 - Politique de mot de passe"),
            ],
            remediation: "[Medium] Enforce password rotation policy (90-day maximum age).\n\
                Force password change on next logon for stale accounts:\n\
                Get-ADUser -Filter {PasswordLastSet -lt (Get-Date).AddDays(-90)} | \
                Set-ADUser -ChangePasswordAtLogon $true"
                .into(),
        },
        ComplianceCheck {
            id: "password_never_expires".into(),
            title: "Password Never Expires".into(),
            description: "Accounts with the 'Password Never Expires' flag set. These accounts \
                bypass automated password rotation controls."
                .into(),
            severity: "Medium".into(),
            query_scope: "passwordNeverExpires".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "userAccountControl".into(),
            ],
            frameworks: vec![
                fm("HIPAA", "164.312(d) - Person or entity authentication"),
                fm("PCI-DSS v4.0", "Req. 8.3.9 - Password change frequency"),
                fm("NIST 800-53", "AC-2(1) - Automated account management"),
                fm("ANSSI", "R.22 - Politique de mot de passe"),
            ],
            remediation: "[Medium] Enforce password expiration:\n\
                Get-ADUser -Filter {PasswordNeverExpires -eq $true} | \
                Set-ADUser -PasswordNeverExpires $false\n\
                Note: document exceptions for service accounts with compensating controls."
                .into(),
        },
        ComplianceCheck {
            id: "disabled_accounts".into(),
            title: "Disabled Accounts Lifecycle".into(),
            description: "Currently disabled accounts. Lingering disabled accounts may indicate \
                incomplete deprovisioning or offboarding processes."
                .into(),
            severity: "Low".into(),
            query_scope: "disabledAccounts".into(),
            query_attributes: vec![
                "sAMAccountName".into(), "displayName".into(), "whenChanged".into(),
            ],
            frameworks: vec![
                fm("SOX", "ITGC APD - Deprovisioning"),
                fm("ISO 27001", "A.5.18 - Access rights review"),
                fm("CIS v8", "5.3 - Disable dormant accounts"),
                fm("ANSSI", "R.30 - Desactiver les comptes inutilises"),
            ],
            remediation: "[Low] Archive and delete disabled accounts older than retention period:\n\
                Search-ADAccount -AccountDisabled | Where-Object {$_.Modified -lt (Get-Date).AddDays(-90)}"
                .into(),
        },
    ]
}

fn fm(standard: &str, control_ref: &str) -> FrameworkMapping {
    FrameworkMapping {
        standard: standard.to_string(),
        control_ref: control_ref.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Scan execution
// ---------------------------------------------------------------------------

/// Runs all compliance checks once and computes per-framework scores.
pub async fn run_compliance_scan(
    provider: Arc<dyn DirectoryProvider>,
) -> Result<ComplianceScanResult, AppError> {
    let scanned_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let generator = provider
        .authenticated_user()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "DSPanel".to_string()));

    let checks = builtin_checks();
    let mut results = Vec::new();
    let mut total_accounts = 0usize;
    let mut total_findings = 0usize;

    for check in &checks {
        let entries = execute_query(provider.clone(), &check.query_scope).await?;
        total_accounts = total_accounts.max(entries.len());

        let headers: Vec<String> = check
            .query_attributes
            .iter()
            .map(|a| friendly_header(a))
            .collect();

        let rows: Vec<Vec<String>> = entries
            .iter()
            .map(|e| {
                check
                    .query_attributes
                    .iter()
                    .map(|attr| {
                        let raw = e.get_attribute(attr).unwrap_or("-");
                        format_ad_attribute(attr, raw)
                    })
                    .collect()
            })
            .collect();

        let count = rows.len();
        total_findings += count;

        results.push(CheckResult {
            check_id: check.id.clone(),
            title: check.title.clone(),
            description: check.description.clone(),
            severity: check.severity.clone(),
            finding_count: count,
            headers,
            rows,
            frameworks: check.frameworks.clone(),
            remediation: check.remediation.clone(),
        });
    }

    // Compute per-framework scores
    let framework_scores = compute_framework_scores(&results);
    let global_score = compute_global_score(&results);

    Ok(ComplianceScanResult {
        scanned_at,
        generator,
        total_accounts_scanned: total_accounts,
        global_score,
        total_findings,
        framework_scores,
        checks: results,
    })
}

/// Computes a score per framework based on which checks have findings.
fn compute_framework_scores(results: &[CheckResult]) -> Vec<FrameworkScore> {
    FRAMEWORKS
        .iter()
        .map(|&std_name| {
            let relevant_checks: Vec<&CheckResult> = results
                .iter()
                .filter(|r| r.frameworks.iter().any(|f| f.standard == std_name))
                .collect();

            let total = relevant_checks.len();
            let with_findings = relevant_checks
                .iter()
                .filter(|r| r.finding_count > 0)
                .count();

            let mut penalty = 0u32;
            for r in &relevant_checks {
                if r.finding_count > 0 {
                    match r.severity.as_str() {
                        "Critical" => penalty += 25,
                        "High" => penalty += 10,
                        "Medium" => penalty += 5,
                        _ => penalty += 2,
                    }
                }
            }
            let score = 100u32.saturating_sub(penalty);

            let control_refs: Vec<String> = relevant_checks
                .iter()
                .flat_map(|r| {
                    r.frameworks
                        .iter()
                        .filter(|f| f.standard == std_name)
                        .map(|f| f.control_ref.clone())
                })
                .collect();

            FrameworkScore {
                standard: std_name.to_string(),
                score,
                total_checks: total,
                checks_with_findings: with_findings,
                control_refs,
            }
        })
        .collect()
}

/// Computes a global score across all checks.
fn compute_global_score(results: &[CheckResult]) -> u32 {
    let mut penalty = 0u32;
    for r in results {
        if r.finding_count > 0 {
            match r.severity.as_str() {
                "Critical" => penalty += 25,
                "High" => penalty += 10,
                "Medium" => penalty += 5,
                _ => penalty += 2,
            }
        }
    }
    100u32.saturating_sub(penalty)
}

// ---------------------------------------------------------------------------
// Per-framework report export
// ---------------------------------------------------------------------------

/// Generates an HTML report filtered for a specific framework.
pub fn export_framework_report(scan: &ComplianceScanResult, framework: &str) -> String {
    let fw_score = scan
        .framework_scores
        .iter()
        .find(|f| f.standard == framework);

    let score = fw_score.map(|f| f.score).unwrap_or(100);
    let score_color = if score >= 80 {
        "#2e7d32"
    } else if score >= 50 {
        "#e65100"
    } else {
        "#c62828"
    };

    let relevant_checks: Vec<&CheckResult> = scan
        .checks
        .iter()
        .filter(|c| c.frameworks.iter().any(|f| f.standard == framework))
        .collect();

    let mut html = String::with_capacity(16384);

    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n");
    html.push_str(&format!(
        "<title>{} Compliance Report</title>\n",
        he(framework)
    ));
    html.push_str("<style>\n");
    html.push_str(
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;\
         margin:0;color:#1a1a2e;background:#fff}\
         .cover{background:#1a1a2e;color:#fff;padding:3rem;text-align:center;margin-bottom:2rem}\
         .cover h1{font-size:2rem;margin:0 0 0.5rem}\
         .cover .meta{font-size:0.85rem;opacity:0.6;margin-top:1rem}\
         .content{max-width:900px;margin:0 auto;padding:0 2rem 2rem}\
         .summary{display:flex;align-items:center;gap:1.5rem;margin:1rem 0 2rem}\
         .score{font-size:2.5rem;font-weight:700}\
         .section{margin-bottom:2rem;page-break-inside:avoid}\
         .section h2{font-size:1.1rem;margin-bottom:0.25rem}\
         .control-ref{display:inline-block;background:#e8eaf6;color:#3949ab;padding:2px 8px;\
         border-radius:4px;font-size:0.75rem;font-weight:600;margin-right:0.5rem}\
         .sev{display:inline-block;color:#fff;padding:2px 8px;border-radius:4px;\
         font-size:0.7rem;font-weight:600}\
         .sev-critical{background:#c62828}.sev-high{background:#e65100}\
         .sev-medium{background:#f9a825;color:#333}.sev-low{background:#546e7a}\
         table{border-collapse:collapse;width:100%;font-size:0.8rem;margin-top:0.5rem}\
         th{background:#1a1a2e;color:#fff;text-align:left;padding:6px 10px;font-weight:600}\
         td{padding:5px 10px;border-bottom:1px solid #e0e0e0}\
         tr:nth-child(even){background:#f8f9fa}\
         .desc{color:#555;font-size:0.85rem;line-height:1.5;margin:0.5rem 0}\
         .remediation{white-space:pre-line;font-size:0.82rem;line-height:1.6;\
         background:#f8f9fa;padding:1rem;border-radius:6px;border:1px solid #e0e0e0;margin-top:0.5rem}\
         .count{font-size:0.8rem;color:#666;margin-bottom:0.5rem}\
         .footer{text-align:center;color:#999;font-size:0.75rem;margin-top:3rem;\
         padding-top:1rem;border-top:1px solid #e0e0e0}\n",
    );
    html.push_str("</style>\n</head>\n<body>\n");

    // Cover
    html.push_str("<div class=\"cover\">\n");
    html.push_str(&format!("<h1>{} Compliance Report</h1>\n", he(framework)));
    html.push_str(&format!(
        "<div class=\"meta\">Generated: {} | By: {} | DSPanel</div>\n",
        he(&scan.scanned_at),
        he(&scan.generator),
    ));
    html.push_str("</div>\n");

    html.push_str("<div class=\"content\">\n");

    // Score summary
    html.push_str(&format!(
        "<div class=\"summary\">\
         <div class=\"score\" style=\"color:{}\">{}/100</div>\
         <div><div style=\"font-weight:600\">Compliance Score</div>\
         <div style=\"font-size:0.8rem;color:#666\">{} checks evaluated - {} with findings</div>\
         </div></div>\n",
        score_color,
        score,
        relevant_checks.len(),
        relevant_checks
            .iter()
            .filter(|c| c.finding_count > 0)
            .count(),
    ));

    // TOC
    html.push_str("<div class=\"section\">\n<h2>Table of Contents</h2>\n<ol>\n");
    for (i, check) in relevant_checks.iter().enumerate() {
        let ctrl = check
            .frameworks
            .iter()
            .find(|f| f.standard == framework)
            .map(|f| f.control_ref.as_str())
            .unwrap_or("");
        html.push_str(&format!(
            "<li><a href=\"#check-{}\">{}</a> <span class=\"control-ref\">{}</span> ({} findings)</li>\n",
            i, he(&check.title), he(ctrl), check.finding_count,
        ));
    }
    html.push_str("</ol>\n</div>\n");

    // Checks
    for (i, check) in relevant_checks.iter().enumerate() {
        let ctrl = check
            .frameworks
            .iter()
            .find(|f| f.standard == framework)
            .map(|f| f.control_ref.as_str())
            .unwrap_or("");
        let sev_class = match check.severity.as_str() {
            "Critical" => "sev-critical",
            "High" => "sev-high",
            "Medium" => "sev-medium",
            _ => "sev-low",
        };

        html.push_str(&format!("<div class=\"section\" id=\"check-{}\">\n", i));
        html.push_str(&format!("<h2>{}</h2>\n", he(&check.title)));
        html.push_str(&format!(
            "<span class=\"control-ref\">{}</span> <span class=\"sev {}\">{}</span>\n",
            he(ctrl),
            sev_class,
            he(&check.severity),
        ));
        html.push_str(&format!(
            "<p class=\"desc\">{}</p>\n",
            he(&check.description)
        ));
        html.push_str(&format!(
            "<div class=\"count\">{} findings</div>\n",
            check.finding_count
        ));

        if !check.rows.is_empty() {
            html.push_str("<table>\n<thead><tr>\n");
            for h in &check.headers {
                html.push_str(&format!("<th>{}</th>", he(h)));
            }
            html.push_str("\n</tr></thead>\n<tbody>\n");
            for row in &check.rows {
                html.push_str("<tr>");
                for cell in row {
                    html.push_str(&format!("<td>{}</td>", he(cell)));
                }
                html.push_str("</tr>\n");
            }
            html.push_str("</tbody>\n</table>\n");
        }

        html.push_str(&format!(
            "<div class=\"remediation\">{}</div>\n",
            he(&check.remediation)
        ));
        html.push_str("</div>\n");
    }

    html.push_str(&format!(
        "<div class=\"footer\">Generated by DSPanel - {} - {}</div>\n",
        he(framework),
        he(&scan.scanned_at),
    ));
    html.push_str("</div>\n</body>\n</html>");

    html
}

fn he(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

async fn execute_query(
    provider: Arc<dyn DirectoryProvider>,
    scope: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    let entries = provider
        .browse_users(5000)
        .await
        .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

    let now = chrono::Utc::now();
    let threshold_90d = 90 * 86400i64;

    Ok(match scope {
        "privilegedAccounts" => entries
            .into_iter()
            .filter(|e| e.get_attribute("adminCount") == Some("1"))
            .collect(),
        "inactiveAccounts" => entries
            .into_iter()
            .filter(|e| {
                parse_filetime(e.get_attribute("lastLogonTimestamp"))
                    .map(|ts| (now - ts).num_seconds() > threshold_90d)
                    .unwrap_or(false)
            })
            .collect(),
        "disabledAccounts" => entries
            .into_iter()
            .filter(|e| uac_has_flag(e, 0x0002))
            .collect(),
        "passwordNeverExpires" => entries
            .into_iter()
            .filter(|e| uac_has_flag(e, 0x10000))
            .collect(),
        "passwordNotRequired" => entries
            .into_iter()
            .filter(|e| uac_has_flag(e, 0x0020))
            .collect(),
        "reversibleEncryption" => entries
            .into_iter()
            .filter(|e| uac_has_flag(e, 0x0080))
            .collect(),
        "passwordExpired" => entries
            .into_iter()
            .filter(|e| {
                parse_filetime(e.get_attribute("pwdLastSet"))
                    .map(|ts| (now - ts).num_seconds() > threshold_90d)
                    .unwrap_or(false)
            })
            .collect(),
        _ => Vec::new(),
    })
}

fn parse_filetime(value: Option<&str>) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = value?;
    let ticks: i64 = s.parse().ok()?;
    if ticks <= 0 {
        return None;
    }
    let unix_secs = ticks / 10_000_000 - 11_644_473_600;
    chrono::DateTime::from_timestamp(unix_secs, 0)
}

fn uac_has_flag(entry: &DirectoryEntry, flag: u32) -> bool {
    entry
        .get_attribute("userAccountControl")
        .and_then(|s| s.parse::<u32>().ok())
        .map(|uac| uac & flag != 0)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Attribute formatting
// ---------------------------------------------------------------------------

fn friendly_header(attr: &str) -> String {
    match attr {
        "sAMAccountName" => "Username",
        "displayName" => "Display Name",
        "lastLogonTimestamp" | "lastLogon" => "Last Logon",
        "pwdLastSet" => "Password Set",
        "whenCreated" => "Created",
        "whenChanged" => "Last Modified",
        "userAccountControl" => "Account Flags",
        "memberOf" => "Group Memberships",
        "accountExpires" => "Account Expires",
        "distinguishedName" => "DN",
        other => other,
    }
    .to_string()
}

fn format_ad_attribute(attr_name: &str, value: &str) -> String {
    if value == "-" || value.is_empty() {
        return value.to_string();
    }
    match attr_name {
        "lastLogonTimestamp" | "pwdLastSet" | "accountExpires" | "lastLogon"
        | "badPasswordTime" | "lockoutTime" => {
            if let Ok(ticks) = value.parse::<i64>() {
                if ticks <= 0 || ticks == 9_223_372_036_854_775_807 {
                    return "Never".to_string();
                }
                let unix_secs = ticks / 10_000_000 - 11_644_473_600;
                if let Some(dt) = chrono::DateTime::from_timestamp(unix_secs, 0) {
                    return dt.format("%Y-%m-%d %H:%M").to_string();
                }
            }
            value.to_string()
        }
        "whenCreated" | "whenChanged" => {
            let clean = value.replace(".0Z", "").replace('Z', "");
            if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&clean, "%Y%m%d%H%M%S") {
                return naive.format("%Y-%m-%d %H:%M").to_string();
            }
            value.to_string()
        }
        "userAccountControl" => {
            if let Ok(uac) = value.parse::<u32>() {
                let mut flags = Vec::new();
                if uac & 0x0002 != 0 {
                    flags.push("Disabled");
                }
                if uac & 0x0010 != 0 {
                    flags.push("Locked");
                }
                if uac & 0x10000 != 0 {
                    flags.push("PwdNeverExpires");
                }
                if uac & 0x0020 != 0 {
                    flags.push("PwdNotRequired");
                }
                if uac & 0x0080 != 0 {
                    flags.push("ReversibleEncryption");
                }
                if uac & 0x200000 != 0 {
                    flags.push("TrustedForDelegation");
                }
                if flags.is_empty() {
                    "Normal".to_string()
                } else {
                    flags.join(", ")
                }
            } else {
                value.to_string()
            }
        }
        _ => value.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_checks_has_seven() {
        assert_eq!(builtin_checks().len(), 7);
    }

    #[test]
    fn all_checks_have_frameworks() {
        for c in builtin_checks() {
            assert!(!c.frameworks.is_empty(), "Check {} has no frameworks", c.id);
        }
    }

    #[test]
    fn all_checks_have_remediation() {
        for c in builtin_checks() {
            assert!(
                !c.remediation.is_empty(),
                "Check {} has no remediation",
                c.id
            );
        }
    }

    #[test]
    fn all_nine_frameworks_covered() {
        let checks = builtin_checks();
        for &fw in FRAMEWORKS {
            let covered = checks
                .iter()
                .any(|c| c.frameworks.iter().any(|f| f.standard == fw));
            assert!(covered, "Framework {} not covered by any check", fw);
        }
    }

    #[test]
    fn critical_checks_map_to_all_frameworks() {
        let checks = builtin_checks();
        let critical: Vec<&ComplianceCheck> =
            checks.iter().filter(|c| c.severity == "Critical").collect();
        assert!(critical.len() >= 2);
        for c in critical {
            assert!(
                c.frameworks.len() >= 7,
                "Critical check {} should map to most frameworks",
                c.id
            );
        }
    }

    #[test]
    fn compute_score_no_findings() {
        let results = vec![CheckResult {
            check_id: "test".into(),
            title: "Test".into(),
            description: "".into(),
            severity: "High".into(),
            finding_count: 0,
            headers: vec![],
            rows: vec![],
            frameworks: vec![fm("GDPR", "Art. 32")],
            remediation: "".into(),
        }];
        assert_eq!(compute_global_score(&results), 100);
    }

    #[test]
    fn compute_score_with_findings() {
        let results = vec![
            CheckResult {
                check_id: "a".into(),
                title: "".into(),
                description: "".into(),
                severity: "Critical".into(),
                finding_count: 2,
                headers: vec![],
                rows: vec![vec![], vec![]],
                frameworks: vec![fm("GDPR", "x")],
                remediation: "".into(),
            },
            CheckResult {
                check_id: "b".into(),
                title: "".into(),
                description: "".into(),
                severity: "High".into(),
                finding_count: 1,
                headers: vec![],
                rows: vec![vec![]],
                frameworks: vec![fm("GDPR", "y")],
                remediation: "".into(),
            },
        ];
        // 100 - 25 (critical) - 10 (high) = 65
        assert_eq!(compute_global_score(&results), 65);
    }

    #[test]
    fn framework_scores_computed() {
        let results = vec![CheckResult {
            check_id: "test".into(),
            title: "".into(),
            description: "".into(),
            severity: "High".into(),
            finding_count: 3,
            headers: vec![],
            rows: vec![vec![], vec![], vec![]],
            frameworks: vec![fm("GDPR", "Art. 32"), fm("HIPAA", "164.312")],
            remediation: "".into(),
        }];
        let scores = compute_framework_scores(&results);
        let gdpr = scores.iter().find(|s| s.standard == "GDPR").unwrap();
        assert_eq!(gdpr.score, 90); // 100 - 10
        assert_eq!(gdpr.total_checks, 1);
        assert_eq!(gdpr.checks_with_findings, 1);

        let sox = scores.iter().find(|s| s.standard == "SOX").unwrap();
        assert_eq!(sox.score, 100); // no relevant checks with findings
    }

    #[test]
    fn export_framework_report_html_valid() {
        let scan = ComplianceScanResult {
            scanned_at: "2026-03-24".into(),
            generator: "test".into(),
            total_accounts_scanned: 100,
            global_score: 65,
            total_findings: 5,
            framework_scores: compute_framework_scores(&[]),
            checks: vec![CheckResult {
                check_id: "priv".into(),
                title: "Privileged Accounts".into(),
                description: "Test desc".into(),
                severity: "High".into(),
                finding_count: 2,
                headers: vec!["Username".into()],
                rows: vec![vec!["admin".into()], vec!["svc_sql".into()]],
                frameworks: vec![fm("GDPR", "Art. 32(2)")],
                remediation: "Review accounts.".into(),
            }],
        };
        let html = export_framework_report(&scan, "GDPR");
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("GDPR Compliance Report"));
        assert!(html.contains("Art. 32(2)"));
        assert!(html.contains("admin"));
        assert!(html.contains("Review accounts."));
        assert!(html.contains("High"));
    }

    #[test]
    fn format_filetime_valid() {
        let ticks = (1_705_276_800i64 + 11_644_473_600) * 10_000_000;
        let result = format_ad_attribute("lastLogonTimestamp", &ticks.to_string());
        assert_eq!(result, "2024-01-15 00:00");
    }

    #[test]
    fn format_uac_flags() {
        assert_eq!(format_ad_attribute("userAccountControl", "514"), "Disabled");
        assert_eq!(format_ad_attribute("userAccountControl", "512"), "Normal");
        assert_eq!(
            format_ad_attribute("userAccountControl", "66048"),
            "PwdNeverExpires"
        );
    }

    #[test]
    fn html_escapes() {
        assert_eq!(he("<script>"), "&lt;script&gt;");
    }
}
