use tracing_appender::rolling;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// Initialize the tracing subscriber with console and rolling file outputs.
///
/// - Console output: human-readable, colored
/// - File output: rolling daily logs in `logs/` directory
/// - Default level: `info`
/// - Noisy crates (`hyper`, `tao`, `wry`) are set to `warn`
pub fn init_logging(log_dir: &str) {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,hyper=warn,tao=warn,wry=warn,reqwest=warn"));

    let file_appender = rolling::daily(log_dir, "dspanel.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Leak the guard so it lives for the entire process lifetime.
    // This is intentional - the guard must outlive all tracing calls.
    std::mem::forget(_guard);

    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(true);

    let console_layer = fmt::layer().with_writer(std::io::stdout).with_target(true);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();
}

/// Initialize logging for tests (console only, no file).
///
/// This is safe to call multiple times - subsequent calls are silently ignored
/// by tracing_subscriber.
#[cfg(test)]
pub fn init_test_logging() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("debug"))
        .with_test_writer()
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_init_logging_creates_log_directory() {
        let test_dir = "target/test-logs-init";
        let _ = fs::remove_dir_all(test_dir);
        fs::create_dir_all(test_dir).unwrap();

        // We can't fully test init_logging because it calls .init() which
        // can only be called once per process. Instead, verify the components work.
        let file_appender = rolling::daily(test_dir, "dspanel.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
        // Verify non_blocking writer was created successfully
        drop(non_blocking);
        drop(guard);

        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn test_env_filter_default_levels() {
        let filter = EnvFilter::new("info,hyper=warn,tao=warn,wry=warn,reqwest=warn");
        // Verify filter was created without panic
        let filter_str = format!("{}", filter);
        assert!(filter_str.contains("info"));
    }

    #[test]
    fn test_init_test_logging_does_not_panic() {
        init_test_logging();
        // Second call should also not panic
        init_test_logging();
    }
}
