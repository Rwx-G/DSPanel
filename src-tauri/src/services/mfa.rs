use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::sync::Mutex;

type HmacSha1 = Hmac<Sha1>;

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

/// TOTP-based MFA service implementing RFC 6238.
pub struct MfaService {
    secret: Mutex<Option<Vec<u8>>>,
    backup_codes: Mutex<Vec<String>>,
    config: Mutex<MfaConfig>,
}

impl Default for MfaService {
    fn default() -> Self {
        Self::new()
    }
}

impl MfaService {
    pub fn new() -> Self {
        Self {
            secret: Mutex::new(None),
            backup_codes: Mutex::new(Vec::new()),
            config: Mutex::new(MfaConfig::default()),
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

    /// Generates a new TOTP secret and backup codes.
    pub fn setup(&self, username: &str) -> Result<MfaSetupResult> {
        let mut rng = rand::thread_rng();
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

        Ok(MfaSetupResult {
            secret_base32: secret_b32,
            qr_uri,
            backup_codes,
        })
    }

    /// Verifies a TOTP code against the stored secret.
    ///
    /// Accepts codes from T-1, T, and T+1 time steps (90-second window).
    pub fn verify(&self, code: &str) -> Result<bool> {
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
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Revokes MFA setup by removing the stored secret.
    pub fn revoke(&self) {
        *self.secret.lock().unwrap() = None;
        self.backup_codes.lock().unwrap().clear();
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
        let svc = MfaService::new();
        assert!(!svc.is_configured());
    }

    #[test]
    fn test_mfa_setup_configures_service() {
        let svc = MfaService::new();
        let result = svc.setup("testuser").unwrap();
        assert!(svc.is_configured());
        assert!(!result.secret_base32.is_empty());
        assert!(result.qr_uri.contains("otpauth://totp/DSPanel:testuser"));
        assert_eq!(result.backup_codes.len(), 10);
    }

    #[test]
    fn test_mfa_setup_produces_valid_qr_uri() {
        let svc = MfaService::new();
        let result = svc.setup("admin").unwrap();
        assert!(result.qr_uri.contains("secret="));
        assert!(result.qr_uri.contains("issuer=DSPanel"));
        assert!(result.qr_uri.contains("algorithm=SHA1"));
        assert!(result.qr_uri.contains("digits=6"));
        assert!(result.qr_uri.contains("period=30"));
    }

    #[test]
    fn test_mfa_backup_codes_are_unique() {
        let svc = MfaService::new();
        let result = svc.setup("testuser").unwrap();
        let mut codes = result.backup_codes.clone();
        codes.sort();
        codes.dedup();
        // Extremely unlikely to have duplicates with 8-digit random codes
        assert_eq!(codes.len(), 10);
    }

    #[test]
    fn test_mfa_verify_backup_code() {
        let svc = MfaService::new();
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
    }

    #[test]
    fn test_mfa_backup_code_single_use() {
        let svc = MfaService::new();
        let result = svc.setup("testuser").unwrap();
        let backup = result.backup_codes[0].clone();
        assert!(svc.verify(&backup).unwrap());
        // Second use should fail
        assert!(!svc.verify(&backup).unwrap());
    }

    #[test]
    fn test_mfa_verify_wrong_code() {
        let svc = MfaService::new();
        svc.setup("testuser").unwrap();
        assert!(!svc.verify("000000").unwrap());
    }

    #[test]
    fn test_mfa_verify_not_configured_fails() {
        let svc = MfaService::new();
        assert!(svc.verify("123456").is_err());
    }

    #[test]
    fn test_mfa_revoke() {
        let svc = MfaService::new();
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
        let svc = MfaService::new();
        assert!(!svc.requires_mfa("PasswordReset"));
    }

    #[test]
    fn test_mfa_requires_mfa_when_configured() {
        let svc = MfaService::new();
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
        let svc = MfaService::new();
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
}
