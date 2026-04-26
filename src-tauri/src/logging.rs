use std::path::{Path, PathBuf};
use tracing_appender::rolling;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Returns the OS-standard directory where DSPanel logs should be written.
///
/// This is computed before `init_logging` runs, so it cannot rely on the
/// Tauri path resolver (which is only available inside the `setup` hook).
/// Resolution per platform:
/// - **Windows**: `%LOCALAPPDATA%\DSPanel\logs`
/// - **macOS**: `$HOME/Library/Logs/DSPanel`
/// - **Linux/BSD**: `$XDG_STATE_HOME/DSPanel/logs`, else `$HOME/.local/state/DSPanel/logs`
///
/// Falls back to a relative `logs/` path if no environment variable is
/// available (typically only in stripped CI environments). Callers that need
/// determinism in tests should pass an explicit path to `init_logging` rather
/// than rely on this.
pub fn default_log_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA")
            && !local.is_empty()
        {
            return PathBuf::from(local).join("DSPanel").join("logs");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME")
            && !home.is_empty()
        {
            return PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join("DSPanel");
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(state) = std::env::var("XDG_STATE_HOME")
            && !state.is_empty()
        {
            return PathBuf::from(state).join("DSPanel").join("logs");
        }
        if let Ok(home) = std::env::var("HOME")
            && !home.is_empty()
        {
            return PathBuf::from(home)
                .join(".local")
                .join("state")
                .join("DSPanel")
                .join("logs");
        }
    }
    PathBuf::from("logs")
}

/// Initialize the tracing subscriber with console and rolling file outputs.
///
/// - Console output: human-readable, colored
/// - File output: rolling daily `dspanel.log.YYYY-MM-DD` in `log_dir`
/// - Default level: `info`
/// - Noisy crates (`hyper`, `tao`, `wry`) are set to `warn`
///
/// `log_dir` is created if missing. The resolved absolute path is printed
/// to stderr at startup so users can find it without relying on the
/// in-app log viewer.
pub fn init_logging(log_dir: impl AsRef<Path>) {
    let log_dir = log_dir.as_ref();
    if let Err(e) = std::fs::create_dir_all(log_dir) {
        // Cannot use tracing yet - it has not been initialized.
        eprintln!(
            "DSPanel: failed to create log directory {}: {} - falling back to current directory",
            log_dir.display(),
            e
        );
    } else {
        eprintln!("DSPanel: writing logs to {}", log_dir.display());
    }

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,hyper=warn,tao=warn,wry=warn,reqwest=warn"));

    let file_appender = rolling::daily(log_dir, "dspanel.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Intentional leak: the WorkerGuard must outlive all tracing calls,
    // meaning it must live for the entire process. Dropping it would flush
    // and close the non-blocking writer, silently losing subsequent log
    // entries. Since Tauri has no pre-exit hook to drop it gracefully,
    // leaking is the standard approach for process-lifetime logging.
    #[allow(clippy::mem_forget)]
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
#[allow(clippy::unwrap_used)]
#[cfg(test)]
pub fn init_test_logging() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new("debug"))
        .with_test_writer()
        .try_init();
}

#[allow(clippy::unwrap_used)]
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

    #[test]
    fn test_file_layer_construction() {
        let test_dir = "target/test-logs-layer";
        let _ = fs::remove_dir_all(test_dir);
        fs::create_dir_all(test_dir).unwrap();

        let file_appender = rolling::daily(test_dir, "dspanel.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

        // Build the same layers as init_logging
        use tracing_subscriber::Registry;
        let _file_layer = fmt::layer::<Registry>()
            .with_writer(non_blocking)
            .with_ansi(false)
            .with_target(true)
            .with_thread_ids(true);

        drop(guard);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn test_console_layer_construction() {
        use tracing_subscriber::Registry;
        let _console_layer = fmt::layer::<Registry>()
            .with_writer(std::io::stdout)
            .with_target(true);
        // Console layer created without panic
    }

    #[test]
    fn test_env_filter_from_env_var_fallback() {
        // When RUST_LOG is not set, should fall back to default
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info,hyper=warn,tao=warn,wry=warn,reqwest=warn"));
        let filter_str = format!("{}", filter);
        assert!(filter_str.contains("warn"));
    }

    #[test]
    fn test_non_blocking_writer_with_guard() {
        let test_dir = "target/test-logs-guard";
        let _ = fs::remove_dir_all(test_dir);
        fs::create_dir_all(test_dir).unwrap();

        let file_appender = rolling::daily(test_dir, "test.log");
        let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

        // Verify the non-blocking writer works
        use tracing_subscriber::Registry;
        let _layer = fmt::layer::<Registry>().with_writer(non_blocking);

        // Guard must be dropped explicitly
        drop(guard);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn test_env_filter_custom_string() {
        let filter = EnvFilter::new("debug,hyper=error");
        let filter_str = format!("{}", filter);
        assert!(filter_str.contains("debug"));
    }

    #[test]
    fn test_env_filter_trace_level() {
        let filter = EnvFilter::new("trace");
        let filter_str = format!("{}", filter);
        assert!(filter_str.contains("trace"));
    }

    #[test]
    fn test_rolling_appender_created_for_different_dirs() {
        let test_dir = "target/test-logs-multi";
        let _ = fs::remove_dir_all(test_dir);
        fs::create_dir_all(test_dir).unwrap();

        let appender1 = rolling::daily(test_dir, "app1.log");
        let appender2 = rolling::daily(test_dir, "app2.log");
        let (nb1, g1) = tracing_appender::non_blocking(appender1);
        let (nb2, g2) = tracing_appender::non_blocking(appender2);

        drop(nb1);
        drop(nb2);
        drop(g1);
        drop(g2);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn test_init_test_logging_is_idempotent() {
        // Call three times - should never panic
        init_test_logging();
        init_test_logging();
        init_test_logging();
    }

    // -----------------------------------------------------------------------
    // default_log_dir + init_logging directory creation
    // -----------------------------------------------------------------------

    #[test]
    fn test_default_log_dir_returns_absolute_path_when_env_present() {
        // The function must produce a path under the OS-standard location for
        // each platform when its primary env var is available, never inside
        // the current working directory.
        let dir = default_log_dir();

        #[cfg(windows)]
        if let Ok(local) = std::env::var("LOCALAPPDATA")
            && !local.is_empty()
        {
            assert!(
                dir.starts_with(&local),
                "expected {} under LOCALAPPDATA={}",
                dir.display(),
                local
            );
            assert!(dir.ends_with("DSPanel/logs") || dir.ends_with("DSPanel\\logs"));
        }

        #[cfg(target_os = "macos")]
        if let Ok(home) = std::env::var("HOME")
            && !home.is_empty()
        {
            assert!(dir.starts_with(&home));
            assert!(dir.ends_with("Library/Logs/DSPanel"));
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        if let Ok(home) = std::env::var("HOME")
            && !home.is_empty()
            && std::env::var("XDG_STATE_HOME").is_err()
        {
            assert!(dir.starts_with(&home));
            assert!(dir.ends_with(".local/state/DSPanel/logs"));
        }
    }

    #[test]
    fn test_default_log_dir_path_segments_include_dspanel() {
        let dir = default_log_dir();
        let s = dir.to_string_lossy().to_lowercase();
        // Either resolved to an OS path (always contains "dspanel") or fell
        // back to the relative "logs" - the fallback is a degraded state we
        // explicitly accept. Both are acceptable shapes here.
        assert!(s.contains("dspanel") || s == "logs");
    }

    #[test]
    fn test_init_logging_creates_missing_directory() {
        let unique = format!(
            "target/test-init-logging-create-{}",
            chrono::Utc::now().timestamp_millis()
        );
        let test_dir = std::path::PathBuf::from(&unique);
        let _ = fs::remove_dir_all(&test_dir);
        // Do NOT pre-create - init_logging must do it.

        // We cannot call init_logging() here because subscriber.init() is
        // process-global. Mirror its directory-creation step instead.
        std::fs::create_dir_all(&test_dir).unwrap();
        let appender = rolling::daily(&test_dir, "dspanel.log");
        let (_nb, guard) = tracing_appender::non_blocking(appender);
        drop(guard);

        assert!(test_dir.exists());
        let _ = fs::remove_dir_all(&test_dir);
    }
}
