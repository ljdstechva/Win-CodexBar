//! OpenAI/ChatGPT web provider implementation.
//!
//! The account-only provider exposes plan data from ChatGPT's authenticated
//! accounts endpoint. It prefers the Codex CLI OAuth account so entitlement
//! data matches the visible Codex quota, then falls back to a web session when
//! no Codex account exists. It never manufactures a quota window.

pub mod friendly_errors;
pub mod scraper;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::{
    Client,
    header::{ACCEPT, AUTHORIZATION, COOKIE, HeaderValue, USER_AGENT},
};

use crate::browser::{
    cookies::get_cookie_header_from_browser,
    detection::{BrowserDetector, DetectedBrowser},
};
use crate::core::{
    FetchContext, Provider, ProviderError, ProviderFetchResult, ProviderId, ProviderMetadata,
    SourceMode, UsageSnapshot,
};
use crate::providers::codex::{CodexApi, CodexChatGptSession};
use scraper::{
    ChatGPTBootstrapSession, chatgpt_account_plan, chatgpt_bootstrap_session,
    parse_chatgpt_plan_from_accounts_json, parse_json_script,
    parse_subscription_end_from_accounts_json,
};

const CHATGPT_HOME_URL: &str = "https://chatgpt.com/";
const CHATGPT_ACCOUNTS_URL: &str = "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const CHATGPT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

pub struct ChatGPTProvider {
    metadata: ProviderMetadata,
    client: Client,
}

impl ChatGPTProvider {
    pub fn new() -> Self {
        Self {
            metadata: ProviderMetadata {
                id: ProviderId::ChatGPT,
                display_name: "ChatGPT",
                session_label: "Account",
                weekly_label: "Account",
                supports_opus: false,
                supports_credits: false,
                default_enabled: false,
                is_primary: false,
                dashboard_url: Some("https://chatgpt.com/#settings/Subscription"),
                status_page_url: Some("https://status.openai.com"),
            },
            client: crate::core::credentialed_http_client_builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| Client::new()),
        }
    }

    fn account_usage(
        plan_name: Option<String>,
        accounts_json: Option<&str>,
        account_id: Option<&str>,
        now: DateTime<Utc>,
    ) -> UsageSnapshot {
        let mut usage = UsageSnapshot::account_only();
        if let Some(plan_name) = plan_name {
            usage = usage.with_login_method(plan_name);
        }
        if let Some(ends_at) = accounts_json
            .and_then(|json| parse_subscription_end_from_accounts_json(json, account_id, now))
        {
            usage = usage.with_subscription_ends_at(ends_at);
        }
        usage
    }

    async fn fetch_accounts_payload(
        &self,
        cookie: HeaderValue,
        session: &ChatGPTBootstrapSession,
    ) -> Option<String> {
        let authorization =
            HeaderValue::from_str(&format!("Bearer {}", session.access_token)).ok()?;
        let account_id = HeaderValue::from_str(&session.account_id).ok()?;
        let response = self
            .client
            .get(CHATGPT_ACCOUNTS_URL)
            .header(COOKIE, cookie)
            .header(AUTHORIZATION, authorization)
            .header("chatgpt-account-id", account_id)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, CHATGPT_USER_AGENT)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.text().await.ok()
    }

    async fn fetch_accounts_payload_with_codex_oauth(
        &self,
        session: &CodexChatGptSession,
    ) -> Result<String, ProviderError> {
        let authorization = HeaderValue::from_str(&format!("Bearer {}", session.access_token))
            .map_err(|_| ProviderError::AuthRequired)?;
        let account_id =
            HeaderValue::from_str(&session.account_id).map_err(|_| ProviderError::AuthRequired)?;
        let response = self
            .client
            .get(CHATGPT_ACCOUNTS_URL)
            .header(AUTHORIZATION, authorization)
            .header("chatgpt-account-id", account_id)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, CHATGPT_USER_AGENT)
            .send()
            .await?;

        if matches!(response.status().as_u16(), 401 | 403) {
            return Err(ProviderError::AuthRequired);
        }
        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "ChatGPT accounts endpoint returned HTTP {}",
                response.status()
            )));
        }
        response
            .text()
            .await
            .map_err(|error| ProviderError::Parse(error.to_string()))
    }

    async fn fetch_with_codex_oauth(&self) -> Result<Option<UsageSnapshot>, ProviderError> {
        let session = match CodexApi::new().load_chatgpt_session() {
            Ok(session) => session,
            Err(ProviderError::NotInstalled(_)) => None,
            Err(error) => return Err(error),
        };
        let Some(session) = session else {
            return Ok(None);
        };

        let payload = self
            .fetch_accounts_payload_with_codex_oauth(&session)
            .await?;
        let plan_name = parse_chatgpt_plan_from_accounts_json(&payload, &session.account_id);
        let usage = Self::account_usage(
            plan_name,
            Some(&payload),
            Some(&session.account_id),
            Utc::now(),
        );
        if usage.login_method.is_none() && usage.subscription_ends_at.is_none() {
            return Err(ProviderError::Parse(
                "ChatGPT account response did not contain plan or entitlement data".to_string(),
            ));
        }
        Ok(Some(usage))
    }

    async fn fetch_with_cookies(
        &self,
        cookie_header: &str,
    ) -> Result<UsageSnapshot, ProviderError> {
        let cookie = HeaderValue::from_str(cookie_header)
            .map_err(|_| ProviderError::Other("Invalid ChatGPT cookie header".to_string()))?;
        let response = self
            .client
            .get(CHATGPT_HOME_URL)
            .header(COOKIE, cookie.clone())
            .header(ACCEPT, "text/html,application/xhtml+xml")
            .header(USER_AGENT, CHATGPT_USER_AGENT)
            .send()
            .await?;

        if matches!(response.status().as_u16(), 401 | 403) {
            return Err(ProviderError::AuthRequired);
        }
        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "ChatGPT returned HTTP {}",
                response.status()
            )));
        }

        let html = response.text().await?;
        let bootstrap =
            parse_json_script(&html, "client-bootstrap").ok_or(ProviderError::AuthRequired)?;
        let plan_name = chatgpt_account_plan(&bootstrap);
        let session = chatgpt_bootstrap_session(&bootstrap);
        if plan_name.is_none() && session.is_none() {
            return Err(ProviderError::AuthRequired);
        }

        let accounts_payload = match session.as_ref() {
            Some(session) => self.fetch_accounts_payload(cookie, session).await,
            None => None,
        };
        Ok(Self::account_usage(
            plan_name,
            accounts_payload.as_deref(),
            session.as_ref().map(|session| session.account_id.as_str()),
            Utc::now(),
        ))
    }

    async fn fetch_from_browser_profiles(&self) -> Result<UsageSnapshot, ProviderError> {
        let mut last_fetch_error = None;
        let mut first_plan_only = None;

        for browser in BrowserDetector::detect_all() {
            for profile in &browser.profiles {
                let profile_browser = DetectedBrowser {
                    browser_type: browser.browser_type,
                    user_data_dir: browser.user_data_dir.clone(),
                    profiles: vec![profile.clone()],
                };
                let Ok(cookie_header) =
                    get_cookie_header_from_browser("chatgpt.com", &profile_browser)
                else {
                    continue;
                };

                match self.fetch_with_cookies(&cookie_header).await {
                    Ok(usage) if usage.subscription_ends_at.is_some() => return Ok(usage),
                    Ok(usage) => {
                        // A machine can have several logged-in ChatGPT profiles.
                        // Keep the first usable plan as a truthful fallback, but
                        // continue looking for the profile whose active account
                        // exposes the authoritative entitlement expiry.
                        first_plan_only.get_or_insert(usage);
                    }
                    Err(error) => last_fetch_error = Some(error),
                }
            }
        }

        first_plan_only.ok_or_else(|| last_fetch_error.unwrap_or(ProviderError::AuthRequired))
    }
}

impl Default for ChatGPTProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for ChatGPTProvider {
    fn id(&self) -> ProviderId {
        ProviderId::ChatGPT
    }

    fn metadata(&self) -> &ProviderMetadata {
        &self.metadata
    }

    async fn fetch_usage(&self, ctx: &FetchContext) -> Result<ProviderFetchResult, ProviderError> {
        tracing::debug!("Fetching ChatGPT account plan");
        match ctx.source_mode {
            SourceMode::Auto => {
                if let Some(usage) = self.fetch_with_codex_oauth().await? {
                    return Ok(ProviderFetchResult::new(usage, "oauth"));
                }
                let usage = match ctx.manual_cookie_header.as_deref() {
                    Some(cookie_header) if !cookie_header.trim().is_empty() => {
                        self.fetch_with_cookies(cookie_header).await?
                    }
                    _ => self.fetch_from_browser_profiles().await?,
                };
                Ok(ProviderFetchResult::new(usage, "web"))
            }
            SourceMode::Web => {
                let cookie_header = ctx
                    .manual_cookie_header
                    .as_deref()
                    .filter(|header| !header.trim().is_empty())
                    .ok_or(ProviderError::AuthRequired)?;
                let usage = self.fetch_with_cookies(cookie_header).await?;
                Ok(ProviderFetchResult::new(usage, "web"))
            }
            SourceMode::OAuth | SourceMode::Cli => {
                Err(ProviderError::UnsupportedSource(ctx.source_mode))
            }
        }
    }

    fn available_sources(&self) -> Vec<SourceMode> {
        vec![SourceMode::Auto, SourceMode::Web]
    }

    fn supports_web(&self) -> bool {
        true
    }
}

// Re-exports for error handling and dashboard scraping
#[allow(unused_imports)]
pub use friendly_errors::{
    OpenAIWebErrorKind, extract_auth_status, extract_signed_in_email, friendly_error, is_logged_out,
};
#[allow(unused_imports)]
pub use scraper::{
    CreditsHistoryEntry, OPENAI_DASHBOARD_SCRAPE_SCRIPT, OpenAIDashboardData, UsageBreakdown,
    parse_dashboard_json,
};

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn authoritative_entitlement_maps_to_active_chatgpt_snapshot() {
        let usage = ChatGPTProvider::account_usage(
            Some("Pro".to_string()),
            Some(
                r#"{"accounts":{"acct_fixture":{"entitlement":{"expires_at":"2026-07-23T00:00:00Z"}}}}"#,
            ),
            Some("acct_fixture"),
            timestamp("2026-07-22T00:00:00Z"),
        );

        assert!(usage.account_only);
        assert_eq!(usage.login_method.as_deref(), Some("Pro"));
        assert_eq!(
            usage.subscription_ends_at,
            Some(timestamp("2026-07-23T00:00:00Z"))
        );
    }

    #[test]
    fn account_snapshot_degrades_to_plan_only() {
        let usage = ChatGPTProvider::account_usage(
            Some("Plus".to_string()),
            Some(r#"{"accounts":{"default":{"entitlement":{}}}}"#),
            None,
            timestamp("2026-07-22T00:00:00Z"),
        );

        assert!(usage.account_only);
        assert_eq!(usage.login_method.as_deref(), Some("Plus"));
        assert_eq!(usage.subscription_ends_at, None);
    }

    #[tokio::test]
    async fn manual_web_source_requires_an_explicit_cookie() {
        let provider = ChatGPTProvider::new();
        let context = FetchContext {
            source_mode: SourceMode::Web,
            ..FetchContext::default()
        };

        let error = provider.fetch_usage(&context).await.unwrap_err();

        assert!(matches!(error, ProviderError::AuthRequired));
    }
}
