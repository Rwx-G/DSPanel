use crate::services::ntfs::{AceAccessType, AceEntry};
use serde::Serialize;

/// Result of a recursive NTFS analysis.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NtfsAnalysisResult {
    pub paths: Vec<PathAclResult>,
    pub conflicts: Vec<AclConflict>,
    pub total_aces: usize,
    pub total_paths_scanned: usize,
    pub total_errors: usize,
}

/// ACL result for a single path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathAclResult {
    pub path: String,
    pub aces: Vec<AceEntry>,
    pub error: Option<String>,
}

/// A conflict between allow and deny ACEs for the same trustee.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AclConflict {
    pub trustee_sid: String,
    pub trustee_display_name: String,
    pub allow_path: String,
    pub deny_path: String,
    pub allow_permissions: Vec<String>,
    pub deny_permissions: Vec<String>,
}

/// Detects conflicts between allow and deny ACEs across paths.
///
/// A conflict exists when the same trustee has Allow ACEs at one path
/// and Deny ACEs at another path (parent/child or vice versa).
pub fn detect_conflicts(path_results: &[PathAclResult]) -> Vec<AclConflict> {
    let mut conflicts = Vec::new();

    // Collect all ACEs with their paths
    let mut allows: Vec<(&str, &AceEntry)> = Vec::new();
    let mut denies: Vec<(&str, &AceEntry)> = Vec::new();

    for pr in path_results {
        for ace in &pr.aces {
            match ace.access_type {
                AceAccessType::Allow => allows.push((&pr.path, ace)),
                AceAccessType::Deny => denies.push((&pr.path, ace)),
            }
        }
    }

    // Find conflicts: same trustee has both allow and deny
    for (allow_path, allow_ace) in &allows {
        for (deny_path, deny_ace) in &denies {
            if allow_ace.trustee_sid.to_lowercase() == deny_ace.trustee_sid.to_lowercase()
                && allow_path != deny_path
            {
                // Check if permissions overlap
                let overlap: Vec<String> = allow_ace
                    .permissions
                    .iter()
                    .filter(|p| deny_ace.permissions.contains(p))
                    .cloned()
                    .collect();

                if !overlap.is_empty() {
                    let conflict = AclConflict {
                        trustee_sid: allow_ace.trustee_sid.clone(),
                        trustee_display_name: allow_ace.trustee_display_name.clone(),
                        allow_path: allow_path.to_string(),
                        deny_path: deny_path.to_string(),
                        allow_permissions: allow_ace.permissions.clone(),
                        deny_permissions: deny_ace.permissions.clone(),
                    };
                    // Avoid duplicates
                    if !conflicts.contains(&conflict) {
                        conflicts.push(conflict);
                    }
                }
            }
        }
    }

    conflicts
}

/// Recursively enumerates directories up to the specified depth.
///
/// Returns a list of directory paths. Errors on individual directories
/// are captured but do not abort the scan.
#[cfg(windows)]
pub fn enumerate_directories(base_path: &str, max_depth: usize) -> Vec<Result<String, String>> {
    let mut results = vec![Ok(base_path.to_string())];

    if max_depth == 0 {
        return results;
    }

    fn recurse(
        path: &str,
        depth: usize,
        max_depth: usize,
        results: &mut Vec<Result<String, String>>,
    ) {
        if depth >= max_depth {
            return;
        }
        match std::fs::read_dir(path) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(e) => {
                            if let Ok(ft) = e.file_type() {
                                if ft.is_dir() {
                                    let dir_path = e.path().to_string_lossy().to_string();
                                    results.push(Ok(dir_path.clone()));
                                    recurse(&dir_path, depth + 1, max_depth, results);
                                }
                            }
                        }
                        Err(e) => {
                            results.push(Err(format!("Error reading entry in {}: {}", path, e)));
                        }
                    }
                }
            }
            Err(e) => {
                results.push(Err(format!("Cannot read directory {}: {}", path, e)));
            }
        }
    }

    recurse(base_path, 0, max_depth, &mut results);
    results
}

#[cfg(not(windows))]
pub fn enumerate_directories(base_path: &str, _max_depth: usize) -> Vec<Result<String, String>> {
    vec![Ok(base_path.to_string())]
}

/// Performs a full NTFS analysis with demo data.
#[cfg(feature = "demo")]
pub fn analyze(base_path: &str, max_depth: usize) -> NtfsAnalysisResult {
    // Generate fake subdirectories
    let mut dir_paths = vec![base_path.to_string()];
    if max_depth >= 1 {
        dir_paths.push(format!("{}\\Documents", base_path));
        dir_paths.push(format!("{}\\Projects", base_path));
        dir_paths.push(format!("{}\\Shared", base_path));
    }
    if max_depth >= 2 {
        dir_paths.push(format!("{}\\Projects\\Alpha", base_path));
        dir_paths.push(format!("{}\\Projects\\Beta", base_path));
        dir_paths.push(format!("{}\\Shared\\Reports", base_path));
    }

    let mut paths = Vec::new();
    let mut total_aces = 0;

    for path in &dir_paths {
        let aces = crate::services::ntfs::read_acl_demo(path);
        total_aces += aces.len();
        paths.push(PathAclResult {
            path: path.clone(),
            aces,
            error: None,
        });
    }

    let conflicts = detect_conflicts(&paths);
    let total_paths_scanned = dir_paths.len();

    NtfsAnalysisResult {
        paths,
        conflicts,
        total_aces,
        total_paths_scanned,
        total_errors: 0,
    }
}

/// Performs a full NTFS analysis: scan paths, read ACLs, detect conflicts.
#[cfg(not(feature = "demo"))]
pub fn analyze(base_path: &str, max_depth: usize) -> NtfsAnalysisResult {
    let dir_results = enumerate_directories(base_path, max_depth);
    let mut paths = Vec::new();
    let mut total_aces = 0;
    let mut total_errors = 0;

    for dir_result in &dir_results {
        match dir_result {
            Ok(path) => match crate::services::ntfs::read_acl(path) {
                Ok(aces) => {
                    total_aces += aces.len();
                    paths.push(PathAclResult {
                        path: path.clone(),
                        aces,
                        error: None,
                    });
                }
                Err(e) => {
                    total_errors += 1;
                    paths.push(PathAclResult {
                        path: path.clone(),
                        aces: vec![],
                        error: Some(e),
                    });
                }
            },
            Err(e) => {
                total_errors += 1;
                paths.push(PathAclResult {
                    path: String::new(),
                    aces: vec![],
                    error: Some(e.clone()),
                });
            }
        }
    }

    let conflicts = detect_conflicts(&paths);
    let total_paths_scanned = dir_results.len();

    NtfsAnalysisResult {
        paths,
        conflicts,
        total_aces,
        total_paths_scanned,
        total_errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ace(
        sid: &str,
        name: &str,
        access: AceAccessType,
        perms: Vec<&str>,
        inherited: bool,
    ) -> AceEntry {
        AceEntry {
            trustee_sid: sid.to_string(),
            trustee_display_name: name.to_string(),
            access_type: access,
            permissions: perms.iter().map(|p| p.to_string()).collect(),
            is_inherited: inherited,
        }
    }

    #[test]
    fn test_detect_conflicts_finds_overlap() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read", "Write"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\subfolder".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Write"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].trustee_sid, "S-1-5-21-100");
        assert_eq!(conflicts[0].allow_path, "\\\\server\\share");
        assert_eq!(conflicts[0].deny_path, "\\\\server\\share\\subfolder");
    }

    #[test]
    fn test_detect_conflicts_no_conflict_different_trustees() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-200",
                    "Users",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_detect_conflicts_same_path_no_conflict() {
        let paths = vec![PathAclResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![
                make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                ),
                make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                ),
            ],
            error: None,
        }];

        let conflicts = detect_conflicts(&paths);
        // Same path doesn't count as parent/child conflict
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_detect_conflicts_no_permission_overlap() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Write"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_detect_conflicts_case_insensitive_sid() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-ABC",
                    "Group",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "s-1-5-21-abc",
                    "Group",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
    }

    #[test]
    fn test_detect_conflicts_empty() {
        let conflicts = detect_conflicts(&[]);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_analysis_result_serialization() {
        let result = NtfsAnalysisResult {
            paths: vec![],
            conflicts: vec![],
            total_aces: 0,
            total_paths_scanned: 0,
            total_errors: 0,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("totalAces"));
        assert!(json.contains("totalPathsScanned"));
        assert!(json.contains("totalErrors"));
        assert!(json.contains("conflicts"));
    }

    #[test]
    fn test_path_acl_result_with_error() {
        let result = PathAclResult {
            path: "\\\\server\\denied".to_string(),
            aces: vec![],
            error: Some("Access denied".to_string()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Access denied"));
    }

    #[test]
    fn test_conflict_serialization() {
        let conflict = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\share".to_string(),
            deny_path: "\\\\server\\share\\sub".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let json = serde_json::to_string(&conflict).unwrap();
        assert!(json.contains("trusteeSid"));
        assert!(json.contains("allowPath"));
        assert!(json.contains("denyPath"));
    }

    #[cfg(not(windows))]
    #[test]
    fn test_enumerate_directories_non_windows() {
        let results = enumerate_directories("\\\\server\\share", 3);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].as_ref().unwrap(), "\\\\server\\share");
    }

    // -----------------------------------------------------------------------
    // Multiple conflicts - same trustee across many paths
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_multiple_paths_same_trustee() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share\\dir1".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read", "Write"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\dir2".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\dir3".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Write"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        // dir1 Allow vs dir2 Deny (overlap: Read)
        // dir1 Allow vs dir3 Deny (overlap: Write)
        assert_eq!(conflicts.len(), 2);
    }

    // -----------------------------------------------------------------------
    // Duplicate conflict deduplication
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_deduplicates() {
        // Two identical Allow ACEs at the same path should not produce duplicate conflicts
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![
                    make_ace(
                        "S-1-5-21-100",
                        "Admins",
                        AceAccessType::Allow,
                        vec!["Read"],
                        false,
                    ),
                    make_ace(
                        "S-1-5-21-100",
                        "Admins",
                        AceAccessType::Allow,
                        vec!["Read"],
                        true,
                    ),
                ],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        // Two Allow ACEs at path1 both match the single Deny at path2
        // but conflict struct is identical so only 1 should remain
        assert_eq!(conflicts.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Only allow ACEs - no conflicts
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_only_allows() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-200",
                    "Users",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    // -----------------------------------------------------------------------
    // Only deny ACEs - no conflicts
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_only_denies() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Write"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    // -----------------------------------------------------------------------
    // Multiple ACEs per path
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_multiple_aces_per_path() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![
                    make_ace(
                        "S-1-5-21-100",
                        "Admins",
                        AceAccessType::Allow,
                        vec!["Read"],
                        false,
                    ),
                    make_ace(
                        "S-1-5-21-200",
                        "Users",
                        AceAccessType::Allow,
                        vec!["Write"],
                        true,
                    ),
                ],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![
                    make_ace(
                        "S-1-5-21-100",
                        "Admins",
                        AceAccessType::Deny,
                        vec!["Read"],
                        false,
                    ),
                    make_ace(
                        "S-1-5-21-200",
                        "Users",
                        AceAccessType::Deny,
                        vec!["Write"],
                        false,
                    ),
                ],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        // Admins: Allow Read vs Deny Read = conflict
        // Users: Allow Write vs Deny Write = conflict
        assert_eq!(conflicts.len(), 2);
    }

    // -----------------------------------------------------------------------
    // Path with error field - no ACEs
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_path_with_error_no_aces() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\denied".to_string(),
                aces: vec![],
                error: Some("Access denied".to_string()),
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    // -----------------------------------------------------------------------
    // NtfsAnalysisResult construction
    // -----------------------------------------------------------------------

    #[test]
    fn test_ntfs_analysis_result_with_data() {
        let result = NtfsAnalysisResult {
            paths: vec![PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["FullControl"],
                    false,
                )],
                error: None,
            }],
            conflicts: vec![],
            total_aces: 1,
            total_paths_scanned: 1,
            total_errors: 0,
        };
        assert_eq!(result.total_aces, 1);
        assert_eq!(result.total_paths_scanned, 1);
        assert_eq!(result.total_errors, 0);
        assert_eq!(result.paths.len(), 1);
        assert!(result.conflicts.is_empty());
    }

    #[test]
    fn test_ntfs_analysis_result_with_errors() {
        let result = NtfsAnalysisResult {
            paths: vec![PathAclResult {
                path: String::new(),
                aces: vec![],
                error: Some("Cannot read directory".to_string()),
            }],
            conflicts: vec![],
            total_aces: 0,
            total_paths_scanned: 1,
            total_errors: 1,
        };
        assert_eq!(result.total_errors, 1);
        assert!(result.paths[0].error.is_some());
    }

    // -----------------------------------------------------------------------
    // Inherited vs explicit ACEs - detect_conflicts is ACE-type agnostic
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_inherited_aces_also_conflict() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    true, // inherited
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Read"],
                    false, // explicit
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Single path with no ACEs
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_single_path_empty_aces() {
        let paths = vec![PathAclResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![],
            error: None,
        }];
        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    // -----------------------------------------------------------------------
    // Conflict fields correctness
    // -----------------------------------------------------------------------

    #[test]
    fn test_conflict_contains_correct_permissions() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\root".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-300",
                    "Finance",
                    AceAccessType::Allow,
                    vec!["Read", "Write", "Execute"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\root\\child".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-300",
                    "Finance",
                    AceAccessType::Deny,
                    vec!["Write", "Delete"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
        // allow_permissions should be the full allow list
        assert_eq!(
            conflicts[0].allow_permissions,
            vec!["Read", "Write", "Execute"]
        );
        // deny_permissions should be the full deny list
        assert_eq!(conflicts[0].deny_permissions, vec!["Write", "Delete"]);
        assert_eq!(conflicts[0].trustee_display_name, "Finance");
    }

    // -----------------------------------------------------------------------
    // PathAclResult serialization camelCase
    // -----------------------------------------------------------------------

    #[test]
    fn test_path_acl_result_serialization_camel_case() {
        let result = PathAclResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![make_ace(
                "S-1-5-21-100",
                "Group",
                AceAccessType::Allow,
                vec!["Read"],
                true,
            )],
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        // Check that fields are camelCase or at least present
        assert!(json.contains("\"path\""));
        assert!(json.contains("\"aces\""));
    }

    // -----------------------------------------------------------------------
    // AclConflict equality (used for dedup)
    // -----------------------------------------------------------------------

    #[test]
    fn test_acl_conflict_equality() {
        let c1 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let c2 = c1.clone();
        assert_eq!(c1, c2);
    }

    #[test]
    fn test_acl_conflict_inequality() {
        let c1 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let c2 = AclConflict {
            trustee_sid: "S-1-5-21-200".to_string(),
            trustee_display_name: "Users".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        assert_ne!(c1, c2);
    }

    // -----------------------------------------------------------------------
    // detect_conflicts - many trustees across many paths
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_three_trustees_partial_overlap() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\dir1".to_string(),
                aces: vec![
                    make_ace(
                        "S-1-5-21-100",
                        "GroupA",
                        AceAccessType::Allow,
                        vec!["Read", "Write"],
                        false,
                    ),
                    make_ace(
                        "S-1-5-21-200",
                        "GroupB",
                        AceAccessType::Allow,
                        vec!["Execute"],
                        false,
                    ),
                ],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\dir2".to_string(),
                aces: vec![
                    make_ace(
                        "S-1-5-21-100",
                        "GroupA",
                        AceAccessType::Deny,
                        vec!["Write"],
                        false,
                    ),
                    make_ace(
                        "S-1-5-21-300",
                        "GroupC",
                        AceAccessType::Deny,
                        vec!["Read"],
                        false,
                    ),
                ],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        // Only GroupA has Allow at dir1 and Deny at dir2 with overlap (Write)
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].trustee_sid, "S-1-5-21-100");
    }

    // -----------------------------------------------------------------------
    // detect_conflicts - reverse direction (deny at parent, allow at child)
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_deny_parent_allow_child() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Deny,
                    vec!["Write"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\share\\sub".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Write", "Read"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
        // Reversed direction: allow is at child, deny is at parent
        assert_eq!(conflicts[0].allow_path, "\\\\server\\share\\sub");
        assert_eq!(conflicts[0].deny_path, "\\\\server\\share");
    }

    // -----------------------------------------------------------------------
    // detect_conflicts - many permissions partial overlap
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_multi_permission_partial_overlap() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\a".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Group",
                    AceAccessType::Allow,
                    vec!["Read", "Write", "Execute", "Delete"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\b".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Group",
                    AceAccessType::Deny,
                    vec!["Delete", "TakeOwnership"],
                    false,
                )],
                error: None,
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
        // Overlap on "Delete"
        assert_eq!(
            conflicts[0].allow_permissions,
            vec!["Read", "Write", "Execute", "Delete"]
        );
        assert_eq!(
            conflicts[0].deny_permissions,
            vec!["Delete", "TakeOwnership"]
        );
    }

    // -----------------------------------------------------------------------
    // NtfsAnalysisResult - full serialization with data
    // -----------------------------------------------------------------------

    #[test]
    fn test_ntfs_analysis_result_full_serialization() {
        let result = NtfsAnalysisResult {
            paths: vec![PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Group",
                    AceAccessType::Allow,
                    vec!["Read"],
                    true,
                )],
                error: None,
            }],
            conflicts: vec![AclConflict {
                trustee_sid: "S-1-5-21-100".to_string(),
                trustee_display_name: "Group".to_string(),
                allow_path: "\\\\server\\a".to_string(),
                deny_path: "\\\\server\\b".to_string(),
                allow_permissions: vec!["Read".to_string()],
                deny_permissions: vec!["Read".to_string()],
            }],
            total_aces: 1,
            total_paths_scanned: 1,
            total_errors: 0,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"totalAces\":1"));
        assert!(json.contains("\"totalPathsScanned\":1"));
        assert!(json.contains("\"totalErrors\":0"));
        assert!(json.contains("trusteeSid"));
        assert!(json.contains("allowPermissions"));
        assert!(json.contains("denyPermissions"));
    }

    // -----------------------------------------------------------------------
    // PathAclResult - serialization with ACE data
    // -----------------------------------------------------------------------

    #[test]
    fn test_path_acl_result_serialization_with_multiple_aces() {
        let result = PathAclResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![
                make_ace(
                    "S-1-5-21-100",
                    "Admins",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                ),
                make_ace(
                    "S-1-5-21-200",
                    "Users",
                    AceAccessType::Deny,
                    vec!["Write"],
                    true,
                ),
            ],
            error: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("S-1-5-21-100"));
        assert!(json.contains("S-1-5-21-200"));
        assert!(json.contains("\"error\":null"));
    }

    // -----------------------------------------------------------------------
    // detect_conflicts - large number of paths
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_many_paths_no_conflict() {
        let paths: Vec<PathAclResult> = (0..20)
            .map(|i| PathAclResult {
                path: format!("\\\\server\\dir{}", i),
                aces: vec![make_ace(
                    &format!("S-1-5-21-{}", i),
                    &format!("Group{}", i),
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            })
            .collect();

        let conflicts = detect_conflicts(&paths);
        // Each path has a unique trustee, so no conflicts
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_detect_conflicts_many_paths_with_single_conflict() {
        let mut paths: Vec<PathAclResult> = (0..10)
            .map(|i| PathAclResult {
                path: format!("\\\\server\\dir{}", i),
                aces: vec![make_ace(
                    &format!("S-1-5-21-{}", i),
                    &format!("Group{}", i),
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            })
            .collect();
        // Add a deny for the first trustee at a different path
        paths.push(PathAclResult {
            path: "\\\\server\\conflict".to_string(),
            aces: vec![make_ace(
                "S-1-5-21-0",
                "Group0",
                AceAccessType::Deny,
                vec!["Read"],
                false,
            )],
            error: None,
        });

        let conflicts = detect_conflicts(&paths);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].trustee_sid, "S-1-5-21-0");
    }

    // -----------------------------------------------------------------------
    // AclConflict - field-level inequality checks
    // -----------------------------------------------------------------------

    #[test]
    fn test_acl_conflict_inequality_different_paths() {
        let c1 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let c2 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\c".to_string(),
            deny_path: "\\\\server\\d".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        assert_ne!(c1, c2);
    }

    #[test]
    fn test_acl_conflict_inequality_different_permissions() {
        let c1 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let c2 = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Write".to_string()],
            deny_permissions: vec!["Write".to_string()],
        };
        assert_ne!(c1, c2);
    }

    // -----------------------------------------------------------------------
    // detect_conflicts - empty ACEs on some paths
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_conflicts_mixed_empty_and_populated_aces() {
        let paths = vec![
            PathAclResult {
                path: "\\\\server\\empty1".to_string(),
                aces: vec![],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\populated".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "Group",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            },
            PathAclResult {
                path: "\\\\server\\empty2".to_string(),
                aces: vec![],
                error: Some("Access denied".to_string()),
            },
        ];

        let conflicts = detect_conflicts(&paths);
        assert!(conflicts.is_empty());
    }

    // -----------------------------------------------------------------------
    // NtfsAnalysisResult - Debug trait
    // -----------------------------------------------------------------------

    #[test]
    fn test_ntfs_analysis_result_debug() {
        let result = NtfsAnalysisResult {
            paths: vec![],
            conflicts: vec![],
            total_aces: 0,
            total_paths_scanned: 0,
            total_errors: 0,
        };
        let debug_str = format!("{:?}", result);
        assert!(debug_str.contains("NtfsAnalysisResult"));
    }

    #[test]
    fn test_path_acl_result_debug() {
        let result = PathAclResult {
            path: "\\\\server\\share".to_string(),
            aces: vec![],
            error: None,
        };
        let debug_str = format!("{:?}", result);
        assert!(debug_str.contains("PathAclResult"));
    }

    #[test]
    fn test_acl_conflict_debug() {
        let conflict = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let debug_str = format!("{:?}", conflict);
        assert!(debug_str.contains("AclConflict"));
        assert!(debug_str.contains("S-1-5-21-100"));
    }

    // -----------------------------------------------------------------------
    // NtfsAnalysisResult and PathAclResult - Clone trait
    // -----------------------------------------------------------------------

    #[test]
    fn test_ntfs_analysis_result_clone() {
        let result = NtfsAnalysisResult {
            paths: vec![PathAclResult {
                path: "\\\\server\\share".to_string(),
                aces: vec![make_ace(
                    "S-1-5-21-100",
                    "G",
                    AceAccessType::Allow,
                    vec!["Read"],
                    false,
                )],
                error: None,
            }],
            conflicts: vec![],
            total_aces: 1,
            total_paths_scanned: 1,
            total_errors: 0,
        };
        let cloned = result.clone();
        assert_eq!(cloned.total_aces, result.total_aces);
        assert_eq!(cloned.paths.len(), result.paths.len());
        assert_eq!(cloned.paths[0].path, result.paths[0].path);
    }

    #[test]
    fn test_acl_conflict_clone() {
        let conflict = AclConflict {
            trustee_sid: "S-1-5-21-100".to_string(),
            trustee_display_name: "Admins".to_string(),
            allow_path: "\\\\server\\a".to_string(),
            deny_path: "\\\\server\\b".to_string(),
            allow_permissions: vec!["Read".to_string(), "Write".to_string()],
            deny_permissions: vec!["Read".to_string()],
        };
        let cloned = conflict.clone();
        assert_eq!(cloned, conflict);
        assert_eq!(cloned.allow_permissions.len(), 2);
    }
}
