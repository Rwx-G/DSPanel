/// DPAPI-based encryption for protecting sensitive data at rest.
///
/// On Windows, uses CryptProtectData/CryptUnprotectData (DPAPI) which ties
/// the encrypted blob to the current Windows user profile. On non-Windows
/// platforms, falls back to base64 encoding (no real encryption).
#[cfg(target_os = "windows")]
mod platform {
    use anyhow::{Context, Result};
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Foundation::HLOCAL;
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
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
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
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
            let _ = LocalFree(HLOCAL(output.pbData as *mut _));
            Ok(decrypted)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use anyhow::Result;
    use base64::Engine;

    /// Fallback: base64 encoding (no real encryption on non-Windows).
    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>> {
        Ok(base64::engine::general_purpose::STANDARD
            .encode(plaintext)
            .into_bytes())
    }

    /// Fallback: base64 decoding.
    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>> {
        let encoded = std::str::from_utf8(ciphertext)?;
        Ok(base64::engine::general_purpose::STANDARD.decode(encoded)?)
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
        // On Windows DPAPI, encrypted != plaintext
        // On non-Windows, it's base64 which is also different from raw bytes
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
