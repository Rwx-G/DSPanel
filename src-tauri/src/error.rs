use serde::Serialize;

/// Application-level error type for Tauri command results.
///
/// All Tauri commands return `Result<T, AppError>`. The error is serialized
/// to the frontend as a JSON string via the `Into<tauri::ipc::InvokeError>` impl.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Directory error: {0}")]
    Directory(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Serializable error response sent to the frontend.
#[derive(Debug, Serialize)]
struct ErrorResponse {
    kind: String,
    message: String,
}

impl From<AppError> for ErrorResponse {
    fn from(err: AppError) -> Self {
        let kind = match &err {
            AppError::Directory(_) => "directory",
            AppError::Network(_) => "network",
            AppError::PermissionDenied(_) => "permission_denied",
            AppError::Configuration(_) => "configuration",
            AppError::Internal(_) => "internal",
        };
        ErrorResponse {
            kind: kind.to_string(),
            message: err.to_string(),
        }
    }
}

impl From<AppError> for tauri::ipc::InvokeError {
    fn from(err: AppError) -> Self {
        let response = ErrorResponse::from(err);
        tauri::ipc::InvokeError::from(
            serde_json::to_string(&response).unwrap_or_else(|_| response.message.clone()),
        )
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_error_directory_display() {
        let err = AppError::Directory("LDAP connection failed".to_string());
        assert_eq!(err.to_string(), "Directory error: LDAP connection failed");
    }

    #[test]
    fn test_app_error_network_display() {
        let err = AppError::Network("timeout".to_string());
        assert_eq!(err.to_string(), "Network error: timeout");
    }

    #[test]
    fn test_app_error_permission_denied_display() {
        let err = AppError::PermissionDenied("requires DomainAdmin".to_string());
        assert_eq!(
            err.to_string(),
            "Permission denied: requires DomainAdmin"
        );
    }

    #[test]
    fn test_app_error_configuration_display() {
        let err = AppError::Configuration("missing config file".to_string());
        assert_eq!(
            err.to_string(),
            "Configuration error: missing config file"
        );
    }

    #[test]
    fn test_app_error_internal_display() {
        let err = AppError::Internal("unexpected".to_string());
        assert_eq!(err.to_string(), "Internal error: unexpected");
    }

    #[test]
    fn test_error_response_from_directory_error() {
        let err = AppError::Directory("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "directory");
        assert_eq!(response.message, "Directory error: test");
    }

    #[test]
    fn test_error_response_from_network_error() {
        let err = AppError::Network("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "network");
    }

    #[test]
    fn test_error_response_from_permission_denied() {
        let err = AppError::PermissionDenied("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "permission_denied");
    }

    #[test]
    fn test_error_response_from_configuration_error() {
        let err = AppError::Configuration("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "configuration");
    }

    #[test]
    fn test_error_response_from_internal_error() {
        let err = AppError::Internal("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "internal");
    }

    #[test]
    fn test_from_anyhow_error() {
        let anyhow_err = anyhow::anyhow!("something went wrong");
        let app_err = AppError::from(anyhow_err);
        assert!(matches!(app_err, AppError::Internal(_)));
        assert!(app_err.to_string().contains("something went wrong"));
    }

    #[test]
    fn test_invoke_error_conversion_does_not_panic() {
        let err = AppError::Directory("test error".to_string());
        let _invoke_err: tauri::ipc::InvokeError = err.into();
        // Verify conversion completes without panic.
        // InvokeError wraps a serde_json::Value internally.
    }
}
