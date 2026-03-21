# PR: Epic 6 - Exchange Diagnostics

## Title

Epic 6: Exchange Diagnostics (on-prem + online)

## Labels

enhancement, security

## Body

## Summary

- Exchange on-prem mailbox panel auto-detected from LDAP `msExch*` attributes (recipient type, aliases, forwarding, delegates)
- Exchange Online diagnostics via Microsoft Graph API (OAuth2 client credentials, token caching, auto-expiry)
- Real mailbox quota from `getMailboxUsageDetail` report CSV (`Reports.Read.All`), fallback to 50 GB default
- LDAP TLS improvements: StartTLS on port 389, custom CA certificate loading (PEM/DER)
- DPAPI encryption for Graph client secret at rest
- SHA-256 integrity checksums for preset JSON files with user-facing warning on external modification
- Settings UI (`GraphSettings`) for Azure AD tenant/client configuration with test connection button
- `#[allow(clippy::unwrap_used)]` applied to all test modules for CI compatibility

## Test coverage

| Layer | Count |
|-------|-------|
| Rust unit tests | 834 pass |
| Rust integration tests | 22 pass (LDAPS) |
| Frontend tests | 1337 pass |
| Clippy (`--all-targets -D warnings`) | Clean |
| `cargo fmt` | Clean |

### New tests (Epic 6)

- `ExchangeMailboxInfo` model: 16 tests
- `ExchangeOnlineInfo` model: 12 tests
- `GraphExchangeService`: 31 tests (10 sync + 21 async mockito)
- `PresetService` checksums: 12 tests
- `AppSettings` DPAPI: 3 tests
- `exchange.ts` / `exchange-online.ts`: 20 tests
- `ExchangePanel` / `ExchangeOnlinePanel` / `GraphSettings`: 22 component tests

## New dependencies

- `csv = "1"` - parse Graph usage report CSV
- `sha2 = "0.10"` - SHA-256 preset integrity checksums

## Azure AD permissions

| Permission | Purpose |
|------------|---------|
| `Mail.Read` | Read mailbox settings, folder sizes |
| `User.Read.All` | Read user profiles, proxy addresses |
| `Reports.Read.All` | Read mailbox usage reports (real quota) |

## Test plan

- [ ] Verify Exchange on-prem panel appears for users with `msExch*` attributes
- [ ] Verify Exchange on-prem panel hidden for users without Exchange attributes
- [ ] Verify Exchange Online panel appears when Graph configured + user has mailbox
- [ ] Verify Exchange Online panel hidden when Graph not configured
- [ ] Verify Graph Settings test connection button works with valid Azure AD app
- [ ] Verify preset integrity warning appears after external file modification
- [ ] Verify "Accept changes" clears the warning
- [ ] Verify StartTLS connection works on port 389
- [ ] Verify custom CA cert loading for LDAPS/StartTLS
- [ ] Run `cargo test --lib` (834 tests)
- [ ] Run `pnpm test` (1337 tests)
