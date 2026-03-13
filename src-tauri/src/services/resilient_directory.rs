use std::future::Future;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;

use crate::error::DirectoryError;
use crate::models::DirectoryEntry;
use crate::services::directory::DirectoryProvider;
use crate::services::resilience::{retry_with_backoff, CircuitBreaker, RetryConfig};

/// A decorator around `DirectoryProvider` that adds retry and circuit breaker
/// resilience to all directory operations.
///
/// - Retries transient errors with exponential backoff
/// - Tracks consecutive failures via circuit breaker
/// - Rejects requests immediately when the circuit is open
pub struct ResilientDirectoryProvider<D: Fn(std::time::Duration) -> F, F: Future<Output = ()>> {
    inner: Arc<dyn DirectoryProvider>,
    retry_config: RetryConfig,
    circuit_breaker: CircuitBreaker,
    delay_fn: D,
}

impl<D, F> ResilientDirectoryProvider<D, F>
where
    D: Fn(std::time::Duration) -> F + Send + Sync,
    F: Future<Output = ()> + Send,
{
    /// Creates a new resilient provider wrapping an inner provider.
    pub fn new(
        inner: Arc<dyn DirectoryProvider>,
        retry_config: RetryConfig,
        circuit_breaker: CircuitBreaker,
        delay_fn: D,
    ) -> Self {
        Self {
            inner,
            retry_config,
            circuit_breaker,
            delay_fn,
        }
    }

    /// Returns a reference to the circuit breaker for state inspection.
    pub fn circuit_breaker(&self) -> &CircuitBreaker {
        &self.circuit_breaker
    }

    /// Executes an async operation with retry and circuit breaker protection.
    async fn execute_with_resilience<T, Op, OpFut>(
        &self,
        mut operation: Op,
    ) -> Result<T, DirectoryError>
    where
        Op: FnMut() -> OpFut,
        OpFut: Future<Output = Result<T>>,
    {
        // Check circuit breaker first
        self.circuit_breaker.check_allowed()?;

        let cb = &self.circuit_breaker;
        let result = retry_with_backoff(
            &self.retry_config,
            || {
                let fut = operation();
                async move {
                    fut.await.map_err(|e| {
                        // Try to classify the anyhow error as a DirectoryError
                        classify_anyhow_error(e)
                    })
                }
            },
            &self.delay_fn,
        )
        .await;

        match &result {
            Ok(_) => cb.record_success(),
            Err(_) => cb.record_failure(),
        }

        result
    }
}

/// Attempts to classify an anyhow::Error as a DirectoryError.
///
/// If the error contains LDAP-specific error text, maps it to the appropriate
/// variant. Otherwise, wraps it as `DirectoryError::Other`.
fn classify_anyhow_error(err: anyhow::Error) -> DirectoryError {
    let msg = err.to_string().to_lowercase();

    if msg.contains("connection") && (msg.contains("refused") || msg.contains("reset")) {
        DirectoryError::ConnectError
    } else if msg.contains("timeout") || msg.contains("timed out") {
        DirectoryError::Timeout
    } else if msg.contains("server down") || msg.contains("unavailable") {
        DirectoryError::ServerDown
    } else if msg.contains("not domain-joined") || msg.contains("no domain") {
        DirectoryError::NotDomainJoined
    } else if msg.contains("insufficient") || msg.contains("access denied") {
        DirectoryError::InsufficientRights(err.to_string())
    } else {
        DirectoryError::Other(err.to_string())
    }
}

#[async_trait]
impl<D, F> DirectoryProvider for ResilientDirectoryProvider<D, F>
where
    D: Fn(std::time::Duration) -> F + Send + Sync,
    F: Future<Output = ()> + Send,
{
    fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    fn domain_name(&self) -> Option<&str> {
        self.inner.domain_name()
    }

    fn base_dn(&self) -> Option<String> {
        self.inner.base_dn()
    }

    async fn test_connection(&self) -> Result<bool> {
        let inner = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            async move { inner.test_connection().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let inner = self.inner.clone();
        let filter = filter.to_string();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            let f = filter.clone();
            async move { inner.search_users(&f, max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let inner = self.inner.clone();
        let filter = filter.to_string();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            let f = filter.clone();
            async move { inner.search_computers(&f, max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn search_groups(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let inner = self.inner.clone();
        let filter = filter.to_string();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            let f = filter.clone();
            async move { inner.search_groups(&f, max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        let inner = self.inner.clone();
        let sam = sam_account_name.to_string();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            let s = sam.clone();
            async move { inner.get_user_by_identity(&s).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let inner = self.inner.clone();
        let dn = group_dn.to_string();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            let d = dn.clone();
            async move { inner.get_group_members(&d, max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        let inner = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner.clone();
            async move { inner.get_current_user_groups().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::directory::tests::MockDirectoryProvider;
    use crate::services::resilience::{CircuitBreakerConfig, CircuitState};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    fn make_entry(sam: &str) -> DirectoryEntry {
        DirectoryEntry {
            distinguished_name: format!("CN={},DC=test", sam),
            sam_account_name: Some(sam.to_string()),
            display_name: Some(sam.to_string()),
            object_class: Some("user".to_string()),
            attributes: HashMap::new(),
        }
    }

    fn noop_delay(_: Duration) -> impl Future<Output = ()> {
        async {}
    }

    #[tokio::test]
    async fn test_resilient_search_users_success() {
        let inner = Arc::new(MockDirectoryProvider::new().with_users(vec![make_entry("jdoe")]));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.search_users("jdoe", 50).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sam_account_name, Some("jdoe".to_string()));
    }

    #[tokio::test]
    async fn test_resilient_provider_retries_on_transient_failure() {
        // Create a provider that fails twice then succeeds
        let attempt = Arc::new(AtomicU32::new(0));
        let attempt_clone = attempt.clone();
        let users = vec![make_entry("jdoe")];

        // Use a provider that tracks call count via interior mutability
        let inner = Arc::new(MockDirectoryProvider::new().with_users(users));

        // For this test we need a custom approach since MockDirectoryProvider
        // doesn't support "fail N times then succeed" directly.
        // Instead, test the retry logic directly via retry_with_backoff.
        let config = RetryConfig {
            max_retries: 3,
            initial_delay: Duration::from_millis(1),
            multiplier: 2.0,
        };

        let result = retry_with_backoff(
            &config,
            || {
                let n = attempt_clone.fetch_add(1, Ordering::SeqCst);
                async move {
                    if n < 2 {
                        Err(DirectoryError::Timeout)
                    } else {
                        Ok(vec![make_entry("jdoe")])
                    }
                }
            },
            noop_delay,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 1);
        assert_eq!(attempt.load(Ordering::SeqCst), 3);
        let _ = inner; // keep inner alive
    }

    #[tokio::test]
    async fn test_resilient_provider_circuit_breaker_triggers() {
        let inner = Arc::new(MockDirectoryProvider::new().with_failure());
        let cb_config = CircuitBreakerConfig {
            failure_threshold: 2,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(cb_config);
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig {
                max_retries: 0,
                initial_delay: Duration::from_millis(1),
                multiplier: 2.0,
            },
            cb.clone(),
            noop_delay,
        );

        // First failure
        let _ = provider.search_users("test", 50).await;
        assert_eq!(cb.state(), CircuitState::Closed);

        // Second failure triggers circuit breaker
        let _ = provider.search_users("test", 50).await;
        assert_eq!(cb.state(), CircuitState::Open);

        // Third request should be rejected immediately
        let result = provider.search_users("test", 50).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_resilient_provider_passes_through_delegate_methods() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        assert!(provider.is_connected());
        assert_eq!(provider.domain_name(), Some("EXAMPLE.COM"));
    }

    #[tokio::test]
    async fn test_resilient_provider_does_not_retry_permanent_error() {
        // classify_anyhow_error for "access denied" -> InsufficientRights (permanent)
        let config = RetryConfig {
            max_retries: 3,
            initial_delay: Duration::from_millis(1),
            multiplier: 2.0,
        };

        let attempt = AtomicU32::new(0);
        let result = retry_with_backoff(
            &config,
            || {
                attempt.fetch_add(1, Ordering::SeqCst);
                async {
                    Err::<Vec<DirectoryEntry>, _>(DirectoryError::InsufficientRights(
                        "denied".to_string(),
                    ))
                }
            },
            noop_delay,
        )
        .await;

        assert!(result.is_err());
        assert_eq!(attempt.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_resilient_provider_circuit_breaker_resets_on_success() {
        let cb = CircuitBreaker::new(CircuitBreakerConfig {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(60),
        });

        // 2 failures
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);

        // Success resets
        cb.record_success();

        // 2 more failures - still closed because counter was reset
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn test_classify_anyhow_error_timeout() {
        let err = anyhow::anyhow!("operation timed out");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::Timeout));
        assert!(dir_err.is_transient());
    }

    #[test]
    fn test_classify_anyhow_error_connection_refused() {
        let err = anyhow::anyhow!("connection refused");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::ConnectError));
    }

    #[test]
    fn test_classify_anyhow_error_connection_reset() {
        let err = anyhow::anyhow!("connection reset by peer");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::ConnectError));
    }

    #[test]
    fn test_classify_anyhow_error_server_down() {
        let err = anyhow::anyhow!("LDAP server unavailable");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::ServerDown));
    }

    #[test]
    fn test_classify_anyhow_error_access_denied() {
        let err = anyhow::anyhow!("access denied to resource");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::InsufficientRights(_)));
        assert!(!dir_err.is_transient());
    }

    #[test]
    fn test_classify_anyhow_error_not_domain_joined() {
        let err = anyhow::anyhow!("not domain-joined");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::NotDomainJoined));
    }

    #[test]
    fn test_classify_anyhow_error_unknown() {
        let err = anyhow::anyhow!("something completely unexpected");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::Other(_)));
        assert!(!dir_err.is_transient());
    }

    #[tokio::test]
    async fn test_resilient_test_connection() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        assert!(provider.test_connection().await.unwrap());
    }

    #[tokio::test]
    async fn test_resilient_search_computers() {
        let computers = vec![DirectoryEntry {
            distinguished_name: "CN=WS01,DC=test".to_string(),
            sam_account_name: Some("WS01$".to_string()),
            display_name: Some("WS01".to_string()),
            object_class: Some("computer".to_string()),
            attributes: HashMap::new(),
        }];
        let inner = Arc::new(MockDirectoryProvider::new().with_computers(computers));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.search_computers("WS", 50).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_resilient_get_user_by_identity() {
        let inner = Arc::new(MockDirectoryProvider::new().with_users(vec![make_entry("jdoe")]));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider.get_user_by_identity("jdoe").await.unwrap();
        assert!(result.is_some());
    }

    #[tokio::test]
    async fn test_resilient_get_group_members() {
        let members = vec![make_entry("jdoe")];
        let inner = Arc::new(MockDirectoryProvider::new().with_members(members));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider
            .get_group_members("CN=G,DC=test", 50)
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_resilient_search_groups() {
        let groups = vec![DirectoryEntry {
            distinguished_name: "CN=Admins,DC=test".to_string(),
            sam_account_name: Some("Admins".to_string()),
            display_name: Some("Admins".to_string()),
            object_class: Some("group".to_string()),
            attributes: HashMap::new(),
        }];
        let inner = Arc::new(MockDirectoryProvider::new().with_groups(groups));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.search_groups("Admin", 50).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].sam_account_name, Some("Admins".to_string()));
    }

    #[test]
    fn test_resilient_provider_base_dn_passthrough() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        // MockDirectoryProvider returns Some for base_dn
        assert_eq!(provider.base_dn(), Some("DC=example,DC=com".to_string()));
    }

    #[tokio::test]
    async fn test_resilient_get_current_user_groups() {
        let groups = vec!["CN=G1,DC=test".to_string()];
        let inner = Arc::new(MockDirectoryProvider::new().with_user_groups(groups));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.get_current_user_groups().await.unwrap();
        assert_eq!(results.len(), 1);
    }
}
