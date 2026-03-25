use serde::{Deserialize, Serialize};

/// Represents a single GPO link parsed from the `gPLink` attribute.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpoLink {
    /// DN of the GPO (e.g., CN={GUID},CN=Policies,CN=System,DC=...).
    pub gpo_dn: String,
    /// Display name of the GPO (resolved from the GPO object).
    pub gpo_name: String,
    /// Link order (position in the gPLink attribute, 1-based).
    pub link_order: usize,
    /// Whether the link is enforced (overrides block inheritance).
    pub is_enforced: bool,
    /// Whether the link is disabled.
    pub is_disabled: bool,
    /// DN of the container (OU/domain/site) where this GPO is linked.
    pub linked_at: String,
    /// Whether this link is inherited from a parent container.
    pub is_inherited: bool,
}

/// Result of querying GPO links for an object.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpoLinksResult {
    /// DN of the target object.
    pub object_dn: String,
    /// All GPO links in effective order (enforced first, then by hierarchy).
    pub links: Vec<GpoLink>,
    /// Whether the object's container blocks inheritance.
    pub blocks_inheritance: bool,
}

/// A single raw parsed link from a gPLink attribute value.
#[derive(Debug, Clone, PartialEq)]
pub struct RawGpoLink {
    /// The LDAP DN extracted from the gPLink entry.
    pub gpo_dn: String,
    /// Link flags: 0=enabled, 1=disabled, 2=enforced, 3=disabled+enforced.
    pub flags: u32,
}

/// Parses a `gPLink` attribute value into structured link entries.
///
/// The gPLink format is:
/// `[LDAP://cn={GUID},cn=policies,cn=system,DC=...;flags][LDAP://...;flags]`
///
/// Each entry is enclosed in brackets. The DN and flags are separated by `;`.
/// Link flags: 0 = enabled, 1 = disabled, 2 = enforced, 3 = disabled+enforced.
pub fn parse_gp_link(gp_link: &str) -> Vec<RawGpoLink> {
    let mut links = Vec::new();

    for segment in gp_link.split(']') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }

        // Remove leading '['
        let segment = segment.strip_prefix('[').unwrap_or(segment);

        // Split by ';' to separate DN from flags
        if let Some((dn_part, flags_part)) = segment.rsplit_once(';') {
            // Extract the DN from the LDAP:// prefix
            let dn = dn_part
                .strip_prefix("LDAP://")
                .or_else(|| dn_part.strip_prefix("ldap://"))
                .unwrap_or(dn_part)
                .to_string();

            let flags: u32 = flags_part.trim().parse().unwrap_or(0);

            if !dn.is_empty() {
                links.push(RawGpoLink { gpo_dn: dn, flags });
            }
        }
    }

    links
}

/// Returns whether a link is enforced based on its flags.
pub fn is_link_enforced(flags: u32) -> bool {
    flags & 2 != 0
}

/// Returns whether a link is disabled based on its flags.
pub fn is_link_disabled(flags: u32) -> bool {
    flags & 1 != 0
}

/// Computes the effective GPO list for an object given its OU hierarchy.
///
/// `ou_chain` is ordered from the domain root (index 0) down to the object's
/// direct parent OU. Each entry is (ou_dn, gPLink_value, gPOptions_value).
///
/// `gPOptions` = 1 means the OU blocks inheritance.
///
/// GPO resolution order:
/// 1. Process from domain root down to the direct parent OU
/// 2. Within each level, GPOs apply in reverse link order (last link = highest priority)
/// 3. "Block Inheritance" on an OU stops all non-enforced GPOs from parent OUs
/// 4. Enforced GPOs always apply regardless of block inheritance
pub fn resolve_effective_gpos(
    ou_chain: &[(String, Option<String>, Option<String>)],
    gpo_names: &std::collections::HashMap<String, String>,
) -> (Vec<GpoLink>, bool) {
    let mut enforced_links: Vec<GpoLink> = Vec::new();
    let mut normal_links: Vec<GpoLink> = Vec::new();
    let mut object_blocks_inheritance = false;

    for (level_idx, (ou_dn, gp_link_val, gp_options)) in ou_chain.iter().enumerate() {
        let blocks = gp_options
            .as_deref()
            .map(|v| v.trim() == "1")
            .unwrap_or(false);

        let is_direct_parent = level_idx == ou_chain.len() - 1;

        if is_direct_parent && blocks {
            object_blocks_inheritance = true;
            // Block inheritance: remove all non-enforced inherited links
            normal_links.clear();
        }

        if let Some(ref gp_link) = gp_link_val {
            let raw_links = parse_gp_link(gp_link);

            for (order, raw) in raw_links.iter().enumerate() {
                if is_link_disabled(raw.flags) {
                    continue;
                }

                let gpo_name = gpo_names
                    .get(&raw.gpo_dn.to_uppercase())
                    .cloned()
                    .unwrap_or_else(|| {
                        // Try to extract CN from DN
                        raw.gpo_dn
                            .split(',')
                            .next()
                            .and_then(|p| p.strip_prefix("CN=").or_else(|| p.strip_prefix("cn=")))
                            .unwrap_or(&raw.gpo_dn)
                            .to_string()
                    });

                let link = GpoLink {
                    gpo_dn: raw.gpo_dn.clone(),
                    gpo_name,
                    link_order: order + 1,
                    is_enforced: is_link_enforced(raw.flags),
                    is_disabled: false,
                    linked_at: ou_dn.clone(),
                    is_inherited: !is_direct_parent,
                };

                if link.is_enforced {
                    enforced_links.push(link);
                } else {
                    normal_links.push(link);
                }
            }
        }
    }

    // Enforced GPOs are listed first (they always win), then normal links
    let mut result = enforced_links;
    result.extend(normal_links);
    (result, object_blocks_inheritance)
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gp_link_single() {
        let input = "[LDAP://CN={6AC1786C},CN=Policies,CN=System,DC=contoso,DC=com;0]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].gpo_dn,
            "CN={6AC1786C},CN=Policies,CN=System,DC=contoso,DC=com"
        );
        assert_eq!(links[0].flags, 0);
    }

    #[test]
    fn test_parse_gp_link_multiple() {
        let input = "[LDAP://CN={AAA},CN=Policies,CN=System,DC=c,DC=com;0][LDAP://CN={BBB},CN=Policies,CN=System,DC=c,DC=com;2]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].flags, 0);
        assert_eq!(links[1].flags, 2);
    }

    #[test]
    fn test_parse_gp_link_disabled() {
        let input = "[LDAP://CN={AAA},CN=Policies;1]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 1);
        assert!(is_link_disabled(links[0].flags));
        assert!(!is_link_enforced(links[0].flags));
    }

    #[test]
    fn test_parse_gp_link_enforced() {
        let input = "[LDAP://CN={AAA},CN=Policies;2]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 1);
        assert!(is_link_enforced(links[0].flags));
        assert!(!is_link_disabled(links[0].flags));
    }

    #[test]
    fn test_parse_gp_link_disabled_and_enforced() {
        let input = "[LDAP://CN={AAA},CN=Policies;3]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 1);
        assert!(is_link_disabled(links[0].flags));
        assert!(is_link_enforced(links[0].flags));
    }

    #[test]
    fn test_parse_gp_link_empty() {
        let links = parse_gp_link("");
        assert!(links.is_empty());
    }

    #[test]
    fn test_parse_gp_link_lowercase() {
        let input = "[ldap://cn={AAA},cn=Policies;0]";
        let links = parse_gp_link(input);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].gpo_dn, "cn={AAA},cn=Policies");
    }

    #[test]
    fn test_resolve_effective_gpos_simple() {
        let mut names = std::collections::HashMap::new();
        names.insert(
            "CN={AAA},CN=POLICIES".to_uppercase(),
            "Default Domain Policy".to_string(),
        );

        let chain = vec![(
            "DC=contoso,DC=com".to_string(),
            Some("[LDAP://CN={AAA},CN=Policies;0]".to_string()),
            None,
        )];

        let (links, blocks) = resolve_effective_gpos(&chain, &names);
        assert!(!blocks);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].gpo_name, "Default Domain Policy");
        assert!(!links[0].is_inherited);
    }

    #[test]
    fn test_resolve_effective_gpos_block_inheritance() {
        let names = std::collections::HashMap::new();

        let chain = vec![
            (
                "DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={AAA},CN=P;0]".to_string()),
                None,
            ),
            (
                "OU=Users,DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={BBB},CN=P;0]".to_string()),
                Some("1".to_string()), // blocks inheritance
            ),
        ];

        let (links, blocks) = resolve_effective_gpos(&chain, &names);
        assert!(blocks);
        // AAA is blocked (non-enforced from parent), only BBB remains
        assert_eq!(links.len(), 1);
        assert!(links[0].gpo_dn.contains("{BBB}"));
    }

    #[test]
    fn test_resolve_effective_gpos_enforced_survives_block() {
        let names = std::collections::HashMap::new();

        let chain = vec![
            (
                "DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={AAA},CN=P;2]".to_string()), // enforced
                None,
            ),
            (
                "OU=Users,DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={BBB},CN=P;0]".to_string()),
                Some("1".to_string()), // blocks inheritance
            ),
        ];

        let (links, blocks) = resolve_effective_gpos(&chain, &names);
        assert!(blocks);
        // AAA is enforced, so it survives block inheritance
        assert_eq!(links.len(), 2);
        assert!(links[0].is_enforced);
        assert!(links[0].gpo_dn.contains("{AAA}"));
    }

    #[test]
    fn test_resolve_effective_gpos_disabled_skipped() {
        let names = std::collections::HashMap::new();

        let chain = vec![(
            "DC=contoso,DC=com".to_string(),
            Some("[LDAP://CN={AAA},CN=P;0][LDAP://CN={BBB},CN=P;1]".to_string()),
            None,
        )];

        let (links, _) = resolve_effective_gpos(&chain, &names);
        assert_eq!(links.len(), 1); // BBB is disabled
        assert!(links[0].gpo_dn.contains("{AAA}"));
    }

    #[test]
    fn test_resolve_effective_gpos_inheritance() {
        let names = std::collections::HashMap::new();

        let chain = vec![
            (
                "DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={AAA},CN=P;0]".to_string()),
                None,
            ),
            (
                "OU=Users,DC=contoso,DC=com".to_string(),
                Some("[LDAP://CN={BBB},CN=P;0]".to_string()),
                None,
            ),
        ];

        let (links, _) = resolve_effective_gpos(&chain, &names);
        assert_eq!(links.len(), 2);
        // AAA is inherited, BBB is direct
        let aaa = links.iter().find(|l| l.gpo_dn.contains("{AAA}")).unwrap();
        let bbb = links.iter().find(|l| l.gpo_dn.contains("{BBB}")).unwrap();
        assert!(aaa.is_inherited);
        assert!(!bbb.is_inherited);
    }
}
