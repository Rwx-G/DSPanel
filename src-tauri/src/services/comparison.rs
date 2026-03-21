use serde::Serialize;

/// Result of comparing two users' group memberships.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupComparisonResult {
    pub shared_groups: Vec<String>,
    pub only_a_groups: Vec<String>,
    pub only_b_groups: Vec<String>,
    pub total_a: usize,
    pub total_b: usize,
}

/// Computes the group membership delta between two users.
///
/// Group DNs are compared case-insensitively. Returns three sets:
/// shared (in both), only-A (in A but not B), only-B (in B but not A).
pub fn compute_group_diff(groups_a: &[String], groups_b: &[String]) -> GroupComparisonResult {
    let set_a: std::collections::HashSet<String> =
        groups_a.iter().map(|g| g.to_lowercase()).collect();
    let set_b: std::collections::HashSet<String> =
        groups_b.iter().map(|g| g.to_lowercase()).collect();

    let shared_lower: std::collections::HashSet<&String> = set_a.intersection(&set_b).collect();

    // Preserve original casing from groups_a for shared and only-A
    let mut shared_groups: Vec<String> = groups_a
        .iter()
        .filter(|g| shared_lower.contains(&g.to_lowercase()))
        .cloned()
        .collect();
    shared_groups.sort_by_key(|a| a.to_lowercase());

    let mut only_a_groups: Vec<String> = groups_a
        .iter()
        .filter(|g| !set_b.contains(&g.to_lowercase()))
        .cloned()
        .collect();
    only_a_groups.sort_by_key(|a| a.to_lowercase());

    // Preserve original casing from groups_b for only-B
    let mut only_b_groups: Vec<String> = groups_b
        .iter()
        .filter(|g| !set_a.contains(&g.to_lowercase()))
        .cloned()
        .collect();
    only_b_groups.sort_by_key(|a| a.to_lowercase());

    GroupComparisonResult {
        total_a: groups_a.len(),
        total_b: groups_b.len(),
        shared_groups,
        only_a_groups,
        only_b_groups,
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_with_overlapping_memberships() {
        let groups_a = vec![
            "CN=Group1,DC=example,DC=com".to_string(),
            "CN=Group2,DC=example,DC=com".to_string(),
            "CN=Group3,DC=example,DC=com".to_string(),
        ];
        let groups_b = vec![
            "CN=Group2,DC=example,DC=com".to_string(),
            "CN=Group3,DC=example,DC=com".to_string(),
            "CN=Group4,DC=example,DC=com".to_string(),
        ];

        let result = compute_group_diff(&groups_a, &groups_b);

        assert_eq!(result.shared_groups.len(), 2);
        assert!(result
            .shared_groups
            .contains(&"CN=Group2,DC=example,DC=com".to_string()));
        assert!(result
            .shared_groups
            .contains(&"CN=Group3,DC=example,DC=com".to_string()));
        assert_eq!(result.only_a_groups, vec!["CN=Group1,DC=example,DC=com"]);
        assert_eq!(result.only_b_groups, vec!["CN=Group4,DC=example,DC=com"]);
        assert_eq!(result.total_a, 3);
        assert_eq!(result.total_b, 3);
    }

    #[test]
    fn test_diff_with_no_overlap() {
        let groups_a = vec!["CN=GroupA,DC=example,DC=com".to_string()];
        let groups_b = vec!["CN=GroupB,DC=example,DC=com".to_string()];

        let result = compute_group_diff(&groups_a, &groups_b);

        assert!(result.shared_groups.is_empty());
        assert_eq!(result.only_a_groups.len(), 1);
        assert_eq!(result.only_b_groups.len(), 1);
    }

    #[test]
    fn test_diff_with_identical_memberships() {
        let groups = vec![
            "CN=Group1,DC=example,DC=com".to_string(),
            "CN=Group2,DC=example,DC=com".to_string(),
        ];

        let result = compute_group_diff(&groups, &groups);

        assert_eq!(result.shared_groups.len(), 2);
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
    }

    #[test]
    fn test_diff_with_empty_groups() {
        let empty: Vec<String> = vec![];
        let groups = vec!["CN=Group1,DC=example,DC=com".to_string()];

        let result = compute_group_diff(&empty, &groups);
        assert!(result.shared_groups.is_empty());
        assert!(result.only_a_groups.is_empty());
        assert_eq!(result.only_b_groups.len(), 1);

        let result2 = compute_group_diff(&groups, &empty);
        assert!(result2.shared_groups.is_empty());
        assert_eq!(result2.only_a_groups.len(), 1);
        assert!(result2.only_b_groups.is_empty());
    }

    #[test]
    fn test_diff_both_empty() {
        let empty: Vec<String> = vec![];
        let result = compute_group_diff(&empty, &empty);
        assert!(result.shared_groups.is_empty());
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
        assert_eq!(result.total_a, 0);
        assert_eq!(result.total_b, 0);
    }

    #[test]
    fn test_diff_case_insensitive() {
        let groups_a = vec!["CN=Group1,DC=EXAMPLE,DC=COM".to_string()];
        let groups_b = vec!["cn=group1,dc=example,dc=com".to_string()];

        let result = compute_group_diff(&groups_a, &groups_b);

        assert_eq!(result.shared_groups.len(), 1);
        // Preserves original casing from groups_a
        assert_eq!(result.shared_groups[0], "CN=Group1,DC=EXAMPLE,DC=COM");
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
    }

    #[test]
    fn test_diff_sorted_output() {
        let groups_a = vec![
            "CN=Zebra,DC=example,DC=com".to_string(),
            "CN=Alpha,DC=example,DC=com".to_string(),
            "CN=Middle,DC=example,DC=com".to_string(),
        ];
        let groups_b: Vec<String> = vec![];

        let result = compute_group_diff(&groups_a, &groups_b);

        assert_eq!(result.only_a_groups[0], "CN=Alpha,DC=example,DC=com");
        assert_eq!(result.only_a_groups[1], "CN=Middle,DC=example,DC=com");
        assert_eq!(result.only_a_groups[2], "CN=Zebra,DC=example,DC=com");
    }

    #[test]
    fn test_diff_summary_counts() {
        let groups_a = vec![
            "CN=G1,DC=example,DC=com".to_string(),
            "CN=G2,DC=example,DC=com".to_string(),
            "CN=G3,DC=example,DC=com".to_string(),
        ];
        let groups_b = vec![
            "CN=G2,DC=example,DC=com".to_string(),
            "CN=G4,DC=example,DC=com".to_string(),
        ];

        let result = compute_group_diff(&groups_a, &groups_b);

        assert_eq!(result.shared_groups.len(), 1);
        assert_eq!(result.only_a_groups.len(), 2);
        assert_eq!(result.only_b_groups.len(), 1);
        assert_eq!(result.total_a, 3);
        assert_eq!(result.total_b, 2);
    }

    #[test]
    fn test_serialization() {
        let result = GroupComparisonResult {
            shared_groups: vec!["CN=G1,DC=example,DC=com".to_string()],
            only_a_groups: vec![],
            only_b_groups: vec![],
            total_a: 1,
            total_b: 1,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("sharedGroups"));
        assert!(json.contains("onlyAGroups"));
        assert!(json.contains("onlyBGroups"));
        assert!(json.contains("totalA"));
        assert!(json.contains("totalB"));
    }

    #[test]
    fn test_diff_duplicate_groups_in_input() {
        let groups_a = vec![
            "CN=Group1,DC=example,DC=com".to_string(),
            "CN=Group1,DC=example,DC=com".to_string(),
        ];
        let groups_b = vec!["CN=Group1,DC=example,DC=com".to_string()];

        let result = compute_group_diff(&groups_a, &groups_b);
        // Both duplicates from A match B, so both appear in shared
        assert_eq!(result.shared_groups.len(), 2);
        assert!(result.only_a_groups.is_empty());
        assert!(result.only_b_groups.is_empty());
    }
}
