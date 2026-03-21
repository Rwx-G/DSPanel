use std::future::Future;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;

use crate::error::DirectoryError;
use crate::models::{ContactInfo, DirectoryEntry, OUNode, PrinterInfo};
use crate::services::directory::DirectoryProvider;
use crate::services::resilience::{retry_with_backoff, CircuitBreaker, RetryConfig};

/// Executes a directory operation with retry and circuit breaker protection.
///
/// Two forms:
/// - `resilient_call!(self, |inner| expr)` - no captured args
/// - `resilient_call!(self, arg, |inner, a| expr)` - one captured String arg
macro_rules! resilient_call {
    ($self:ident, |$inner:ident| $body:expr) => {{
        let $inner = $self.inner.clone();
        $self
            .execute_with_resilience(|| {
                let $inner = $inner.clone();
                async move { $body }
            })
            .await
            .map_err(|e| anyhow::anyhow!(e))
    }};
    ($self:ident, $arg:ident, |$inner:ident, $a:ident| $body:expr) => {{
        let inner_ref = $self.inner.clone();
        let arg_val = $arg;
        $self
            .execute_with_resilience(|| {
                let $inner = inner_ref.clone();
                let $a = arg_val.clone();
                async move { $body }
            })
            .await
            .map_err(|e| anyhow::anyhow!(e))
    }};
}

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
        resilient_call!(self, |inner| inner.test_connection().await)
    }

    async fn search_users(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let filter = filter.to_string();
        resilient_call!(self, filter, |inner, f| inner
            .search_users(&f, max_results)
            .await)
    }

    async fn search_computers(
        &self,
        filter: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let filter = filter.to_string();
        resilient_call!(self, filter, |inner, f| inner
            .search_computers(&f, max_results)
            .await)
    }

    async fn search_groups(&self, filter: &str, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let filter = filter.to_string();
        resilient_call!(self, filter, |inner, f| inner
            .search_groups(&f, max_results)
            .await)
    }

    async fn browse_users(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        resilient_call!(self, |inner| inner.browse_users(max_results).await)
    }

    async fn browse_computers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        resilient_call!(self, |inner| inner.browse_computers(max_results).await)
    }

    async fn browse_groups(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        resilient_call!(self, |inner| inner.browse_groups(max_results).await)
    }

    async fn delete_object(&self, dn: &str) -> Result<()> {
        let dn_owned = dn.to_string();
        resilient_call!(self, dn_owned, |inner, d| inner.delete_object(&d).await)
    }

    async fn remove_group_member(&self, group_dn: &str, member_dn: &str) -> Result<()> {
        let g = group_dn.to_string();
        let m = member_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let g = g.clone();
            let m = m.clone();
            async move { inner.remove_group_member(&g, &m).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_user_by_identity(&self, sam_account_name: &str) -> Result<Option<DirectoryEntry>> {
        let sam = sam_account_name.to_string();
        resilient_call!(self, sam, |inner, s| inner.get_user_by_identity(&s).await)
    }

    async fn get_group_members(
        &self,
        group_dn: &str,
        max_results: usize,
    ) -> Result<Vec<DirectoryEntry>> {
        let dn = group_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner
            .get_group_members(&d, max_results)
            .await)
    }

    async fn get_current_user_groups(&self) -> Result<Vec<String>> {
        resilient_call!(self, |inner| inner.get_current_user_groups().await)
    }

    async fn reset_password(
        &self,
        user_dn: &str,
        new_password: &str,
        must_change_at_next_logon: bool,
    ) -> Result<()> {
        let dn = user_dn.to_string();
        let pwd = new_password.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            let p = pwd.clone();
            async move {
                inner
                    .reset_password(&d, &p, must_change_at_next_logon)
                    .await
            }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn unlock_account(&self, user_dn: &str) -> Result<()> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.unlock_account(&d).await)
    }

    async fn enable_account(&self, user_dn: &str) -> Result<()> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.enable_account(&d).await)
    }

    async fn disable_account(&self, user_dn: &str) -> Result<()> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.disable_account(&d).await)
    }

    async fn get_cannot_change_password(&self, user_dn: &str) -> Result<bool> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner
            .get_cannot_change_password(&d)
            .await)
    }

    async fn set_password_flags(
        &self,
        user_dn: &str,
        password_never_expires: bool,
        user_cannot_change_password: bool,
    ) -> Result<()> {
        let dn = user_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            async move {
                inner
                    .set_password_flags(&d, password_never_expires, user_cannot_change_password)
                    .await
            }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn add_user_to_group(&self, user_dn: &str, group_dn: &str) -> Result<()> {
        let u = user_dn.to_string();
        let g = group_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let u = u.clone();
            let g = g.clone();
            async move { inner.add_user_to_group(&u, &g).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_replication_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        let dn = object_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            async move { inner.get_replication_metadata(&d).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_replication_value_metadata(&self, object_dn: &str) -> Result<Option<String>> {
        let dn = object_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            async move { inner.get_replication_value_metadata(&d).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_nested_groups(&self, user_dn: &str) -> Result<Vec<String>> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.get_nested_groups(&d).await)
    }

    async fn get_ou_tree(&self) -> Result<Vec<OUNode>> {
        resilient_call!(self, |inner| inner.get_ou_tree().await)
    }

    async fn create_group(
        &self,
        name: &str,
        container_dn: &str,
        scope: &str,
        category: &str,
        description: &str,
    ) -> Result<String> {
        let name = name.to_string();
        let container = container_dn.to_string();
        let scope = scope.to_string();
        let category = category.to_string();
        let desc = description.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let n = name.clone();
            let c = container.clone();
            let s = scope.clone();
            let cat = category.clone();
            let d = desc.clone();
            async move { inner.create_group(&n, &c, &s, &cat, &d).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn move_object(&self, object_dn: &str, target_container_dn: &str) -> Result<()> {
        let o = object_dn.to_string();
        let t = target_container_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let o = o.clone();
            let t = t.clone();
            async move { inner.move_object(&o, &t).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn update_managed_by(&self, group_dn: &str, manager_dn: &str) -> Result<()> {
        let g = group_dn.to_string();
        let m = manager_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let g = g.clone();
            let m = m.clone();
            async move { inner.update_managed_by(&g, &m).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn browse_contacts(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.browse_contacts(max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn browse_printers(&self, max_results: usize) -> Result<Vec<DirectoryEntry>> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.browse_printers(max_results).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_schema_attributes(&self) -> Result<Vec<String>> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.get_schema_attributes().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn create_user(
        &self,
        cn: &str,
        container_dn: &str,
        sam_account_name: &str,
        password: &str,
        attributes: &std::collections::HashMap<String, Vec<String>>,
    ) -> Result<String> {
        let cn = cn.to_string();
        let container = container_dn.to_string();
        let sam = sam_account_name.to_string();
        let pwd = password.to_string();
        let attrs = attributes.clone();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let cn = cn.clone();
            let container = container.clone();
            let sam = sam.clone();
            let pwd = pwd.clone();
            let attrs = attrs.clone();
            async move { inner.create_user(&cn, &container, &sam, &pwd, &attrs).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn modify_attribute(
        &self,
        dn: &str,
        attribute_name: &str,
        values: &[String],
    ) -> Result<()> {
        let dn = dn.to_string();
        let attr = attribute_name.to_string();
        let vals = values.to_vec();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            let a = attr.clone();
            let v = vals.clone();
            async move { inner.modify_attribute(&d, &a, &v).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    fn authenticated_user(&self) -> Option<String> {
        self.inner.authenticated_user()
    }

    async fn probe_effective_permissions(&self) -> Result<(bool, bool, bool)> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.probe_effective_permissions().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn is_recycle_bin_enabled(&self) -> Result<bool> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.is_recycle_bin_enabled().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn get_deleted_objects(&self) -> Result<Vec<crate::models::DeletedObject>> {
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            async move { inner.get_deleted_objects().await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn restore_deleted_object(&self, deleted_dn: &str, target_ou_dn: &str) -> Result<()> {
        let d = deleted_dn.to_string();
        let t = target_ou_dn.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = d.clone();
            let t = t.clone();
            async move { inner.restore_deleted_object(&d, &t).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn search_contacts(&self, filter: &str, max_results: usize) -> Result<Vec<ContactInfo>> {
        let filter = filter.to_string();
        resilient_call!(self, filter, |inner, f| inner
            .search_contacts(&f, max_results)
            .await)
    }

    async fn search_printers(&self, filter: &str, max_results: usize) -> Result<Vec<PrinterInfo>> {
        let filter = filter.to_string();
        resilient_call!(self, filter, |inner, f| inner
            .search_printers(&f, max_results)
            .await)
    }

    async fn create_contact(
        &self,
        container_dn: &str,
        attrs: &std::collections::HashMap<String, String>,
    ) -> Result<String> {
        let container = container_dn.to_string();
        let attrs = attrs.clone();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let c = container.clone();
            let a = attrs.clone();
            async move { inner.create_contact(&c, &a).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn update_contact(
        &self,
        dn: &str,
        attrs: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        let dn = dn.to_string();
        let attrs = attrs.clone();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            let a = attrs.clone();
            async move { inner.update_contact(&d, &a).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn delete_contact(&self, dn: &str) -> Result<()> {
        let dn = dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.delete_contact(&d).await)
    }

    async fn create_printer(
        &self,
        container_dn: &str,
        attrs: &std::collections::HashMap<String, String>,
    ) -> Result<String> {
        let container = container_dn.to_string();
        let attrs = attrs.clone();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let c = container.clone();
            let a = attrs.clone();
            async move { inner.create_printer(&c, &a).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn update_printer(
        &self,
        dn: &str,
        attrs: &std::collections::HashMap<String, String>,
    ) -> Result<()> {
        let dn = dn.to_string();
        let attrs = attrs.clone();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            let a = attrs.clone();
            async move { inner.update_printer(&d, &a).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn delete_printer(&self, dn: &str) -> Result<()> {
        let dn = dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.delete_printer(&d).await)
    }

    async fn get_thumbnail_photo(&self, user_dn: &str) -> Result<Option<String>> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.get_thumbnail_photo(&d).await)
    }

    async fn set_thumbnail_photo(&self, user_dn: &str, photo_base64: &str) -> Result<()> {
        let dn = user_dn.to_string();
        let photo = photo_base64.to_string();
        let inner_ref = self.inner.clone();
        self.execute_with_resilience(|| {
            let inner = inner_ref.clone();
            let d = dn.clone();
            let p = photo.clone();
            async move { inner.set_thumbnail_photo(&d, &p).await }
        })
        .await
        .map_err(|e| anyhow::anyhow!(e))
    }

    async fn remove_thumbnail_photo(&self, user_dn: &str) -> Result<()> {
        let dn = user_dn.to_string();
        resilient_call!(self, dn, |inner, d| inner.remove_thumbnail_photo(&d).await)
    }
}

#[allow(clippy::unwrap_used)]
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

    async fn noop_delay(_: Duration) {}

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

    #[test]
    fn test_classify_anyhow_error_server_down_variant() {
        let err = anyhow::anyhow!("LDAP server down");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::ServerDown));
        assert!(dir_err.is_transient());
    }

    #[test]
    fn test_classify_anyhow_error_timeout_variant() {
        let err = anyhow::anyhow!("request timeout exceeded");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::Timeout));
        assert!(dir_err.is_transient());
    }

    #[test]
    fn test_classify_anyhow_error_insufficient_rights() {
        let err = anyhow::anyhow!("insufficient permissions for this operation");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::InsufficientRights(_)));
        assert!(!dir_err.is_transient());
    }

    #[test]
    fn test_classify_anyhow_error_no_domain() {
        let err = anyhow::anyhow!("this machine has no domain controller");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::NotDomainJoined));
    }

    #[test]
    fn test_classify_anyhow_error_unavailable() {
        let err = anyhow::anyhow!("service unavailable");
        let dir_err = classify_anyhow_error(err);
        assert!(matches!(dir_err, DirectoryError::ServerDown));
    }

    #[test]
    fn test_classify_preserves_original_message_for_insufficient() {
        let err = anyhow::anyhow!("Access denied to resource CN=User,DC=test");
        let dir_err = classify_anyhow_error(err);
        match dir_err {
            DirectoryError::InsufficientRights(msg) => {
                assert!(msg.contains("CN=User,DC=test"));
            }
            other => panic!("Expected InsufficientRights, got: {:?}", other),
        }
    }

    #[test]
    fn test_classify_preserves_original_message_for_other() {
        let err = anyhow::anyhow!("random weird error 42");
        let dir_err = classify_anyhow_error(err);
        match dir_err {
            DirectoryError::Other(msg) => {
                assert!(msg.contains("random weird error 42"));
            }
            other => panic!("Expected Other, got: {:?}", other),
        }
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
    async fn test_resilient_browse_users() {
        let inner = Arc::new(MockDirectoryProvider::new().with_users(vec![make_entry("jdoe")]));
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.browse_users(500).await.unwrap();
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

    // -----------------------------------------------------------------------
    // Circuit breaker accessor
    // -----------------------------------------------------------------------

    #[test]
    fn test_circuit_breaker_accessor() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let cb = CircuitBreaker::new(CircuitBreakerConfig::default());
        let provider =
            ResilientDirectoryProvider::new(inner, RetryConfig::default(), cb.clone(), noop_delay);
        assert_eq!(provider.circuit_breaker().state(), CircuitState::Closed);
    }

    // -----------------------------------------------------------------------
    // Resilient browse_computers passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_browse_computers() {
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

        let results = provider.browse_computers(500).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Resilient unlock_account passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_unlock_account() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider.unlock_account("CN=User,DC=test").await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient enable_account passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_enable_account() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider.enable_account("CN=User,DC=test").await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient disable_account passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_disable_account() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider.disable_account("CN=User,DC=test").await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient reset_password passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_reset_password() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .reset_password("CN=User,DC=test", "NewPass1!", false)
            .await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient get_cannot_change_password passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_get_cannot_change_password() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .get_cannot_change_password("CN=User,DC=test")
            .await
            .unwrap();
        assert!(!result);
    }

    // -----------------------------------------------------------------------
    // Resilient set_password_flags passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_set_password_flags() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .set_password_flags("CN=User,DC=test", true, false)
            .await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient add_user_to_group passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_add_user_to_group() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .add_user_to_group("CN=User,DC=test", "CN=Group,DC=test")
            .await;
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Resilient get_nested_groups passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_get_nested_groups() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.get_nested_groups("CN=User,DC=test").await.unwrap();
        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // Resilient get_ou_tree passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_get_ou_tree() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let results = provider.get_ou_tree().await.unwrap();
        assert!(results.is_empty());
    }

    // -----------------------------------------------------------------------
    // Resilient get_replication_metadata passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_get_replication_metadata() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .get_replication_metadata("CN=User,DC=test")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // Resilient get_replication_value_metadata passthrough
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_get_replication_value_metadata() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig::default(),
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        let result = provider
            .get_replication_value_metadata("CN=User,DC=test")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // Failure propagation through resilient provider
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_resilient_failure_propagates() {
        let inner = Arc::new(MockDirectoryProvider::new().with_failure());
        let provider = ResilientDirectoryProvider::new(
            inner,
            RetryConfig {
                max_retries: 0,
                initial_delay: Duration::from_millis(1),
                multiplier: 1.0,
            },
            CircuitBreaker::new(CircuitBreakerConfig::default()),
            noop_delay,
        );

        assert!(provider.browse_users(100).await.is_err());
        assert!(provider.browse_computers(100).await.is_err());
        assert!(provider.search_groups("test", 50).await.is_err());
        assert!(provider.get_ou_tree().await.is_err());
    }

    // -----------------------------------------------------------------------
    // Circuit breaker open rejects immediately
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn test_circuit_breaker_open_rejects_all_operations() {
        let inner = Arc::new(MockDirectoryProvider::new());
        let cb_config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(cb_config);
        cb.record_failure(); // opens the circuit
        assert_eq!(cb.state(), CircuitState::Open);

        let provider =
            ResilientDirectoryProvider::new(inner, RetryConfig::default(), cb, noop_delay);

        assert!(provider.test_connection().await.is_err());
        assert!(provider.search_users("test", 50).await.is_err());
        assert!(provider.get_ou_tree().await.is_err());
    }
}
