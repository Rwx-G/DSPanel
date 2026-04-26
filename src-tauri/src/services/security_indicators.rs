//! Per-object security indicator evaluator.
//!
//! Pure-function service that maps a typed projection of an AD object's
//! relevant attributes to a list of `SecurityIndicator` items the UI can
//! render as inline badges. Mirrors the design of `services/health.rs`:
//! deterministic, no LDAP dependency, trivially unit-testable.
//!
//! Story 14.1 (Epic 14 - Security-Aware Admin).

use serde::{Deserialize, Serialize};

use crate::services::health::HealthLevel;

// -----------------------------------------------------------------------------
// UAC bit constants
// -----------------------------------------------------------------------------

/// `userAccountControl` flag: account does not require a password
/// (ADS_UF_PASSWD_NOTREQD).
const UAC_PASSWORD_NOT_REQUIRED: u32 = 0x0020;

/// `userAccountControl` flag: passwords are stored using reversible
/// encryption (ADS_UF_ENCRYPTED_TEXT_PWD_ALLOWED). Equivalent to plaintext.
const UAC_REVERSIBLE_ENCRYPTION: u32 = 0x0080;

/// `userAccountControl` flag: account password never expires
/// (ADS_UF_DONT_EXPIRE_PASSWD).
const UAC_PASSWORD_NEVER_EXPIRES: u32 = 0x10000;

/// `userAccountControl` flag: account is trusted for unconstrained delegation
/// (ADS_UF_TRUSTED_FOR_DELEGATION).
const UAC_TRUSTED_FOR_DELEGATION: u32 = 0x80000;

/// `userAccountControl` flag: Kerberos preauthentication is not required for
/// this account (ADS_UF_DONT_REQUIRE_PREAUTH). Enables AS-REP roasting.
const UAC_DONT_REQUIRE_PREAUTH: u32 = 0x400000;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/// Severity reuses the existing `HealthLevel` enum so the same color tokens
/// drive both the health badge and the security badges.
pub type IndicatorSeverity = HealthLevel;

/// Stable identifier for each detected security indicator. Frontend maps the
/// kind to an i18n badge label and tooltip; backend audit and analytics use
/// the kind as a stable key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SecurityIndicatorKind {
    Kerberoastable,
    PasswordNotRequired,
    PasswordNeverExpires,
    ReversibleEncryption,
    AsRepRoastable,
    UnconstrainedDelegation,
    ConstrainedDelegation,
    Rbcd,
}

/// One detected security indicator on an AD object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityIndicator {
    pub kind: SecurityIndicatorKind,
    pub severity: IndicatorSeverity,
    /// i18n key. UI translates via `t(description_key)`. Never a translated
    /// string.
    pub description_key: String,
    /// Optional structured payload for indicators that carry extra context
    /// (e.g. `Rbcd` populates `{"allowed_principals": ["S-1-...", ...]}`,
    /// `ConstrainedDelegation` populates `{"target_spns": [...]}`). Other
    /// indicators set this to `None` and the field is omitted on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// Set of indicators detected on a single object plus the highest severity
/// across the set, so the UI can render a single dot color without
/// re-iterating the list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityIndicatorSet {
    pub indicators: Vec<SecurityIndicator>,
    pub highest_severity: IndicatorSeverity,
}

/// Typed projection of the user attributes the evaluator needs. Mirrors the
/// existing `HealthInput` pattern from `services/health.rs`. The frontend
/// constructs this from its `DirectoryUser` and sends it through the Tauri
/// command.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIndicatorInput {
    /// Raw `userAccountControl` value. Defaults to 0 (no flags) when missing.
    #[serde(default)]
    pub user_account_control: u32,
    /// Values of the `servicePrincipalName` multi-valued attribute. Defaults
    /// to an empty list. A non-empty list flags the user as kerberoastable.
    #[serde(default)]
    pub service_principal_names: Vec<String>,
    /// `adminCount` attribute. `Some(1)` means AdminSDHolder-protected
    /// (escalates Kerberoastable / PasswordNeverExpires from Warning to
    /// Critical). Other values or `None` are treated as not protected.
    #[serde(default)]
    pub admin_count: Option<u32>,
}

/// Typed projection of the computer attributes the evaluator needs.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerIndicatorInput {
    /// Raw `userAccountControl` value.
    #[serde(default)]
    pub user_account_control: u32,
    /// Values of `msDS-AllowedToDelegateTo` (constrained delegation target
    /// SPNs). Empty means no constrained delegation configured.
    #[serde(default)]
    pub allowed_to_delegate_to: Vec<String>,
    /// Base64-encoded binary security descriptor blob from
    /// `msDS-AllowedToActOnBehalfOfOtherIdentity` (RBCD). The evaluator
    /// decodes and parses it via `services::dacl::extract_dacl_principals`
    /// to produce the principal SID list in the indicator metadata.
    #[serde(default)]
    pub allowed_to_act_on_behalf_of_b64: Option<String>,
}

// -----------------------------------------------------------------------------
// Evaluators
// -----------------------------------------------------------------------------

/// Returns `true` when the AdminSDHolder-protected flag (`adminCount = 1`)
/// is set. Used to escalate the severity of indicators that would otherwise
/// be Warning on a regular user but are Critical on a privileged user.
fn is_admin_sdholder_protected(admin_count: Option<u32>) -> bool {
    admin_count == Some(1)
}

/// Computes the highest severity present in a list of indicators. Defaults
/// to `Healthy` when the list is empty.
fn compute_highest_severity(indicators: &[SecurityIndicator]) -> IndicatorSeverity {
    indicators
        .iter()
        .map(|i| i.severity.clone())
        .max()
        .unwrap_or(HealthLevel::Healthy)
}

/// Evaluates user-side security indicators from the typed input.
///
/// Returns the set of detected indicators in declaration order plus the
/// highest severity across the set. An "all-clean" user yields an empty
/// indicator list and `highest_severity = Healthy`.
pub fn evaluate_user_indicators(input: &UserIndicatorInput) -> SecurityIndicatorSet {
    let mut indicators: Vec<SecurityIndicator> = Vec::new();
    let admin_protected = is_admin_sdholder_protected(input.admin_count);
    let uac = input.user_account_control;

    if uac & UAC_PASSWORD_NOT_REQUIRED != 0 {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::PasswordNotRequired,
            severity: HealthLevel::Critical,
            description_key: "securityIndicators.passwordNotRequired".to_string(),
            metadata: None,
        });
    }

    if uac & UAC_REVERSIBLE_ENCRYPTION != 0 {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::ReversibleEncryption,
            severity: HealthLevel::Critical,
            description_key: "securityIndicators.reversibleEncryption".to_string(),
            metadata: None,
        });
    }

    if uac & UAC_PASSWORD_NEVER_EXPIRES != 0 {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::PasswordNeverExpires,
            severity: if admin_protected {
                HealthLevel::Critical
            } else {
                HealthLevel::Warning
            },
            description_key: "securityIndicators.passwordNeverExpires".to_string(),
            metadata: None,
        });
    }

    if uac & UAC_DONT_REQUIRE_PREAUTH != 0 {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::AsRepRoastable,
            severity: HealthLevel::Critical,
            description_key: "securityIndicators.asRepRoastable".to_string(),
            metadata: None,
        });
    }

    if !input.service_principal_names.is_empty() {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::Kerberoastable,
            severity: if admin_protected {
                HealthLevel::Critical
            } else {
                HealthLevel::Warning
            },
            description_key: "securityIndicators.kerberoastable".to_string(),
            metadata: None,
        });
    }

    let highest_severity = compute_highest_severity(&indicators);
    SecurityIndicatorSet {
        indicators,
        highest_severity,
    }
}

/// Evaluates computer-side security indicators from the typed input.
pub fn evaluate_computer_indicators(input: &ComputerIndicatorInput) -> SecurityIndicatorSet {
    let mut indicators: Vec<SecurityIndicator> = Vec::new();
    let uac = input.user_account_control;

    if uac & UAC_TRUSTED_FOR_DELEGATION != 0 {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::UnconstrainedDelegation,
            severity: HealthLevel::Critical,
            description_key: "securityIndicators.unconstrainedDelegation".to_string(),
            metadata: None,
        });
    }

    if !input.allowed_to_delegate_to.is_empty() {
        indicators.push(SecurityIndicator {
            kind: SecurityIndicatorKind::ConstrainedDelegation,
            severity: HealthLevel::Warning,
            description_key: "securityIndicators.constrainedDelegation".to_string(),
            metadata: Some(serde_json::json!({
                "target_spns": input.allowed_to_delegate_to,
            })),
        });
    }

    if let Some(ref b64) = input.allowed_to_act_on_behalf_of_b64
        && !b64.is_empty()
    {
        use base64::Engine;
        let principals = match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(bytes) => crate::services::dacl::extract_dacl_principals(&bytes).unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        if !principals.is_empty() {
            indicators.push(SecurityIndicator {
                kind: SecurityIndicatorKind::Rbcd,
                severity: HealthLevel::Warning,
                description_key: "securityIndicators.rbcd".to_string(),
                metadata: Some(serde_json::json!({
                    "allowed_principals": principals,
                })),
            });
        }
    }

    let highest_severity = compute_highest_severity(&indicators);
    SecurityIndicatorSet {
        indicators,
        highest_severity,
    }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    // -- helpers --

    fn user(uac: u32, spns: &[&str], admin_count: Option<u32>) -> UserIndicatorInput {
        UserIndicatorInput {
            user_account_control: uac,
            service_principal_names: spns.iter().map(|s| s.to_string()).collect(),
            admin_count,
        }
    }

    fn computer(uac: u32, delegate_to: &[&str], rbcd_b64: Option<&str>) -> ComputerIndicatorInput {
        ComputerIndicatorInput {
            user_account_control: uac,
            allowed_to_delegate_to: delegate_to.iter().map(|s| s.to_string()).collect(),
            allowed_to_act_on_behalf_of_b64: rbcd_b64.map(|s| s.to_string()),
        }
    }

    fn has_kind(set: &SecurityIndicatorSet, kind: SecurityIndicatorKind) -> bool {
        set.indicators.iter().any(|i| i.kind == kind)
    }

    fn severity_of(set: &SecurityIndicatorSet, kind: SecurityIndicatorKind) -> IndicatorSeverity {
        set.indicators
            .iter()
            .find(|i| i.kind == kind)
            .expect("indicator present")
            .severity
            .clone()
    }

    // -- isolated user indicators --

    #[test]
    fn user_password_not_required_is_critical() {
        let r = evaluate_user_indicators(&user(0x0020, &[], None));
        assert!(has_kind(&r, SecurityIndicatorKind::PasswordNotRequired));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNotRequired),
            HealthLevel::Critical
        );
        assert_eq!(r.highest_severity, HealthLevel::Critical);
    }

    #[test]
    fn user_reversible_encryption_is_critical() {
        let r = evaluate_user_indicators(&user(0x0080, &[], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::ReversibleEncryption),
            HealthLevel::Critical
        );
    }

    #[test]
    fn user_password_never_expires_is_warning_when_not_protected() {
        let r = evaluate_user_indicators(&user(0x10000, &[], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Warning
        );
    }

    #[test]
    fn user_as_rep_roastable_is_critical() {
        let r = evaluate_user_indicators(&user(0x400000, &[], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::AsRepRoastable),
            HealthLevel::Critical
        );
    }

    #[test]
    fn user_kerberoastable_is_warning_when_not_protected() {
        let r = evaluate_user_indicators(&user(0, &["MSSQLSvc/db.corp.local:1433"], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::Kerberoastable),
            HealthLevel::Warning
        );
    }

    // -- severity escalation when AdminSDHolder-protected --

    #[test]
    fn user_kerberoastable_escalates_to_critical_when_admin_count_one() {
        let r = evaluate_user_indicators(&user(0, &["http/web1"], Some(1)));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::Kerberoastable),
            HealthLevel::Critical
        );
        assert_eq!(r.highest_severity, HealthLevel::Critical);
    }

    #[test]
    fn user_password_never_expires_escalates_when_admin_count_one() {
        let r = evaluate_user_indicators(&user(0x10000, &[], Some(1)));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Critical
        );
    }

    #[test]
    fn user_both_escalating_indicators_when_admin_count_one() {
        let r = evaluate_user_indicators(&user(0x10000, &["http/web1"], Some(1)));
        assert!(has_kind(&r, SecurityIndicatorKind::PasswordNeverExpires));
        assert!(has_kind(&r, SecurityIndicatorKind::Kerberoastable));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Critical
        );
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::Kerberoastable),
            HealthLevel::Critical
        );
    }

    #[test]
    fn user_admin_count_zero_does_not_escalate() {
        let r = evaluate_user_indicators(&user(0x10000, &["http/web1"], Some(0)));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Warning
        );
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::Kerberoastable),
            HealthLevel::Warning
        );
    }

    #[test]
    fn user_admin_count_two_does_not_escalate() {
        // adminCount=2 is rare migration leftover - not protected per AD semantics
        let r = evaluate_user_indicators(&user(0x10000, &[], Some(2)));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Warning
        );
    }

    #[test]
    fn user_admin_count_absent_does_not_escalate() {
        let r = evaluate_user_indicators(&user(0x10000, &["http/web1"], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::PasswordNeverExpires),
            HealthLevel::Warning
        );
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::Kerberoastable),
            HealthLevel::Warning
        );
    }

    // -- multi-indicator combinations --

    #[test]
    fn user_multiple_indicators_combined() {
        // PasswordNotRequired (Critical) + Kerberoastable (Warning) on a regular user
        let r = evaluate_user_indicators(&user(0x0020, &["http/web1"], None));
        assert_eq!(r.indicators.len(), 2);
        assert!(has_kind(&r, SecurityIndicatorKind::PasswordNotRequired));
        assert!(has_kind(&r, SecurityIndicatorKind::Kerberoastable));
        // Highest severity is the Critical from PasswordNotRequired
        assert_eq!(r.highest_severity, HealthLevel::Critical);
    }

    #[test]
    fn user_clean_yields_empty_set() {
        let r = evaluate_user_indicators(&user(0, &[], None));
        assert!(r.indicators.is_empty());
        assert_eq!(r.highest_severity, HealthLevel::Healthy);
    }

    #[test]
    fn user_empty_spn_array_treated_as_no_spn() {
        let r = evaluate_user_indicators(&user(0, &[], Some(1)));
        assert!(!has_kind(&r, SecurityIndicatorKind::Kerberoastable));
    }

    // -- isolated computer indicators --

    #[test]
    fn computer_unconstrained_delegation_is_critical() {
        let r = evaluate_computer_indicators(&computer(0x80000, &[], None));
        assert_eq!(
            severity_of(&r, SecurityIndicatorKind::UnconstrainedDelegation),
            HealthLevel::Critical
        );
        assert_eq!(r.highest_severity, HealthLevel::Critical);
    }

    #[test]
    fn computer_constrained_delegation_is_warning_with_metadata() {
        let r = evaluate_computer_indicators(&computer(
            0,
            &["http/web1.corp.local", "http/web2.corp.local"],
            None,
        ));
        let ind = r
            .indicators
            .iter()
            .find(|i| i.kind == SecurityIndicatorKind::ConstrainedDelegation)
            .expect("constrained delegation present");
        assert_eq!(ind.severity, HealthLevel::Warning);
        let metadata = ind.metadata.as_ref().expect("metadata present");
        let target_spns = metadata.get("target_spns").expect("target_spns key");
        assert_eq!(target_spns.as_array().unwrap().len(), 2);
    }

    #[test]
    fn computer_rbcd_parses_principals_from_sd_blob() {
        // Minimal SECURITY_DESCRIPTOR_RELATIVE with one ACCESS_ALLOWED_ACE
        // granting access to S-1-5-21-1-2-3-1000.
        // Header: Revision(1=0x01) Sbz1(1=0x00) Control(2=0x0080 SELF_RELATIVE)
        //         OffsetOwner(4=0) OffsetGroup(4=0) OffsetSacl(4=0)
        //         OffsetDacl(4=20)
        // DACL header at offset 20: AclRevision(1=0x02) Sbz1(1=0x00)
        //         AclSize(2=) AceCount(2=1) Sbz2(2=0)
        // ACE: Type(1=0x00) Flags(1=0x00) Size(2=24) Mask(4=0x00000100) SID(16)
        // SID S-1-5-21-1-2-3-1000: rev=1 subauth_count=4 authority=5 (BE)
        //                          subs LE: 21, 1, 2, 3, 1000
        let sid: [u8; 24] = [
            0x01, 0x04, // rev, count
            0x00, 0x00, 0x00, 0x00, 0x00, 0x05, // authority = 5 (BE)
            0x15, 0x00, 0x00, 0x00, // 21
            0x01, 0x00, 0x00, 0x00, // 1
            0x02, 0x00, 0x00, 0x00, // 2
            0x03, 0x00, 0x00, 0x00, // 3 - subauth count is 4 so this is the 4th
        ];
        let ace_size: u16 = 4 + 4 + sid.len() as u16; // header + mask + sid = 32
        let mut ace = Vec::new();
        ace.push(0x00); // ACCESS_ALLOWED_ACE_TYPE
        ace.push(0x00); // flags
        ace.extend_from_slice(&ace_size.to_le_bytes()); // size
        ace.extend_from_slice(&0x00000100u32.to_le_bytes()); // mask
        ace.extend_from_slice(&sid);

        let acl_size: u16 = 8 + ace.len() as u16;
        let mut sd = Vec::new();
        // SD header
        sd.push(0x01); // revision
        sd.push(0x00); // sbz1
        sd.extend_from_slice(&0x8000u16.to_le_bytes()); // control: SELF_RELATIVE
        sd.extend_from_slice(&0u32.to_le_bytes()); // OffsetOwner
        sd.extend_from_slice(&0u32.to_le_bytes()); // OffsetGroup
        sd.extend_from_slice(&0u32.to_le_bytes()); // OffsetSacl
        sd.extend_from_slice(&20u32.to_le_bytes()); // OffsetDacl
        // DACL
        sd.push(0x02); // AclRevision
        sd.push(0x00); // Sbz1
        sd.extend_from_slice(&acl_size.to_le_bytes());
        sd.extend_from_slice(&1u16.to_le_bytes()); // AceCount
        sd.extend_from_slice(&0u16.to_le_bytes()); // Sbz2
        sd.extend_from_slice(&ace);

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&sd);
        let r = evaluate_computer_indicators(&computer(0, &[], Some(&b64)));

        let ind = r
            .indicators
            .iter()
            .find(|i| i.kind == SecurityIndicatorKind::Rbcd)
            .expect("rbcd indicator present");
        assert_eq!(ind.severity, HealthLevel::Warning);
        let metadata = ind.metadata.as_ref().expect("metadata present");
        let principals = metadata
            .get("allowed_principals")
            .expect("allowed_principals key")
            .as_array()
            .expect("array")
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(principals.len(), 1);
        assert!(principals[0].starts_with("S-1-5-"));
    }

    // -- multi-indicator on computers --

    #[test]
    fn computer_clean_yields_empty_set() {
        let r = evaluate_computer_indicators(&computer(0, &[], None));
        assert!(r.indicators.is_empty());
        assert_eq!(r.highest_severity, HealthLevel::Healthy);
    }

    #[test]
    fn computer_unconstrained_dominates_constrained_severity() {
        let r = evaluate_computer_indicators(&computer(0x80000, &["http/web1.corp.local"], None));
        assert_eq!(r.indicators.len(), 2);
        assert_eq!(r.highest_severity, HealthLevel::Critical);
    }

    // -- defensive --

    #[test]
    fn computer_empty_rbcd_string_does_not_emit_indicator() {
        let r = evaluate_computer_indicators(&computer(0, &[], Some("")));
        assert!(!has_kind(&r, SecurityIndicatorKind::Rbcd));
    }

    #[test]
    fn computer_invalid_base64_does_not_emit_indicator() {
        let r = evaluate_computer_indicators(&computer(0, &[], Some("not-valid-base64!!!")));
        assert!(!has_kind(&r, SecurityIndicatorKind::Rbcd));
    }
}
