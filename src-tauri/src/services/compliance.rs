use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::DirectoryEntry;
use crate::services::directory::DirectoryProvider;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// A compliance report template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceTemplate {
    pub name: String,
    pub standard: String,
    pub version: String,
    pub description: String,
    /// Introductory paragraph explaining the purpose and scope of this report.
    #[serde(default)]
    pub introduction: Option<String>,
    pub sections: Vec<TemplateSection>,
    /// Whether this is a built-in (read-only) or custom template.
    #[serde(default)]
    pub builtin: bool,
}

/// A section within a compliance template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSection {
    pub title: String,
    pub control_reference: String,
    /// Brief explanation of what this section checks and why it matters.
    #[serde(default)]
    pub introduction: Option<String>,
    /// Severity if findings are present: Critical, High, Medium, Low.
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(rename = "type")]
    pub section_type: SectionType,
    /// Query scope (for query-type sections).
    pub query_scope: Option<String>,
    /// Attributes to fetch (for query-type sections).
    pub query_attributes: Option<Vec<String>>,
    /// Static content (for static-type sections).
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SectionType {
    Query,
    Static,
}

/// A generated compliance report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceReport {
    pub template_name: String,
    pub standard: String,
    pub version: String,
    pub generated_at: String,
    pub generator: String,
    pub introduction: Option<String>,
    /// Overall compliance score (0-100). Higher = more compliant.
    pub compliance_score: u32,
    /// Total accounts scanned.
    pub total_accounts_scanned: usize,
    /// Total findings across all sections.
    pub total_findings: usize,
    pub sections: Vec<ReportSection>,
}

/// A section of a generated report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    pub title: String,
    pub control_reference: String,
    /// Brief explanation of what this section checks.
    pub introduction: Option<String>,
    /// Severity of findings in this section.
    pub severity: Option<String>,
    pub section_type: SectionType,
    /// Table data: headers + rows (for query sections).
    pub headers: Option<Vec<String>>,
    pub rows: Option<Vec<Vec<String>>>,
    /// Static text content.
    pub content: Option<String>,
    /// Number of findings.
    pub finding_count: Option<usize>,
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

pub fn builtin_templates() -> Vec<ComplianceTemplate> {
    vec![
        gdpr_template(),
        hipaa_template(),
        sox_template(),
        pci_dss_template(),
        iso27001_template(),
        nist_800_53_template(),
        cis_controls_template(),
        nis2_template(),
        anssi_template(),
    ]
}

/// Helper to build a query section.
fn query_section(
    title: &str,
    control_ref: &str,
    intro: &str,
    severity: &str,
    scope: &str,
    attrs: &[&str],
) -> TemplateSection {
    TemplateSection {
        title: title.to_string(),
        control_reference: control_ref.to_string(),
        introduction: Some(intro.to_string()),
        severity: Some(severity.to_string()),
        section_type: SectionType::Query,
        query_scope: Some(scope.to_string()),
        query_attributes: Some(attrs.iter().map(|s| s.to_string()).collect()),
        content: None,
    }
}

/// Helper to build a static recommendations section.
fn static_section(title: &str, control_ref: &str, content: &str) -> TemplateSection {
    TemplateSection {
        title: title.to_string(),
        control_reference: control_ref.to_string(),
        introduction: None,
        severity: None,
        section_type: SectionType::Static,
        query_scope: None,
        query_attributes: None,
        content: Some(content.to_string()),
    }
}

fn gdpr_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "GDPR Access Review".to_string(),
        standard: "GDPR".to_string(),
        version: "2.0".to_string(),
        description: "Review of AD access controls and data minimization for GDPR compliance".to_string(),
        introduction: Some(
            "This report assesses Active Directory access controls against the General Data Protection \
             Regulation (GDPR). It examines privileged account usage under Art. 32 (security of processing), \
             identifies inactive accounts violating Art. 5(1)(e) (storage limitation), detects accounts with \
             weak authentication configurations, and provides actionable remediation steps to strengthen \
             data protection by design (Art. 25) and by default."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Access Summary",
                "GDPR Art. 32(2) - Security of processing",
                "Lists all accounts with administrative privileges (adminCount=1). Under Art. 32, \
                 the controller must implement appropriate technical measures to ensure a level of \
                 security appropriate to the risk. Excessive privileged accounts increase the risk \
                 of unauthorized access to personal data.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Inactive Accounts",
                "GDPR Art. 5(1)(e) - Storage limitation",
                "Identifies accounts that have not logged in for more than 90 days. Art. 5(1)(e) \
                 requires that personal data is kept only as long as necessary. Inactive accounts \
                 represent dormant access paths that could be exploited in a breach.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Accounts Without Password Requirement",
                "GDPR Art. 32(1)(b) - Ongoing confidentiality",
                "Detects accounts where the PASSWD_NOTREQD flag is set, allowing empty passwords. \
                 Art. 32(1)(b) requires the ability to ensure the ongoing confidentiality of processing \
                 systems. Accounts without password requirements are a critical security gap.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Accounts With Reversible Encryption",
                "GDPR Art. 32(1)(a) - Encryption",
                "Detects accounts storing passwords with reversible encryption. Art. 32(1)(a) explicitly \
                 lists encryption as a security measure. Reversible encryption allows passwords to be \
                 recovered in clear text, defeating the purpose of hashing.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Stale Passwords",
                "GDPR Art. 5(1)(f) - Integrity and confidentiality",
                "Identifies accounts whose passwords have not been changed in over 90 days. \
                 Art. 5(1)(f) requires integrity and confidentiality of personal data. Stale passwords \
                 increase the window for credential compromise.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            static_section(
                "Remediation Steps",
                "GDPR Art. 32 - Security of processing",
                "[Critical] Remove PASSWD_NOTREQD flag and set passwords:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical] Remove reversible encryption:\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Disable inactive accounts older than 90 days:\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [High] Enforce password expiration:\n\
                 Get-ADUser -Filter {PasswordNeverExpires -eq $true} | Set-ADUser -PasswordNeverExpires $false\n\n\
                 [Medium] Review privileged accounts quarterly and document business justification for each.",
            ),
        ],
    }
}

fn hipaa_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "HIPAA Access Controls".to_string(),
        standard: "HIPAA".to_string(),
        version: "2.0".to_string(),
        description: "Audit of AD access controls for HIPAA Security Rule compliance".to_string(),
        introduction: Some(
            "This report evaluates Active Directory configuration against the HIPAA Security Rule \
             (45 CFR Part 164). It reviews administrative access to systems containing ePHI \
             (164.312(a)), assesses authentication controls (164.312(d)), identifies accounts with \
             weak password configurations, and detects reversible encryption that violates \
             encryption requirements."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Administrative Access Audit",
                "HIPAA 164.312(a)(1) - Access control",
                "Lists all accounts with administrative privileges. 164.312(a)(1) requires covered \
                 entities to implement technical policies that allow only authorized persons to access \
                 ePHI. Each privileged account represents a potential access path to sensitive health data.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Password Policy Assessment",
                "HIPAA 164.312(d) - Person or entity authentication",
                "Identifies accounts with the 'Password Never Expires' flag. 164.312(d) requires \
                 procedures to verify identity before granting access to ePHI. Non-expiring passwords \
                 weaken authentication controls and increase the credential compromise window.",
                "High",
                "passwordNeverExpires",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Accounts Without Password Requirement",
                "HIPAA 164.312(d) - Authentication",
                "Detects accounts where PASSWD_NOTREQD is set, allowing empty passwords. This is \
                 a direct violation of 164.312(d) authentication requirements and a critical finding \
                 in any HIPAA audit.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Encryption",
                "HIPAA 164.312(a)(2)(iv) - Encryption and decryption",
                "Detects accounts storing passwords with reversible encryption. 164.312(a)(2)(iv) \
                 is an addressable specification requiring encryption of ePHI. Reversible password \
                 encryption undermines this control.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Inactive Accounts",
                "HIPAA 164.308(a)(3)(ii)(C) - Termination procedures",
                "Identifies accounts inactive for more than 90 days. 164.308(a)(3)(ii)(C) requires \
                 procedures for terminating access when no longer needed. Inactive accounts may indicate \
                 incomplete offboarding.",
                "Medium",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            static_section(
                "Remediation Steps",
                "HIPAA 164.306(a) - Security standards: general rules",
                "[Critical] Remove PASSWD_NOTREQD flag:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical] Remove reversible encryption:\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Enforce password rotation for all accounts accessing ePHI:\n\
                 Get-ADUser -Filter {PasswordNeverExpires -eq $true} | Set-ADUser -PasswordNeverExpires $false\n\n\
                 [Medium] Disable inactive accounts:\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [Medium] Review administrative access monthly and document business justification.\n\
                 Note: addressable specifications (e.g., encryption) require documented rationale if an alternative is implemented.",
            ),
        ],
    }
}

fn sox_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "SOX IT General Controls".to_string(),
        standard: "SOX".to_string(),
        version: "2.0".to_string(),
        description: "Audit of AD access controls under SOX ITGC - Access to Programs and Data".to_string(),
        introduction: Some(
            "This report evaluates Active Directory controls under the Sarbanes-Oxley Act (SOX) \
             IT General Controls (ITGC) framework, specifically the Access to Programs and Data (APD) \
             domain. It inventories privileged accounts that could impact financial reporting systems, \
             reviews account lifecycle management, detects weak authentication configurations, and \
             identifies potential separation of duties concerns."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Account Inventory",
                "SOX ITGC - APD: Provisioning",
                "Inventories all accounts with administrative privileges, including creation date and \
                 last activity. Under SOX Section 404 ITGC requirements, management must assess the \
                 effectiveness of access controls. Undocumented or stale privileged accounts represent \
                 a control deficiency that external auditors will flag.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "whenCreated", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Disabled Account Review",
                "SOX ITGC - APD: Deprovisioning",
                "Lists all currently disabled accounts and when they were last modified. Effective \
                 deprovisioning controls are a core ITGC requirement. Disabled accounts that linger \
                 indefinitely indicate weak offboarding processes - a significant deficiency if access \
                 to financial systems is involved.",
                "Medium",
                "disabledAccounts",
                &["sAMAccountName", "displayName", "whenChanged"],
            ),
            query_section(
                "Accounts Without Password Requirement",
                "SOX ITGC - APD: Authentication",
                "Detects accounts where PASSWD_NOTREQD is set. Accounts that can have empty passwords \
                 represent a material weakness in authentication controls. This finding would likely \
                 escalate to a significant deficiency or material weakness if the account has access \
                 to financially significant systems.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Stale Passwords",
                "SOX ITGC - APD: Periodic review",
                "Identifies accounts with passwords unchanged for over 90 days. Periodic password \
                 rotation is a standard ITGC control. Stale passwords on privileged accounts \
                 represent a control deficiency.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            static_section(
                "Remediation Steps",
                "SOX ITGC - Access to Programs and Data",
                "[Critical] Clear PASSWD_NOTREQD flag on all accounts:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [High] Perform quarterly access reviews for all privileged accounts and document approvals.\n\n\
                 [High] Implement a formal access request/approval workflow with documented evidence.\n\n\
                 [Medium] Delete or archive disabled accounts older than 90 days after audit retention period.\n\n\
                 [Medium] Enforce password rotation policy (90-day maximum age).\n\n\
                 [Medium] Implement separation of duties: ensure no single account can both provision and approve access.",
            ),
        ],
    }
}

fn pci_dss_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "PCI-DSS v4.0 Auth & Access Audit".to_string(),
        standard: "PCI-DSS".to_string(),
        version: "2.0".to_string(),
        description: "Audit of authentication and access controls for PCI-DSS v4.0 compliance".to_string(),
        introduction: Some(
            "This report assesses Active Directory configuration against PCI-DSS v4.0 (effective \
             March 2024). It evaluates access controls for cardholder data environments (Req. 7), \
             reviews authentication settings (Req. 8), identifies inactive accounts that must be \
             removed per Req. 8.2.6, detects critical authentication weaknesses, and provides \
             specific remediation commands."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Access Review",
                "PCI-DSS v4.0 Req. 7.2.1 - Access control model",
                "Lists all accounts with administrative privileges. Req. 7.2.1 requires an access \
                 control model that restricts access based on job classification and function. Each \
                 privileged account should have documented business justification.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Password Expiration Controls",
                "PCI-DSS v4.0 Req. 8.3.9 - Password change frequency",
                "Identifies accounts with the 'Password Never Expires' flag. Req. 8.3.9 requires \
                 passwords to be changed at least every 90 days (or dynamic analysis via Req. 8.3.10.1). \
                 Non-expiring passwords directly violate this requirement.",
                "High",
                "passwordNeverExpires",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Inactive Account Audit",
                "PCI-DSS v4.0 Req. 8.2.6 - Inactive accounts",
                "Identifies accounts inactive for more than 90 days. Req. 8.2.6 explicitly requires \
                 that inactive accounts be removed or disabled within 90 days. This is one of the \
                 most commonly cited findings in PCI assessments.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Accounts Without Password Requirement",
                "PCI-DSS v4.0 Req. 8.3.1 - Authentication factors",
                "Detects accounts where PASSWD_NOTREQD is set. Req. 8.3.1 requires strong \
                 authentication for all access to system components. An account with no password \
                 requirement would result in an automatic FAIL on this requirement.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Encryption",
                "PCI-DSS v4.0 Req. 8.3.2 - Strong cryptography",
                "Detects accounts storing passwords with reversible encryption. Req. 8.3.2 requires \
                 strong cryptography to render authentication factors unreadable. Reversible encryption \
                 allows password recovery in clear text.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Stale Passwords",
                "PCI-DSS v4.0 Req. 8.3.9 - Password rotation",
                "Identifies accounts with passwords unchanged for over 90 days. Req. 8.3.9 mandates \
                 password changes at minimum every 90 days unless dynamic analysis is implemented \
                 per Req. 8.3.10.1.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            static_section(
                "Remediation Steps",
                "PCI-DSS v4.0 Req. 8 - Identification and authentication",
                "[Critical - FAIL if not fixed] Remove PASSWD_NOTREQD flag:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical - FAIL if not fixed] Remove reversible encryption:\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High - Req. 8.2.6] Disable inactive accounts within 90 days:\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [High - Req. 8.3.9] Enforce password expiration:\n\
                 Get-ADUser -Filter {PasswordNeverExpires -eq $true} | Set-ADUser -PasswordNeverExpires $false\n\n\
                 [High - Req. 7.2.1] Review all privileged accounts quarterly; document business justification.\n\n\
                 [Medium - Req. 8.3.9] Force password change for accounts with passwords older than 90 days.",
            ),
        ],
    }
}

fn iso27001_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "ISO 27001 Access Control Audit".to_string(),
        standard: "ISO 27001".to_string(),
        version: "1.0".to_string(),
        description: "Audit of AD access controls against ISO/IEC 27001:2022 Annex A controls".to_string(),
        introduction: Some(
            "This report evaluates Active Directory configuration against ISO/IEC 27001:2022 \
             information security controls. It covers access control (A.8), identity management \
             (A.5.16), authentication (A.8.5), and access rights review (A.5.18). These controls \
             are foundational for any ISMS certification audit."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Access Inventory",
                "ISO 27001 A.8.2 - Privileged access rights",
                "Lists all accounts with administrative privileges. A.8.2 requires that privileged \
                 access rights are restricted and managed. Each privileged account must be justified, \
                 approved, and periodically reviewed.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet", "whenCreated"],
            ),
            query_section(
                "Inactive User Accounts",
                "ISO 27001 A.5.18 - Access rights review",
                "Identifies accounts inactive for more than 90 days. A.5.18 requires periodic review \
                 of access rights. Inactive accounts indicate that access rights have not been revoked \
                 when no longer needed, a common finding in ISO 27001 audits.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Weak Authentication - No Password Required",
                "ISO 27001 A.8.5 - Secure authentication",
                "Detects accounts with PASSWD_NOTREQD flag. A.8.5 requires secure authentication \
                 mechanisms. Accounts that can operate without a password represent a fundamental \
                 authentication control failure.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Password Encryption",
                "ISO 27001 A.8.24 - Use of cryptography",
                "Detects accounts with reversible password encryption. A.8.24 requires appropriate \
                 use of cryptography. Storing passwords in a reversible format violates this control.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Password Rotation Compliance",
                "ISO 27001 A.5.17 - Authentication information",
                "Identifies accounts with passwords older than 90 days. A.5.17 requires management \
                 of authentication information including periodic changes. Stale passwords increase \
                 the risk of credential compromise.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            query_section(
                "Disabled Accounts Lifecycle",
                "ISO 27001 A.5.18 - Access rights review",
                "Lists disabled accounts to verify proper lifecycle management. A.5.18 requires that \
                 access rights are removed or adjusted on change of role or termination. Lingering \
                 disabled accounts suggest incomplete deprovisioning.",
                "Low",
                "disabledAccounts",
                &["sAMAccountName", "displayName", "whenChanged"],
            ),
            static_section(
                "Remediation Steps",
                "ISO 27001 A.8 - Technological controls",
                "[Critical] Clear PASSWD_NOTREQD and reversible encryption flags:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Implement quarterly access rights review (A.5.18) with documented sign-off.\n\n\
                 [High] Disable inactive accounts within 90 days:\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [Medium] Enforce 90-day password rotation policy.\n\n\
                 [Low] Archive and delete disabled accounts older than retention period.",
            ),
        ],
    }
}

fn nist_800_53_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "NIST 800-53 Access Control Assessment".to_string(),
        standard: "NIST 800-53".to_string(),
        version: "1.0".to_string(),
        description: "Assessment of AD controls against NIST SP 800-53 Rev. 5 AC and IA families".to_string(),
        introduction: Some(
            "This report assesses Active Directory controls against NIST SP 800-53 Revision 5, \
             focusing on the Access Control (AC) and Identification and Authentication (IA) control \
             families. These controls are mandatory for U.S. federal information systems and widely \
             adopted as best practice by private sector organizations."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Account Management",
                "NIST AC-6 - Least privilege",
                "Lists all accounts with administrative privileges. AC-6 requires the principle of \
                 least privilege: authorize only the minimum access necessary. Each privileged account \
                 should be individually authorized and documented.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet", "whenCreated"],
            ),
            query_section(
                "Inactive Account Detection",
                "NIST AC-2(3) - Account management: disable accounts",
                "Identifies accounts inactive for more than 90 days. AC-2(3) requires automatic \
                 disabling of inactive accounts after a defined period. FedRAMP typically sets this \
                 at 90 days for unprivileged and 35 days for privileged accounts.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Password-Not-Required Accounts",
                "NIST IA-5 - Authenticator management",
                "Detects accounts with the PASSWD_NOTREQD flag. IA-5 requires that authenticators \
                 have sufficient strength. An account that does not require a password has no \
                 authenticator strength at all.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Encryption Detection",
                "NIST IA-5(1)(h) - Password-based authentication",
                "Detects accounts with reversible password encryption. IA-5(1)(h) requires passwords \
                 to be stored using approved one-way hashing. Reversible encryption violates this \
                 requirement and allows password recovery.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Password Age Compliance",
                "NIST IA-5(1)(d) - Minimum/maximum lifetime restrictions",
                "Identifies accounts with passwords older than 90 days. While NIST SP 800-63B \
                 recommends against mandatory rotation for user passwords, IA-5(1)(d) still requires \
                 maximum lifetime restrictions as determined by the organization's policy.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            query_section(
                "Password Never Expires",
                "NIST AC-2(1) - Automated account management",
                "Identifies accounts with non-expiring passwords. AC-2(1) requires automated \
                 mechanisms to support account management. Non-expiring passwords bypass automated \
                 rotation controls.",
                "Medium",
                "passwordNeverExpires",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            static_section(
                "Remediation Steps",
                "NIST AC-2 / IA-5 - Account management and authentication",
                "[Critical] Remove PASSWD_NOTREQD flag:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical] Remove reversible encryption:\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Disable inactive accounts (AC-2(3)):\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [High] Document justification for every privileged account (AC-6).\n\n\
                 [Medium] Review and enforce password policy per organizational NIST implementation.\n\n\
                 [Medium] Implement automated account management per AC-2(1).",
            ),
        ],
    }
}

fn cis_controls_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "CIS Controls v8 Assessment".to_string(),
        standard: "CIS v8".to_string(),
        version: "1.0".to_string(),
        description: "Assessment of AD security against CIS Critical Security Controls v8".to_string(),
        introduction: Some(
            "This report evaluates Active Directory configuration against the CIS Critical Security \
             Controls Version 8. It focuses on Control 5 (Account Management), Control 6 (Access \
             Control Management), and related safeguards. CIS Controls are prioritized, actionable \
             security best practices adopted worldwide."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Administrative Account Inventory",
                "CIS v8 5.1 - Establish and maintain an inventory of accounts",
                "Lists all privileged accounts. Safeguard 5.1 requires maintaining an inventory of \
                 all accounts, with special attention to administrative and service accounts. This \
                 inventory must be reviewed at minimum quarterly.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Inactive Account Removal",
                "CIS v8 5.3 - Disable dormant accounts",
                "Identifies accounts inactive for more than 90 days. Safeguard 5.3 explicitly \
                 requires disabling dormant accounts after 45 days of inactivity (IG1). This is \
                 one of the most impactful CIS safeguards for reducing attack surface.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Disabled Accounts Review",
                "CIS v8 5.3 - Disable dormant accounts",
                "Lists currently disabled accounts for lifecycle review. Disabled accounts should \
                 be deleted after a retention period to prevent reactivation attacks.",
                "Low",
                "disabledAccounts",
                &["sAMAccountName", "displayName", "whenChanged"],
            ),
            query_section(
                "Weak Authentication - No Password Required",
                "CIS v8 5.2 - Use unique passwords",
                "Detects accounts with PASSWD_NOTREQD flag. Safeguard 5.2 requires unique passwords \
                 for all accounts. An account that allows no password is a critical violation.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Encryption",
                "CIS v8 3.11 - Encrypt sensitive data at rest",
                "Detects accounts with reversible password encryption. Safeguard 3.11 requires \
                 encryption of sensitive data. Reversible password encryption effectively stores \
                 credentials in recoverable form.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Password Freshness",
                "CIS v8 5.2 - Use unique passwords",
                "Identifies accounts with passwords older than 90 days. While CIS aligns with \
                 NIST guidance on not forcing arbitrary rotation, stale passwords on privileged \
                 accounts remain a significant risk indicator.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            static_section(
                "Remediation Steps",
                "CIS v8 5 / 6 - Account and Access Control Management",
                "[Critical] Clear PASSWD_NOTREQD flag (CIS 5.2):\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical] Clear reversible encryption (CIS 3.11):\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Disable dormant accounts within 45 days (CIS 5.3 IG1):\n\
                 Search-ADAccount -AccountInactive -TimeSpan 45 | Disable-ADAccount\n\n\
                 [High] Maintain quarterly privileged account inventory review (CIS 5.1).\n\n\
                 [Medium] Implement centralized authentication (CIS 6.7) for all admin access.\n\n\
                 [Medium] Restrict admin privileges to dedicated admin accounts (CIS 5.4).",
            ),
        ],
    }
}

fn nis2_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "NIS2 Directive - Access Security".to_string(),
        standard: "NIS2".to_string(),
        version: "1.0".to_string(),
        description: "Assessment of AD controls under EU NIS2 Directive (2022/2555) requirements".to_string(),
        introduction: Some(
            "This report evaluates Active Directory security against the EU Network and Information \
             Security Directive 2 (NIS2 - Directive 2022/2555). NIS2 requires essential and important \
             entities to implement appropriate cybersecurity risk management measures, including \
             access control policies, authentication security, and account hygiene. Enforcement \
             began October 2024 with significant penalties for non-compliance."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Privileged Access Management",
                "NIS2 Art. 21(2)(i) - Access control policies",
                "Lists all accounts with administrative privileges. Art. 21(2)(i) requires \
                 access control policies and asset management. Privileged accounts must be \
                 inventoried, justified, and subject to enhanced monitoring.",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet"],
            ),
            query_section(
                "Inactive Account Hygiene",
                "NIS2 Art. 21(2)(i) - Access control",
                "Identifies accounts inactive for more than 90 days. Under NIS2, entities must \
                 maintain effective access control. Dormant accounts represent unmanaged access \
                 paths that increase attack surface.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Accounts Without Password Requirement",
                "NIS2 Art. 21(2)(j) - Multi-factor authentication",
                "Detects accounts with PASSWD_NOTREQD flag. Art. 21(2)(j) requires use of \
                 multi-factor authentication or continuous authentication solutions. An account \
                 requiring no password is a fundamental violation of authentication security.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Reversible Password Encryption",
                "NIS2 Art. 21(2)(h) - Cryptography and encryption",
                "Detects accounts with reversible password encryption. Art. 21(2)(h) requires \
                 policies on the use of cryptography and encryption. Reversible password storage \
                 defeats the purpose of cryptographic protection.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Password Age Assessment",
                "NIS2 Art. 21(2)(g) - Basic cyber hygiene practices",
                "Identifies accounts with passwords older than 90 days. Art. 21(2)(g) explicitly \
                 requires basic cyber hygiene practices including password management. Stale \
                 passwords on critical systems increase breach risk.",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            static_section(
                "Remediation Steps",
                "NIS2 Art. 21 - Cybersecurity risk-management measures",
                "[Critical] Remove PASSWD_NOTREQD flag:\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critical] Remove reversible encryption:\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [High] Disable inactive accounts within 90 days.\n\n\
                 [High] Implement MFA for all administrative access (Art. 21(2)(j)).\n\n\
                 [Medium] Enforce password rotation policy aligned with ENISA guidelines.\n\n\
                 [Medium] Document and maintain an incident response plan covering identity compromise (Art. 21(2)(b)).\n\n\
                 Note: NIS2 penalties can reach 10M EUR or 2% of global annual turnover for essential entities.",
            ),
        ],
    }
}

fn anssi_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "ANSSI - Hygiene informatique AD".to_string(),
        standard: "ANSSI".to_string(),
        version: "1.0".to_string(),
        description: "Audit de l'Active Directory selon le guide d'hygiene ANSSI et les recommandations AD".to_string(),
        introduction: Some(
            "Ce rapport evalue la configuration Active Directory selon les recommandations de l'ANSSI \
             (Agence Nationale de la Securite des Systemes d'Information), notamment le guide \
             d'hygiene informatique (42 mesures) et le guide de securisation de l'Active Directory. \
             Ces referentiels sont la base des audits de securite en France et sont alignes avec \
             les exigences NIS2 pour les entites essentielles et importantes."
                .to_string(),
        ),
        builtin: true,
        sections: vec![
            query_section(
                "Inventaire des comptes a privileges",
                "ANSSI R.27 - Limiter les droits d'administration",
                "Liste tous les comptes avec privileges administratifs. La mesure R.27 du guide \
                 d'hygiene recommande de limiter strictement les droits d'administration et de \
                 maintenir un inventaire a jour. Le guide AD ANSSI recommande des comptes admin \
                 dedies (tiering model).",
                "High",
                "privilegedAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp", "pwdLastSet", "whenCreated"],
            ),
            query_section(
                "Comptes inactifs",
                "ANSSI R.30 - Desactiver les comptes inutilises",
                "Identifie les comptes inactifs depuis plus de 90 jours. La mesure R.30 recommande \
                 de desactiver les comptes utilisateurs inutilises et de supprimer les comptes \
                 obsoletes. Les comptes dormants sont un vecteur d'attaque privilegie.",
                "High",
                "inactiveAccounts",
                &["sAMAccountName", "displayName", "lastLogonTimestamp"],
            ),
            query_section(
                "Comptes sans mot de passe requis",
                "ANSSI R.22 - Mettre en oeuvre une politique de mot de passe",
                "Detecte les comptes avec le flag PASSWD_NOTREQD. La mesure R.22 impose une \
                 politique de mots de passe robuste. Un compte pouvant fonctionner sans mot de \
                 passe est une faille critique.",
                "Critical",
                "passwordNotRequired",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Chiffrement reversible des mots de passe",
                "ANSSI R.22 - Politique de mot de passe",
                "Detecte les comptes stockant les mots de passe en chiffrement reversible. Le \
                 guide ANSSI recommande le stockage des mots de passe sous forme de hash \
                 irreversible uniquement. Le chiffrement reversible permet la recuperation \
                 en clair.",
                "Critical",
                "reversibleEncryption",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Age des mots de passe",
                "ANSSI R.22 - Politique de mot de passe",
                "Identifie les comptes dont le mot de passe n'a pas ete change depuis plus de \
                 90 jours. L'ANSSI recommande un renouvellement periodique des mots de passe, \
                 en particulier pour les comptes a privileges (tous les 6 mois maximum).",
                "Medium",
                "passwordExpired",
                &["sAMAccountName", "displayName", "pwdLastSet"],
            ),
            query_section(
                "Comptes avec mot de passe permanent",
                "ANSSI R.22 - Politique de mot de passe",
                "Identifie les comptes avec le flag 'Password Never Expires'. A l'exception \
                 des comptes de service documentes, aucun compte ne devrait avoir de mot de \
                 passe permanent.",
                "Medium",
                "passwordNeverExpires",
                &["sAMAccountName", "displayName", "userAccountControl"],
            ),
            query_section(
                "Comptes desactives",
                "ANSSI R.30 - Desactiver les comptes inutilises",
                "Liste les comptes desactives pour verification du cycle de vie. Les comptes \
                 desactives depuis longtemps doivent etre supprimes apres la periode de \
                 retention definie par la politique interne.",
                "Low",
                "disabledAccounts",
                &["sAMAccountName", "displayName", "whenChanged"],
            ),
            static_section(
                "Actions de remediation",
                "ANSSI - Guide d'hygiene informatique",
                "[Critique] Supprimer le flag PASSWD_NOTREQD :\n\
                 Get-ADUser -Filter {PasswordNotRequired -eq $true} | Set-ADUser -PasswordNotRequired $false\n\n\
                 [Critique] Supprimer le chiffrement reversible :\n\
                 Get-ADUser -Filter {AllowReversiblePasswordEncryption -eq $true} | Set-ADUser -AllowReversiblePasswordEncryption $false\n\n\
                 [Eleve] Desactiver les comptes inactifs > 90 jours (R.30) :\n\
                 Search-ADAccount -AccountInactive -TimeSpan 90 | Disable-ADAccount\n\n\
                 [Eleve] Mettre en place le tiering model pour les comptes admin (guide AD ANSSI).\n\n\
                 [Eleve] Deployer l'authentification multifacteur pour tous les acces administratifs.\n\n\
                 [Moyen] Appliquer la politique de rotation des mots de passe (R.22).\n\n\
                 [Moyen] Supprimer les comptes desactives apres la periode de retention.\n\n\
                 Reference : https://cyber.gouv.fr/publications/guide-dhygiene-informatique",
            ),
        ],
    }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/// Generates a compliance report from a template by executing its data queries.
pub async fn generate_report(
    provider: Arc<dyn DirectoryProvider>,
    template: &ComplianceTemplate,
) -> Result<ComplianceReport, AppError> {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let generator = provider
        .authenticated_user()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "DSPanel".to_string()));

    let mut sections = Vec::new();
    let mut total_accounts = 0usize;

    for section in &template.sections {
        let report_section = match section.section_type {
            SectionType::Query => {
                let scope = section.query_scope.as_deref().unwrap_or("");
                let attrs = section.query_attributes.as_deref().unwrap_or(&[]);

                let entries = execute_query(provider.clone(), scope).await?;
                let headers: Vec<String> = attrs.iter().map(|a| friendly_header(a)).collect();
                let rows: Vec<Vec<String>> = entries
                    .iter()
                    .map(|e| {
                        attrs
                            .iter()
                            .map(|attr| {
                                let raw = e.get_attribute(attr).unwrap_or("-");
                                format_ad_attribute(attr, raw)
                            })
                            .collect()
                    })
                    .collect();

                let count = rows.len();
                total_accounts = total_accounts.max(entries.len());
                ReportSection {
                    title: section.title.clone(),
                    control_reference: section.control_reference.clone(),
                    introduction: section.introduction.clone(),
                    severity: if count > 0 { section.severity.clone() } else { None },
                    section_type: SectionType::Query,
                    headers: Some(headers),
                    rows: Some(rows),
                    content: None,
                    finding_count: Some(count),
                }
            }
            SectionType::Static => ReportSection {
                title: section.title.clone(),
                control_reference: section.control_reference.clone(),
                introduction: section.introduction.clone(),
                severity: None,
                section_type: SectionType::Static,
                headers: None,
                rows: None,
                content: section.content.clone(),
                finding_count: None,
            },
        };
        sections.push(report_section);
    }

    // Compute compliance score: 100 - (critical*25 + high*10 + medium*5), clamped to 0
    let mut critical_count = 0usize;
    let mut high_count = 0usize;
    let mut medium_count = 0usize;
    let mut total_findings = 0usize;
    for s in &sections {
        if let Some(count) = s.finding_count {
            if count > 0 {
                total_findings += count;
                match s.severity.as_deref() {
                    Some("Critical") => critical_count += 1,
                    Some("High") => high_count += 1,
                    Some("Medium") => medium_count += 1,
                    _ => {}
                }
            }
        }
    }
    let penalty = critical_count * 25 + high_count * 10 + medium_count * 5;
    let compliance_score = 100u32.saturating_sub(penalty as u32);

    Ok(ComplianceReport {
        template_name: template.name.clone(),
        standard: template.standard.clone(),
        version: template.version.clone(),
        generated_at: timestamp,
        generator,
        introduction: template.introduction.clone(),
        compliance_score,
        total_accounts_scanned: total_accounts,
        total_findings,
        sections,
    })
}

/// Executes a data query scope against the directory.
async fn execute_query(
    provider: Arc<dyn DirectoryProvider>,
    scope: &str,
) -> Result<Vec<DirectoryEntry>, AppError> {
    match scope {
        "privilegedAccounts" => {
            // Search for members of common admin groups
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            // Filter to accounts that are in privileged groups (have adminCount=1)
            Ok(entries
                .into_iter()
                .filter(|e| e.get_attribute("adminCount") == Some("1"))
                .collect())
        }
        "inactiveAccounts" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            let now = chrono::Utc::now();
            let threshold = 90 * 86400i64; // 90 days

            Ok(entries
                .into_iter()
                .filter(|e| {
                    if let Some(ts_str) = e.get_attribute("lastLogonTimestamp") {
                        if let Ok(ticks) = ts_str.parse::<i64>() {
                            if ticks > 0 {
                                let unix_secs = ticks / 10_000_000 - 11_644_473_600;
                                if let Some(logon) = chrono::DateTime::from_timestamp(unix_secs, 0)
                                {
                                    return (now - logon).num_seconds() > threshold;
                                }
                            }
                        }
                    }
                    false
                })
                .collect())
        }
        "disabledAccounts" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            Ok(entries
                .into_iter()
                .filter(|e| {
                    e.get_attribute("userAccountControl")
                        .and_then(|s| s.parse::<u32>().ok())
                        .map(|uac| uac & 0x0002 != 0)
                        .unwrap_or(false)
                })
                .collect())
        }
        "passwordNeverExpires" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            Ok(entries
                .into_iter()
                .filter(|e| {
                    e.get_attribute("userAccountControl")
                        .and_then(|s| s.parse::<u32>().ok())
                        .map(|uac| uac & 0x10000 != 0)
                        .unwrap_or(false)
                })
                .collect())
        }
        "passwordNotRequired" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            Ok(entries
                .into_iter()
                .filter(|e| {
                    e.get_attribute("userAccountControl")
                        .and_then(|s| s.parse::<u32>().ok())
                        .map(|uac| uac & 0x0020 != 0) // PASSWD_NOTREQD
                        .unwrap_or(false)
                })
                .collect())
        }
        "reversibleEncryption" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            Ok(entries
                .into_iter()
                .filter(|e| {
                    e.get_attribute("userAccountControl")
                        .and_then(|s| s.parse::<u32>().ok())
                        .map(|uac| uac & 0x0080 != 0) // ENCRYPTED_TEXT_PWD_ALLOWED
                        .unwrap_or(false)
                })
                .collect())
        }
        "passwordExpired" => {
            let entries = provider
                .browse_users(5000)
                .await
                .map_err(|e| AppError::Internal(format!("Query failed: {e}")))?;

            let now = chrono::Utc::now();
            let threshold = 90 * 86400i64;

            Ok(entries
                .into_iter()
                .filter(|e| {
                    if let Some(ts_str) = e.get_attribute("pwdLastSet") {
                        if let Ok(ticks) = ts_str.parse::<i64>() {
                            if ticks > 0 {
                                let unix_secs = ticks / 10_000_000 - 11_644_473_600;
                                if let Some(set_date) =
                                    chrono::DateTime::from_timestamp(unix_secs, 0)
                                {
                                    return (now - set_date).num_seconds() > threshold;
                                }
                            }
                        }
                    }
                    false
                })
                .collect())
        }
        _ => Ok(Vec::new()),
    }
}

/// Generates an HTML compliance report from a ComplianceReport.
pub fn report_to_html(report: &ComplianceReport) -> String {
    let mut html = String::with_capacity(8192);

    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n");
    html.push_str(&format!("<title>{} - {} Compliance Report</title>\n", html_escape(&report.standard), html_escape(&report.template_name)));
    html.push_str("<style>\n");
    html.push_str(
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;\
         margin:0;color:#1a1a2e;background:#fff}\
         .cover{background:#1a1a2e;color:#fff;padding:3rem;text-align:center;margin-bottom:2rem}\
         .cover h1{font-size:2rem;margin:0 0 0.5rem}\
         .cover .standard{font-size:1.2rem;opacity:0.8}\
         .cover .meta{font-size:0.85rem;opacity:0.6;margin-top:1rem}\
         .content{max-width:900px;margin:0 auto;padding:0 2rem 2rem}\
         .section{margin-bottom:2rem;page-break-inside:avoid}\
         .section h2{font-size:1.1rem;margin-bottom:0.25rem;color:#1a1a2e}\
         .control-ref{display:inline-block;background:#e8eaf6;color:#3949ab;padding:2px 8px;\
         border-radius:4px;font-size:0.75rem;font-weight:600;margin-bottom:0.75rem}\
         table{border-collapse:collapse;width:100%;font-size:0.8rem;margin-top:0.5rem}\
         th{background:#1a1a2e;color:#fff;text-align:left;padding:6px 10px;font-weight:600}\
         td{padding:5px 10px;border-bottom:1px solid #e0e0e0}\
         tr:nth-child(even){background:#f8f9fa}\
         .finding-count{font-size:0.8rem;color:#666;margin-bottom:0.5rem}\
         .static-content{white-space:pre-line;font-size:0.85rem;line-height:1.6;\
         background:#f8f9fa;padding:1rem;border-radius:6px;border:1px solid #e0e0e0}\
         .footer{text-align:center;color:#999;font-size:0.75rem;margin-top:3rem;\
         padding-top:1rem;border-top:1px solid #e0e0e0}\n",
    );
    html.push_str("</style>\n</head>\n<body>\n");

    // Cover page
    html.push_str("<div class=\"cover\">\n");
    html.push_str(&format!("<h1>{}</h1>\n", html_escape(&report.template_name)));
    html.push_str(&format!("<div class=\"standard\">{} Compliance Report</div>\n", html_escape(&report.standard)));
    html.push_str(&format!(
        "<div class=\"meta\">Generated: {} | By: {} | Version: {}</div>\n",
        html_escape(&report.generated_at),
        html_escape(&report.generator),
        html_escape(&report.version),
    ));
    html.push_str("</div>\n");

    html.push_str("<div class=\"content\">\n");

    // Executive summary
    let score_color = if report.compliance_score >= 80 {
        "#2e7d32"
    } else if report.compliance_score >= 50 {
        "#e65100"
    } else {
        "#c62828"
    };
    html.push_str("<div class=\"section\">\n<h2>Executive Summary</h2>\n");
    html.push_str(&format!(
        "<div style=\"display:flex;align-items:center;gap:1.5rem;margin:1rem 0\">\
         <div style=\"font-size:2.5rem;font-weight:700;color:{}\">{}/100</div>\
         <div><div style=\"font-size:0.9rem;font-weight:600\">Compliance Score</div>\
         <div style=\"font-size:0.8rem;color:#666\">{} accounts scanned - {} findings across {} sections</div>\
         </div></div>\n",
        score_color,
        report.compliance_score,
        report.total_accounts_scanned,
        report.total_findings,
        report.sections.iter().filter(|s| s.finding_count.is_some()).count(),
    ));

    // Report introduction
    if let Some(intro) = &report.introduction {
        html.push_str(&format!(
            "<p style=\"color:#555;font-size:0.85rem;line-height:1.5\">{}</p>\n",
            html_escape(intro)
        ));
    }
    html.push_str("</div>\n");

    // Table of contents
    html.push_str("<div class=\"section\">\n<h2>Table of Contents</h2>\n<ol>\n");
    for (i, section) in report.sections.iter().enumerate() {
        html.push_str(&format!(
            "<li><a href=\"#section-{}\">{}</a> <span class=\"control-ref\">{}</span></li>\n",
            i,
            html_escape(&section.title),
            html_escape(&section.control_reference),
        ));
    }
    html.push_str("</ol>\n</div>\n");

    // Sections
    for (i, section) in report.sections.iter().enumerate() {
        html.push_str(&format!("<div class=\"section\" id=\"section-{}\">\n", i));
        html.push_str(&format!("<h2>{}</h2>\n", html_escape(&section.title)));
        html.push_str(&format!(
            "<span class=\"control-ref\">{}</span>\n",
            html_escape(&section.control_reference)
        ));

        if let Some(severity) = &section.severity {
            let sev_color = match severity.as_str() {
                "Critical" => "#c62828",
                "High" => "#e65100",
                "Medium" => "#f9a825",
                _ => "#546e7a",
            };
            html.push_str(&format!(
                " <span style=\"background:{};color:#fff;padding:2px 8px;border-radius:4px;\
                 font-size:0.7rem;font-weight:600\">{}</span>\n",
                sev_color, html_escape(severity)
            ));
        }

        if let Some(intro) = &section.introduction {
            html.push_str(&format!(
                "<p style=\"color:#555;font-size:0.85rem;line-height:1.5;margin:0.5rem 0\">{}</p>\n",
                html_escape(intro)
            ));
        }

        match section.section_type {
            SectionType::Query => {
                if let Some(count) = section.finding_count {
                    html.push_str(&format!(
                        "<div class=\"finding-count\">{} items found</div>\n",
                        count
                    ));
                }
                if let (Some(headers), Some(rows)) = (&section.headers, &section.rows) {
                    html.push_str("<table>\n<thead><tr>\n");
                    for h in headers {
                        html.push_str(&format!("<th>{}</th>", html_escape(h)));
                    }
                    html.push_str("\n</tr></thead>\n<tbody>\n");
                    for row in rows {
                        html.push_str("<tr>");
                        for cell in row {
                            html.push_str(&format!("<td>{}</td>", html_escape(cell)));
                        }
                        html.push_str("</tr>\n");
                    }
                    html.push_str("</tbody>\n</table>\n");
                }
            }
            SectionType::Static => {
                if let Some(content) = &section.content {
                    html.push_str(&format!(
                        "<div class=\"static-content\">{}</div>\n",
                        html_escape(content)
                    ));
                }
            }
        }

        html.push_str("</div>\n");
    }

    html.push_str(&format!(
        "<div class=\"footer\">Generated by DSPanel - {} - {}</div>\n",
        html_escape(&report.standard),
        html_escape(&report.generated_at),
    ));
    html.push_str("</div>\n</body>\n</html>");

    html
}

/// Maps AD attribute names to human-readable column headers.
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

/// Formats known AD attributes into human-readable strings.
/// Converts Windows FileTime timestamps and GeneralizedTime to readable dates.
fn format_ad_attribute(attr_name: &str, value: &str) -> String {
    if value == "-" || value.is_empty() {
        return value.to_string();
    }

    match attr_name {
        // Windows FileTime attributes (100ns intervals since 1601-01-01)
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
        // GeneralizedTime attributes (yyyyMMddHHmmss.0Z)
        "whenCreated" | "whenChanged" => {
            let clean = value.replace(".0Z", "").replace('Z', "");
            if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&clean, "%Y%m%d%H%M%S") {
                return naive.format("%Y-%m-%d %H:%M").to_string();
            }
            value.to_string()
        }
        // UAC flags - show human-readable
        "userAccountControl" => {
            if let Ok(uac) = value.parse::<u32>() {
                let mut flags = Vec::new();
                if uac & 0x0002 != 0 { flags.push("Disabled"); }
                if uac & 0x0010 != 0 { flags.push("Locked"); }
                if uac & 0x10000 != 0 { flags.push("PwdNeverExpires"); }
                if uac & 0x0020 != 0 { flags.push("PwdNotRequired"); }
                if uac & 0x200000 != 0 { flags.push("TrustedForDelegation"); }
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

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_templates_has_nine() {
        let templates = builtin_templates();
        assert_eq!(templates.len(), 9);
        let standards: Vec<&str> = templates.iter().map(|t| t.standard.as_str()).collect();
        assert!(standards.contains(&"GDPR"));
        assert!(standards.contains(&"HIPAA"));
        assert!(standards.contains(&"SOX"));
        assert!(standards.contains(&"PCI-DSS"));
        assert!(standards.contains(&"ISO 27001"));
        assert!(standards.contains(&"NIST 800-53"));
        assert!(standards.contains(&"CIS v8"));
        assert!(standards.contains(&"NIS2"));
        assert!(standards.contains(&"ANSSI"));
    }

    #[test]
    fn all_templates_have_sections() {
        for t in builtin_templates() {
            assert!(!t.sections.is_empty(), "Template {} has no sections", t.name);
            for s in &t.sections {
                assert!(!s.title.is_empty());
                assert!(!s.control_reference.is_empty());
            }
        }
    }

    #[test]
    fn all_templates_have_remediation() {
        for t in builtin_templates() {
            let has_recs = t
                .sections
                .iter()
                .any(|s| s.section_type == SectionType::Static && s.title.to_lowercase().contains("remediation"));
            assert!(has_recs, "Template {} missing Remediation section", t.name);
        }
    }

    #[test]
    fn template_serde_roundtrip() {
        let template = &builtin_templates()[0];
        let json = serde_json::to_string(template).unwrap();
        let loaded: ComplianceTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.name, template.name);
        assert_eq!(loaded.sections.len(), template.sections.len());
    }

    #[test]
    fn report_section_serde() {
        let section = ReportSection {
            title: "Test".to_string(),
            control_reference: "GDPR Art. 32".to_string(),
            introduction: None,
            severity: Some("High".to_string()),
            section_type: SectionType::Query,
            headers: Some(vec!["Name".to_string(), "Email".to_string()]),
            rows: Some(vec![vec!["Alice".to_string(), "a@test.com".to_string()]]),
            content: None,
            finding_count: Some(1),
        };
        let json = serde_json::to_string(&section).unwrap();
        assert!(json.contains("GDPR Art. 32"));
        let loaded: ReportSection = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.finding_count, Some(1));
    }

    #[test]
    fn report_to_html_produces_valid_html() {
        let report = ComplianceReport {
            template_name: "Test Report".to_string(),
            standard: "GDPR".to_string(),
            version: "1.0".to_string(),
            generated_at: "2026-03-24 12:00:00".to_string(),
            generator: "TestUser".to_string(),
            introduction: Some("Test intro".to_string()),
            compliance_score: 75,
            total_accounts_scanned: 100,
            total_findings: 5,
            sections: vec![
                ReportSection {
                    title: "Privileged Access".to_string(),
                    control_reference: "GDPR Art. 32".to_string(),
                    introduction: None,
                    severity: Some("High".to_string()),
                    section_type: SectionType::Query,
                    headers: Some(vec!["Name".to_string()]),
                    rows: Some(vec![vec!["Admin".to_string()]]),
                    content: None,
                    finding_count: Some(1),
                },
                ReportSection {
                    title: "Recommendations".to_string(),
                    control_reference: "GDPR Art. 32".to_string(),
                    introduction: None,
                    severity: None,
                    section_type: SectionType::Static,
                    headers: None,
                    rows: None,
                    content: Some("Review quarterly.".to_string()),
                    finding_count: None,
                },
            ],
        };

        let html = report_to_html(&report);
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("Test Report"));
        assert!(html.contains("GDPR Compliance Report"));
        assert!(html.contains("GDPR Art. 32"));
        assert!(html.contains("Admin"));
        assert!(html.contains("Review quarterly."));
        assert!(html.contains("Table of Contents"));
        assert!(html.contains("TestUser"));
        assert!(html.contains("75/100"));
        assert!(html.contains("Compliance Score"));
        assert!(html.contains("High"));
    }

    #[test]
    fn report_html_escapes_special_chars() {
        let report = ComplianceReport {
            template_name: "Test <Script>".to_string(),
            standard: "TEST".to_string(),
            version: "1.0".to_string(),
            generated_at: "now".to_string(),
            generator: "user".to_string(),
            introduction: None,
            compliance_score: 100,
            total_accounts_scanned: 0,
            total_findings: 0,
            sections: vec![],
        };
        let html = report_to_html(&report);
        assert!(!html.contains("<Script>"));
        assert!(html.contains("&lt;Script&gt;"));
    }

    #[test]
    fn pci_dss_has_seven_sections() {
        let pci = pci_dss_template();
        assert_eq!(pci.sections.len(), 7);
        assert!(pci.sections[0].control_reference.contains("Req. 7"));
        assert!(pci.sections[1].control_reference.contains("Req. 8.3.9"));
        assert!(pci.sections[2].control_reference.contains("Req. 8.2.6"));
        assert!(pci.sections[3].control_reference.contains("Req. 8.3.1"));
        assert!(pci.sections[4].control_reference.contains("Req. 8.3.2"));
    }

    // -- format_ad_attribute tests --

    #[test]
    fn format_filetime_timestamp() {
        // 2024-01-15 00:00:00 UTC
        let ticks = (1_705_276_800i64 + 11_644_473_600) * 10_000_000;
        let result = format_ad_attribute("lastLogonTimestamp", &ticks.to_string());
        assert_eq!(result, "2024-01-15 00:00");
    }

    #[test]
    fn format_filetime_zero_is_never() {
        assert_eq!(format_ad_attribute("lastLogonTimestamp", "0"), "Never");
    }

    #[test]
    fn format_filetime_max_is_never() {
        assert_eq!(
            format_ad_attribute("accountExpires", "9223372036854775807"),
            "Never"
        );
    }

    #[test]
    fn format_generalized_time() {
        assert_eq!(
            format_ad_attribute("whenCreated", "20240315143022.0Z"),
            "2024-03-15 14:30"
        );
    }

    #[test]
    fn format_uac_disabled() {
        assert_eq!(format_ad_attribute("userAccountControl", "514"), "Disabled");
    }

    #[test]
    fn format_uac_pwd_never_expires() {
        // 512 (normal) | 0x10000 (65536) = 66048
        assert_eq!(
            format_ad_attribute("userAccountControl", "66048"),
            "PwdNeverExpires"
        );
    }

    #[test]
    fn format_uac_normal() {
        assert_eq!(format_ad_attribute("userAccountControl", "512"), "Normal");
    }

    #[test]
    fn format_passthrough_unknown_attr() {
        assert_eq!(format_ad_attribute("sAMAccountName", "john"), "john");
    }

    #[test]
    fn format_dash_passthrough() {
        assert_eq!(format_ad_attribute("lastLogonTimestamp", "-"), "-");
    }
}
