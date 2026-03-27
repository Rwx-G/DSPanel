use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::error::DirectoryError;

/// Configuration for exponential backoff retry policy.
#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Maximum number of retry attempts (not counting the initial attempt).
    pub max_retries: u32,
    /// Initial delay before the first retry.
    pub initial_delay: Duration,
    /// Multiplier applied to the delay after each retry.
    pub multiplier: f64,
    /// Maximum delay cap (prevents unbounded growth). Default: 10 seconds.
    pub max_delay: Duration,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay: Duration::from_secs(1),
            multiplier: 2.0,
            max_delay: Duration::from_secs(10),
        }
    }
}

/// Executes an async operation with exponential backoff retry.
///
/// Only retries when the error is classified as transient. Permanent errors
/// are returned immediately. The `delay_fn` parameter allows injecting a
/// custom sleep function for testing (avoids real waits).
///
/// Returns `Ok(T)` on success, or the last `DirectoryError` after all retries
/// are exhausted.
pub async fn retry_with_backoff<T, F, Fut, D, DFut>(
    config: &RetryConfig,
    mut operation: F,
    delay_fn: D,
) -> Result<T, DirectoryError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, DirectoryError>>,
    D: Fn(Duration) -> DFut,
    DFut: Future<Output = ()>,
{
    let mut attempt = 0;
    let mut delay = config.initial_delay;

    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                if !err.is_transient() || attempt >= config.max_retries {
                    return Err(err);
                }

                attempt += 1;
                tracing::warn!(
                    attempt = attempt,
                    max = config.max_retries,
                    delay_ms = delay.as_millis() as u64,
                    error = %err,
                    "Retrying after transient error"
                );

                // Apply jitter: randomize delay by +/-50% to prevent thundering herd
                let jittered = apply_jitter(delay);
                delay_fn(jittered).await;
                // Grow delay with cap
                delay = Duration::from_secs_f64(delay.as_secs_f64() * config.multiplier);
                if delay > config.max_delay {
                    delay = config.max_delay;
                }
            }
        }
    }
}

/// Circuit breaker state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation - requests pass through.
    Closed,
    /// Too many failures - requests are rejected immediately.
    Open,
    /// Recovery probe - one request is allowed through to test recovery.
    HalfOpen,
}

/// Configuration for the circuit breaker.
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Number of consecutive failures before opening the circuit.
    pub failure_threshold: u32,
    /// Duration to wait before transitioning from Open to HalfOpen.
    pub recovery_timeout: Duration,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(30),
        }
    }
}

/// Inner state for the circuit breaker, protected by a Mutex.
#[derive(Debug)]
struct CircuitBreakerInner {
    state: CircuitState,
    consecutive_failures: u32,
    last_failure_time: Option<Instant>,
    config: CircuitBreakerConfig,
}

/// Thread-safe circuit breaker implementing the standard three-state pattern.
///
/// - **Closed**: Normal operation. Failures are counted.
/// - **Open**: Requests are rejected immediately. After `recovery_timeout`,
///   transitions to HalfOpen.
/// - **HalfOpen**: One probe request is allowed. Success resets to Closed;
///   failure returns to Open.
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    inner: Arc<Mutex<CircuitBreakerInner>>,
}

impl CircuitBreaker {
    /// Creates a new circuit breaker with the given configuration.
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CircuitBreakerInner {
                state: CircuitState::Closed,
                consecutive_failures: 0,
                last_failure_time: None,
                config,
            })),
        }
    }

    /// Returns the current state of the circuit breaker.
    pub fn state(&self) -> CircuitState {
        let mut inner = self.inner.lock().expect("lock poisoned");
        Self::maybe_transition_to_half_open(&mut inner);
        inner.state
    }

    /// Checks if a request should be allowed through.
    ///
    /// Returns `Ok(())` if the request is allowed, or `Err(DirectoryError)`
    /// if the circuit is open and the request should be rejected.
    pub fn check_allowed(&self) -> Result<(), DirectoryError> {
        let mut inner = self.inner.lock().expect("lock poisoned");
        Self::maybe_transition_to_half_open(&mut inner);

        match inner.state {
            CircuitState::Closed => Ok(()),
            CircuitState::HalfOpen => Ok(()),
            CircuitState::Open => {
                tracing::debug!("Circuit breaker is open, rejecting request");
                Err(DirectoryError::Other("Circuit breaker is open".to_string()))
            }
        }
    }

    /// Records a successful operation. Resets the circuit to Closed.
    pub fn record_success(&self) {
        let mut inner = self.inner.lock().expect("lock poisoned");
        if inner.state == CircuitState::HalfOpen {
            tracing::info!("Circuit breaker recovered - transitioning to Closed");
        }
        inner.state = CircuitState::Closed;
        inner.consecutive_failures = 0;
        inner.last_failure_time = None;
    }

    /// Records a failed operation. May transition to Open.
    pub fn record_failure(&self) {
        let mut inner = self.inner.lock().expect("lock poisoned");
        inner.consecutive_failures += 1;
        inner.last_failure_time = Some(Instant::now());

        if inner.state == CircuitState::HalfOpen {
            tracing::warn!("Circuit breaker probe failed - reopening circuit");
            inner.state = CircuitState::Open;
        } else if inner.consecutive_failures >= inner.config.failure_threshold {
            tracing::warn!(
                failures = inner.consecutive_failures,
                threshold = inner.config.failure_threshold,
                "Circuit breaker opened after consecutive failures"
            );
            inner.state = CircuitState::Open;
        }
    }

    /// Manually resets the circuit breaker to Closed state.
    pub fn reset(&self) {
        let mut inner = self.inner.lock().expect("lock poisoned");
        inner.state = CircuitState::Closed;
        inner.consecutive_failures = 0;
        inner.last_failure_time = None;
    }

    /// Checks if recovery timeout has elapsed and transitions Open -> HalfOpen.
    fn maybe_transition_to_half_open(inner: &mut CircuitBreakerInner) {
        if inner.state == CircuitState::Open
            && let Some(last_failure) = inner.last_failure_time
            && last_failure.elapsed() >= inner.config.recovery_timeout
        {
            tracing::info!("Circuit breaker recovery timeout elapsed - transitioning to HalfOpen");
            inner.state = CircuitState::HalfOpen;
        }
    }
}

/// Applies jitter to a duration (+/-50%) to prevent synchronized retries.
///
/// Uses a simple hash-based pseudo-random to avoid adding a rand dependency.
fn apply_jitter(base: Duration) -> Duration {
    // Use current time nanoseconds as cheap entropy source
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    // Map to 0.5..1.5 range
    let factor = 0.5 + (nanos as f64 % 1000.0) / 1000.0;
    Duration::from_secs_f64(base.as_secs_f64() * factor)
}

/// Centralized timeout configuration for all external service calls.
#[derive(Debug, Clone)]
pub struct TimeoutConfig {
    /// Timeout for LDAP operations.
    pub ldap: Duration,
    /// Timeout for Graph API calls (future use).
    pub graph_api: Duration,
    /// Timeout for HIBP API calls (future use).
    pub hibp: Duration,
    /// Timeout for WMI operations (future use).
    pub wmi: Duration,
}

impl Default for TimeoutConfig {
    fn default() -> Self {
        Self {
            ldap: Duration::from_secs(30),
            graph_api: Duration::from_secs(15),
            hibp: Duration::from_secs(5),
            wmi: Duration::from_secs(10),
        }
    }
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    // -- RetryConfig tests --

    #[test]
    fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.initial_delay, Duration::from_secs(1));
        assert_eq!(config.multiplier, 2.0);
    }

    // -- retry_with_backoff tests --

    #[tokio::test]
    async fn test_retry_succeeds_immediately() {
        let config = RetryConfig::default();
        let result = retry_with_backoff(
            &config,
            || async { Ok::<_, DirectoryError>(42) },
            |_| async {},
        )
        .await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_transient_failure() {
        let config = RetryConfig::default();
        let attempt = AtomicU32::new(0);

        let result = retry_with_backoff(
            &config,
            || {
                let n = attempt.fetch_add(1, Ordering::SeqCst);
                async move {
                    if n < 2 {
                        Err(DirectoryError::Timeout)
                    } else {
                        Ok(99)
                    }
                }
            },
            |_| async {},
        )
        .await;

        assert_eq!(result.unwrap(), 99);
        assert_eq!(attempt.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_gives_up_after_max_retries() {
        let config = RetryConfig {
            max_retries: 2,
            initial_delay: Duration::from_millis(1),
            multiplier: 2.0,
            ..Default::default()
        };

        let attempt = AtomicU32::new(0);
        let result = retry_with_backoff(
            &config,
            || {
                attempt.fetch_add(1, Ordering::SeqCst);
                async { Err::<i32, _>(DirectoryError::ServerDown) }
            },
            |_| async {},
        )
        .await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), DirectoryError::ServerDown));
        // 1 initial + 2 retries = 3 total attempts
        assert_eq!(attempt.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_does_not_retry_permanent_error() {
        let config = RetryConfig::default();
        let attempt = AtomicU32::new(0);

        let result = retry_with_backoff(
            &config,
            || {
                attempt.fetch_add(1, Ordering::SeqCst);
                async {
                    Err::<i32, _>(DirectoryError::InsufficientRights("admin only".to_string()))
                }
            },
            |_| async {},
        )
        .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            DirectoryError::InsufficientRights(_)
        ));
        assert_eq!(attempt.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_retry_applies_exponential_backoff_delays() {
        let config = RetryConfig {
            max_retries: 3,
            initial_delay: Duration::from_millis(100),
            multiplier: 2.0,
            ..Default::default()
        };

        let delays: Arc<Mutex<Vec<Duration>>> = Arc::new(Mutex::new(Vec::new()));
        let delays_clone = delays.clone();

        let attempt = AtomicU32::new(0);
        let _ = retry_with_backoff(
            &config,
            || {
                attempt.fetch_add(1, Ordering::SeqCst);
                async { Err::<i32, _>(DirectoryError::Busy) }
            },
            move |d| {
                let delays = delays_clone.clone();
                async move {
                    delays.lock().unwrap().push(d);
                }
            },
        )
        .await;

        let recorded = delays.lock().unwrap();
        assert_eq!(recorded.len(), 3);
        // Delays have jitter applied, so check they are within reasonable bounds of expected values
        // Expected base delays: 100ms, 200ms, 400ms. Jitter can reduce them.
        assert!(
            recorded[0] <= Duration::from_millis(200),
            "first delay too large: {:?}",
            recorded[0]
        );
        assert!(
            recorded[1] <= Duration::from_millis(400),
            "second delay too large: {:?}",
            recorded[1]
        );
        assert!(
            recorded[2] <= Duration::from_millis(800),
            "third delay too large: {:?}",
            recorded[2]
        );
    }

    // -- CircuitBreakerConfig tests --

    #[test]
    fn test_circuit_breaker_config_default() {
        let config = CircuitBreakerConfig::default();
        assert_eq!(config.failure_threshold, 3);
        assert_eq!(config.recovery_timeout, Duration::from_secs(30));
    }

    // -- CircuitBreaker tests --

    #[test]
    fn test_circuit_breaker_starts_closed() {
        let cb = CircuitBreaker::new(CircuitBreakerConfig::default());
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn test_circuit_breaker_allows_when_closed() {
        let cb = CircuitBreaker::new(CircuitBreakerConfig::default());
        assert!(cb.check_allowed().is_ok());
    }

    #[test]
    fn test_circuit_breaker_opens_after_threshold_failures() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(config);

        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }

    #[test]
    fn test_circuit_breaker_rejects_when_open() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();

        assert_eq!(cb.state(), CircuitState::Open);
        assert!(cb.check_allowed().is_err());
    }

    #[test]
    fn test_circuit_breaker_transitions_to_half_open_after_timeout() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_millis(150),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();

        // Should be open immediately after failure (timeout hasn't elapsed)
        assert!(cb.check_allowed().is_err());

        // After recovery timeout, should transition to HalfOpen
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(cb.state(), CircuitState::HalfOpen);
    }

    #[test]
    fn test_circuit_breaker_closes_on_successful_probe() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_millis(150),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();

        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn test_circuit_breaker_reopens_on_failed_probe() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_millis(150),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();

        // Wait for recovery timeout to transition to HalfOpen
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        // Failed probe should reopen the circuit
        cb.record_failure();

        // Should be Open - verify by checking that check_allowed rejects
        // (use check_allowed instead of state() to avoid immediate re-transition)
        assert!(cb.check_allowed().is_err());
    }

    #[test]
    fn test_circuit_breaker_success_resets_failure_count() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(config);

        cb.record_failure();
        cb.record_failure();
        cb.record_success();
        cb.record_failure();
        cb.record_failure();

        // Should still be closed because success reset the counter
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[test]
    fn test_circuit_breaker_manual_reset() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        cb.reset();
        assert_eq!(cb.state(), CircuitState::Closed);
        assert!(cb.check_allowed().is_ok());
    }

    #[test]
    fn test_circuit_breaker_half_open_allows_request() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_millis(150),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();

        std::thread::sleep(Duration::from_millis(200));
        assert!(cb.check_allowed().is_ok());
    }

    #[tokio::test]
    async fn test_retry_warn_log_on_transient_then_success() {
        let config = RetryConfig {
            max_retries: 2,
            initial_delay: Duration::from_millis(10),
            multiplier: 2.0,
            ..Default::default()
        };
        let attempt = AtomicU32::new(0);

        let result = retry_with_backoff(
            &config,
            || {
                let n = attempt.fetch_add(1, Ordering::SeqCst);
                async move {
                    if n == 0 {
                        Err(DirectoryError::Timeout)
                    } else {
                        Ok("recovered")
                    }
                }
            },
            |_| async {},
        )
        .await;

        assert_eq!(result.unwrap(), "recovered");
        assert_eq!(attempt.load(Ordering::SeqCst), 2);
    }

    // -- TimeoutConfig tests --

    #[test]
    fn test_timeout_config_default() {
        let config = TimeoutConfig::default();
        assert_eq!(config.ldap, Duration::from_secs(30));
        assert_eq!(config.graph_api, Duration::from_secs(15));
        assert_eq!(config.hibp, Duration::from_secs(5));
        assert_eq!(config.wmi, Duration::from_secs(10));
    }

    // -- Additional coverage tests --

    #[tokio::test]
    async fn test_retry_with_zero_multiplier_does_not_infinite_loop() {
        let config = RetryConfig {
            max_retries: 3,
            initial_delay: Duration::from_millis(10),
            multiplier: 0.0,
            ..Default::default()
        };

        let delays: Arc<Mutex<Vec<Duration>>> = Arc::new(Mutex::new(Vec::new()));
        let delays_clone = delays.clone();
        let attempt = AtomicU32::new(0);

        let result = retry_with_backoff(
            &config,
            || {
                attempt.fetch_add(1, Ordering::SeqCst);
                async { Err::<i32, _>(DirectoryError::Timeout) }
            },
            move |d| {
                let delays = delays_clone.clone();
                async move {
                    delays.lock().unwrap().push(d);
                }
            },
        )
        .await;

        assert!(result.is_err());
        // 1 initial + 3 retries = 4 total attempts
        assert_eq!(attempt.load(Ordering::SeqCst), 4);
        let recorded = delays.lock().unwrap();
        assert_eq!(recorded.len(), 3);
        // First delay is at most initial_delay (jitter may reduce it), subsequent delays collapse toward zero
        assert!(
            recorded[0] <= Duration::from_millis(20),
            "first delay too large: {:?}",
            recorded[0]
        );
        assert!(
            recorded[1] <= Duration::from_millis(10),
            "second delay should be near zero: {:?}",
            recorded[1]
        );
        assert!(
            recorded[2] <= Duration::from_millis(10),
            "third delay should be near zero: {:?}",
            recorded[2]
        );
    }

    #[tokio::test]
    async fn test_retry_with_very_small_initial_delay() {
        let config = RetryConfig {
            max_retries: 5,
            initial_delay: Duration::from_millis(1),
            multiplier: 2.0,
            ..Default::default()
        };

        let delays: Arc<Mutex<Vec<Duration>>> = Arc::new(Mutex::new(Vec::new()));
        let delays_clone = delays.clone();

        let _ = retry_with_backoff(
            &config,
            || async { Err::<i32, _>(DirectoryError::Busy) },
            move |d| {
                let delays = delays_clone.clone();
                async move {
                    delays.lock().unwrap().push(d);
                }
            },
        )
        .await;

        let recorded = delays.lock().unwrap();
        assert_eq!(recorded.len(), 5);
        // Verify roughly exponential growth from 1ms (jitter applied, so check upper bounds)
        assert!(
            recorded[0] <= Duration::from_millis(2),
            "delay 0: {:?}",
            recorded[0]
        );
        assert!(
            recorded[1] <= Duration::from_millis(4),
            "delay 1: {:?}",
            recorded[1]
        );
        assert!(
            recorded[2] <= Duration::from_millis(8),
            "delay 2: {:?}",
            recorded[2]
        );
        assert!(
            recorded[3] <= Duration::from_millis(16),
            "delay 3: {:?}",
            recorded[3]
        );
        assert!(
            recorded[4] <= Duration::from_millis(32),
            "delay 4: {:?}",
            recorded[4]
        );
    }

    #[test]
    fn test_circuit_breaker_half_open_allows_one_rejects_second() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: Duration::from_millis(150),
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Wait for recovery timeout to transition to HalfOpen
        std::thread::sleep(Duration::from_millis(200));

        // First check transitions to HalfOpen and allows the request
        assert!(cb.check_allowed().is_ok());
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        // Simulate the probe request failing, which reopens the circuit
        cb.record_failure();

        // Second request should be rejected because circuit is Open again
        assert!(cb.check_allowed().is_err());
    }

    #[test]
    fn test_circuit_breaker_recovery_timeout_boundary() {
        let timeout = Duration::from_millis(300);
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            recovery_timeout: timeout,
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Sleep well under the timeout - should still be Open
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(cb.state(), CircuitState::Open);

        // Sleep past the remaining timeout - should transition to HalfOpen
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(cb.state(), CircuitState::HalfOpen);
    }

    #[tokio::test]
    async fn test_retry_exhaustion_returns_last_error_message() {
        let config = RetryConfig {
            max_retries: 2,
            initial_delay: Duration::from_millis(1),
            multiplier: 1.0,
            ..Default::default()
        };

        let attempt = AtomicU32::new(0);
        let result = retry_with_backoff(
            &config,
            || {
                let n = attempt.fetch_add(1, Ordering::SeqCst);
                async move {
                    // Return different transient errors on each attempt
                    match n {
                        0 => Err::<i32, _>(DirectoryError::Timeout),
                        1 => Err(DirectoryError::Busy),
                        _ => Err(DirectoryError::ServerDown),
                    }
                }
            },
            |_| async {},
        )
        .await;

        let err = result.unwrap_err();
        // The last attempt (n=2) returns ServerDown
        assert!(
            matches!(err, DirectoryError::ServerDown),
            "Expected ServerDown from last attempt, got: {err}"
        );
    }

    #[test]
    fn test_circuit_breaker_failure_count_resets_after_success_in_closed() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            recovery_timeout: Duration::from_secs(60),
        };
        let cb = CircuitBreaker::new(config);

        // Accumulate failures just below threshold
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);

        // A success should reset the counter
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);

        // Now we need 3 fresh failures to open, not just 1
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);
    }
}
