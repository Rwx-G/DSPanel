# External APIs

### Active Directory (LDAP)

- **Purpose**: Primary data source for all AD on-prem operations
- **Rust Crate**: ldap3
- **Authentication**: Kerberos (current OS user credentials, no stored passwords)
- **Rate Limits**: None (on-prem infrastructure)

**Key Operations:**
- Search with LDAP filters for user/computer/group lookups
- Modify for attribute changes, group membership modifications
- Add for object creation (onboarding)
- Delete for object deletion
- ModDN for moving objects between OUs

**Integration Notes**: Use paged results control for queries returning 1000+ results. Always use LDAP over TLS (port 636) when available. Connection pooling via ldap3's built-in connection management. The ldap3 crate supports async operations via tokio.

### Microsoft Graph API

- **Purpose**: Entra ID directory operations and Exchange Online diagnostics
- **Rust Crate**: reqwest (direct HTTP calls with manual token management)
- **Documentation**: https://learn.microsoft.com/en-us/graph/api/overview
- **Base URL**: https://graph.microsoft.com/v1.0
- **Authentication**: OAuth 2.0 via Azure AD App Registration (device code flow for desktop)
- **Rate Limits**: Per-tenant throttling (varies by endpoint)

**Key Endpoints Used:**
- `GET /users/{id}` - User profile and attributes
- `GET /users/{id}/memberOf` - Group memberships
- `GET /users/{id}/mailboxSettings` - Exchange Online mailbox settings
- `GET /users/{id}/messages` - Mail diagnostics (if permitted)
- `GET /groups` - Group listing
- `GET /users/{id}/mailFolders` - Mailbox quota info

**Integration Notes**: Requires Azure AD App Registration with Directory.Read.All and Mail.Read delegated permissions minimum. Use batch requests ($batch) for multiple queries. Handle 429 (throttled) responses with retry-after header. All HTTP calls made via reqwest with appropriate headers and OAuth token management.

### HaveIBeenPwned API

- **Purpose**: Check generated passwords against known compromised passwords
- **Rust Crate**: reqwest (for HTTP calls), sha1 (for hashing)
- **Documentation**: https://haveibeenpwned.com/API/v3#PwnedPasswords
- **Base URL**: https://api.pwnedpasswords.com
- **Authentication**: None (k-anonymity model)
- **Rate Limits**: Generous, no API key required for password range endpoint

**Key Endpoints Used:**
- `GET /range/{first5HashChars}` - Get all password hashes matching the first 5 characters of the SHA1 hash

**Integration Notes**: Only the first 5 characters of the SHA1 hash are sent (k-anonymity). Response is compared locally. Must work offline (skip check with warning if unreachable).

### GitHub Releases API

- **Purpose**: Check for application updates at startup
- **Rust Crate**: reqwest
- **Base URL**: https://api.github.com
- **Authentication**: None (public repo)
- **Rate Limits**: 60 requests/hour unauthenticated

**Key Endpoints Used:**
- `GET /repos/Rwx-G/DSPanel/releases/latest` - Get latest release version and download URL

---
