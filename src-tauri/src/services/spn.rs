//! Service Principal Name policy helpers.
//!
//! Story 14.5 (Epic 14 - Security-Aware Admin) - Quick-Fix Remove Unused SPN.
//!
//! This module owns the **system-SPN guard list** used by the
//! `remove_user_spns` quick-fix command. System SPNs (HOST/, ldap/, cifs/,
//! krbtgt/, etc.) belong to AD itself or to security-critical services;
//! removing them from a user object would cause a service outage. The list is
//! deliberately conservative: false positives (a legitimate SPN we refuse to
//! remove) just send the operator to ADUC, while false negatives (a system
//! SPN we let through) cause an outage. Conservative bias is correct.
//!
//! Keep `src/utils/spn.ts` `SYSTEM_SPN_PREFIXES` in sync with this list.

/// Prefixes (the substring before the first `/`) that mark an SPN as
/// system-owned. Comparison is case-insensitive on the full prefix only -
/// substring matches are NOT performed (e.g. `MyHostService/x` is NOT
/// flagged because the prefix is `MyHostService`, not `host`).
const SYSTEM_SPN_PREFIXES: &[&str] = &[
    "host",
    "RestrictedKrbHost",
    "cifs",
    "ldap",
    "GC",
    "kadmin",
    "krbtgt",
    "wsman",
    "TERMSRV",
    "MSServerClusterMgmtAPI",
    "MSServerCluster",
    "DNS",
];

/// Returns `true` when the SPN is system-protected and must not be removed
/// by the quick-fix command.
///
/// The check splits on the first `/` and matches the prefix
/// case-insensitively against `SYSTEM_SPN_PREFIXES`. SPNs without a `/`
/// (malformed) return `false` - they are not system-owned by this rule and
/// the rest of the pipeline (LDAP-side validation) decides their fate.
pub fn is_system_spn(spn: &str) -> bool {
    spn.split('/')
        .next()
        .map(|prefix| {
            SYSTEM_SPN_PREFIXES
                .iter()
                .any(|sp| prefix.eq_ignore_ascii_case(sp))
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Each prefix is correctly classified as system ---

    #[test]
    fn host_is_system() {
        assert!(is_system_spn("HOST/dc01.corp.local"));
        assert!(is_system_spn("host/dc01.corp.local"));
        assert!(is_system_spn("Host/dc01.corp.local"));
    }

    #[test]
    fn restricted_krb_host_is_system() {
        assert!(is_system_spn("RestrictedKrbHost/dc01.corp.local"));
        assert!(is_system_spn("restrictedkrbhost/dc01.corp.local"));
    }

    #[test]
    fn cifs_is_system() {
        assert!(is_system_spn("cifs/fileserver.corp.local"));
        assert!(is_system_spn("CIFS/fileserver.corp.local"));
    }

    #[test]
    fn ldap_is_system() {
        assert!(is_system_spn("ldap/dc01.corp.local"));
        assert!(is_system_spn("LDAP/dc01.corp.local"));
    }

    #[test]
    fn gc_is_system() {
        assert!(is_system_spn("GC/dc01.corp.local"));
        assert!(is_system_spn("gc/dc01.corp.local"));
    }

    #[test]
    fn kadmin_is_system() {
        assert!(is_system_spn("kadmin/changepw"));
    }

    #[test]
    fn krbtgt_is_system() {
        assert!(is_system_spn("krbtgt/CORP.LOCAL"));
    }

    #[test]
    fn wsman_is_system() {
        assert!(is_system_spn("wsman/dc01.corp.local"));
        assert!(is_system_spn("WSMAN/dc01.corp.local"));
    }

    #[test]
    fn termsrv_is_system() {
        assert!(is_system_spn("TERMSRV/rdp01.corp.local"));
        assert!(is_system_spn("termsrv/rdp01.corp.local"));
    }

    #[test]
    fn cluster_mgmt_is_system() {
        assert!(is_system_spn(
            "MSServerClusterMgmtAPI/cluster01.corp.local"
        ));
        assert!(is_system_spn("MSServerCluster/cluster01.corp.local"));
    }

    #[test]
    fn dns_is_system() {
        assert!(is_system_spn("DNS/dc01.corp.local"));
        assert!(is_system_spn("dns/dc01.corp.local"));
    }

    // --- User-defined SPNs are correctly classified as non-system ---

    #[test]
    fn mssql_svc_is_not_system() {
        assert!(!is_system_spn("MSSQLSvc/db.corp.local:1433"));
        assert!(!is_system_spn("MSSQLSvc/db.corp.local"));
    }

    #[test]
    fn http_is_not_system() {
        assert!(!is_system_spn("HTTP/web1.corp.local"));
        assert!(!is_system_spn("http/web1.corp.local"));
    }

    #[test]
    fn arbitrary_user_service_is_not_system() {
        assert!(!is_system_spn("MyService/app1.corp.local"));
        assert!(!is_system_spn("FtpSvc/files.corp.local"));
        assert!(!is_system_spn("CustomApp/srv01"));
    }

    #[test]
    fn host_substring_in_user_prefix_is_not_system() {
        // Defense against substring-style false positives - the prefix
        // must equal the system word, not just contain it.
        assert!(!is_system_spn("MyHostService/x.corp.local"));
        assert!(!is_system_spn("hostnamed/x.corp.local"));
    }

    // --- Malformed inputs ---

    #[test]
    fn empty_string_is_not_system() {
        assert!(!is_system_spn(""));
    }

    #[test]
    fn no_slash_with_system_prefix_is_system() {
        // Conservative-bias: a malformed SPN equal to a system prefix is
        // still flagged as system. Better to refuse to delete an
        // unparseable value than to accidentally delete a system SPN.
        assert!(is_system_spn("HOST"));
        assert!(is_system_spn("krbtgt"));
    }

    #[test]
    fn no_slash_with_unknown_prefix_is_not_system() {
        assert!(!is_system_spn("just-a-prefix"));
        assert!(!is_system_spn("randomstring"));
    }

    #[test]
    fn only_slash_is_not_system() {
        // Prefix is "" which matches nothing in the list.
        assert!(!is_system_spn("/anything"));
    }
}
