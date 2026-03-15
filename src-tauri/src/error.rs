use serde::Serialize;

/// Application-level error type for Tauri command results.
///
/// All Tauri commands return `Result<T, AppError>`. The error is serialized
/// to the frontend as a JSON string via the `Into<tauri::ipc::InvokeError>` impl.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Directory error: {0}")]
    Directory(String),

    #[error("{0}")]
    DirectoryTyped(#[from] DirectoryError),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Circuit breaker open: service temporarily unavailable")]
    CircuitBreakerOpen,
}

/// Serializable error response sent to the frontend.
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub kind: String,
    pub message: String,
    pub user_message: String,
    pub retryable: bool,
}

impl From<AppError> for ErrorResponse {
    fn from(err: AppError) -> Self {
        let (kind, retryable, user_message) = match &err {
            AppError::Directory(_) => ("directory", false, "A directory operation failed. Please try again.".to_string()),
            AppError::DirectoryTyped(dir_err) => (
                "directory",
                dir_err.is_transient(),
                dir_err.user_message(),
            ),
            AppError::Network(_) => ("network", true, "A network error occurred. Please check your connection.".to_string()),
            AppError::PermissionDenied(_) => ("permission_denied", false, "You do not have permission to perform this action.".to_string()),
            AppError::Configuration(_) => ("configuration", false, "A configuration error occurred.".to_string()),
            AppError::Validation(msg) => ("validation", false, msg.clone()),
            AppError::Internal(_) => ("internal", false, "An unexpected error occurred.".to_string()),
            AppError::CircuitBreakerOpen => ("circuit_breaker", true, "The directory service is temporarily unavailable. Please wait a moment and try again.".to_string()),
        };
        ErrorResponse {
            kind: kind.to_string(),
            message: err.to_string(),
            user_message,
            retryable,
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

/// Typed directory errors with LDAP error code classification.
///
/// Each variant maps to a specific LDAP result code or error condition.
/// Use `is_transient()` to determine if the error is retryable.
#[derive(Debug, thiserror::Error)]
pub enum DirectoryError {
    #[error("LDAP server unavailable (code 52)")]
    Unavailable,

    #[error("LDAP server busy (code 51)")]
    Busy,

    #[error("LDAP operation timed out (code 85)")]
    Timeout,

    #[error("LDAP server down (code 81)")]
    ServerDown,

    #[error("LDAP connection error (code 91)")]
    ConnectError,

    #[error("Insufficient rights: {0}")]
    InsufficientRights(String),

    #[error("Object not found: {0}")]
    NoSuchObject(String),

    #[error("Constraint violation: {0}")]
    ConstraintViolation(String),

    #[error("Connection lost")]
    ConnectionLost,

    #[error("Not domain-joined")]
    NotDomainJoined,

    #[error("{0}")]
    Other(String),
}

impl DirectoryError {
    /// Returns true if this error is transient and the operation can be retried.
    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            DirectoryError::Unavailable
                | DirectoryError::Busy
                | DirectoryError::Timeout
                | DirectoryError::ServerDown
                | DirectoryError::ConnectError
                | DirectoryError::ConnectionLost
        )
    }

    /// Returns true if reconnection should be attempted after this error.
    pub fn needs_reconnect(&self) -> bool {
        matches!(
            self,
            DirectoryError::Unavailable
                | DirectoryError::Timeout
                | DirectoryError::ServerDown
                | DirectoryError::ConnectError
                | DirectoryError::ConnectionLost
        )
    }

    /// Returns a user-friendly message for display in notifications.
    pub fn user_message(&self) -> String {
        match self {
            DirectoryError::Unavailable
            | DirectoryError::ServerDown
            | DirectoryError::ConnectError => {
                "The directory server is currently unreachable. Please try again later.".to_string()
            }
            DirectoryError::Busy => {
                "The directory server is busy. Please try again in a moment.".to_string()
            }
            DirectoryError::Timeout => "The operation timed out. Please try again.".to_string(),
            DirectoryError::InsufficientRights(detail) => {
                format!("Permission denied: {}", detail)
            }
            DirectoryError::NoSuchObject(_) => {
                "The requested object was not found in the directory.".to_string()
            }
            DirectoryError::ConstraintViolation(detail) => {
                format!("The operation could not be completed: {}", detail)
            }
            DirectoryError::ConnectionLost => {
                "Connection to the directory was lost. Reconnecting...".to_string()
            }
            DirectoryError::NotDomainJoined => {
                "This machine is not joined to a domain.".to_string()
            }
            DirectoryError::Other(msg) => {
                format!("Directory error: {}", msg)
            }
        }
    }

    /// Classifies an LDAP result code into a typed DirectoryError.
    pub fn from_ldap_code(code: u32, message: &str) -> Self {
        match code {
            52 => DirectoryError::Unavailable,
            51 => DirectoryError::Busy,
            85 => DirectoryError::Timeout,
            81 => DirectoryError::ServerDown,
            91 => DirectoryError::ConnectError,
            50 => DirectoryError::InsufficientRights(message.to_string()),
            32 => DirectoryError::NoSuchObject(message.to_string()),
            19 => DirectoryError::ConstraintViolation(message.to_string()),
            _ => DirectoryError::Other(format!("LDAP error {}: {}", code, message)),
        }
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
        assert_eq!(err.to_string(), "Permission denied: requires DomainAdmin");
    }

    #[test]
    fn test_app_error_configuration_display() {
        let err = AppError::Configuration("missing config file".to_string());
        assert_eq!(err.to_string(), "Configuration error: missing config file");
    }

    #[test]
    fn test_app_error_validation_display() {
        let err = AppError::Validation("query too long".to_string());
        assert_eq!(err.to_string(), "Validation error: query too long");
    }

    #[test]
    fn test_error_response_from_validation_error() {
        let err = AppError::Validation("bad input".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "validation");
        assert!(!response.retryable);
        assert_eq!(response.user_message, "bad input");
    }

    #[test]
    fn test_app_error_internal_display() {
        let err = AppError::Internal("unexpected".to_string());
        assert_eq!(err.to_string(), "Internal error: unexpected");
    }

    #[test]
    fn test_app_error_circuit_breaker_open_display() {
        let err = AppError::CircuitBreakerOpen;
        assert!(err.to_string().contains("Circuit breaker open"));
    }

    #[test]
    fn test_error_response_from_directory_error() {
        let err = AppError::Directory("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "directory");
        assert!(!response.retryable);
    }

    #[test]
    fn test_error_response_from_network_error() {
        let err = AppError::Network("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "network");
        assert!(response.retryable);
    }

    #[test]
    fn test_error_response_from_permission_denied() {
        let err = AppError::PermissionDenied("test".to_string());
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "permission_denied");
        assert!(!response.retryable);
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
    fn test_error_response_from_circuit_breaker() {
        let err = AppError::CircuitBreakerOpen;
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "circuit_breaker");
        assert!(response.retryable);
    }

    #[test]
    fn test_error_response_from_typed_directory_error() {
        let err = AppError::DirectoryTyped(DirectoryError::Timeout);
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "directory");
        assert!(response.retryable);
    }

    #[test]
    fn test_error_response_from_typed_permanent_error() {
        let err =
            AppError::DirectoryTyped(DirectoryError::InsufficientRights("admin only".to_string()));
        let response = ErrorResponse::from(err);
        assert_eq!(response.kind, "directory");
        assert!(!response.retryable);
    }

    #[test]
    fn test_error_response_user_message_not_raw() {
        let err = AppError::Directory("raw LDAP internal detail".to_string());
        let response = ErrorResponse::from(err);
        assert!(!response.user_message.contains("raw LDAP internal detail"));
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
    }

    // DirectoryError tests

    #[test]
    fn test_directory_error_transient_classification() {
        assert!(DirectoryError::Unavailable.is_transient());
        assert!(DirectoryError::Busy.is_transient());
        assert!(DirectoryError::Timeout.is_transient());
        assert!(DirectoryError::ServerDown.is_transient());
        assert!(DirectoryError::ConnectError.is_transient());
        assert!(DirectoryError::ConnectionLost.is_transient());
    }

    #[test]
    fn test_directory_error_permanent_classification() {
        assert!(!DirectoryError::InsufficientRights("test".to_string()).is_transient());
        assert!(!DirectoryError::NoSuchObject("test".to_string()).is_transient());
        assert!(!DirectoryError::ConstraintViolation("test".to_string()).is_transient());
        assert!(!DirectoryError::NotDomainJoined.is_transient());
        assert!(!DirectoryError::Other("test".to_string()).is_transient());
    }

    #[test]
    fn test_directory_error_needs_reconnect() {
        assert!(DirectoryError::Unavailable.needs_reconnect());
        assert!(DirectoryError::ServerDown.needs_reconnect());
        assert!(DirectoryError::ConnectError.needs_reconnect());
        assert!(DirectoryError::Timeout.needs_reconnect());
        assert!(DirectoryError::ConnectionLost.needs_reconnect());
        assert!(!DirectoryError::Busy.needs_reconnect());
        assert!(!DirectoryError::InsufficientRights("test".to_string()).needs_reconnect());
    }

    #[test]
    fn test_directory_error_from_ldap_code() {
        assert!(matches!(
            DirectoryError::from_ldap_code(52, ""),
            DirectoryError::Unavailable
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(51, ""),
            DirectoryError::Busy
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(85, ""),
            DirectoryError::Timeout
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(81, ""),
            DirectoryError::ServerDown
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(91, ""),
            DirectoryError::ConnectError
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(50, "msg"),
            DirectoryError::InsufficientRights(_)
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(32, "msg"),
            DirectoryError::NoSuchObject(_)
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(19, "msg"),
            DirectoryError::ConstraintViolation(_)
        ));
        assert!(matches!(
            DirectoryError::from_ldap_code(99, "unknown"),
            DirectoryError::Other(_)
        ));
    }

    #[test]
    fn test_directory_error_user_messages_are_friendly() {
        let cases = vec![
            DirectoryError::Unavailable,
            DirectoryError::Busy,
            DirectoryError::Timeout,
            DirectoryError::ServerDown,
            DirectoryError::ConnectError,
            DirectoryError::ConnectionLost,
            DirectoryError::InsufficientRights("admin".to_string()),
            DirectoryError::NoSuchObject("CN=test".to_string()),
            DirectoryError::ConstraintViolation("too long".to_string()),
            DirectoryError::NotDomainJoined,
            DirectoryError::Other("some error".to_string()),
        ];
        for err in cases {
            let msg = err.user_message();
            assert!(
                !msg.is_empty(),
                "user_message should not be empty for {:?}",
                err
            );
        }
    }

    #[test]
    fn test_directory_error_display() {
        assert_eq!(
            DirectoryError::Unavailable.to_string(),
            "LDAP server unavailable (code 52)"
        );
        assert_eq!(
            DirectoryError::Busy.to_string(),
            "LDAP server busy (code 51)"
        );
        assert_eq!(
            DirectoryError::Timeout.to_string(),
            "LDAP operation timed out (code 85)"
        );
    }

    #[test]
    fn test_app_error_from_directory_error() {
        let dir_err = DirectoryError::Timeout;
        let app_err: AppError = dir_err.into();
        assert!(matches!(app_err, AppError::DirectoryTyped(_)));
    }
}
