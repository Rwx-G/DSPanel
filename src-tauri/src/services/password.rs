use anyhow::{Context, Result};
use rand::rngs::OsRng;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const DIGITS: &[u8] = b"0123456789";
const SPECIAL: &[u8] = b"!@#$%^&*()-_=+[]{}|;:,.<>?";
const AMBIGUOUS: &[u8] = b"0OolI1|`";

/// Options for password generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordOptions {
    pub length: usize,
    pub include_uppercase: bool,
    pub include_lowercase: bool,
    pub include_digits: bool,
    pub include_special: bool,
    pub exclude_ambiguous: bool,
}

impl Default for PasswordOptions {
    fn default() -> Self {
        Self {
            length: 20,
            include_uppercase: true,
            include_lowercase: true,
            include_digits: true,
            include_special: true,
            exclude_ambiguous: false,
        }
    }
}

/// Result of HIBP breach check.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HibpResult {
    pub is_breached: bool,
    pub breach_count: u64,
    pub checked: bool,
}

/// Generates a cryptographically random password matching the given options.
///
/// Ensures at least one character from each selected category is included.
pub fn generate_password(options: &PasswordOptions) -> Result<String> {
    let mut pool: Vec<u8> = Vec::new();
    let mut required: Vec<u8> = Vec::new();
    let mut rng = OsRng;

    let is_ambiguous = |c: u8| -> bool { AMBIGUOUS.contains(&c) };
    let filter = |chars: &[u8], exclude: bool| -> Vec<u8> {
        if exclude {
            chars
                .iter()
                .copied()
                .filter(|c| !is_ambiguous(*c))
                .collect()
        } else {
            chars.to_vec()
        }
    };

    if options.include_uppercase {
        let chars = filter(UPPERCASE, options.exclude_ambiguous);
        if !chars.is_empty() {
            required.push(chars[rng.gen_range(0..chars.len())]);
            pool.extend_from_slice(&chars);
        }
    }
    if options.include_lowercase {
        let chars = filter(LOWERCASE, options.exclude_ambiguous);
        if !chars.is_empty() {
            required.push(chars[rng.gen_range(0..chars.len())]);
            pool.extend_from_slice(&chars);
        }
    }
    if options.include_digits {
        let chars = filter(DIGITS, options.exclude_ambiguous);
        if !chars.is_empty() {
            required.push(chars[rng.gen_range(0..chars.len())]);
            pool.extend_from_slice(&chars);
        }
    }
    if options.include_special {
        let chars = filter(SPECIAL, options.exclude_ambiguous);
        if !chars.is_empty() {
            required.push(chars[rng.gen_range(0..chars.len())]);
            pool.extend_from_slice(&chars);
        }
    }

    if pool.is_empty() {
        anyhow::bail!("No character categories selected");
    }

    let length = options.length.max(required.len());
    let mut password: Vec<u8> = required;

    while password.len() < length {
        password.push(pool[rng.gen_range(0..pool.len())]);
    }

    // Shuffle to randomize positions of required characters
    for i in (1..password.len()).rev() {
        let j = rng.gen_range(0..=i);
        password.swap(i, j);
    }

    Ok(String::from_utf8(password).unwrap())
}

/// Checks a password against the HIBP Pwned Passwords API using k-anonymity.
///
/// Only the first 5 characters of the SHA1 hash are sent to the API.
/// Returns the breach count, or 0 if the password is not found.
pub async fn check_hibp(password: &str, http_client: &reqwest::Client) -> Result<HibpResult> {
    let mut hasher = Sha1::new();
    hasher.update(password.as_bytes());
    let hash = format!("{:X}", hasher.finalize());

    let prefix = &hash[..5];
    let suffix = &hash[5..];

    let url = format!("https://api.pwnedpasswords.com/range/{}", prefix);
    let response = http_client
        .get(&url)
        .send()
        .await
        .context("Failed to reach HIBP API")?
        .text()
        .await
        .context("Failed to read HIBP response")?;

    for line in response.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() == 2 && parts[0].eq_ignore_ascii_case(suffix) {
            let count = parts[1].trim().parse::<u64>().unwrap_or(0);
            return Ok(HibpResult {
                is_breached: true,
                breach_count: count,
                checked: true,
            });
        }
    }

    Ok(HibpResult {
        is_breached: false,
        breach_count: 0,
        checked: true,
    })
}

/// Generates a password and checks it against HIBP, retrying if breached.
pub async fn generate_safe_password(
    options: &PasswordOptions,
    http_client: Option<&reqwest::Client>,
    max_retries: usize,
) -> Result<(String, HibpResult)> {
    for attempt in 0..=max_retries {
        let password = generate_password(options)?;

        let hibp_result = if let Some(client) = http_client {
            match check_hibp(&password, client).await {
                Ok(result) => result,
                Err(e) => {
                    tracing::warn!("HIBP check failed (attempt {}): {}", attempt + 1, e);
                    HibpResult {
                        is_breached: false,
                        breach_count: 0,
                        checked: false,
                    }
                }
            }
        } else {
            HibpResult {
                is_breached: false,
                breach_count: 0,
                checked: false,
            }
        };

        if !hibp_result.is_breached {
            return Ok((password, hibp_result));
        }

        if attempt < max_retries {
            tracing::info!(
                "Generated password found in HIBP (count: {}), regenerating (attempt {}/{})",
                hibp_result.breach_count,
                attempt + 1,
                max_retries
            );
        } else {
            tracing::warn!(
                "All {} retries produced breached passwords, returning last with warning",
                max_retries + 1
            );
            return Ok((password, hibp_result));
        }
    }

    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_password_default_options() {
        let options = PasswordOptions::default();
        let password = generate_password(&options).unwrap();
        assert_eq!(password.len(), 20);
    }

    #[test]
    fn test_generate_password_custom_length() {
        let options = PasswordOptions {
            length: 24,
            ..Default::default()
        };
        let password = generate_password(&options).unwrap();
        assert_eq!(password.len(), 24);
    }

    #[test]
    fn test_generate_password_includes_all_categories() {
        let options = PasswordOptions {
            length: 20,
            include_uppercase: true,
            include_lowercase: true,
            include_digits: true,
            include_special: true,
            exclude_ambiguous: false,
        };
        let password = generate_password(&options).unwrap();
        assert!(password.chars().any(|c| c.is_ascii_uppercase()));
        assert!(password.chars().any(|c| c.is_ascii_lowercase()));
        assert!(password.chars().any(|c| c.is_ascii_digit()));
        assert!(password.chars().any(|c| !c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_generate_password_uppercase_only() {
        let options = PasswordOptions {
            length: 10,
            include_uppercase: true,
            include_lowercase: false,
            include_digits: false,
            include_special: false,
            exclude_ambiguous: false,
        };
        let password = generate_password(&options).unwrap();
        assert!(password.chars().all(|c| c.is_ascii_uppercase()));
    }

    #[test]
    fn test_generate_password_no_categories_fails() {
        let options = PasswordOptions {
            length: 10,
            include_uppercase: false,
            include_lowercase: false,
            include_digits: false,
            include_special: false,
            exclude_ambiguous: false,
        };
        assert!(generate_password(&options).is_err());
    }

    #[test]
    fn test_generate_password_excludes_ambiguous() {
        let options = PasswordOptions {
            length: 100,
            include_uppercase: true,
            include_lowercase: true,
            include_digits: true,
            include_special: true,
            exclude_ambiguous: true,
        };
        let password = generate_password(&options).unwrap();
        let ambiguous = "0OolI1|`";
        assert!(
            !password.chars().any(|c| ambiguous.contains(c)),
            "Password '{}' contains ambiguous characters",
            password
        );
    }

    #[test]
    fn test_generate_password_minimum_length_is_category_count() {
        let options = PasswordOptions {
            length: 1, // Too short for 4 categories
            include_uppercase: true,
            include_lowercase: true,
            include_digits: true,
            include_special: true,
            exclude_ambiguous: false,
        };
        let password = generate_password(&options).unwrap();
        assert!(password.len() >= 4); // At least one char per category
    }

    #[test]
    fn test_generate_password_produces_different_results() {
        let options = PasswordOptions::default();
        let p1 = generate_password(&options).unwrap();
        let p2 = generate_password(&options).unwrap();
        // Statistically extremely unlikely to be the same
        assert_ne!(p1, p2);
    }

    #[test]
    fn test_password_options_default() {
        let opts = PasswordOptions::default();
        assert_eq!(opts.length, 20);
        assert!(opts.include_uppercase);
        assert!(opts.include_lowercase);
        assert!(opts.include_digits);
        assert!(opts.include_special);
        assert!(!opts.exclude_ambiguous);
    }

    #[test]
    fn test_password_options_serialization() {
        let opts = PasswordOptions::default();
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("includeUppercase")); // camelCase
        assert!(json.contains("excludeAmbiguous"));
    }

    #[test]
    fn test_hibp_result_serialization() {
        let result = HibpResult {
            is_breached: true,
            breach_count: 42,
            checked: true,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("isBreached"));
        assert!(json.contains("breachCount"));
    }

    #[test]
    fn test_sha1_hash_format() {
        // Known SHA1 for "password"
        let mut hasher = Sha1::new();
        hasher.update(b"password");
        let hash = format!("{:X}", hasher.finalize());
        assert_eq!(hash, "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
    }

    #[test]
    fn test_sha1_prefix_extraction() {
        let mut hasher = Sha1::new();
        hasher.update(b"password");
        let hash = format!("{:X}", hasher.finalize());
        let prefix = &hash[..5];
        let suffix = &hash[5..];
        assert_eq!(prefix, "5BAA6");
        assert_eq!(suffix, "1E4C9B93F3F0682250B6CF8331B7EE68FD8");
    }

    #[tokio::test]
    async fn test_generate_safe_password_without_hibp() {
        let options = PasswordOptions::default();
        let (password, result) = generate_safe_password(&options, None, 5).await.unwrap();
        assert!(!password.is_empty());
        assert!(!result.checked);
    }
}
