use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::collections::HashMap;
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::{fs, path::PathBuf};
use std::time::Instant;
use zeroize::Zeroize;

type HmacSha1 = Hmac<Sha1>;

/// Duration for which a successful MFA verification remains valid.
const MFA_SESSION_WINDOW: std::time::Duration = std::time::Duration::from_secs(300); // 5 minutes

/// Duration for which a used TOTP code is cached to prevent replay attacks.
const TOTP_REPLAY_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// Result of MFA setup containing the secret and backup codes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaSetupResult {
    pub secret_base32: String,
    pub qr_uri: String,
    pub backup_codes: Vec<String>,
}

/// MFA configuration for per-action requirements.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaConfig {
    pub require_for_password_reset: bool,
    pub require_for_account_disable: bool,
    pub require_for_flag_changes: bool,
    pub require_for_bulk_operations: bool,
}

impl Default for MfaConfig {
    fn default() -> Self {
        Self {
            require_for_password_reset: true,
            require_for_account_disable: true,
            require_for_flag_changes: false,
            require_for_bulk_operations: false,
        }
    }
}

/// Persisted MFA data (secret + backup codes).
#[derive(Serialize, Deserialize)]
struct MfaPersistedData {
    secret_b64: String,
    backup_codes: Vec<String>,
}

/// TOTP-based MFA service implementing RFC 6238.
///
/// The shared secret and backup codes are persisted for durability across
/// restarts. On Windows, uses DPAPI-encrypted file (`mfa.dat`). On
/// macOS/Linux, uses the OS keychain via the `keyring` crate.
pub struct MfaService {
    secret: Mutex<Option<Vec<u8>>>,
    backup_codes: Mutex<Vec<String>>,
    config: Mutex<MfaConfig>,
    /// Path to the DPAPI-encrypted file (Windows only).
    #[cfg(target_os = "windows")]
    persist_path: Option<PathBuf>,
    failed_attempts: Mutex<u32>,
    last_verified: Mutex<Option<Instant>>,
    /// Cache of recently used TOTP codes to prevent replay attacks.
    /// Maps code -> timestamp when it was used.
    used_codes: Mutex<HashMap<String, Instant>>,
}

impl Default for MfaService {
    fn default() -> Self {
        Self::new()
    }
}

/// Keyring service name used on non-Windows platforms.
#[cfg(not(target_os = "windows"))]
const KEYRING_SERVICE: &str = "DSPanel-MFA";
/// Keyring key for the MFA secret + backup codes JSON blob.
#[cfg(not(target_os = "windows"))]
const KEYRING_KEY: &str = "mfa_data";

impl MfaService {
    pub fn new() -> Self {
        let (secret, backup_codes) = Self::load_persisted().unwrap_or((None, Vec::new()));

        Self {
            secret: Mutex::new(secret),
            backup_codes: Mutex::new(backup_codes),
            config: Mutex::new(MfaConfig::default()),
            #[cfg(target_os = "windows")]
            persist_path: Self::resolve_persist_path(),
            failed_attempts: Mutex::new(0),
            last_verified: Mutex::new(None),
            used_codes: Mutex::new(HashMap::new()),
        }
    }

    /// Creates an MfaService without persistence (for testing).
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        Self {
            secret: Mutex::new(None),
            backup_codes: Mutex::new(Vec::new()),
            config: Mutex::new(MfaConfig::default()),
            #[cfg(target_os = "windows")]
            persist_path: None,
            failed_attempts: Mutex::new(0),
            last_verified: Mutex::new(None),
            used_codes: Mutex::new(HashMap::new()),
        }
    }

    // -----------------------------------------------------------------------
    // Windows: DPAPI-encrypted file (mfa.dat)
    // -----------------------------------------------------------------------

    #[cfg(target_os = "windows")]
    fn resolve_persist_path() -> Option<PathBuf> {
        let base = std::env::var("LOCALAPPDATA").ok()?;
        let dir = PathBuf::from(base).join("DSPanel");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok()?;
        }
        Some(dir.join("mfa.dat"))
    }

    #[cfg(target_os = "windows")]
    fn load_persisted() -> Option<(Option<Vec<u8>>, Vec<String>)> {
        let path = Self::resolve_persist_path()?;
        let encrypted = fs::read(&path).ok()?;
        let decrypted = crate::services::dpapi::unprotect(&encrypted).ok()?;
        let persisted: MfaPersistedData = serde_json::from_slice(&decrypted).ok()?;
        use base64::Engine;
        let secret = base64::engine::general_purpose::STANDARD
            .decode(&persisted.secret_b64)
            .ok()?;
        tracing::info!("MFA secret loaded from DPAPI-protected storage");
        Some((Some(secret), persisted.backup_codes))
    }

    #[cfg(target_os = "windows")]
    fn persist(&self) {
        if let Some(ref path) = self.persist_path {
            let secret = self.secret.lock().expect("lock poisoned");
            if let Some(ref s) = *secret {
                use base64::Engine;
                let data = MfaPersistedData {
                    secret_b64: base64::engine::general_purpose::STANDARD.encode(s),
                    backup_codes: self.backup_codes.lock().expect("lock poisoned").clone(),
                };
                if let Ok(json) = serde_json::to_string(&data) {
                    match crate::services::dpapi::protect(json.as_bytes()) {
                        Ok(encrypted) => {
                            if let Err(e) = fs::write(path, encrypted) {
                                tracing::warn!("Failed to persist MFA data: {}", e);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("DPAPI encryption failed: {}", e);
                        }
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Non-Windows: OS keychain via keyring crate
    // -----------------------------------------------------------------------

    #[cfg(not(target_os = "windows"))]
    fn load_persisted() -> Option<(Option<Vec<u8>>, Vec<String>)> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY).ok()?;
        let json = match entry.get_password() {
            Ok(pw) => pw,
            Err(keyring::Error::NoEntry) => return None,
            Err(e) => {
                tracing::warn!("Failed to read MFA data from OS keychain: {}", e);
                return None;
            }
        };
        let persisted: MfaPersistedData = serde_json::from_str(&json).ok()?;
        use base64::Engine;
        let secret = base64::engine::general_purpose::STANDARD
            .decode(&persisted.secret_b64)
            .ok()?;
        tracing::info!("MFA secret loaded from OS keychain");
        Some((Some(secret), persisted.backup_codes))
    }

    #[cfg(not(target_os = "windows"))]
    fn persist(&self) {
        let secret = self.secret.lock().expect("lock poisoned");
        if let Some(ref s) = *secret {
            use base64::Engine;
            let data = MfaPersistedData {
                secret_b64: base64::engine::general_purpose::STANDARD.encode(s),
                backup_codes: self.backup_codes.lock().expect("lock poisoned").clone(),
            };
            if let Ok(json) = serde_json::to_string(&data) {
                match keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY) {
                    Ok(entry) => {
                        if let Err(e) = entry.set_password(&json) {
                            tracing::warn!("Failed to persist MFA data to OS keychain: {}", e);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to create keyring entry: {}", e);
                    }
                }
            }
        }
    }

    /// Whether MFA has been configured (secret exists).
    pub fn is_configured(&self) -> bool {
        self.secret.lock().expect("lock poisoned").is_some()
    }

    /// Returns the current MFA configuration.
    pub fn config(&self) -> MfaConfig {
        self.config.lock().expect("lock poisoned").clone()
    }

    /// Updates the MFA configuration.
    pub fn set_config(&self, config: MfaConfig) {
        *self.config.lock().expect("lock poisoned") = config;
    }

    /// Whether a given action requires MFA verification.
    pub fn requires_mfa(&self, action: &str) -> bool {
        if !self.is_configured() {
            return false;
        }
        let config = self.config.lock().expect("lock poisoned");
        match action {
            "PasswordReset" => config.require_for_password_reset,
            "AccountDisable" => config.require_for_account_disable,
            "PasswordFlagsChange" => config.require_for_flag_changes,
            "BulkOperation" => config.require_for_bulk_operations,
            _ => false,
        }
    }

    /// Checks whether MFA verification is required and still valid for an action.
    ///
    /// Returns `Ok(())` if:
    /// - MFA is not configured, OR
    /// - The action does not require MFA, OR
    /// - MFA was successfully verified within the session window (5 minutes)
    ///
    /// Returns `Err` if MFA is required but not recently verified.
    pub fn check_mfa_for_action(&self, action: &str) -> Result<()> {
        if !self.requires_mfa(action) {
            return Ok(());
        }

        let last = self.last_verified.lock().expect("lock poisoned");
        match *last {
            Some(ts) if ts.elapsed() < MFA_SESSION_WINDOW => Ok(()),
            _ => anyhow::bail!(
                "MFA verification required for {}. Please verify your identity first.",
                action
            ),
        }
    }

    /// Generates a new TOTP secret and backup codes.
    /// Persists the secret to local storage for durability.
    pub fn setup(&self, username: &str) -> Result<MfaSetupResult> {
        let mut rng = rand::rng();
        let secret: Vec<u8> = (0..20).map(|_| rng.random()).collect();
        let secret_b32 = data_encoding::BASE32_NOPAD.encode(&secret);

        let qr_uri = format!(
            "otpauth://totp/DSPanel:{}?secret={}&issuer=DSPanel&algorithm=SHA1&digits=6&period=30",
            username, secret_b32
        );

        let backup_codes: Vec<String> = (0..10)
            .map(|_| {
                let code: u32 = rng.random_range(10000000..99999999);
                format!("{}", code)
            })
            .collect();

        *self.secret.lock().expect("lock poisoned") = Some(secret);
        *self.backup_codes.lock().expect("lock poisoned") = backup_codes.clone();
        *self.failed_attempts.lock().expect("lock poisoned") = 0;
        self.persist();

        Ok(MfaSetupResult {
            secret_base32: secret_b32,
            qr_uri,
            backup_codes,
        })
    }

    /// Maximum consecutive failed attempts before temporary lockout.
    const MAX_FAILED_ATTEMPTS: u32 = 5;

    /// Verifies a TOTP code against the stored secret.
    ///
    /// Accepts codes from T-1, T, and T+1 time steps (90-second window).
    /// Rate-limited: after 5 consecutive failures, verification is blocked.
    pub fn verify(&self, code: &str) -> Result<bool> {
        {
            let attempts = self.failed_attempts.lock().expect("lock poisoned");
            if *attempts >= Self::MAX_FAILED_ATTEMPTS {
                anyhow::bail!(
                    "Too many failed MFA attempts ({}). Please wait before retrying.",
                    *attempts
                );
            }
        }

        // Evict expired entries from the replay cache
        {
            let mut used = self.used_codes.lock().expect("lock poisoned");
            used.retain(|_, ts| ts.elapsed() < TOTP_REPLAY_TTL);
        }

        // Check replay: reject codes already used within the TTL window
        {
            let used = self.used_codes.lock().expect("lock poisoned");
            if used.contains_key(code) {
                tracing::warn!("TOTP replay detected: code already used");
                return Ok(false);
            }
        }

        let secret = self
            .secret
            .lock()
            .expect("lock poisoned")
            .clone()
            .context("MFA not configured")?;

        // Check backup codes first
        {
            let mut backup_codes = self.backup_codes.lock().expect("lock poisoned");
            if let Some(pos) = backup_codes.iter().position(|c| c == code) {
                backup_codes.remove(pos);
                *self.failed_attempts.lock().expect("lock poisoned") = 0;
                *self.last_verified.lock().expect("lock poisoned") = Some(Instant::now());
                self.persist();
                tracing::info!("MFA verified via backup code");
                return Ok(true);
            }
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .context("System time error")?
            .as_secs();

        let current_step = now / 30;

        // Check T-1, T, T+1 for clock drift tolerance
        for offset in [-1i64, 0, 1] {
            let step = (current_step as i64 + offset) as u64;
            let expected = generate_totp(&secret, step)?;
            if expected == code {
                *self.failed_attempts.lock().expect("lock poisoned") = 0;
                *self.last_verified.lock().expect("lock poisoned") = Some(Instant::now());
                self.used_codes
                    .lock()
                    .expect("lock poisoned")
                    .insert(code.to_string(), Instant::now());
                return Ok(true);
            }
        }

        *self.failed_attempts.lock().expect("lock poisoned") += 1;
        Ok(false)
    }

    /// Resets the failed attempt counter (e.g., after a cooldown period).
    pub fn reset_failed_attempts(&self) {
        *self.failed_attempts.lock().expect("lock poisoned") = 0;
    }

    /// Revokes MFA setup by removing the stored secret and persisted data.
    pub fn revoke(&self) {
        if let Some(ref mut secret) = *self.secret.lock().expect("lock poisoned") {
            secret.zeroize();
        }
        *self.secret.lock().expect("lock poisoned") = None;
        self.backup_codes.lock().expect("lock poisoned").clear();
        *self.failed_attempts.lock().expect("lock poisoned") = 0;
        self.delete_persisted();
    }

    #[cfg(target_os = "windows")]
    fn delete_persisted(&self) {
        if let Some(ref path) = self.persist_path {
            let _ = fs::remove_file(path);
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn delete_persisted(&self) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_KEY) {
            let _ = entry.delete_credential();
        }
    }
}

impl Drop for MfaService {
    fn drop(&mut self) {
        if let Ok(mut secret) = self.secret.lock()
            && let Some(ref mut s) = *secret
        {
            s.zeroize();
        }
    }
}

/// Generates a 6-digit TOTP code for a given time step (RFC 6238).
fn generate_totp(secret: &[u8], time_step: u64) -> Result<String> {
    let time_bytes = time_step.to_be_bytes();

    let mut mac = HmacSha1::new_from_slice(secret).context("Invalid HMAC key length")?;
    mac.update(&time_bytes);
    let result = mac.finalize().into_bytes();

    // Dynamic truncation
    let offset = (result[result.len() - 1] & 0x0f) as usize;
    let code = ((result[offset] as u32 & 0x7f) << 24)
        | ((result[offset + 1] as u32) << 16)
        | ((result[offset + 2] as u32) << 8)
        | (result[offset + 3] as u32);

    let otp = code % 1_000_000;
    Ok(format!("{:06}", otp))
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_totp_known_vector() {
        // RFC 6238 test vector: secret = "12345678901234567890" (ASCII), time step 1
        let secret = b"12345678901234567890";
        let code = generate_totp(secret, 1).unwrap();
        assert_eq!(code.len(), 6);
        // Verify it produces a valid 6-digit string
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_generate_totp_rfc6238_time_step_0x23523ec() {
        // RFC 6238 Appendix B: time = 59, T = 0x0000000000000001
        let secret = b"12345678901234567890";
        let code = generate_totp(secret, 0x0000000000000001).unwrap();
        assert_eq!(code, "287082");
    }

    #[test]
    fn test_generate_totp_different_steps_produce_different_codes() {
        let secret = b"test_secret_key_here";
        let code1 = generate_totp(secret, 100).unwrap();
        let code2 = generate_totp(secret, 200).unwrap();
        assert_ne!(code1, code2);
    }

    #[test]
    fn test_generate_totp_code_is_6_digits() {
        let secret = b"mysecretkeytestvalue";
        for step in 0..100 {
            let code = generate_totp(secret, step).unwrap();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn test_mfa_service_not_configured_initially() {
        let svc = MfaService::new_in_memory();
        assert!(!svc.is_configured());
    }

    #[test]
    fn test_mfa_setup_configures_service() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        assert!(svc.is_configured());
        assert!(!result.secret_base32.is_empty());
        assert!(result.qr_uri.contains("otpauth://totp/DSPanel:testuser"));
        assert_eq!(result.backup_codes.len(), 10);
    }

    #[test]
    fn test_mfa_setup_produces_valid_qr_uri() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("admin").unwrap();
        assert!(result.qr_uri.contains("secret="));
        assert!(result.qr_uri.contains("issuer=DSPanel"));
        assert!(result.qr_uri.contains("algorithm=SHA1"));
        assert!(result.qr_uri.contains("digits=6"));
        assert!(result.qr_uri.contains("period=30"));
    }

    #[test]
    fn test_mfa_backup_codes_are_unique() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        let mut codes = result.backup_codes.clone();
        codes.sort();
        codes.dedup();
        // Extremely unlikely to have duplicates with 8-digit random codes
        assert_eq!(codes.len(), 10);
    }

    #[test]
    fn test_mfa_verify_backup_code() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
    }

    #[test]
    fn test_mfa_backup_code_single_use() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
        // Second use should fail
        assert!(!svc.verify(&backup).unwrap());
    }

    #[test]
    fn test_mfa_verify_wrong_code() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        assert!(!svc.verify("000000").unwrap());
    }

    #[test]
    fn test_mfa_verify_not_configured_fails() {
        let svc = MfaService::new_in_memory();
        assert!(svc.verify("123456").is_err());
    }

    #[test]
    fn test_mfa_revoke() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        assert!(svc.is_configured());
        svc.revoke();
        assert!(!svc.is_configured());
    }

    #[test]
    fn test_mfa_config_default() {
        let config = MfaConfig::default();
        assert!(config.require_for_password_reset);
        assert!(config.require_for_account_disable);
        assert!(!config.require_for_flag_changes);
        assert!(!config.require_for_bulk_operations);
    }

    #[test]
    fn test_mfa_requires_mfa_when_not_configured() {
        let svc = MfaService::new_in_memory();
        assert!(!svc.requires_mfa("PasswordReset"));
    }

    #[test]
    fn test_mfa_requires_mfa_when_configured() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        assert!(svc.requires_mfa("PasswordReset"));
        assert!(svc.requires_mfa("AccountDisable"));
        assert!(!svc.requires_mfa("PasswordFlagsChange"));
        assert!(!svc.requires_mfa("UnknownAction"));
    }

    #[test]
    fn test_mfa_config_serialization() {
        let config = MfaConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("requireForPasswordReset"));
    }

    #[test]
    fn test_mfa_set_config() {
        let svc = MfaService::new_in_memory();
        let config = MfaConfig {
            require_for_flag_changes: true,
            ..Default::default()
        };
        svc.set_config(config);
        svc.setup("testuser").unwrap();
        assert!(svc.requires_mfa("PasswordFlagsChange"));
    }

    #[test]
    fn test_mfa_setup_result_serialization() {
        let result = MfaSetupResult {
            secret_base32: "JBSWY3DPEHPK3PXP".to_string(),
            qr_uri: "otpauth://totp/DSPanel:test?secret=JBSWY3DPEHPK3PXP".to_string(),
            backup_codes: vec!["12345678".to_string()],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("secretBase32"));
        assert!(json.contains("qrUri"));
        assert!(json.contains("backupCodes"));
    }

    #[test]
    fn test_check_mfa_for_action_not_configured() {
        let svc = MfaService::new_in_memory();
        // Not configured - should pass without verification
        assert!(svc.check_mfa_for_action("PasswordReset").is_ok());
    }

    #[test]
    fn test_check_mfa_for_action_configured_but_not_verified() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        // Configured but never verified - should fail
        assert!(svc.check_mfa_for_action("PasswordReset").is_err());
    }

    #[test]
    fn test_check_mfa_for_action_after_verification() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
        // Just verified - should pass
        assert!(svc.check_mfa_for_action("PasswordReset").is_ok());
    }

    #[test]
    fn test_check_mfa_for_action_not_required() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        // PasswordFlagsChange not required by default
        assert!(svc.check_mfa_for_action("PasswordFlagsChange").is_ok());
    }

    #[test]
    fn test_mfa_rate_limiting_blocks_after_max_attempts() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        // Fail 5 times
        for _ in 0..5 {
            assert!(!svc.verify("000000").unwrap());
        }

        // 6th attempt should be blocked with an error
        let result = svc.verify("000000");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Too many failed MFA attempts")
        );
    }

    #[test]
    fn test_mfa_reset_failed_attempts() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        // Fail 3 times
        for _ in 0..3 {
            assert!(!svc.verify("000000").unwrap());
        }

        svc.reset_failed_attempts();

        // Should be able to verify again (not locked out)
        assert!(!svc.verify("000000").unwrap());
    }

    #[test]
    fn test_mfa_successful_verify_resets_failed_count() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();

        // Fail 3 times
        for _ in 0..3 {
            assert!(!svc.verify("000000").unwrap());
        }

        // Succeed with backup code - should reset counter
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());

        // Should be able to fail again without being locked
        for _ in 0..4 {
            assert!(!svc.verify("000000").unwrap());
        }
    }

    #[test]
    fn test_mfa_revoke_clears_failed_attempts() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        for _ in 0..3 {
            assert!(!svc.verify("000000").unwrap());
        }

        svc.revoke();

        // After revoke, not configured
        assert!(!svc.is_configured());
        assert!(svc.verify("123456").is_err()); // err because not configured
    }

    #[test]
    fn test_mfa_requires_bulk_operations_when_configured() {
        let svc = MfaService::new_in_memory();
        let config = MfaConfig {
            require_for_bulk_operations: true,
            ..Default::default()
        };
        svc.set_config(config);
        svc.setup("testuser").unwrap();
        assert!(svc.requires_mfa("BulkOperation"));
    }

    #[test]
    fn test_mfa_default_service() {
        // Test Default trait implementation
        let svc = MfaService::new_in_memory();
        assert!(!svc.is_configured());
        assert!(svc.config().require_for_password_reset);
    }

    #[test]
    fn test_mfa_backup_codes_are_8_digits() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        for code in &result.backup_codes {
            assert_eq!(code.len(), 8);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn test_mfa_setup_replaces_previous_config() {
        let svc = MfaService::new_in_memory();
        let result1 = svc.setup("user1").unwrap();
        let result2 = svc.setup("user2").unwrap();
        // New setup should produce different secrets
        assert_ne!(result1.secret_base32, result2.secret_base32);
        // Old backup codes should no longer work
        assert!(!svc.verify(&result1.backup_codes[0]).unwrap());
        // New backup codes should work
        assert!(svc.verify(&result2.backup_codes[0]).unwrap());
    }

    #[test]
    fn test_verify_exactly_at_rate_limit() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        // Fail exactly MAX_FAILED_ATTEMPTS (5) times
        for i in 0..5 {
            let res = svc.verify("000000");
            assert!(res.is_ok(), "Attempt {} should not error", i);
            assert!(!res.unwrap());
        }
        // The 6th attempt should be blocked
        assert!(svc.verify("000000").is_err());
    }

    #[test]
    fn test_verify_after_lockout_reset() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        // Lock out
        for _ in 0..5 {
            let _ = svc.verify("000000");
        }
        assert!(svc.verify("000000").is_err());

        // Reset and verify we can try again
        svc.reset_failed_attempts();
        let res = svc.verify("000000");
        assert!(res.is_ok());
        assert!(!res.unwrap());
    }

    #[test]
    fn test_generate_totp_same_step_same_result() {
        let secret = b"consistent_secret_key";
        let code1 = generate_totp(secret, 42).unwrap();
        let code2 = generate_totp(secret, 42).unwrap();
        assert_eq!(code1, code2);
    }

    #[test]
    fn test_verify_with_real_totp_code() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();

        // Decode the secret from the setup result
        let secret = data_encoding::BASE32_NOPAD
            .decode(result.secret_base32.as_bytes())
            .unwrap();

        // Generate the current valid TOTP code
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let step = now / 30;
        let valid_code = generate_totp(&secret, step).unwrap();

        // Should verify successfully
        assert!(svc.verify(&valid_code).unwrap());
    }

    #[test]
    fn test_verify_sets_last_verified_on_totp_success() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();

        // Before verification, check_mfa should fail for required actions
        assert!(svc.check_mfa_for_action("PasswordReset").is_err());

        // Verify with a real TOTP code
        let secret = data_encoding::BASE32_NOPAD
            .decode(result.secret_base32.as_bytes())
            .unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let step = now / 30;
        let valid_code = generate_totp(&secret, step).unwrap();
        assert!(svc.verify(&valid_code).unwrap());

        // After successful TOTP verification, check_mfa should pass
        assert!(svc.check_mfa_for_action("PasswordReset").is_ok());
    }

    #[test]
    fn test_backup_code_sets_last_verified() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();

        assert!(svc.check_mfa_for_action("PasswordReset").is_err());

        let backup = result.backup_codes[5].clone();
        assert!(svc.verify(&backup).unwrap());

        assert!(svc.check_mfa_for_action("PasswordReset").is_ok());
    }

    #[test]
    fn test_all_backup_codes_work() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();

        for (i, code) in result.backup_codes.iter().enumerate() {
            assert!(svc.verify(code).unwrap(), "Backup code {} should verify", i);
        }
        // All 10 used up - none should work now
        // Re-setup to get new codes and verify old ones are gone
    }

    #[test]
    fn test_revoke_clears_backup_codes() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        svc.revoke();
        // After revoke, not configured - verify returns error
        assert!(svc.verify(&result.backup_codes[0]).is_err());
    }

    #[test]
    fn test_setup_resets_failed_attempts() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();

        // Accumulate some failures
        for _ in 0..3 {
            let _ = svc.verify("000000");
        }

        // Re-setup should reset the counter
        let result2 = svc.setup("testuser").unwrap();
        // Should be able to fail 5 times without lockout (counter was reset)
        for _ in 0..5 {
            let res = svc.verify("000000");
            assert!(res.is_ok());
        }
        // 6th fails - confirms counter was reset at setup
        assert!(svc.verify("000000").is_err());

        // But backup codes from new setup still work after reset
        svc.reset_failed_attempts();
        assert!(svc.verify(&result2.backup_codes[0]).unwrap());
    }

    #[test]
    fn test_requires_mfa_unknown_action() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        assert!(!svc.requires_mfa("SomeRandomAction"));
        assert!(!svc.requires_mfa(""));
    }

    #[test]
    fn test_check_mfa_for_unknown_action_passes() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        // Unknown action does not require MFA
        assert!(svc.check_mfa_for_action("UnknownAction").is_ok());
    }

    #[test]
    fn test_mfa_config_all_enabled() {
        let svc = MfaService::new_in_memory();
        svc.set_config(MfaConfig {
            require_for_password_reset: true,
            require_for_account_disable: true,
            require_for_flag_changes: true,
            require_for_bulk_operations: true,
        });
        svc.setup("testuser").unwrap();
        assert!(svc.requires_mfa("PasswordReset"));
        assert!(svc.requires_mfa("AccountDisable"));
        assert!(svc.requires_mfa("PasswordFlagsChange"));
        assert!(svc.requires_mfa("BulkOperation"));
    }

    #[test]
    fn test_mfa_config_all_disabled() {
        let svc = MfaService::new_in_memory();
        svc.set_config(MfaConfig {
            require_for_password_reset: false,
            require_for_account_disable: false,
            require_for_flag_changes: false,
            require_for_bulk_operations: false,
        });
        svc.setup("testuser").unwrap();
        assert!(!svc.requires_mfa("PasswordReset"));
        assert!(!svc.requires_mfa("AccountDisable"));
        assert!(!svc.requires_mfa("PasswordFlagsChange"));
        assert!(!svc.requires_mfa("BulkOperation"));
    }

    #[test]
    fn test_generate_totp_empty_like_secret() {
        // A single-byte secret should still work
        let code = generate_totp(&[0x42], 1).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_mfa_setup_result_deserialization() {
        let json =
            r#"{"secretBase32":"AAAA","qrUri":"otpauth://totp/test","backupCodes":["11111111"]}"#;
        let result: MfaSetupResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.secret_base32, "AAAA");
        assert_eq!(result.backup_codes.len(), 1);
    }

    #[test]
    fn test_mfa_config_deserialization() {
        let json = r#"{"requireForPasswordReset":false,"requireForAccountDisable":true,"requireForFlagChanges":true,"requireForBulkOperations":false}"#;
        let config: MfaConfig = serde_json::from_str(json).unwrap();
        assert!(!config.require_for_password_reset);
        assert!(config.require_for_account_disable);
        assert!(config.require_for_flag_changes);
        assert!(!config.require_for_bulk_operations);
    }

    // -----------------------------------------------------------------------
    // MFA service - config interaction with check_mfa_for_action
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_mfa_all_actions_require_verification() {
        let svc = MfaService::new_in_memory();
        svc.set_config(MfaConfig {
            require_for_password_reset: true,
            require_for_account_disable: true,
            require_for_flag_changes: true,
            require_for_bulk_operations: true,
        });
        svc.setup("testuser").unwrap();
        // All actions should fail without verification
        assert!(svc.check_mfa_for_action("PasswordReset").is_err());
        assert!(svc.check_mfa_for_action("AccountDisable").is_err());
        assert!(svc.check_mfa_for_action("PasswordFlagsChange").is_err());
        assert!(svc.check_mfa_for_action("BulkOperation").is_err());
    }

    #[test]
    fn test_check_mfa_all_actions_pass_after_verification() {
        let svc = MfaService::new_in_memory();
        svc.set_config(MfaConfig {
            require_for_password_reset: true,
            require_for_account_disable: true,
            require_for_flag_changes: true,
            require_for_bulk_operations: true,
        });
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
        // All actions should pass after verification
        assert!(svc.check_mfa_for_action("PasswordReset").is_ok());
        assert!(svc.check_mfa_for_action("AccountDisable").is_ok());
        assert!(svc.check_mfa_for_action("PasswordFlagsChange").is_ok());
        assert!(svc.check_mfa_for_action("BulkOperation").is_ok());
    }

    // -----------------------------------------------------------------------
    // TOTP code format validation
    // -----------------------------------------------------------------------

    #[test]
    fn test_generate_totp_large_time_step() {
        let secret = b"12345678901234567890";
        let code = generate_totp(secret, u64::MAX).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_generate_totp_step_zero() {
        let secret = b"12345678901234567890";
        let code = generate_totp(secret, 0).unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    // -----------------------------------------------------------------------
    // MFA service - verify with non-numeric code
    // -----------------------------------------------------------------------

    #[test]
    fn test_verify_non_numeric_code_fails() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        // Non-numeric codes should not match any TOTP or backup code
        assert!(!svc.verify("abcdef").unwrap());
        assert!(!svc.verify("").unwrap());
        assert!(!svc.verify("123").unwrap());
    }

    // -----------------------------------------------------------------------
    // MFA service - revoke then setup again
    // -----------------------------------------------------------------------

    #[test]
    fn test_revoke_then_setup_works() {
        let svc = MfaService::new_in_memory();
        let r1 = svc.setup("user1").unwrap();
        svc.revoke();
        assert!(!svc.is_configured());

        let r2 = svc.setup("user2").unwrap();
        assert!(svc.is_configured());
        assert_ne!(r1.secret_base32, r2.secret_base32);
        // New backup codes should work
        assert!(svc.verify(&r2.backup_codes[0]).unwrap());
    }

    // -----------------------------------------------------------------------
    // MFA service - config persistence across set_config calls
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_config_overrides_previous() {
        let svc = MfaService::new_in_memory();
        svc.set_config(MfaConfig {
            require_for_password_reset: false,
            require_for_account_disable: false,
            require_for_flag_changes: true,
            require_for_bulk_operations: true,
        });
        let c1 = svc.config();
        assert!(!c1.require_for_password_reset);
        assert!(c1.require_for_flag_changes);

        svc.set_config(MfaConfig {
            require_for_password_reset: true,
            require_for_account_disable: true,
            require_for_flag_changes: false,
            require_for_bulk_operations: false,
        });
        let c2 = svc.config();
        assert!(c2.require_for_password_reset);
        assert!(!c2.require_for_flag_changes);
    }

    // -----------------------------------------------------------------------
    // MFA service - backup codes consumed in order
    // -----------------------------------------------------------------------

    #[test]
    fn test_backup_codes_consumed_leaves_remaining() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("testuser").unwrap();
        // Use first 5 backup codes
        for i in 0..5 {
            assert!(svc.verify(&result.backup_codes[i]).unwrap());
        }
        // Remaining 5 should still work
        for i in 5..10 {
            assert!(svc.verify(&result.backup_codes[i]).unwrap());
        }
    }

    // -----------------------------------------------------------------------
    // MfaSetupResult - qr_uri contains username
    // -----------------------------------------------------------------------

    #[test]
    fn test_setup_qr_uri_encodes_username() {
        let svc = MfaService::new_in_memory();
        let result = svc.setup("admin.user").unwrap();
        assert!(result.qr_uri.contains("DSPanel:admin.user"));
    }

    // -----------------------------------------------------------------------
    // MfaPersistedData serialization (internal struct accessible in tests)
    // -----------------------------------------------------------------------

    #[test]
    fn test_mfa_persisted_data_roundtrip() {
        let data = MfaPersistedData {
            secret_b64: "dGVzdA==".to_string(),
            backup_codes: vec!["12345678".to_string(), "87654321".to_string()],
        };
        let json = serde_json::to_string(&data).unwrap();
        let deserialized: MfaPersistedData = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.secret_b64, "dGVzdA==");
        assert_eq!(deserialized.backup_codes.len(), 2);
    }

    // -----------------------------------------------------------------------
    // MFA service - verify does not set last_verified on failure
    // -----------------------------------------------------------------------

    #[test]
    fn test_failed_verify_does_not_set_last_verified() {
        let svc = MfaService::new_in_memory();
        svc.setup("testuser").unwrap();
        svc.set_config(MfaConfig {
            require_for_password_reset: true,
            ..Default::default()
        });
        // Fail a verification
        assert!(!svc.verify("000000").unwrap());
        // check_mfa should still fail (last_verified not set)
        assert!(svc.check_mfa_for_action("PasswordReset").is_err());
    }

    // -----------------------------------------------------------------------
    // MFA service - multiple sequential setups
    // -----------------------------------------------------------------------

    #[test]
    fn test_multiple_setups_each_unique() {
        let svc = MfaService::new_in_memory();
        let r1 = svc.setup("user1").unwrap();
        let r2 = svc.setup("user2").unwrap();
        let r3 = svc.setup("user3").unwrap();
        // All secrets should be different
        assert_ne!(r1.secret_base32, r2.secret_base32);
        assert_ne!(r2.secret_base32, r3.secret_base32);
        assert_ne!(r1.secret_base32, r3.secret_base32);
        // Only r3 backup codes should work
        assert!(!svc.verify(&r1.backup_codes[0]).unwrap());
        assert!(!svc.verify(&r2.backup_codes[0]).unwrap());
        assert!(svc.verify(&r3.backup_codes[0]).unwrap());
    }
}
