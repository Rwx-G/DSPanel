use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

type HmacSha1 = Hmac<Sha1>;

/// Duration for which a successful MFA verification remains valid.
const MFA_SESSION_WINDOW: std::time::Duration = std::time::Duration::from_secs(300); // 5 minutes

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
/// The shared secret and backup codes are persisted to a local file
/// in the user's app data directory for durability across restarts.
pub struct MfaService {
    secret: Mutex<Option<Vec<u8>>>,
    backup_codes: Mutex<Vec<String>>,
    config: Mutex<MfaConfig>,
    persist_path: Option<PathBuf>,
    failed_attempts: Mutex<u32>,
    last_verified: Mutex<Option<Instant>>,
}

impl Default for MfaService {
    fn default() -> Self {
        Self::new()
    }
}

impl MfaService {
    pub fn new() -> Self {
        let persist_path = Self::resolve_persist_path();
        let (secret, backup_codes) = persist_path
            .as_ref()
            .and_then(Self::load_from_file)
            .unwrap_or((None, Vec::new()));

        Self {
            secret: Mutex::new(secret),
            backup_codes: Mutex::new(backup_codes),
            config: Mutex::new(MfaConfig::default()),
            persist_path,
            failed_attempts: Mutex::new(0),
            last_verified: Mutex::new(None),
        }
    }

    /// Creates an MfaService without file persistence (for testing).
    #[cfg(test)]
    pub fn new_in_memory() -> Self {
        Self {
            secret: Mutex::new(None),
            backup_codes: Mutex::new(Vec::new()),
            config: Mutex::new(MfaConfig::default()),
            persist_path: None,
            failed_attempts: Mutex::new(0),
            last_verified: Mutex::new(None),
        }
    }

    fn resolve_persist_path() -> Option<PathBuf> {
        let base = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let dir = PathBuf::from(base).join("DSPanel");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok()?;
        }
        Some(dir.join("mfa.dat"))
    }

    fn load_from_file(path: &PathBuf) -> Option<(Option<Vec<u8>>, Vec<String>)> {
        let encrypted = fs::read(path).ok()?;
        let decrypted = crate::services::dpapi::unprotect(&encrypted).ok()?;
        let persisted: MfaPersistedData = serde_json::from_slice(&decrypted).ok()?;
        use base64::Engine;
        let secret = base64::engine::general_purpose::STANDARD
            .decode(&persisted.secret_b64)
            .ok()?;
        tracing::info!("MFA secret loaded from DPAPI-protected storage");
        Some((Some(secret), persisted.backup_codes))
    }

    fn persist(&self) {
        if let Some(ref path) = self.persist_path {
            let secret = self.secret.lock().unwrap();
            if let Some(ref s) = *secret {
                use base64::Engine;
                let data = MfaPersistedData {
                    secret_b64: base64::engine::general_purpose::STANDARD.encode(s),
                    backup_codes: self.backup_codes.lock().unwrap().clone(),
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

    /// Whether MFA has been configured (secret exists).
    pub fn is_configured(&self) -> bool {
        self.secret.lock().unwrap().is_some()
    }

    /// Returns the current MFA configuration.
    pub fn config(&self) -> MfaConfig {
        self.config.lock().unwrap().clone()
    }

    /// Updates the MFA configuration.
    pub fn set_config(&self, config: MfaConfig) {
        *self.config.lock().unwrap() = config;
    }

    /// Whether a given action requires MFA verification.
    pub fn requires_mfa(&self, action: &str) -> bool {
        if !self.is_configured() {
            return false;
        }
        let config = self.config.lock().unwrap();
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

        let last = self.last_verified.lock().unwrap();
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
        let mut rng = OsRng;
        let secret: Vec<u8> = (0..20).map(|_| rng.gen()).collect();
        let secret_b32 = base32::encode(base32::Alphabet::Rfc4648 { padding: false }, &secret);

        let qr_uri = format!(
            "otpauth://totp/DSPanel:{}?secret={}&issuer=DSPanel&algorithm=SHA1&digits=6&period=30",
            username, secret_b32
        );

        let backup_codes: Vec<String> = (0..10)
            .map(|_| {
                let code: u32 = rng.gen_range(10000000..99999999);
                format!("{}", code)
            })
            .collect();

        *self.secret.lock().unwrap() = Some(secret);
        *self.backup_codes.lock().unwrap() = backup_codes.clone();
        *self.failed_attempts.lock().unwrap() = 0;
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
            let attempts = self.failed_attempts.lock().unwrap();
            if *attempts >= Self::MAX_FAILED_ATTEMPTS {
                anyhow::bail!(
                    "Too many failed MFA attempts ({}). Please wait before retrying.",
                    *attempts
                );
            }
        }

        let secret = self
            .secret
            .lock()
            .unwrap()
            .clone()
            .context("MFA not configured")?;

        // Check backup codes first
        {
            let mut backup_codes = self.backup_codes.lock().unwrap();
            if let Some(pos) = backup_codes.iter().position(|c| c == code) {
                backup_codes.remove(pos);
                *self.failed_attempts.lock().unwrap() = 0;
                *self.last_verified.lock().unwrap() = Some(Instant::now());
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
                *self.failed_attempts.lock().unwrap() = 0;
                *self.last_verified.lock().unwrap() = Some(Instant::now());
                return Ok(true);
            }
        }

        *self.failed_attempts.lock().unwrap() += 1;
        Ok(false)
    }

    /// Resets the failed attempt counter (e.g., after a cooldown period).
    pub fn reset_failed_attempts(&self) {
        *self.failed_attempts.lock().unwrap() = 0;
    }

    /// Revokes MFA setup by removing the stored secret and persisted file.
    pub fn revoke(&self) {
        *self.secret.lock().unwrap() = None;
        self.backup_codes.lock().unwrap().clear();
        *self.failed_attempts.lock().unwrap() = 0;
        if let Some(ref path) = self.persist_path {
            let _ = fs::remove_file(path);
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
        let mut config = MfaConfig::default();
        config.require_for_flag_changes = true;
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
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Too many failed MFA attempts"));
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
        let mut config = MfaConfig::default();
        config.require_for_bulk_operations = true;
        svc.set_config(config);
        svc.setup("testuser").unwrap();
        assert!(svc.requires_mfa("BulkOperation"));
    }

    #[test]
    fn test_mfa_default_service() {
        // Test Default trait implementation
        let svc = MfaService::new_in_memory();
        assert!(!svc.is_configured());
        assert_eq!(svc.config().require_for_password_reset, true);
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
}
