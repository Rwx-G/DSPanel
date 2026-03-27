use anyhow::{Context, Result};
use serde::Deserialize;
use std::sync::RwLock;

use crate::models::exchange_online::{ExchangeOnlineInfo, compute_usage_percentage};

/// Configuration for Microsoft Graph API integration.
#[derive(Debug, Clone, Default)]
pub struct GraphConfig {
    pub tenant_id: String,
    pub client_id: String,
    pub client_secret: Option<String>,
}

impl GraphConfig {
    /// Returns true if the minimum required fields are set.
    pub fn is_configured(&self) -> bool {
        !self.tenant_id.is_empty() && !self.client_id.is_empty()
    }

    /// Validates the configuration, returning an error message if invalid.
    pub fn validate(&self) -> Result<(), String> {
        if self.tenant_id.is_empty() {
            return Err("Tenant ID is required".to_string());
        }
        if self.client_id.is_empty() {
            return Err("Client ID is required".to_string());
        }
        Ok(())
    }
}

/// Simple circuit breaker for Graph API calls.
///
/// Opens after `failure_threshold` consecutive failures and stays open
/// for `recovery_timeout`, rejecting calls immediately during that window.
struct GraphCircuitBreaker {
    failure_count: u32,
    last_failure: Option<std::time::Instant>,
    state: GraphCircuitState,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum GraphCircuitState {
    Closed,
    Open,
}

const GRAPH_CB_FAILURE_THRESHOLD: u32 = 3;
const GRAPH_CB_RECOVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

impl GraphCircuitBreaker {
    fn new() -> Self {
        Self {
            failure_count: 0,
            last_failure: None,
            state: GraphCircuitState::Closed,
        }
    }

    fn is_allowed(&mut self) -> bool {
        match self.state {
            GraphCircuitState::Closed => true,
            GraphCircuitState::Open => {
                if let Some(last) = self.last_failure {
                    if last.elapsed() >= GRAPH_CB_RECOVERY_TIMEOUT {
                        tracing::info!("Graph circuit breaker: half-open, allowing probe");
                        self.state = GraphCircuitState::Closed;
                        self.failure_count = 0;
                        true
                    } else {
                        false
                    }
                } else {
                    true
                }
            }
        }
    }

    fn record_success(&mut self) {
        self.failure_count = 0;
        self.state = GraphCircuitState::Closed;
    }

    fn record_failure(&mut self) {
        self.failure_count += 1;
        self.last_failure = Some(std::time::Instant::now());
        if self.failure_count >= GRAPH_CB_FAILURE_THRESHOLD {
            self.state = GraphCircuitState::Open;
            tracing::warn!(
                failures = self.failure_count,
                "Graph circuit breaker OPEN - rejecting calls for {}s",
                GRAPH_CB_RECOVERY_TIMEOUT.as_secs()
            );
        }
    }
}

/// Service for fetching Exchange Online data via Microsoft Graph API.
///
/// Uses OAuth2 client credentials flow with the configured tenant and app.
/// Requires `Mail.Read`, `User.Read.All`, and `Reports.Read.All` application permissions.
/// Includes a circuit breaker that opens after 3 consecutive failures and
/// recovers after 60 seconds.
pub struct GraphExchangeService {
    config: RwLock<GraphConfig>,
    token_cache: RwLock<Option<CachedToken>>,
    circuit_breaker: RwLock<GraphCircuitBreaker>,
    graph_base_url: String,
    auth_base_url: String,
}

#[derive(Debug, Clone)]
struct CachedToken {
    access_token: String,
    expires_at: std::time::Instant,
}

impl Default for GraphExchangeService {
    fn default() -> Self {
        Self::new()
    }
}

impl GraphExchangeService {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(GraphConfig::default()),
            token_cache: RwLock::new(None),
            circuit_breaker: RwLock::new(GraphCircuitBreaker::new()),
            graph_base_url: "https://graph.microsoft.com".to_string(),
            auth_base_url: "https://login.microsoftonline.com".to_string(),
        }
    }

    /// Creates a service with custom base URLs (for testing with mock servers).
    #[allow(clippy::unwrap_used)]
    #[cfg(test)]
    fn new_with_base_urls(graph_base_url: &str, auth_base_url: &str) -> Self {
        Self {
            config: RwLock::new(GraphConfig::default()),
            token_cache: RwLock::new(None),
            circuit_breaker: RwLock::new(GraphCircuitBreaker::new()),
            graph_base_url: graph_base_url.to_string(),
            auth_base_url: auth_base_url.to_string(),
        }
    }

    /// Updates the Graph configuration.
    pub fn set_config(&self, config: GraphConfig) {
        *self.config.write().expect("lock poisoned") = config;
        // Invalidate token cache when config changes
        *self.token_cache.write().expect("lock poisoned") = None;
    }

    /// Returns the current configuration.
    pub fn get_config(&self) -> GraphConfig {
        self.config.read().expect("lock poisoned").clone()
    }

    /// Whether Graph integration is configured.
    pub fn is_configured(&self) -> bool {
        self.config.read().expect("lock poisoned").is_configured()
    }

    /// Acquires an OAuth2 access token using client credentials flow.
    async fn acquire_token(&self, http_client: &reqwest::Client) -> Result<String> {
        // Check cache first
        {
            let cache = self.token_cache.read().expect("lock poisoned");
            if let Some(ref cached) = *cache {
                if cached.expires_at > std::time::Instant::now() {
                    return Ok(cached.access_token.clone());
                }
            }
        }

        let config = self.config.read().expect("lock poisoned").clone();
        let client_secret = config
            .client_secret
            .as_deref()
            .filter(|s| !s.is_empty())
            .context("Client secret is required for Graph API token acquisition")?;

        let token_url = format!(
            "{}/{}/oauth2/v2.0/token",
            self.auth_base_url, config.tenant_id
        );

        let params = [
            ("grant_type", "client_credentials"),
            ("client_id", &config.client_id),
            ("client_secret", client_secret),
            ("scope", "https://graph.microsoft.com/.default"),
        ];

        let response = http_client
            .post(&token_url)
            .form(&params)
            .send()
            .await
            .context("Failed to reach Azure AD token endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Token request failed with status {}: {}", status, body);
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .context("Failed to parse token response")?;

        let expires_at = std::time::Instant::now()
            + std::time::Duration::from_secs(token_response.expires_in.saturating_sub(60));

        let access_token = token_response.access_token.clone();

        *self.token_cache.write().expect("lock poisoned") = Some(CachedToken {
            access_token: token_response.access_token,
            expires_at,
        });

        Ok(access_token)
    }

    /// Checks the circuit breaker and returns an error if open.
    fn check_circuit_breaker(&self) -> Result<()> {
        let mut cb = self.circuit_breaker.write().expect("lock poisoned");
        if !cb.is_allowed() {
            anyhow::bail!("Graph API circuit breaker is open - service temporarily unavailable")
        }
        Ok(())
    }

    /// Records a success in the circuit breaker.
    fn cb_success(&self) {
        self.circuit_breaker
            .write()
            .expect("lock poisoned")
            .record_success();
    }

    /// Records a failure in the circuit breaker.
    fn cb_failure(&self) {
        self.circuit_breaker
            .write()
            .expect("lock poisoned")
            .record_failure();
    }

    /// Tests the Graph API connection by fetching the organization endpoint.
    pub async fn test_connection(&self, http_client: &reqwest::Client) -> Result<bool> {
        self.check_circuit_breaker()?;

        let token = match self.acquire_token(http_client).await {
            Ok(t) => t,
            Err(e) => {
                self.cb_failure();
                return Err(e);
            }
        };

        let result = http_client
            .get(format!("{}/v1.0/organization", self.graph_base_url))
            .bearer_auth(&token)
            .send()
            .await
            .context("Failed to reach Graph API");

        match result {
            Ok(response) => {
                let success = response.status().is_success();
                if success {
                    self.cb_success();
                } else {
                    self.cb_failure();
                }
                Ok(success)
            }
            Err(e) => {
                self.cb_failure();
                Err(e)
            }
        }
    }

    /// Fetches mailbox quota from the usage report CSV.
    ///
    /// Calls `GET /reports/getMailboxUsageDetail(period='D7')` which returns CSV.
    /// Returns `(storage_used_bytes, quota_bytes)` if the user is found.
    async fn fetch_mailbox_quota(
        &self,
        http_client: &reqwest::Client,
        token: &str,
        upn: &str,
    ) -> Option<(u64, u64)> {
        let report_url = format!(
            "{}/v1.0/reports/getMailboxUsageDetail(period='D7')",
            self.graph_base_url
        );
        let response = http_client
            .get(&report_url)
            .bearer_auth(token)
            .send()
            .await
            .ok()?;

        if !response.status().is_success() {
            return None;
        }

        let csv_text = response.text().await.ok()?;
        parse_mailbox_quota_csv(&csv_text, upn)
    }

    /// Fetches Exchange Online information for a user by UPN or object ID.
    pub async fn get_exchange_online_info(
        &self,
        http_client: &reqwest::Client,
        user_id: &str,
    ) -> Result<Option<ExchangeOnlineInfo>> {
        if !self.is_configured() {
            return Ok(None);
        }

        self.check_circuit_breaker()?;

        let token = match self.acquire_token(http_client).await {
            Ok(t) => t,
            Err(e) => {
                self.cb_failure();
                return Err(e);
            }
        };

        // Fetch user profile (aliases, mail)
        let user_url = format!(
            "{}/v1.0/users/{}?$select=proxyAddresses,mail,otherMails",
            self.graph_base_url, user_id
        );
        let user_response = http_client
            .get(&user_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| {
                self.cb_failure();
                anyhow::anyhow!("Failed to fetch user profile from Graph: {}", e)
            })?;

        if user_response.status() == reqwest::StatusCode::NOT_FOUND {
            self.cb_success();
            return Ok(None);
        }

        if !user_response.status().is_success() {
            self.cb_failure();
            let status = user_response.status();
            let body = user_response.text().await.unwrap_or_default();
            anyhow::bail!("Graph user query failed ({}): {}", status, body);
        }

        let user_data: GraphUserResponse = user_response
            .json()
            .await
            .context("Failed to parse Graph user response")?;

        // Parse primary SMTP and aliases from proxyAddresses
        let proxy_addresses = user_data.proxy_addresses.unwrap_or_default();
        let mut primary_smtp = user_data.mail.unwrap_or_default();
        let mut aliases = Vec::new();

        for addr in &proxy_addresses {
            let addr_str: &str = addr.as_str();
            if let Some(stripped) = addr_str.strip_prefix("SMTP:") {
                primary_smtp = stripped.to_string();
            } else if let Some(stripped) = addr_str.strip_prefix("smtp:") {
                aliases.push(stripped.to_string());
            }
        }

        // Fetch mailbox settings (auto-reply, forwarding)
        let settings_url = format!(
            "{}/v1.0/users/{}/mailboxSettings",
            self.graph_base_url, user_id
        );
        let settings_response = http_client
            .get(&settings_url)
            .bearer_auth(&token)
            .send()
            .await;

        let (auto_reply_status, forwarding_address) = match settings_response {
            Ok(resp) if resp.status().is_success() => {
                let settings: GraphMailboxSettings = resp.json().await.unwrap_or_default();
                let auto_reply = settings
                    .automatic_replies_setting
                    .map(|s| s.status)
                    .unwrap_or_else(|| "Unknown".to_string());
                (auto_reply, None) // Forwarding via mailbox rules, handled separately
            }
            _ => ("Unknown".to_string(), None),
        };

        // Try to get real quota from usage report
        let report_quota = self.fetch_mailbox_quota(http_client, &token, user_id).await;

        // Fetch mailbox usage statistics (inbox folder as fallback)
        let (usage_bytes, quota_bytes) = if let Some((used, quota)) = report_quota {
            (used, quota)
        } else {
            let usage_url = format!(
                "{}/v1.0/users/{}/mailFolders/inbox?$select=totalItemCount,sizeInBytes",
                self.graph_base_url, user_id
            );
            match http_client.get(&usage_url).bearer_auth(&token).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let folder: GraphMailFolder = resp.json().await.unwrap_or_default();
                    let usage = folder.size_in_bytes.unwrap_or(0);
                    let quota = 53_687_091_200_u64; // 50 GB default
                    (usage, quota)
                }
                _ => (0, 53_687_091_200_u64),
            }
        };

        let usage_percentage = compute_usage_percentage(usage_bytes, quota_bytes);

        // Fetch mailbox delegates via inbox permissions
        let permissions_url = format!(
            "{}/v1.0/users/{}/mailFolders/inbox/permissions",
            self.graph_base_url, user_id
        );
        let delegates = match http_client
            .get(&permissions_url)
            .bearer_auth(&token)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let perms: GraphPermissionsResponse = resp.json().await.unwrap_or_default();
                perms
                    .value
                    .into_iter()
                    .filter_map(|p| {
                        p.email_address
                            .and_then(|e| e.address)
                            .filter(|a| !a.is_empty())
                    })
                    .collect()
            }
            _ => Vec::new(),
        };

        self.cb_success();

        Ok(Some(ExchangeOnlineInfo {
            primary_smtp_address: primary_smtp,
            email_aliases: aliases,
            forwarding_smtp_address: forwarding_address,
            auto_reply_status,
            mailbox_usage_bytes: usage_bytes,
            mailbox_quota_bytes: quota_bytes,
            usage_percentage,
            delegates,
        }))
    }
}

/// Parses the mailbox usage detail CSV to extract quota for a specific user.
///
/// Microsoft may prepend a UTF-8 BOM; the csv crate handles this transparently.
/// Returns `(storage_used_bytes, prohibit_send_quota_bytes)` if the UPN is found.
fn parse_mailbox_quota_csv(csv_text: &str, upn: &str) -> Option<(u64, u64)> {
    // Strip BOM if present
    let text = csv_text.strip_prefix('\u{FEFF}').unwrap_or(csv_text);

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());

    let headers = reader.headers().ok()?.clone();

    let upn_idx = headers.iter().position(|h| h == "User Principal Name")?;
    let used_idx = headers.iter().position(|h| h == "Storage Used (Byte)")?;
    let quota_idx = headers
        .iter()
        .position(|h| h == "Prohibit Send Quota (Byte)")?;

    for record in reader.records().flatten() {
        let record_upn = record.get(upn_idx)?;
        if record_upn.eq_ignore_ascii_case(upn) {
            let used: u64 = record.get(used_idx)?.parse().ok()?;
            let quota: u64 = record.get(quota_idx)?.parse().ok()?;
            return Some((used, quota));
        }
    }

    None
}

// --- Graph API response types ---

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize, Default)]
struct GraphUserResponse {
    mail: Option<String>,
    #[serde(rename = "proxyAddresses")]
    proxy_addresses: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
struct GraphMailboxSettings {
    #[serde(rename = "automaticRepliesSetting")]
    automatic_replies_setting: Option<AutomaticRepliesSetting>,
}

#[derive(Debug, Deserialize)]
struct AutomaticRepliesSetting {
    status: String,
}

#[derive(Debug, Deserialize, Default)]
struct GraphMailFolder {
    #[serde(rename = "sizeInBytes")]
    size_in_bytes: Option<u64>,
}

#[derive(Debug, Deserialize, Default)]
struct GraphPermissionsResponse {
    value: Vec<GraphPermission>,
}

#[derive(Debug, Deserialize)]
struct GraphPermission {
    #[serde(rename = "emailAddress")]
    email_address: Option<GraphEmailAddress>,
}

#[derive(Debug, Deserialize)]
struct GraphEmailAddress {
    address: Option<String>,
}

#[allow(clippy::unwrap_used)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_graph_config_is_configured() {
        let config = GraphConfig {
            tenant_id: "tenant-123".to_string(),
            client_id: "client-456".to_string(),
            client_secret: Some("secret".to_string()),
        };
        assert!(config.is_configured());
    }

    #[test]
    fn test_graph_config_not_configured_empty_tenant() {
        let config = GraphConfig {
            tenant_id: String::new(),
            client_id: "client-456".to_string(),
            client_secret: None,
        };
        assert!(!config.is_configured());
    }

    #[test]
    fn test_graph_config_not_configured_empty_client() {
        let config = GraphConfig {
            tenant_id: "tenant-123".to_string(),
            client_id: String::new(),
            client_secret: None,
        };
        assert!(!config.is_configured());
    }

    #[test]
    fn test_graph_config_not_configured_default() {
        let config = GraphConfig::default();
        assert!(!config.is_configured());
    }

    #[test]
    fn test_graph_config_validate_success() {
        let config = GraphConfig {
            tenant_id: "tenant".to_string(),
            client_id: "client".to_string(),
            client_secret: None,
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_graph_config_validate_missing_tenant() {
        let config = GraphConfig {
            tenant_id: String::new(),
            client_id: "client".to_string(),
            client_secret: None,
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("Tenant ID"));
    }

    #[test]
    fn test_graph_config_validate_missing_client() {
        let config = GraphConfig {
            tenant_id: "tenant".to_string(),
            client_id: String::new(),
            client_secret: None,
        };
        let err = config.validate().unwrap_err();
        assert!(err.contains("Client ID"));
    }

    #[test]
    fn test_service_default_not_configured() {
        let svc = GraphExchangeService::new();
        assert!(!svc.is_configured());
    }

    #[test]
    fn test_service_set_config() {
        let svc = GraphExchangeService::new();
        svc.set_config(GraphConfig {
            tenant_id: "t".to_string(),
            client_id: "c".to_string(),
            client_secret: Some("s".to_string()),
        });
        assert!(svc.is_configured());
        let config = svc.get_config();
        assert_eq!(config.tenant_id, "t");
        assert_eq!(config.client_id, "c");
    }

    #[test]
    fn test_service_config_change_invalidates_token() {
        let svc = GraphExchangeService::new();
        // Manually inject a cached token
        *svc.token_cache.write().unwrap() = Some(CachedToken {
            access_token: "old-token".to_string(),
            expires_at: std::time::Instant::now() + std::time::Duration::from_secs(3600),
        });
        // Change config should clear the cache
        svc.set_config(GraphConfig {
            tenant_id: "new".to_string(),
            client_id: "new".to_string(),
            client_secret: None,
        });
        assert!(svc.token_cache.read().unwrap().is_none());
    }

    // --- CSV quota parsing tests ---

    #[test]
    fn test_parse_csv_found() {
        let csv = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                   2026-03-18,alice@contoso.com,Alice,1073741824,53687091200\n\
                   2026-03-18,bob@contoso.com,Bob,2147483648,107374182400\n\
                   2026-03-18,carol@contoso.com,Carol,536870912,53687091200";
        let result = parse_mailbox_quota_csv(csv, "bob@contoso.com");
        assert_eq!(result, Some((2_147_483_648, 107_374_182_400)));
    }

    #[test]
    fn test_parse_csv_not_found() {
        let csv = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                   2026-03-18,alice@contoso.com,Alice,1073741824,53687091200";
        let result = parse_mailbox_quota_csv(csv, "unknown@contoso.com");
        assert_eq!(result, None);
    }

    #[test]
    fn test_parse_csv_case_insensitive() {
        let csv = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                   2026-03-18,Alice@Contoso.COM,Alice,999,53687091200";
        let result = parse_mailbox_quota_csv(csv, "alice@contoso.com");
        assert_eq!(result, Some((999, 53_687_091_200)));
    }

    #[test]
    fn test_parse_csv_empty() {
        let csv = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)";
        assert_eq!(parse_mailbox_quota_csv(csv, "alice@contoso.com"), None);
    }

    #[test]
    fn test_parse_csv_missing_columns() {
        let csv = "Report Refresh Date,User Principal Name,Display Name\n\
                   2026-03-18,alice@contoso.com,Alice";
        assert_eq!(parse_mailbox_quota_csv(csv, "alice@contoso.com"), None);
    }

    #[test]
    fn test_parse_csv_with_bom() {
        let csv = "\u{FEFF}Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                   2026-03-18,alice@contoso.com,Alice,500,1000";
        let result = parse_mailbox_quota_csv(csv, "alice@contoso.com");
        assert_eq!(result, Some((500, 1000)));
    }

    #[test]
    fn test_parse_csv_empty_string() {
        assert_eq!(parse_mailbox_quota_csv("", "alice@contoso.com"), None);
    }

    // --- Async integration tests with mockito ---

    fn make_test_config(secret: &str) -> GraphConfig {
        GraphConfig {
            tenant_id: "test-tenant".to_string(),
            client_id: "test-client".to_string(),
            client_secret: Some(secret.to_string()),
        }
    }

    fn token_json(token: &str, expires_in: u64) -> String {
        format!(
            r#"{{"access_token":"{}","token_type":"Bearer","expires_in":{}}}"#,
            token, expires_in
        )
    }

    #[tokio::test]
    async fn test_acquire_token_success() {
        let mut server = mockito::Server::new_async().await;
        let token_mock = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("my-access-token", 3600))
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls("http://unused.local", &server.url());
        svc.set_config(make_test_config("my-secret"));

        let client = reqwest::Client::new();
        let token = svc.acquire_token(&client).await.unwrap();
        assert_eq!(token, "my-access-token");
        assert!(svc.token_cache.read().unwrap().is_some());

        token_mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_acquire_token_uses_cache() {
        let mut server = mockito::Server::new_async().await;
        // No mock created - any HTTP call would panic
        let svc = GraphExchangeService::new_with_base_urls("http://unused.local", &server.url());
        svc.set_config(make_test_config("s"));

        // Inject a valid cached token
        *svc.token_cache.write().unwrap() = Some(CachedToken {
            access_token: "cached-token".to_string(),
            expires_at: std::time::Instant::now() + std::time::Duration::from_secs(3600),
        });

        let client = reqwest::Client::new();
        let token = svc.acquire_token(&client).await.unwrap();
        assert_eq!(token, "cached-token");

        // Ensure no HTTP call was made
        let _unused = server
            .mock("POST", mockito::Matcher::Any)
            .expect(0)
            .create_async()
            .await;
    }

    #[tokio::test]
    async fn test_acquire_token_refreshes_expired_cache() {
        let mut server = mockito::Server::new_async().await;
        let token_mock = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("fresh-token", 3600))
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls("http://unused.local", &server.url());
        svc.set_config(make_test_config("s"));

        // Inject an expired cached token
        *svc.token_cache.write().unwrap() = Some(CachedToken {
            access_token: "expired-token".to_string(),
            expires_at: std::time::Instant::now() - std::time::Duration::from_secs(1),
        });

        let client = reqwest::Client::new();
        let token = svc.acquire_token(&client).await.unwrap();
        assert_eq!(token, "fresh-token");

        token_mock.assert_async().await;
    }

    #[tokio::test]
    async fn test_acquire_token_missing_secret() {
        let svc = GraphExchangeService::new();
        svc.set_config(GraphConfig {
            tenant_id: "t".to_string(),
            client_id: "c".to_string(),
            client_secret: None,
        });

        let client = reqwest::Client::new();
        let err = svc.acquire_token(&client).await.unwrap_err();
        assert!(
            err.to_string().contains("Client secret is required"),
            "Expected 'Client secret is required', got: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_test_connection_success() {
        let mut server = mockito::Server::new_async().await;
        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;
        let _org = server
            .mock("GET", "/v1.0/organization")
            .with_status(200)
            .with_body("{}")
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        assert!(svc.test_connection(&client).await.unwrap());
    }

    #[tokio::test]
    async fn test_test_connection_api_failure() {
        let mut server = mockito::Server::new_async().await;
        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;
        let _org = server
            .mock("GET", "/v1.0/organization")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        assert!(!svc.test_connection(&client).await.unwrap());
    }

    #[tokio::test]
    async fn test_get_exchange_online_info_full_flow() {
        let mut server = mockito::Server::new_async().await;

        // Token
        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        // User profile
        let _user = server
            .mock("GET", "/v1.0/users/alice@contoso.com")
            .match_query(mockito::Matcher::UrlEncoded(
                "$select".to_string(),
                "proxyAddresses,mail,otherMails".to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{
                    "mail": "alice@contoso.com",
                    "proxyAddresses": ["SMTP:alice@contoso.com", "smtp:a.smith@contoso.com"]
                }"#,
            )
            .create_async()
            .await;

        // Mailbox settings
        let _settings = server
            .mock("GET", "/v1.0/users/alice@contoso.com/mailboxSettings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"automaticRepliesSetting":{"status":"Disabled"}}"#)
            .create_async()
            .await;

        // Report CSV (real quota)
        let csv_body = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                        2026-03-18,alice@contoso.com,Alice,2147483648,107374182400";
        let _report = server
            .mock("GET", "/v1.0/reports/getMailboxUsageDetail(period='D7')")
            .with_status(200)
            .with_header("content-type", "text/csv")
            .with_body(csv_body)
            .create_async()
            .await;

        // Permissions
        let _perms = server
            .mock(
                "GET",
                "/v1.0/users/alice@contoso.com/mailFolders/inbox/permissions",
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"value":[{"emailAddress":{"address":"delegate@contoso.com"}}]}"#)
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let info = svc
            .get_exchange_online_info(&client, "alice@contoso.com")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(info.primary_smtp_address, "alice@contoso.com");
        assert_eq!(info.email_aliases, vec!["a.smith@contoso.com"]);
        assert_eq!(info.auto_reply_status, "Disabled");
        assert_eq!(info.mailbox_usage_bytes, 2_147_483_648);
        assert_eq!(info.mailbox_quota_bytes, 107_374_182_400);
        assert_eq!(info.delegates, vec!["delegate@contoso.com"]);
        assert!(info.forwarding_smtp_address.is_none());
    }

    #[tokio::test]
    async fn test_get_exchange_online_info_user_not_found() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        let _user = server
            .mock("GET", "/v1.0/users/nobody@contoso.com")
            .match_query(mockito::Matcher::Any)
            .with_status(404)
            .with_body(r#"{"error":{"code":"Request_ResourceNotFound"}}"#)
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let result = svc
            .get_exchange_online_info(&client, "nobody@contoso.com")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_exchange_online_info_unconfigured() {
        let svc = GraphExchangeService::new(); // not configured

        let client = reqwest::Client::new();
        let result = svc
            .get_exchange_online_info(&client, "alice@contoso.com")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_proxy_address_parsing() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        let _user = server
            .mock("GET", "/v1.0/users/bob@contoso.com")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{
                    "mail": "fallback@contoso.com",
                    "proxyAddresses": [
                        "SMTP:bob.primary@contoso.com",
                        "smtp:bob.alias1@contoso.com",
                        "smtp:bob.alias2@contoso.com",
                        "X500:/o=Exchange/ou=Admin/cn=Recipients/cn=bob"
                    ]
                }"#,
            )
            .create_async()
            .await;

        // Remaining endpoints return defaults
        let _settings = server
            .mock("GET", "/v1.0/users/bob@contoso.com/mailboxSettings")
            .with_status(403)
            .create_async()
            .await;
        let _report = server
            .mock("GET", "/v1.0/reports/getMailboxUsageDetail(period='D7')")
            .with_status(403)
            .create_async()
            .await;
        let _usage = server
            .mock("GET", "/v1.0/users/bob@contoso.com/mailFolders/inbox")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"sizeInBytes": 100}"#)
            .create_async()
            .await;
        let _perms = server
            .mock(
                "GET",
                "/v1.0/users/bob@contoso.com/mailFolders/inbox/permissions",
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"value":[]}"#)
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let info = svc
            .get_exchange_online_info(&client, "bob@contoso.com")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(info.primary_smtp_address, "bob.primary@contoso.com");
        assert_eq!(
            info.email_aliases,
            vec!["bob.alias1@contoso.com", "bob.alias2@contoso.com"]
        );
    }

    #[tokio::test]
    async fn test_user_query_error_status() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        let _user = server
            .mock("GET", "/v1.0/users/forbidden@contoso.com")
            .match_query(mockito::Matcher::Any)
            .with_status(403)
            .with_body("Forbidden")
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let err = svc
            .get_exchange_online_info(&client, "forbidden@contoso.com")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("403"));
    }

    #[tokio::test]
    async fn test_token_endpoint_failure() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(401)
            .with_body("Unauthorized")
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let err = svc.acquire_token(&client).await.unwrap_err();
        assert!(err.to_string().contains("401"));
    }

    #[tokio::test]
    async fn test_exchange_info_with_real_quota() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        let _user = server
            .mock("GET", "/v1.0/users/alice@contoso.com")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"mail":"alice@contoso.com","proxyAddresses":[]}"#)
            .create_async()
            .await;

        let _settings = server
            .mock("GET", "/v1.0/users/alice@contoso.com/mailboxSettings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"automaticRepliesSetting":{"status":"Disabled"}}"#)
            .create_async()
            .await;

        // Report returns real quota: 100 GB
        let csv_body = "Report Refresh Date,User Principal Name,Display Name,Storage Used (Byte),Prohibit Send Quota (Byte)\n\
                        2026-03-18,alice@contoso.com,Alice,5368709120,107374182400";
        let _report = server
            .mock("GET", "/v1.0/reports/getMailboxUsageDetail(period='D7')")
            .with_status(200)
            .with_header("content-type", "text/csv")
            .with_body(csv_body)
            .create_async()
            .await;

        let _perms = server
            .mock(
                "GET",
                "/v1.0/users/alice@contoso.com/mailFolders/inbox/permissions",
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"value":[]}"#)
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let info = svc
            .get_exchange_online_info(&client, "alice@contoso.com")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(info.mailbox_usage_bytes, 5_368_709_120);
        assert_eq!(info.mailbox_quota_bytes, 107_374_182_400);
    }

    #[tokio::test]
    async fn test_exchange_info_report_fallback() {
        let mut server = mockito::Server::new_async().await;

        let _token = server
            .mock("POST", "/test-tenant/oauth2/v2.0/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(token_json("tok", 3600))
            .create_async()
            .await;

        let _user = server
            .mock("GET", "/v1.0/users/alice@contoso.com")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"mail":"alice@contoso.com","proxyAddresses":[]}"#)
            .create_async()
            .await;

        let _settings = server
            .mock("GET", "/v1.0/users/alice@contoso.com/mailboxSettings")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"automaticRepliesSetting":{"status":"Disabled"}}"#)
            .create_async()
            .await;

        // Report returns 403 - fallback to inbox size + 50 GB default
        let _report = server
            .mock("GET", "/v1.0/reports/getMailboxUsageDetail(period='D7')")
            .with_status(403)
            .with_body("Forbidden")
            .create_async()
            .await;

        // Inbox folder fallback
        let _usage = server
            .mock("GET", "/v1.0/users/alice@contoso.com/mailFolders/inbox")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"sizeInBytes": 1073741824}"#)
            .create_async()
            .await;

        let _perms = server
            .mock(
                "GET",
                "/v1.0/users/alice@contoso.com/mailFolders/inbox/permissions",
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"value":[]}"#)
            .create_async()
            .await;

        let svc = GraphExchangeService::new_with_base_urls(&server.url(), &server.url());
        svc.set_config(make_test_config("s"));

        let client = reqwest::Client::new();
        let info = svc
            .get_exchange_online_info(&client, "alice@contoso.com")
            .await
            .unwrap()
            .unwrap();

        // Fallback: inbox size + 50 GB default quota
        assert_eq!(info.mailbox_usage_bytes, 1_073_741_824);
        assert_eq!(info.mailbox_quota_bytes, 53_687_091_200);
    }
}
