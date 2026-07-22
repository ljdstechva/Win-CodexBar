//! Claude Web API fetcher - uses browser cookies to fetch usage from claude.ai

use chrono::{DateTime, Utc};
use reqwest::{Client, header};
use serde::Deserialize;

use crate::browser::cookies::get_cookie_header;
#[cfg(target_os = "windows")]
use crate::browser::{
    cookies::CookieExtractor,
    detection::{BrowserProfile, BrowserType, DetectedBrowser},
};
use crate::core::{
    CostSnapshot, NamedRateWindow, ProviderError, ProviderFetchResult, RateWindow, UsageSnapshot,
};

/// Read the response body as text, then deserialize as JSON. On failure, include
/// non-sensitive shape metadata so auth redirects, error envelopes, and schema
/// changes are distinguishable without exposing account data in UI/log output.
async fn parse_json_with_body<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
    label: &str,
) -> Result<T, ProviderError> {
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response
        .text()
        .await
        .map_err(|e| ProviderError::Parse(format!("Failed to read {label} response body: {e}")))?;

    serde_json::from_str::<T>(&body).map_err(|e| {
        ProviderError::Parse(format!(
            "Failed to parse {label}: {e} ({})",
            describe_json_body_shape(&body, content_type.as_deref())
        ))
    })
}

fn describe_json_body_shape(body: &str, content_type: Option<&str>) -> String {
    let content_type = content_type.unwrap_or("unknown");
    let body_len = body.len();

    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(serde_json::Value::Object(map)) => {
            let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
            keys.sort_unstable();
            let suffix = if keys.len() > 12 { ", ..." } else { "" };
            let keys = keys.into_iter().take(12).collect::<Vec<_>>().join(", ");
            format!("content_type={content_type}, body_len={body_len}, json_keys=[{keys}{suffix}]")
        }
        Ok(value) => format!(
            "content_type={content_type}, body_len={body_len}, json_type={}",
            json_value_kind(&value)
        ),
        Err(_) => format!("content_type={content_type}, body_len={body_len}, body_kind=non-json"),
    }
}

fn json_value_kind(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "bool",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Claude Web API fetcher
pub struct ClaudeWebApiFetcher {
    client: Client,
}

/// Organization info from Claude API
#[derive(Debug, Deserialize)]
struct Organization {
    uuid: String,
    #[allow(dead_code)]
    name: Option<String>,
}

/// Usage response from Claude API.
///
/// Anthropic ships overlapping field names for the design and routines
/// windows (e.g. both `seven_day_design` and `seven_day_omelette` may appear
/// in the same payload). Serde aliases can't accept that — it errors with
/// "duplicate field" if more than one alias is present. We deserialize into
/// a generic map and pick the first alias that yields a non-null value.
#[derive(Debug)]
struct UsageResponse {
    five_hour: Option<UsageWindow>,
    seven_day: Option<UsageWindow>,
    seven_day_opus: Option<UsageWindow>,
    seven_day_sonnet: Option<UsageWindow>,
    seven_day_oauth_apps: Option<UsageWindow>,
    seven_day_design: Option<UsageWindow>,
    seven_day_routines: Option<UsageWindow>,
    extra_usage: Option<ExtraUsageResponse>,
    limits: Vec<super::scoped_weekly::ScopedWeeklyLimit>,
}

impl<'de> Deserialize<'de> for UsageResponse {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut map: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::deserialize(deserializer)?;

        let take = |map: &mut std::collections::HashMap<String, serde_json::Value>,
                    keys: &[&str]|
         -> Result<Option<UsageWindow>, D::Error> {
            for key in keys {
                if let Some(value) = map.remove(*key) {
                    if value.is_null() {
                        continue;
                    }
                    let window: UsageWindow =
                        serde_json::from_value(value).map_err(serde::de::Error::custom)?;
                    return Ok(Some(window));
                }
            }
            Ok(None)
        };

        Ok(UsageResponse {
            five_hour: take(&mut map, &["five_hour"])?,
            seven_day: take(&mut map, &["seven_day"])?,
            seven_day_opus: take(&mut map, &["seven_day_opus"])?,
            seven_day_sonnet: take(&mut map, &["seven_day_sonnet"])?,
            seven_day_oauth_apps: take(
                &mut map,
                &[
                    "seven_day_oauth_apps",
                    "seven_day_claude_oauth_apps",
                    "oauth_apps",
                    "oauth",
                ],
            )?,
            seven_day_design: take(
                &mut map,
                &[
                    "seven_day_design",
                    "seven_day_claude_design",
                    "claude_design",
                    "design",
                    "seven_day_omelette",
                    "omelette",
                    "omelette_promotional",
                ],
            )?,
            seven_day_routines: take(
                &mut map,
                &[
                    "seven_day_routines",
                    "seven_day_claude_routines",
                    "claude_routines",
                    "routines",
                    "routine",
                    "seven_day_cowork",
                    "cowork",
                ],
            )?,
            limits: map
                .get("limits")
                .filter(|value| !value.is_null())
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(serde::de::Error::custom)?
                .unwrap_or_default(),
            extra_usage: map
                .remove("extra_usage")
                .filter(|value| !value.is_null())
                .map(serde_json::from_value)
                .transpose()
                .map_err(serde::de::Error::custom)?,
        })
    }
}

/// A usage window from the API
#[derive(Debug, Deserialize)]
struct UsageWindow {
    utilization: Option<f64>,

    #[serde(rename = "resets_at")]
    resets_at: Option<String>,
}

/// Extra usage (credits) response
#[derive(Debug, Clone, Deserialize)]
struct ExtraUsageResponse {
    #[serde(rename = "monthly_credit_limit")]
    monthly_credit_limit: Option<f64>,

    #[serde(rename = "used_credits")]
    used_credits: Option<f64>,

    currency: Option<String>,

    #[serde(rename = "is_enabled")]
    is_enabled: Option<bool>,
}

/// Account info response
#[derive(Debug, Deserialize)]
struct AccountResponse {
    email_address: Option<String>,

    #[serde(default)]
    memberships: Vec<AccountMembership>,
}

#[derive(Debug, Deserialize)]
struct AccountMembership {
    uuid: Option<String>,
    organization: Option<AccountOrganization>,
}

#[derive(Debug, Deserialize)]
struct AccountOrganization {
    uuid: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DesktopBootstrapResponse {
    account: Option<DesktopBootstrapAccount>,
}

#[derive(Debug, Deserialize)]
struct DesktopBootstrapAccount {
    #[serde(default)]
    memberships: Vec<DesktopBootstrapMembership>,
}

#[derive(Debug, Deserialize)]
struct DesktopBootstrapMembership {
    seat_tier: Option<String>,
    organization: Option<DesktopBootstrapOrganization>,
}

#[derive(Debug, Deserialize)]
struct DesktopBootstrapOrganization {
    uuid: Option<String>,
    rate_limit_tier: Option<String>,
}

impl DesktopBootstrapResponse {
    fn plan_tier_for_org(&self, org_id: &str) -> Option<String> {
        self.account
            .as_ref()?
            .memberships
            .iter()
            .find(|membership| {
                membership
                    .organization
                    .as_ref()
                    .and_then(|organization| organization.uuid.as_deref())
                    == Some(org_id)
            })
            .and_then(|membership| {
                membership
                    .organization
                    .as_ref()
                    .and_then(|organization| organization.rate_limit_tier.as_deref())
                    .or(membership.seat_tier.as_deref())
            })
            .map(str::trim)
            .filter(|tier| !tier.is_empty())
            .map(ToString::to_string)
    }

    fn plan_name_for_org(&self, org_id: &str) -> Option<String> {
        self.plan_tier_for_org(org_id)
            .map(|tier| ClaudeWebApiFetcher::tier_to_plan_name(&tier))
    }
}

/// Provider-owned, non-personal subscription enrichment from Claude's
/// authenticated billing response. No cookie, organization, or identity data
/// leaves this module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaudeSubscriptionSummary {
    pub(crate) ends_at: DateTime<Utc>,
    pub(crate) plan_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SubscriptionDetailsResponse {
    next_charge_at: Option<String>,
    next_charge_date: Option<String>,
    plan_ending_at: Option<String>,
    plan_ending_before: Option<String>,
}

impl SubscriptionDetailsResponse {
    fn future_end(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        // A scheduled plan end is authoritative when present; otherwise the
        // next charge date is the provider's renewal boundary. OAuth token
        // expiry, JWT exp, and quota reset fields are deliberately absent from
        // this typed response and can never reach subscription_ends_at.
        let raw = self
            .plan_ending_at
            .as_deref()
            .or(self.plan_ending_before.as_deref())
            .or(self.next_charge_at.as_deref())
            .or(self.next_charge_date.as_deref())?;
        let parsed = ClaudeWebApiFetcher::parse_iso8601(raw)?;
        (parsed > now).then_some(parsed)
    }
}

impl AccountResponse {
    fn membership_org_ids(&self) -> Vec<String> {
        self.memberships
            .iter()
            .filter_map(|membership| {
                membership
                    .organization
                    .as_ref()
                    .and_then(|organization| organization.uuid.as_deref())
                    .or(membership.uuid.as_deref())
                    .map(str::trim)
                    .filter(|uuid| !uuid.is_empty())
                    .map(ToString::to_string)
            })
            .collect()
    }

    fn first_membership_org_id(&self) -> Option<String> {
        self.membership_org_ids().into_iter().next()
    }
}

fn push_unique_nonempty(values: &mut Vec<String>, candidate: Option<&str>) {
    let Some(candidate) = candidate.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if !values.iter().any(|value| value == candidate) {
        values.push(candidate.to_string());
    }
}

impl ClaudeWebApiFetcher {
    const BASE_URL: &'static str = "https://claude.ai/api";

    /// Create a new fetcher
    pub fn new() -> Self {
        Self {
            client: crate::core::credentialed_http_client_builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
        }
    }

    /// Fetch usage using browser cookies or env-var session key
    pub async fn fetch_with_cookies(&self) -> Result<ProviderFetchResult, ProviderError> {
        if let Some(session_key) = Self::resolve_session_key_from_env() {
            tracing::debug!("Using Claude session key from environment variable");
            let cookie_header = format!("sessionKey={session_key}");
            return self.fetch_with_cookie_header(&cookie_header).await;
        }

        // Try multiple domains - Claude uses different domains for different services
        let domains = [
            "claude.ai",
            "claude.com",
            "console.anthropic.com",
            "anthropic.com",
        ];

        for domain in domains {
            match get_cookie_header(domain) {
                Ok(cookie_header) if !cookie_header.is_empty() => {
                    tracing::debug!("Found cookies for {}", domain);
                    return self.fetch_with_cookie_header(&cookie_header).await;
                }
                Ok(_) => {
                    tracing::debug!("No cookies found for {}", domain);
                }
                Err(e) => {
                    tracing::debug!("Failed to get cookies for {}: {}", domain, e);
                }
            }
        }

        Err(ProviderError::NoCookies)
    }

    /// Fetch only Claude's authoritative renewal/end boundary for enriching a
    /// quota snapshot obtained through OAuth or the CLI.
    pub(crate) async fn fetch_subscription_with_cookies(
        &self,
    ) -> Result<Option<ClaudeSubscriptionSummary>, ProviderError> {
        if let Some(session_key) = Self::resolve_session_key_from_env() {
            let cookie_header = format!("sessionKey={session_key}");
            return self
                .fetch_subscription_with_cookie_header(&cookie_header)
                .await;
        }

        let mut last_error = None;

        match Self::claude_desktop_cookie_header() {
            Ok(Some(cookie_header)) => {
                match self
                    .fetch_subscription_with_cookie_header(&cookie_header)
                    .await
                {
                    Ok(Some(summary)) => return Ok(Some(summary)),
                    Ok(None) => {}
                    Err(error) => last_error = Some(error),
                }
            }
            Ok(None) => {}
            Err(error) => last_error = Some(error),
        }

        match super::super::browser_cookie_header(&[
            "claude.ai",
            "claude.com",
            "console.anthropic.com",
            "anthropic.com",
        ]) {
            Ok(cookie_header) => match self
                .fetch_subscription_with_cookie_header(&cookie_header)
                .await
            {
                Ok(summary) => Ok(summary),
                Err(error) => Err(error),
            },
            Err(error) => Err(last_error.unwrap_or(error)),
        }
    }

    async fn fetch_subscription_with_cookie_header(
        &self,
        cookie_header: &str,
    ) -> Result<Option<ClaudeSubscriptionSummary>, ProviderError> {
        let account_headers = Self::build_headers(cookie_header);
        let subscription_headers = Self::build_subscription_headers(cookie_header);
        let account = self.get_account_info(&account_headers).await.ok();
        let mut org_ids = Vec::new();

        push_unique_nonempty(
            &mut org_ids,
            cookie_value(cookie_header, "lastActiveOrg").as_deref(),
        );
        if let Some(account) = account.as_ref() {
            for org_id in account.membership_org_ids() {
                push_unique_nonempty(&mut org_ids, Some(&org_id));
            }
        }
        if let Ok(organizations) = self.get_organizations(&account_headers).await {
            for organization in organizations {
                push_unique_nonempty(&mut org_ids, Some(&organization.uuid));
            }
        }

        if org_ids.is_empty() {
            return Err(ProviderError::Parse(
                "No Claude organization context found".to_string(),
            ));
        }

        let mut last_error = None;
        let mut successful_response_without_future_date = false;

        for org_id in org_ids {
            match self
                .get_subscription_details(&org_id, &subscription_headers)
                .await
            {
                Ok(details) => {
                    if let Some(ends_at) = details.future_end(Utc::now()) {
                        let plan_name = self
                            .get_desktop_bootstrap_plan_name(&org_id, cookie_header)
                            .await
                            .ok()
                            .flatten();
                        return Ok(Some(ClaudeSubscriptionSummary { ends_at, plan_name }));
                    }
                    successful_response_without_future_date = true;
                }
                Err(error) => last_error = Some(error),
            }
        }

        if successful_response_without_future_date {
            Ok(None)
        } else {
            Err(last_error.unwrap_or_else(|| {
                ProviderError::Other(
                    "Claude subscription details were unavailable for every account organization"
                        .to_string(),
                )
            }))
        }
    }

    fn apply_scoped_web_account_metadata(
        mut snapshot: UsageSnapshot,
        account: Option<&AccountResponse>,
        scoped_plan_name: Option<&str>,
        subscription_end: Option<DateTime<Utc>>,
    ) -> UsageSnapshot {
        if let Some(email) = account.and_then(|account| account.email_address.as_ref()) {
            snapshot = snapshot.with_email(email.clone());
        }
        if let Some(plan_name) = scoped_plan_name {
            snapshot = snapshot.with_login_method(plan_name.to_string());
        }
        if let Some(ends_at) = subscription_end {
            snapshot = snapshot.with_subscription_ends_at(ends_at);
        }
        snapshot
    }

    /// Fetch usage with a provided cookie header
    pub async fn fetch_with_cookie_header(
        &self,
        cookie_header: &str,
    ) -> Result<ProviderFetchResult, ProviderError> {
        tracing::debug!("Fetching Claude usage via web API");

        let headers = Self::build_headers(cookie_header);

        // Step 1: Get organization ID
        let org_id = self.get_organization_id(cookie_header, &headers).await?;
        tracing::debug!("Resolved Claude organization context");

        // Step 2: Fetch usage data
        let usage = self.get_usage(&org_id, &headers).await?;

        // Step 3: Fetch extra usage (credits) - optional
        let extra_usage = self
            .get_extra_usage(&org_id, &headers)
            .await
            .ok()
            .or_else(|| usage.extra_usage.clone());

        // Step 4: Fetch account info - optional
        let account = self.get_account_info(&headers).await.ok();

        // The plan label must come from the same organization used for quota
        // and billing. AccountResponse.rate_limit_tier is account-global and
        // can describe another membership in multi-organization accounts.
        let scoped_plan_name = self
            .get_desktop_bootstrap_plan_name(&org_id, cookie_header)
            .await
            .ok()
            .flatten();

        // Step 5: Fetch the provider's subscription renewal/end boundary.
        // This endpoint is optional because Team/Enterprise organizations can
        // reject it and usage must remain available in that case.
        let subscription_headers = Self::build_subscription_headers(cookie_header);
        let subscription_end = self
            .get_subscription_details(&org_id, &subscription_headers)
            .await
            .ok()
            .and_then(|details| details.future_end(Utc::now()));

        // Build the result. When five_hour is null (enterprise/credit accounts with no live
        // session), emit a fixed 5h 0% placeholder and mark it informational so notifications
        // and automatic metrics can skip the phantom session lane.
        let primary = usage
            .five_hour
            .as_ref()
            .map(|w| self.to_rate_window(w, Some(300))) // 5 hours = 300 minutes
            .unwrap_or_else(synthetic_no_session_primary);

        // Prefer limits[] weekly_all over legacy seven_day (same as OAuth path).
        let secondary = super::scoped_weekly::weekly_all_window(&usage.limits).or_else(|| {
            usage
                .seven_day
                .as_ref()
                .map(|w| self.to_rate_window(w, Some(10080))) // 7 days = 10080 minutes
        });

        let model_specific = usage
            .seven_day_opus
            .as_ref()
            .map(|w| self.to_rate_window(w, Some(10080)));

        let mut snapshot = UsageSnapshot::new(primary);

        if let Some(s) = secondary {
            snapshot = snapshot.with_secondary(s);
        }

        if let Some(m) = model_specific {
            snapshot = snapshot.with_model_specific(m);
        }

        for (id, title, window) in [
            (
                "claude-oauth-apps",
                "OAuth apps",
                usage
                    .seven_day_oauth_apps
                    .as_ref()
                    .map(|w| self.to_rate_window(w, Some(10080))),
            ),
            (
                "claude-routines",
                "Daily Routines",
                usage
                    .seven_day_routines
                    .as_ref()
                    .map(|w| self.to_rate_window(w, Some(10080))),
            ),
        ] {
            if let Some(window) = window {
                snapshot
                    .extra_rate_windows
                    .push(NamedRateWindow::new(id, title, window));
            }
        }
        snapshot
            .extra_rate_windows
            .extend(super::scoped_weekly::scoped_weekly_windows(&usage.limits));

        snapshot = Self::apply_scoped_web_account_metadata(
            snapshot,
            account.as_ref(),
            scoped_plan_name.as_deref(),
            subscription_end,
        );

        let mut result = ProviderFetchResult::new(snapshot, "web");

        // Add cost info if available
        if let Some(extra) = extra_usage
            && extra.is_enabled.unwrap_or(false)
        {
            let used_cents = extra.used_credits.unwrap_or(0.0);
            let limit_cents = extra.monthly_credit_limit;
            let currency = extra.currency.unwrap_or_else(|| "USD".to_string());

            let mut cost = CostSnapshot::new(
                used_cents / 100.0, // Convert cents to dollars
                currency,
                "Monthly",
            );

            if let Some(limit) = limit_cents {
                cost = cost.with_limit(limit / 100.0);
            }

            result = result.with_cost(cost);
        }

        Ok(result)
    }

    fn build_headers(cookie_header: &str) -> reqwest::header::HeaderMap {
        use reqwest::header::HeaderValue;

        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(cookie) = HeaderValue::from_str(cookie_header) {
            headers.insert(header::COOKIE, cookie);
        }
        headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://claude.ai"),
        );
        headers.insert(
            header::REFERER,
            HeaderValue::from_static("https://claude.ai/settings/usage"),
        );
        headers.insert(
            header::USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            ),
        );
        headers.insert(
            reqwest::header::HeaderName::from_static("anthropic-client-platform"),
            HeaderValue::from_static("web_claude_ai"),
        );

        headers
    }

    fn build_subscription_headers(cookie_header: &str) -> reqwest::header::HeaderMap {
        use reqwest::header::{HeaderName, HeaderValue};

        let mut headers = Self::build_headers(cookie_header);
        headers.insert(
            header::REFERER,
            HeaderValue::from_static("https://claude.ai/settings/billing"),
        );
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        for name in [
            "anthropic-client-sha",
            "anthropic-client-version",
            "anthropic-client-build",
            "anthropic-anonymous-id",
            "anthropic-device-id",
        ] {
            headers.insert(
                HeaderName::from_static(name),
                HeaderValue::from_static("unknown"),
            );
        }
        headers
    }

    #[cfg(target_os = "windows")]
    fn claude_desktop_cookie_header() -> Result<Option<String>, ProviderError> {
        let Some(user_data_dir) = dirs::data_dir().map(|path| path.join("Claude")) else {
            return Ok(None);
        };
        if !user_data_dir.join("Local State").is_file() {
            return Ok(None);
        }

        let mut profile_paths = Vec::new();
        if user_data_dir.join("Network").join("Cookies").is_file() {
            profile_paths.push(user_data_dir.clone());
        }
        if let Ok(partitions) = std::fs::read_dir(user_data_dir.join("Partitions")) {
            for partition in partitions.flatten() {
                let path = partition.path();
                if path.join("Network").join("Cookies").is_file() {
                    profile_paths.push(path);
                }
            }
        }

        let mut last_error = None;
        for (index, profile_path) in profile_paths.into_iter().enumerate() {
            let browser = DetectedBrowser {
                browser_type: BrowserType::Chromium,
                user_data_dir: user_data_dir.clone(),
                profiles: vec![BrowserProfile {
                    name: format!("Claude Desktop {index}"),
                    path: profile_path,
                    is_default: index == 0,
                }],
            };
            for domain in ["claude.ai", "claude.com"] {
                let cookies = match CookieExtractor::extract_for_domain(&browser, domain) {
                    Ok(cookies) => cookies,
                    Err(crate::browser::cookies::CookieError::NotFound(_)) => continue,
                    Err(error) => {
                        last_error = Some(error);
                        continue;
                    }
                };
                let cookie_header = CookieExtractor::build_cookie_header(&cookies);
                if has_claude_session_cookie(&cookie_header) {
                    return Ok(Some(cookie_header));
                }
            }
        }

        if let Some(error) = last_error {
            Err(ProviderError::Other(format!(
                "Failed to read Claude desktop session: {error}"
            )))
        } else {
            Ok(None)
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn claude_desktop_cookie_header() -> Result<Option<String>, ProviderError> {
        Ok(None)
    }

    fn resolve_session_key_from_env() -> Option<String> {
        for env_name in ["CLAUDE_AI_SESSION_KEY", "CLAUDE_WEB_SESSION_KEY"] {
            let Ok(value) = std::env::var(env_name) else {
                continue;
            };

            let trimmed = value.trim();
            if trimmed.is_empty() {
                continue;
            }

            let normalized = trimmed
                .strip_prefix("sessionKey=")
                .unwrap_or(trimmed)
                .trim();

            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }

        None
    }

    /// Get the organization ID
    async fn get_organization_id(
        &self,
        cookie_header: &str,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<String, ProviderError> {
        if let Some(org_id) = cookie_value(cookie_header, "lastActiveOrg") {
            return Ok(org_id);
        }

        if let Ok(account) = self.get_account_info(headers).await
            && let Some(org_id) = account.first_membership_org_id()
        {
            return Ok(org_id);
        }

        self.get_organizations(headers)
            .await?
            .into_iter()
            .next()
            .map(|o| o.uuid)
            .ok_or_else(|| ProviderError::Parse("No organizations found".to_string()))
    }

    async fn get_organizations(
        &self,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<Vec<Organization>, ProviderError> {
        let url = format!("{}/organizations", Self::BASE_URL);
        let response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Failed to get organizations: {}",
                response.status()
            )));
        }

        parse_json_with_body(response, "organizations").await
    }

    /// Get usage data
    async fn get_usage(
        &self,
        org_id: &str,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<UsageResponse, ProviderError> {
        let url = format!("{}/organizations/{}/usage", Self::BASE_URL, org_id);

        let response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Failed to get usage: {}",
                response.status()
            )));
        }

        parse_json_with_body(response, "usage").await
    }

    /// Get extra usage (credits)
    async fn get_extra_usage(
        &self,
        org_id: &str,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<ExtraUsageResponse, ProviderError> {
        let url = format!(
            "{}/organizations/{}/overage_spend_limit",
            Self::BASE_URL,
            org_id
        );

        let response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Failed to get extra usage: {}",
                response.status()
            )));
        }

        parse_json_with_body(response, "extra usage").await
    }

    /// Get account info
    async fn get_account_info(
        &self,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<AccountResponse, ProviderError> {
        let url = format!("{}/account", Self::BASE_URL);

        let response = self
            .client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Failed to get account: {}",
                response.status()
            )));
        }

        parse_json_with_body(response, "account").await
    }

    async fn get_desktop_bootstrap_plan_name(
        &self,
        org_id: &str,
        cookie_header: &str,
    ) -> Result<Option<String>, ProviderError> {
        use reqwest::header::{HeaderName, HeaderValue};

        let mut headers = Self::build_subscription_headers(cookie_header);
        headers.insert(
            HeaderName::from_static("anthropic-client-platform"),
            HeaderValue::from_static("desktop_app"),
        );
        let url = format!(
            "https://claude.ai/edge-api/bootstrap/{org_id}/app_start?\
             statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false"
        );
        let response = self.client.get(url).headers(headers).send().await?;
        if !response.status().is_success() {
            return Err(ProviderError::Other(format!(
                "Failed to get Claude desktop account plan: {}",
                response.status()
            )));
        }
        let bootstrap: DesktopBootstrapResponse =
            parse_json_with_body(response, "Claude desktop bootstrap").await?;
        Ok(bootstrap.plan_name_for_org(org_id))
    }

    /// Get the current personal subscription's authoritative renewal/end data.
    async fn get_subscription_details(
        &self,
        org_id: &str,
        headers: &reqwest::header::HeaderMap,
    ) -> Result<SubscriptionDetailsResponse, ProviderError> {
        let base_url = format!(
            "{}/organizations/{}/subscription_details",
            Self::BASE_URL,
            org_id
        );
        let mut last_status = None;

        for url in [base_url.clone(), format!("{base_url}?cached=true")] {
            let response = self
                .client
                .get(&url)
                .headers(headers.clone())
                .send()
                .await?;

            if response.status().is_success() {
                return parse_json_with_body(response, "Claude subscription details").await;
            }

            let status = response.status();
            last_status = Some(status);
            if status.as_u16() != 403 && status.as_u16() != 404 {
                break;
            }
        }

        Err(ProviderError::Other(format!(
            "Failed to get Claude subscription details: {}",
            last_status
                .map(|status| status.to_string())
                .unwrap_or_else(|| "unknown status".to_string())
        )))
    }

    /// Convert a usage window to a RateWindow
    fn to_rate_window(&self, window: &UsageWindow, window_minutes: Option<u32>) -> RateWindow {
        let used_percent = normalize_utilization(window.utilization.unwrap_or(0.0));

        let resets_at = window
            .resets_at
            .as_ref()
            .and_then(|s| Self::parse_iso8601(s));

        let reset_description = resets_at.map(Self::format_reset_time);

        RateWindow::with_details(used_percent, window_minutes, resets_at, reset_description)
    }

    /// Parse ISO8601 date string
    fn parse_iso8601(s: &str) -> Option<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
            .or_else(|| {
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                    .ok()
                    .map(|ndt| ndt.and_utc())
            })
            .or_else(|| {
                chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .ok()
                    .and_then(|date| date.and_hms_opt(0, 0, 0))
                    .map(|ndt| ndt.and_utc())
            })
    }

    /// Format reset time for display
    fn format_reset_time(dt: DateTime<Utc>) -> String {
        dt.format("%b %-d at %-I:%M%p").to_string()
    }

    /// Convert rate limit tier to plan name
    fn tier_to_plan_name(tier: &str) -> String {
        super::claude_plan_label(tier)
    }
}

/// Synthetic 5h session placeholder for Claude web when `five_hour` is null.
///
/// A genuine idle session (object present, 0% used) is NOT marked informational.
fn synthetic_no_session_primary() -> RateWindow {
    let mut window = RateWindow::with_details(
        0.0,
        Some(300),
        None,
        Some("No active 5h session".to_string()),
    );
    window.is_informational = true;
    window
}

impl Default for ClaudeWebApiFetcher {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_utilization(utilization: f64) -> f64 {
    if utilization > 0.0 && utilization <= 1.0 {
        utilization * 100.0
    } else {
        utilization
    }
}

fn cookie_value(cookie_header: &str, name: &str) -> Option<String> {
    cookie_header.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        if key.trim() != name {
            return None;
        }
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn has_claude_session_cookie(cookie_header: &str) -> bool {
    ["sessionKey", "sessionKeyLC", "sessionKeyV3LC"]
        .iter()
        .any(|name| cookie_value(cookie_header, name).is_some())
}

#[cfg(test)]
mod tests {
    use super::{
        AccountResponse, ClaudeWebApiFetcher, DesktopBootstrapResponse,
        SubscriptionDetailsResponse, UsageWindow, cookie_value, has_claude_session_cookie,
        push_unique_nonempty,
    };
    use chrono::{DateTime, Utc};
    use reqwest::header;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }

    #[test]
    fn parses_future_claude_subscription_renewal() {
        let details: SubscriptionDetailsResponse = serde_json::from_str(
            r#"{
                "next_charge_at": "2026-08-22T04:30:00Z",
                "status": "active",
                "billing_interval": "month"
            }"#,
        )
        .unwrap();

        assert_eq!(
            details.future_end(timestamp("2026-07-22T00:00:00Z")),
            Some(timestamp("2026-08-22T04:30:00Z"))
        );
    }

    #[test]
    fn prefers_claude_scheduled_plan_end_over_next_charge() {
        let details: SubscriptionDetailsResponse = serde_json::from_str(
            r#"{
                "next_charge_at": "2026-09-22T00:00:00Z",
                "plan_ending_at": "2026-08-01T12:15:00Z"
            }"#,
        )
        .unwrap();

        assert_eq!(
            details.future_end(timestamp("2026-07-22T00:00:00Z")),
            Some(timestamp("2026-08-01T12:15:00Z"))
        );
    }

    #[test]
    fn parses_legacy_claude_subscription_calendar_dates_as_utc() {
        let details: SubscriptionDetailsResponse = serde_json::from_str(
            r#"{
                "next_charge_date": "2026-08-22",
                "plan_ending_before": null
            }"#,
        )
        .unwrap();

        assert_eq!(
            details.future_end(timestamp("2026-07-22T00:00:00Z")),
            Some(timestamp("2026-08-22T00:00:00Z"))
        );
    }

    #[test]
    fn rejects_token_jwt_and_quota_dates_as_claude_subscription_expiry() {
        let details: SubscriptionDetailsResponse = serde_json::from_str(
            r#"{
                "expiresAt": "2026-08-22T00:00:00Z",
                "exp": 1787356800,
                "resets_at": "2026-08-22T00:00:00Z"
            }"#,
        )
        .unwrap();

        assert_eq!(details.future_end(timestamp("2026-07-22T00:00:00Z")), None);
    }

    #[test]
    fn rejects_past_claude_subscription_boundary() {
        let details: SubscriptionDetailsResponse =
            serde_json::from_str(r#"{ "next_charge_date": "2026-07-21T23:59:59Z" }"#).unwrap();

        assert_eq!(details.future_end(timestamp("2026-07-22T00:00:00Z")), None);
    }

    #[test]
    fn converts_fractional_utilization_to_percent() {
        let window = UsageWindow {
            utilization: Some(0.23),
            resets_at: None,
        };

        let rate = ClaudeWebApiFetcher::new().to_rate_window(&window, Some(300));

        assert!((rate.used_percent - 23.0).abs() < f64::EPSILON);
    }

    #[test]
    fn null_five_hour_session_is_informational_placeholder() {
        let placeholder = super::synthetic_no_session_primary();
        assert!(placeholder.is_informational);
        assert_eq!(placeholder.window_minutes, Some(300));
        assert!((placeholder.used_percent - 0.0).abs() < f64::EPSILON);
        assert_eq!(
            placeholder.reset_description.as_deref(),
            Some("No active 5h session")
        );

        // Real idle session (object present at 0%) stays unflagged.
        let idle = ClaudeWebApiFetcher::new().to_rate_window(
            &UsageWindow {
                utilization: Some(0.0),
                resets_at: None,
            },
            Some(300),
        );
        assert!(!idle.is_informational);
    }

    #[test]
    fn preserves_existing_percentage_utilization() {
        let window = UsageWindow {
            utilization: Some(23.0),
            resets_at: None,
        };

        let rate = ClaudeWebApiFetcher::new().to_rate_window(&window, Some(300));

        assert!((rate.used_percent - 23.0).abs() < f64::EPSILON);
    }

    #[test]
    fn labels_max_5x_and_20x_plans() {
        assert_eq!(
            ClaudeWebApiFetcher::tier_to_plan_name("default_claude_max_5x"),
            "Claude Max 5x"
        );
        assert_eq!(
            ClaudeWebApiFetcher::tier_to_plan_name("v2_default_claude_max_20x"),
            "Claude Max 20x"
        );
    }

    #[test]
    fn resolves_raw_session_key_from_primary_env_var() {
        let _guard = env_lock().lock().expect("env lock");
        unsafe {
            std::env::remove_var("CLAUDE_AI_SESSION_KEY");
            std::env::remove_var("CLAUDE_WEB_SESSION_KEY");
            std::env::set_var("CLAUDE_AI_SESSION_KEY", "sk-ant-primary");
            std::env::set_var("CLAUDE_WEB_SESSION_KEY", "sk-ant-secondary");
        }

        let session_key = ClaudeWebApiFetcher::resolve_session_key_from_env();

        assert_eq!(session_key.as_deref(), Some("sk-ant-primary"));

        unsafe {
            std::env::remove_var("CLAUDE_AI_SESSION_KEY");
            std::env::remove_var("CLAUDE_WEB_SESSION_KEY");
        }
    }

    #[test]
    fn resolves_session_key_assignment_from_env_var() {
        let _guard = env_lock().lock().expect("env lock");
        unsafe {
            std::env::remove_var("CLAUDE_AI_SESSION_KEY");
            std::env::remove_var("CLAUDE_WEB_SESSION_KEY");
            std::env::set_var("CLAUDE_WEB_SESSION_KEY", "sessionKey=sk-ant-cookie-format");
        }

        let session_key = ClaudeWebApiFetcher::resolve_session_key_from_env();

        assert_eq!(session_key.as_deref(), Some("sk-ant-cookie-format"));

        unsafe {
            std::env::remove_var("CLAUDE_AI_SESSION_KEY");
            std::env::remove_var("CLAUDE_WEB_SESSION_KEY");
        }
    }

    #[test]
    fn build_headers_include_required_browser_context() {
        let headers = ClaudeWebApiFetcher::build_headers("sessionKey=sk-ant-cookie-format");

        assert_eq!(
            headers
                .get(header::COOKIE)
                .and_then(|value| value.to_str().ok()),
            Some("sessionKey=sk-ant-cookie-format")
        );
        assert_eq!(
            headers
                .get(header::ACCEPT)
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
        assert_eq!(
            headers
                .get(header::ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("https://claude.ai")
        );
        assert_eq!(
            headers
                .get(header::REFERER)
                .and_then(|value| value.to_str().ok()),
            Some("https://claude.ai/settings/usage")
        );
        assert_eq!(
            headers
                .get("anthropic-client-platform")
                .and_then(|value| value.to_str().ok()),
            Some("web_claude_ai")
        );
        assert!(headers.contains_key(header::USER_AGENT));
    }

    #[test]
    fn subscription_headers_match_the_billing_surface_context() {
        let headers =
            ClaudeWebApiFetcher::build_subscription_headers("sessionKey=sk-ant-cookie-format");

        assert_eq!(
            headers
                .get(header::REFERER)
                .and_then(|value| value.to_str().ok()),
            Some("https://claude.ai/settings/billing")
        );
        assert_eq!(
            headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );
        for name in [
            "anthropic-client-sha",
            "anthropic-client-version",
            "anthropic-client-build",
            "anthropic-anonymous-id",
            "anthropic-device-id",
        ] {
            assert_eq!(
                headers.get(name).and_then(|value| value.to_str().ok()),
                Some("unknown")
            );
        }
    }

    #[test]
    fn extracts_last_active_org_from_cookie_header() {
        let org = cookie_value(
            "foo=bar; sessionKey=sk-ant-session; lastActiveOrg=org-123; other=value",
            "lastActiveOrg",
        );

        assert_eq!(org.as_deref(), Some("org-123"));
    }

    #[test]
    fn recognizes_current_and_legacy_claude_session_cookie_names() {
        assert!(has_claude_session_cookie("sessionKey=legacy"));
        assert!(has_claude_session_cookie("sessionKeyLC=current"));
        assert!(has_claude_session_cookie("sessionKeyV3LC=current-v3"));
        assert!(!has_claude_session_cookie("lastActiveOrg=org-123"));
    }

    #[test]
    fn account_membership_prefers_nested_organization_uuid() {
        let account: AccountResponse = serde_json::from_str(
            r#"{
                "email_address": "user@example.com",
                "memberships": [
                    {
                        "uuid": "membership-id",
                        "organization": { "uuid": "org-id" }
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(account.first_membership_org_id().as_deref(), Some("org-id"));
    }

    #[test]
    fn account_memberships_and_active_org_are_deduplicated() {
        let account: AccountResponse = serde_json::from_str(
            r#"{
                "memberships": [
                    { "organization": { "uuid": "org-active" } },
                    { "organization": { "uuid": "org-second" } }
                ]
            }"#,
        )
        .unwrap();
        let mut org_ids = Vec::new();
        push_unique_nonempty(&mut org_ids, Some("org-active"));
        for org_id in account.membership_org_ids() {
            push_unique_nonempty(&mut org_ids, Some(&org_id));
        }

        assert_eq!(org_ids, vec!["org-active", "org-second"]);
    }

    #[test]
    fn web_snapshot_ignores_conflicting_global_tier_and_scopes_to_billed_org() {
        let conflicting_global_tier = "default_claude_max_20x";
        let account: AccountResponse = serde_json::from_str(
            r#"{
                "email_address": "private@example.com",
                "rate_limit_tier": "default_claude_max_20x",
                "memberships": [
                    { "organization": { "uuid": "other-org" } },
                    { "organization": { "uuid": "billed-org" } }
                ]
            }"#,
        )
        .unwrap();
        let bootstrap: DesktopBootstrapResponse = serde_json::from_str(
            r#"{
                "account": {
                    "memberships": [
                        {
                            "seat_tier": "claude_pro",
                            "organization": {
                                "uuid": "other-org",
                                "rate_limit_tier": "default_claude_ai"
                            }
                        },
                        {
                            "seat_tier": "claude_max",
                            "organization": {
                                "uuid": "billed-org",
                                "rate_limit_tier": "default_claude_max_5x"
                            }
                        }
                    ]
                }
            }"#,
        )
        .unwrap();

        assert_eq!(
            account.membership_org_ids(),
            vec!["other-org", "billed-org"]
        );
        assert_eq!(
            bootstrap.plan_name_for_org("billed-org").as_deref(),
            Some("Claude Max 5x")
        );
        let ends_at = timestamp("2026-08-18T04:29:10Z");
        let snapshot = ClaudeWebApiFetcher::apply_scoped_web_account_metadata(
            crate::core::UsageSnapshot::new(crate::core::RateWindow::new(10.0)),
            Some(&account),
            bootstrap.plan_name_for_org("billed-org").as_deref(),
            Some(ends_at),
        );

        assert_eq!(
            snapshot.account_email.as_deref(),
            Some("private@example.com")
        );
        assert_eq!(snapshot.login_method.as_deref(), Some("Claude Max 5x"));
        assert_ne!(
            snapshot.login_method.as_deref(),
            Some(ClaudeWebApiFetcher::tier_to_plan_name(conflicting_global_tier).as_str())
        );
        assert_eq!(snapshot.subscription_ends_at, Some(ends_at));
        assert_eq!(bootstrap.plan_tier_for_org("missing-org"), None);
    }

    #[tokio::test]
    #[ignore = "requires an authenticated Claude desktop session"]
    async fn live_web_snapshot_uses_active_organization_plan_and_billing_boundary() {
        let cookie_header = ClaudeWebApiFetcher::claude_desktop_cookie_header()
            .expect("Claude desktop cookie extraction should not fail")
            .expect("Claude desktop must have an authenticated session");
        let fetcher = ClaudeWebApiFetcher::new();
        let account_headers = ClaudeWebApiFetcher::build_headers(&cookie_header);
        let subscription_headers = ClaudeWebApiFetcher::build_subscription_headers(&cookie_header);
        let org_id = fetcher
            .get_organization_id(&cookie_header, &account_headers)
            .await
            .expect("the active Claude organization should resolve");
        let expected_plan = fetcher
            .get_desktop_bootstrap_plan_name(&org_id, &cookie_header)
            .await
            .expect("the active organization's bootstrap should load")
            .expect("the active organization should expose a plan");
        let expected_end = fetcher
            .get_subscription_details(&org_id, &subscription_headers)
            .await
            .expect("the active organization's billing details should load")
            .future_end(Utc::now())
            .expect("the active organization should expose a future billing boundary");

        let result = fetcher
            .fetch_with_cookie_header(&cookie_header)
            .await
            .expect("the normal Claude Web path should fetch live usage");

        assert_eq!(
            result.usage.login_method.as_deref(),
            Some(expected_plan.as_str())
        );
        assert_eq!(result.usage.subscription_ends_at, Some(expected_end));
    }

    #[test]
    fn parses_extra_design_and_routines_aliases() {
        let usage: super::UsageResponse = serde_json::from_str(
            r#"{
                "five_hour": { "utilization": 0.1 },
                "seven_day_omelette": { "utilization": 26 },
                "seven_day_cowork": { "utilization": 11 }
            }"#,
        )
        .unwrap();

        let fetcher = ClaudeWebApiFetcher::new();
        let design = usage
            .seven_day_design
            .as_ref()
            .map(|w| fetcher.to_rate_window(w, Some(10080)))
            .expect("design window");
        let routines = usage
            .seven_day_routines
            .as_ref()
            .map(|w| fetcher.to_rate_window(w, Some(10080)))
            .expect("routines window");

        assert!((design.used_percent - 26.0).abs() < f64::EPSILON);
        assert!((routines.used_percent - 11.0).abs() < f64::EPSILON);
    }

    #[test]
    fn maps_scoped_weekly_limits_even_when_inactive() {
        let usage: super::UsageResponse = serde_json::from_str(
            r#"{
                "limits": [{
                    "kind": "weekly_scoped",
                    "group": "weekly",
                    "percent": 7,
                    "resets_at": "2026-07-16T10:00:00Z",
                    "scope": {"model": {"id": null, "display_name": "Fable"}},
                    "is_active": false
                }]
            }"#,
        )
        .unwrap();

        let windows = super::super::scoped_weekly::scoped_weekly_windows(&usage.limits);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].id, "claude-weekly-scoped-fable");
        assert_eq!(windows[0].title, "Fable only");
    }

    #[test]
    fn parses_duplicate_design_and_routines_aliases_with_preferred_key() {
        let usage: super::UsageResponse = serde_json::from_str(
            r#"{
                "seven_day_design": { "utilization": 31 },
                "seven_day_omelette": { "utilization": 26 },
                "seven_day_routines": { "utilization": 19 },
                "seven_day_cowork": { "utilization": 11 }
            }"#,
        )
        .unwrap();

        let fetcher = ClaudeWebApiFetcher::new();
        let design = usage
            .seven_day_design
            .as_ref()
            .map(|w| fetcher.to_rate_window(w, Some(10080)))
            .expect("design window");
        let routines = usage
            .seven_day_routines
            .as_ref()
            .map(|w| fetcher.to_rate_window(w, Some(10080)))
            .expect("routines window");

        assert!((design.used_percent - 31.0).abs() < f64::EPSILON);
        assert!((routines.used_percent - 19.0).abs() < f64::EPSILON);
    }

    #[test]
    fn parses_oauth_apps_window_and_embedded_extra_usage() {
        let usage: super::UsageResponse = serde_json::from_str(
            r#"{
                "five_hour": { "utilization": 0.1 },
                "seven_day_oauth_apps": { "utilization": 42 },
                "extra_usage": {
                    "is_enabled": true,
                    "monthly_credit_limit": 2000,
                    "used_credits": 550,
                    "currency": "USD"
                }
            }"#,
        )
        .unwrap();

        let fetcher = ClaudeWebApiFetcher::new();
        let oauth_apps = usage
            .seven_day_oauth_apps
            .as_ref()
            .map(|w| fetcher.to_rate_window(w, Some(10080)))
            .expect("oauth apps window");
        let extra = usage.extra_usage.expect("extra usage");

        assert!((oauth_apps.used_percent - 42.0).abs() < f64::EPSILON);
        assert_eq!(extra.is_enabled, Some(true));
        assert_eq!(extra.monthly_credit_limit, Some(2000.0));
        assert_eq!(extra.used_credits, Some(550.0));
    }
}
