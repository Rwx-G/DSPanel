//! DPAPI-based encryption for protecting sensitive data at rest.
//!
//! Uses `CryptProtectData` / `CryptUnprotectData` so the encrypted blob is
//! tied to the current Windows user profile (i.e. another OS account on the
//! same machine cannot decrypt it).
//!
//! This module is **Windows only**. Non-Windows platforms must use the OS
//! keyring backend exposed by the `mfa` service - there is no portable DPAPI
//! equivalent and this module deliberately does not ship a fake one. The
//! parent `services/mod.rs` gates the module declaration with
//! `#[cfg(target_os = "windows")]` so attempting to call it from non-Windows
//! code is a compile error rather than silently producing unencrypted bytes.

mod platform {
    use anyhow::{Context, Result};
    use windows::Win32::Foundation::HLOCAL;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };

    /// Encrypts data using DPAPI (tied to current Windows user).
    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        unsafe {
            CryptProtectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .context("DPAPI CryptProtectData failed")?;

            let encrypted =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
            Ok(encrypted)
        }
    }

    /// Decrypts DPAPI-protected data.
    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .context("DPAPI CryptUnprotectData failed")?;

            let decrypted =
                std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
            Ok(decrypted)
        }
    }
}

pub use platform::{protect, unprotect};

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protect_unprotect_roundtrip() {
        let plaintext = b"secret MFA key data 12345";
        let encrypted = protect(plaintext).unwrap();
        let decrypted = unprotect(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_protect_produces_different_output() {
        let plaintext = b"test data";
        let encrypted = protect(plaintext).unwrap();
        assert_ne!(encrypted, plaintext);
    }

    #[test]
    fn test_protect_empty_data() {
        let encrypted = protect(b"").unwrap();
        let decrypted = unprotect(&encrypted).unwrap();
        assert_eq!(decrypted, b"");
    }

    #[test]
    fn test_protect_large_data() {
        let plaintext: Vec<u8> = (0..1024).map(|i| (i % 256) as u8).collect();
        let encrypted = protect(&plaintext).unwrap();
        let decrypted = unprotect(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }
}
