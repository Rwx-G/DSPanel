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

/// Performs a full NTFS analysis: scan paths, read ACLs, detect conflicts.
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
}
