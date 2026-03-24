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
    pub sections: Vec<ReportSection>,
}

/// A section of a generated report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSection {
    pub title: String,
    pub control_reference: String,
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
    ]
}

fn gdpr_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "GDPR Access Review".to_string(),
        standard: "GDPR".to_string(),
        version: "1.0".to_string(),
        description: "Review of AD access controls for GDPR compliance".to_string(),
        builtin: true,
        sections: vec![
            TemplateSection {
                title: "Privileged Access Summary".to_string(),
                control_reference: "GDPR Art. 25 - Data protection by design".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("privilegedAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "lastLogonTimestamp".to_string(),
                    "pwdLastSet".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Inactive Accounts".to_string(),
                control_reference: "GDPR Art. 5 - Data minimization".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("inactiveAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "lastLogonTimestamp".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Recommendations".to_string(),
                control_reference: "GDPR Art. 32 - Security of processing".to_string(),
                section_type: SectionType::Static,
                query_scope: None,
                query_attributes: None,
                content: Some(
                    "1. Review all privileged accounts quarterly and remove unnecessary access.\n\
                     2. Disable or delete inactive accounts older than 90 days.\n\
                     3. Implement least-privilege access model for data access groups.\n\
                     4. Enable audit logging for all access to personal data containers."
                        .to_string(),
                ),
            },
        ],
    }
}

fn hipaa_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "HIPAA Access Controls".to_string(),
        standard: "HIPAA".to_string(),
        version: "1.0".to_string(),
        description: "Audit of AD access controls for HIPAA compliance".to_string(),
        builtin: true,
        sections: vec![
            TemplateSection {
                title: "Administrative Access Audit".to_string(),
                control_reference: "HIPAA 164.312(a) - Access control".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("privilegedAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "memberOf".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Password Policy Assessment".to_string(),
                control_reference: "HIPAA 164.312(d) - Person or entity authentication".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("passwordNeverExpires".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "userAccountControl".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Recommendations".to_string(),
                control_reference: "HIPAA 164.312(b) - Audit controls".to_string(),
                section_type: SectionType::Static,
                query_scope: None,
                query_attributes: None,
                content: Some(
                    "1. Enforce password rotation for all accounts accessing ePHI.\n\
                     2. Remove 'Password Never Expires' flag from all non-service accounts.\n\
                     3. Implement role-based access control for clinical data groups.\n\
                     4. Review administrative access monthly."
                        .to_string(),
                ),
            },
        ],
    }
}

fn sox_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "SOX Change Management".to_string(),
        standard: "SOX".to_string(),
        version: "1.0".to_string(),
        description: "Audit of AD privileged access and change management for SOX compliance"
            .to_string(),
        builtin: true,
        sections: vec![
            TemplateSection {
                title: "Privileged Account Inventory".to_string(),
                control_reference: "SOX Section 404 - Internal controls".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("privilegedAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "whenCreated".to_string(),
                    "lastLogonTimestamp".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Disabled Account Review".to_string(),
                control_reference: "SOX Section 302 - Corporate responsibility".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("disabledAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "whenChanged".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Recommendations".to_string(),
                control_reference: "SOX Section 404 - Assessment of internal controls".to_string(),
                section_type: SectionType::Static,
                query_scope: None,
                query_attributes: None,
                content: Some(
                    "1. Perform quarterly access reviews for all privileged accounts.\n\
                     2. Document and approve all changes to administrative group membership.\n\
                     3. Retain disabled accounts for 90 days before deletion for audit trail.\n\
                     4. Implement separation of duties for financial system access."
                        .to_string(),
                ),
            },
        ],
    }
}

fn pci_dss_template() -> ComplianceTemplate {
    ComplianceTemplate {
        name: "PCI-DSS Auth & Access Audit".to_string(),
        standard: "PCI-DSS".to_string(),
        version: "1.0".to_string(),
        description: "Audit of authentication settings and access rights for PCI-DSS compliance"
            .to_string(),
        builtin: true,
        sections: vec![
            TemplateSection {
                title: "Privileged Access Review".to_string(),
                control_reference: "PCI-DSS Req. 7 - Restrict access".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("privilegedAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "lastLogonTimestamp".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Authentication Controls".to_string(),
                control_reference: "PCI-DSS Req. 8 - Identify and authenticate".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("passwordNeverExpires".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "userAccountControl".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Inactive Account Audit".to_string(),
                control_reference: "PCI-DSS Req. 8.1.4 - Remove inactive accounts".to_string(),
                section_type: SectionType::Query,
                query_scope: Some("inactiveAccounts".to_string()),
                query_attributes: Some(vec![
                    "sAMAccountName".to_string(),
                    "displayName".to_string(),
                    "lastLogonTimestamp".to_string(),
                ]),
                content: None,
            },
            TemplateSection {
                title: "Recommendations".to_string(),
                control_reference: "PCI-DSS Req. 10 - Track and monitor access".to_string(),
                section_type: SectionType::Static,
                query_scope: None,
                query_attributes: None,
                content: Some(
                    "1. Remove or disable inactive accounts within 90 days (Req. 8.1.4).\n\
                     2. Enforce unique IDs for all users with system access (Req. 8.1.1).\n\
                     3. Implement MFA for all administrative access (Req. 8.3).\n\
                     4. Review access rights at least quarterly (Req. 7.1)."
                        .to_string(),
                ),
            },
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
    let generator = std::env::var("USERNAME").unwrap_or_else(|_| "DSPanel".to_string());

    let mut sections = Vec::new();

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
                ReportSection {
                    title: section.title.clone(),
                    control_reference: section.control_reference.clone(),
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
                section_type: SectionType::Static,
                headers: None,
                rows: None,
                content: section.content.clone(),
                finding_count: None,
            },
        };
        sections.push(report_section);
    }

    Ok(ComplianceReport {
        template_name: template.name.clone(),
        standard: template.standard.clone(),
        version: template.version.clone(),
        generated_at: timestamp,
        generator,
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
    fn builtin_templates_has_four() {
        let templates = builtin_templates();
        assert_eq!(templates.len(), 4);
        assert_eq!(templates[0].standard, "GDPR");
        assert_eq!(templates[1].standard, "HIPAA");
        assert_eq!(templates[2].standard, "SOX");
        assert_eq!(templates[3].standard, "PCI-DSS");
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
    fn all_templates_have_recommendations() {
        for t in builtin_templates() {
            let has_recs = t
                .sections
                .iter()
                .any(|s| s.section_type == SectionType::Static && s.title.contains("Recommendation"));
            assert!(has_recs, "Template {} missing Recommendations section", t.name);
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
            control_reference: "GDPR Art. 25".to_string(),
            section_type: SectionType::Query,
            headers: Some(vec!["Name".to_string(), "Email".to_string()]),
            rows: Some(vec![vec!["Alice".to_string(), "a@test.com".to_string()]]),
            content: None,
            finding_count: Some(1),
        };
        let json = serde_json::to_string(&section).unwrap();
        assert!(json.contains("GDPR Art. 25"));
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
            sections: vec![
                ReportSection {
                    title: "Privileged Access".to_string(),
                    control_reference: "GDPR Art. 25".to_string(),
                    section_type: SectionType::Query,
                    headers: Some(vec!["Name".to_string()]),
                    rows: Some(vec![vec!["Admin".to_string()]]),
                    content: None,
                    finding_count: Some(1),
                },
                ReportSection {
                    title: "Recommendations".to_string(),
                    control_reference: "GDPR Art. 32".to_string(),
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
        assert!(html.contains("GDPR Art. 25"));
        assert!(html.contains("GDPR Art. 32"));
        assert!(html.contains("Admin"));
        assert!(html.contains("Review quarterly."));
        assert!(html.contains("Table of Contents"));
        assert!(html.contains("TestUser"));
    }

    #[test]
    fn report_html_escapes_special_chars() {
        let report = ComplianceReport {
            template_name: "Test <Script>".to_string(),
            standard: "TEST".to_string(),
            version: "1.0".to_string(),
            generated_at: "now".to_string(),
            generator: "user".to_string(),
            sections: vec![],
        };
        let html = report_to_html(&report);
        assert!(!html.contains("<Script>"));
        assert!(html.contains("&lt;Script&gt;"));
    }

    #[test]
    fn pci_dss_has_four_sections() {
        let pci = pci_dss_template();
        assert_eq!(pci.sections.len(), 4);
        assert!(pci.sections[0].control_reference.contains("Req. 7"));
        assert!(pci.sections[1].control_reference.contains("Req. 8"));
        assert!(pci.sections[2].control_reference.contains("Req. 8.1.4"));
        assert!(pci.sections[3].control_reference.contains("Req. 10"));
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
