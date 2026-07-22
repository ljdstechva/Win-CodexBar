//! OpenAI Dashboard Scraper
//!
//! JavaScript-based scraper for extracting usage data from the OpenAI/ChatGPT dashboard.
//! Uses React Fiber inspection to extract data from chart components.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Usage breakdown by service (e.g., GPT-4, DALL-E)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageBreakdown {
    /// Service name
    pub service: String,
    /// Hex color for the service in charts
    pub color: String,
    /// Usage amount in dollars
    pub amount: f64,
}

/// Credits usage history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditsHistoryEntry {
    /// Date string
    pub date: String,
    /// Description of usage
    pub description: String,
    /// Amount in dollars (positive = credit, negative = usage)
    pub amount: f64,
}

/// Scraped dashboard data
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OpenAIDashboardData {
    /// Remaining credits balance
    pub credits_remaining: Option<f64>,
    /// Total credits limit
    pub credits_limit: Option<f64>,
    /// Usage breakdown by service
    pub usage_breakdown: Vec<UsageBreakdown>,
    /// Credits usage history
    pub credits_history: Vec<CreditsHistoryEntry>,
    /// Account email
    pub email: Option<String>,
    /// Authentication status from ChatGPT bootstrap data
    pub auth_status: Option<String>,
    /// Account plan from ChatGPT bootstrap or Next data
    pub account_plan: Option<String>,
    /// Authoritative ChatGPT entitlement expiry, when the account API exposes one
    #[serde(default)]
    pub subscription_ends_at: Option<DateTime<Utc>>,
    /// Organization name
    pub organization: Option<String>,
    /// Purchase credits URL
    pub purchase_url: Option<String>,
}

impl OpenAIDashboardData {
    /// Calculate used percentage
    pub fn used_percent(&self) -> Option<f64> {
        let remaining = self.credits_remaining?;
        let limit = self.credits_limit?;
        if limit <= 0.0 {
            return None;
        }
        let used = limit - remaining;
        Some((used / limit) * 100.0)
    }

    /// Get total usage across all services
    pub fn total_usage(&self) -> f64 {
        self.usage_breakdown.iter().map(|b| b.amount).sum()
    }
}

/// JavaScript scrape script for OpenAI dashboard
///
/// This script is injected into the ChatGPT dashboard page to extract usage data.
/// It uses React Fiber inspection to access chart data that isn't directly in the DOM.
pub const OPENAI_DASHBOARD_SCRAPE_SCRIPT: &str = r#"
(async () => {
  const textOf = el => {
    const raw = el && (el.innerText || el.textContent) ? String(el.innerText || el.textContent) : '';
    return raw.trim();
  };

  const parseHexColor = (color) => {
    if (!color) return null;
    const c = String(color).trim().toLowerCase();
    if (c.startsWith('#')) {
      if (c.length === 4) {
        return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      }
      if (c.length === 7) return c;
      return c;
    }
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const parts = m[1].split(',').map(x => parseFloat(x.trim())).filter(x => Number.isFinite(x));
      if (parts.length >= 3) {
        const r = Math.max(0, Math.min(255, Math.round(parts[0])));
        const g = Math.max(0, Math.min(255, Math.round(parts[1])));
        const b = Math.max(0, Math.min(255, Math.round(parts[2])));
        const toHex = n => n.toString(16).padStart(2, '0');
        return '#' + toHex(r) + toHex(g) + toHex(b);
      }
    }
    return c;
  };

  // React Fiber inspection for extracting chart data
  const reactPropsOf = (el) => {
    if (!el) return null;
    try {
      const keys = Object.keys(el);
      const propsKey = keys.find(k => k.startsWith('__reactProps$'));
      if (propsKey) return el[propsKey] || null;
      const fiberKey = keys.find(k => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        const fiber = el[fiberKey];
        return (fiber && (fiber.memoizedProps || fiber.pendingProps)) || null;
      }
    } catch {}
    return null;
  };

  const reactFiberOf = (el) => {
    if (!el) return null;
    try {
      const keys = Object.keys(el);
      const fiberKey = keys.find(k => k.startsWith('__reactFiber$'));
      return fiberKey ? (el[fiberKey] || null) : null;
    } catch {
      return null;
    }
  };

  // Traverse React Fiber tree to find chart payload data
  const nestedBarMetaOf = (root) => {
    if (!root || typeof root !== 'object') return null;
    const queue = [root];
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    let steps = 0;
    while (queue.length && steps < 250) {
      const cur = queue.shift();
      steps++;
      if (!cur || typeof cur !== 'object') continue;
      if (seen) {
        if (seen.has(cur)) continue;
        seen.add(cur);
      }
      if (cur.payload && (cur.dataKey || cur.name || cur.value !== undefined)) return cur;
      const values = Array.isArray(cur) ? cur : Object.values(cur);
      for (const v of values) {
        if (v && typeof v === 'object') queue.push(v);
      }
    }
    return null;
  };

  // Extract chart metadata from DOM element via React Fiber
  const barMetaFromElement = (el) => {
    const direct = reactPropsOf(el);
    if (direct && direct.payload && (direct.dataKey || direct.name || direct.value !== undefined)) return direct;

    const fiber = reactFiberOf(el);
    if (fiber) {
      let cur = fiber;
      for (let i = 0; i < 10 && cur; i++) {
        const props = (cur.memoizedProps || cur.pendingProps) || null;
        if (props && props.payload && (props.dataKey || props.name || props.value !== undefined)) return props;
        const nested = props ? nestedBarMetaOf(props) : null;
        if (nested) return nested;
        cur = cur.return || null;
      }
    }

    if (direct) {
      const nested = nestedBarMetaOf(direct);
      if (nested) return nested;
    }
    return null;
  };

  // Parse dollar amounts from text
  const parseDollarAmount = (text) => {
    if (!text) return null;
    const cleaned = String(text).replace(/[^0-9.,\-]/g, '');
    const num = parseFloat(cleaned.replace(',', ''));
    return Number.isFinite(num) ? num : null;
  };

  // Find credits remaining
  const findCreditsRemaining = () => {
    const patterns = [
      /\$?(\d+(?:\.\d+)?)\s*(?:credits?)?\s*(?:remaining|left|available)/i,
      /(?:remaining|left|available)[:\s]*\$?(\d+(?:\.\d+)?)/i,
      /balance[:\s]*\$?(\d+(?:\.\d+)?)/i,
    ];

    const textNodes = document.querySelectorAll('*');
    for (const node of textNodes) {
      const text = textOf(node);
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const num = parseFloat(match[1]);
          if (Number.isFinite(num)) return num;
        }
      }
    }
    return null;
  };

  // Find account email
  const findEmail = () => {
    const bootstrap = parseJsonScript('client-bootstrap');
    const bootstrapEmail = bootstrap?.session?.user?.email || bootstrap?.user?.email || null;
    if (bootstrapEmail && String(bootstrapEmail).includes('@')) return String(bootstrapEmail);

    const next = parseJsonScript('__NEXT_DATA__');
    const nextEmail = next?.props?.pageProps?.user?.email || next?.props?.session?.user?.email || null;
    if (nextEmail && String(nextEmail).includes('@')) return String(nextEmail);

    // Look for email patterns in the page
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const textNodes = document.querySelectorAll('[class*="email"], [class*="user"], [data-testid*="email"]');
    for (const node of textNodes) {
      const text = textOf(node);
      const match = text.match(emailPattern);
      if (match) return match[0];
    }
    return null;
  };

  const parseJsonScript = (id) => {
    try {
      const node = document.getElementById(id);
      const raw = node && node.textContent ? String(node.textContent) : '';
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const cleanPlanName = (raw) => String(raw || '')
    .replace(/\b(claude|codex|account|plan)\b/gi, ' ')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const codexPlanDisplayName = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const exact = {
      pro: 'Pro 20x',
      prolite: 'Pro 5x',
      'pro_lite': 'Pro 5x',
      'pro-lite': 'Pro 5x',
      'pro lite': 'Pro 5x'
    };
    const lower = trimmed.toLowerCase();
    if (exact[lower]) return exact[lower];
    const cleaned = cleanPlanName(trimmed);
    if (!cleaned) return trimmed;
    const cleanedLower = cleaned.toLowerCase();
    if (exact[cleanedLower]) return exact[cleanedLower];
    return cleaned.split(' ')
      .filter(Boolean)
      .map(word => {
        const wordLower = word.toLowerCase();
        if (wordLower === 'cbp' || wordLower === 'k12') return wordLower.toUpperCase();
        if (word === word.toUpperCase() && /[a-z]/i.test(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ') || cleaned;
  };

  const normalizePlanValue = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    const allowed = ['free', 'plus', 'pro', 'team', 'enterprise', 'business', 'edu', 'education', 'gov', 'premium', 'essential'];
    if (!allowed.some(token => lower.includes(token))) return null;
    return codexPlanDisplayName(trimmed) || cleanPlanName(trimmed);
  };

  const planCandidate = (key, value) => {
    const lower = String(key || '').toLowerCase();
    if (!lower.includes('plan') && !lower.includes('tier') && !lower.includes('subscription')) return null;
    if (typeof value === 'string') return normalizePlanValue(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return normalizePlanValue(value.name) || normalizePlanValue(value.displayName) || normalizePlanValue(value.tier);
    }
    return null;
  };

  const findPlan = (root) => {
    if (!root || typeof root !== 'object') return null;
    const queue = [root];
    const seenObjects = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    let index = 0;
    let seen = 0;
    while (index < queue.length && seen < 6000) {
      const cur = queue[index++];
      seen++;
      if (!cur || typeof cur !== 'object') continue;
      if (seenObjects) {
        if (seenObjects.has(cur)) continue;
        seenObjects.add(cur);
      }
      if (Array.isArray(cur)) {
        for (const value of cur) {
          if (value && typeof value === 'object') queue.push(value);
        }
        continue;
      }
      for (const [key, value] of Object.entries(cur)) {
        const plan = planCandidate(key, value);
        if (plan) return plan;
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return null;
  };

  const findSubscriptionEnd = async () => {
    try {
      const bootstrap = parseJsonScript('client-bootstrap');
      const accessToken = bootstrap?.session?.accessToken;
      const accountId = bootstrap?.session?.account?.id;
      if (!accessToken || !accountId) return null;
      const response = await fetch('/backend-api/accounts/check/v4-2023-04-27', {
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'chatgpt-account-id': accountId
        }
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const account = payload?.accounts?.[accountId];
      const raw = account?.entitlement?.expires_at;
      if (typeof raw !== 'string') return null;
      const timestamp = Date.parse(raw);
      return Number.isFinite(timestamp) && timestamp > Date.now()
        ? new Date(timestamp).toISOString()
        : null;
    } catch {
      return null;
    }
  };

  // Extract usage breakdown from chart
  const extractUsageBreakdown = () => {
    const breakdown = [];

    // Find Recharts bar elements
    const bars = document.querySelectorAll('.recharts-bar-rectangle, [class*="bar"]');
    for (const bar of bars) {
      const meta = barMetaFromElement(bar);
      if (meta && meta.payload) {
        const name = meta.name || meta.dataKey || 'Unknown';
        const value = meta.value || meta.payload[meta.dataKey] || 0;
        const color = parseHexColor(bar.getAttribute('fill')) || '#888888';
        if (value > 0) {
          breakdown.push({ service: name, color, amount: value });
        }
      }
    }

    // Dedupe by service name
    const seen = new Set();
    return breakdown.filter(b => {
      if (seen.has(b.service)) return false;
      seen.add(b.service);
      return true;
    });
  };

  // Main scrape function
  const result = {
    credits_remaining: findCreditsRemaining(),
    credits_limit: null,
    usage_breakdown: extractUsageBreakdown(),
    credits_history: [],
    email: findEmail(),
    auth_status: (() => {
      const bootstrap = parseJsonScript('client-bootstrap');
      return typeof bootstrap?.authStatus === 'string' ? bootstrap.authStatus : null;
    })(),
    account_plan: findPlan(parseJsonScript('client-bootstrap')) || findPlan(parseJsonScript('__NEXT_DATA__')),
    subscription_ends_at: await findSubscriptionEnd(),
    organization: null,
    purchase_url: null
  };

  return JSON.stringify(result);
})();
"#;

/// Parse scraped JSON data into structured format
pub fn parse_dashboard_json(json: &str) -> Result<OpenAIDashboardData, serde_json::Error> {
    serde_json::from_str(json)
}

/// Minimal private session material needed to call ChatGPT's account endpoint.
///
/// This intentionally does not implement `Debug` or serialization so access
/// tokens and account identifiers cannot accidentally enter diagnostics or
/// persisted snapshots.
pub(crate) struct ChatGPTBootstrapSession {
    pub(crate) access_token: String,
    pub(crate) account_id: String,
}

/// Parse one JSON script element without retaining the surrounding page.
pub(crate) fn parse_json_script(html: &str, id: &str) -> Option<Value> {
    let marker = format!("id=\"{id}\"");
    let marker_start = html.find(&marker)?;
    let content_start = html[marker_start..].find('>')? + marker_start + 1;
    let content_end = html[content_start..].find("</script>")? + content_start;
    serde_json::from_str(html[content_start..content_end].trim()).ok()
}

pub(crate) fn chatgpt_bootstrap_session(value: &Value) -> Option<ChatGPTBootstrapSession> {
    Some(ChatGPTBootstrapSession {
        access_token: value.pointer("/session/accessToken")?.as_str()?.to_string(),
        account_id: value.pointer("/session/account/id")?.as_str()?.to_string(),
    })
}

/// Extract the already-authoritative plan label from ChatGPT bootstrap data.
pub(crate) fn chatgpt_account_plan(value: &Value) -> Option<String> {
    let mut queue = vec![value];
    let mut visited = 0usize;

    while let Some(current) = queue.pop() {
        visited += 1;
        if visited > 6_000 {
            break;
        }
        match current {
            Value::Object(map) => {
                for (key, child) in map {
                    let key = key.to_ascii_lowercase();
                    if (key.contains("plan")
                        || key.contains("tier")
                        || key.contains("subscription"))
                        && let Some(raw) = child.as_str()
                        && let Some(plan) = normalize_chatgpt_plan(raw)
                    {
                        return Some(plan);
                    }
                    if child.is_array() || child.is_object() {
                        queue.push(child);
                    }
                }
            }
            Value::Array(values) => queue.extend(values),
            _ => {}
        }
    }

    None
}

fn normalize_chatgpt_plan(raw: &str) -> Option<String> {
    let lower = raw.trim().to_ascii_lowercase();
    const ALLOWED: &[&str] = &[
        "free",
        "plus",
        "pro",
        "team",
        "enterprise",
        "business",
        "edu",
        "education",
        "gov",
        "premium",
        "essential",
    ];
    if !ALLOWED.iter().any(|candidate| lower.contains(candidate)) {
        return None;
    }

    // The accounts endpoint currently emits compact identifiers such as
    // `chatgptpro`. Normalize those to the same human plan label as the web
    // bootstrap without retaining any other account metadata.
    let compact = lower
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    const CANONICAL_COMPACT: &[(&str, &str)] = &[
        ("enterprise", "Enterprise"),
        ("education", "Education"),
        ("business", "Business"),
        ("essential", "Essential"),
        ("premium", "Premium"),
        ("plus", "Plus"),
        ("team", "Team"),
        ("free", "Free"),
        ("pro", "Pro"),
        ("edu", "EDU"),
        ("gov", "GOV"),
    ];
    if (compact.starts_with("chatgpt") || compact.starts_with("openai"))
        && let Some((_, label)) = CANONICAL_COMPACT
            .iter()
            .find(|(candidate, _)| compact.ends_with(candidate))
    {
        return Some((*label).to_string());
    }

    let words = raw
        .replace(['_', '-'], " ")
        .split_whitespace()
        .filter(|word| {
            !matches!(
                word.to_ascii_lowercase().as_str(),
                "openai" | "chatgpt" | "account" | "plan" | "subscription"
            )
        })
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            match lower.as_str() {
                "edu" | "gov" => lower.to_ascii_uppercase(),
                _ => {
                    let mut chars = lower.chars();
                    chars
                        .next()
                        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default()
                }
            }
        })
        .collect::<Vec<_>>();

    (!words.is_empty()).then(|| words.join(" "))
}

/// Extract a normalized plan only from the explicitly selected account in an
/// accounts-check response. Never fall back to another account in the map.
pub(crate) fn parse_chatgpt_plan_from_accounts_json(
    json: &str,
    account_id: &str,
) -> Option<String> {
    let value: Value = serde_json::from_str(json).ok()?;
    let account = value.get("accounts")?.as_object()?.get(account_id)?;
    chatgpt_account_plan(account)
}

/// Extract an authoritative, future ChatGPT entitlement expiry from the
/// accounts-check payload. Auth/session token expiries are intentionally not
/// considered here.
pub fn parse_subscription_end_from_accounts_json(
    json: &str,
    account_id: Option<&str>,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    let value: Value = serde_json::from_str(json).ok()?;
    let accounts = value.get("accounts")?.as_object()?;
    let account = match account_id {
        // When bootstrap identifies an active account, never borrow an
        // entitlement from a different/default account in the same payload.
        Some(id) => accounts.get(id)?,
        None => accounts.get("default")?,
    };
    let raw = account.get("entitlement")?.get("expires_at")?;
    let parsed = match raw {
        Value::String(value) => DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|value| value.with_timezone(&Utc)),
        Value::Number(value) => value.as_i64().and_then(|timestamp| {
            let seconds = if timestamp > 10_000_000_000 {
                timestamp / 1_000
            } else {
                timestamp
            };
            DateTime::from_timestamp(seconds, 0)
        }),
        _ => None,
    }?;
    (parsed > now).then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{FetchContext, Provider, ProviderId, SourceMode};
    use crate::providers::openai::ChatGPTProvider;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn test_usage_breakdown() {
        let breakdown = UsageBreakdown {
            service: "GPT-4".to_string(),
            color: "#10a37f".to_string(),
            amount: 15.50,
        };

        assert_eq!(breakdown.service, "GPT-4");
        assert_eq!(breakdown.amount, 15.50);
    }

    #[test]
    fn test_dashboard_data_used_percent() {
        let data = OpenAIDashboardData {
            credits_remaining: Some(75.0),
            credits_limit: Some(100.0),
            ..Default::default()
        };

        assert_eq!(data.used_percent(), Some(25.0));
    }

    #[test]
    fn test_dashboard_data_total_usage() {
        let data = OpenAIDashboardData {
            usage_breakdown: vec![
                UsageBreakdown {
                    service: "GPT-4".to_string(),
                    color: "#10a37f".to_string(),
                    amount: 10.0,
                },
                UsageBreakdown {
                    service: "DALL-E".to_string(),
                    color: "#ff6b6b".to_string(),
                    amount: 5.0,
                },
            ],
            ..Default::default()
        };

        assert_eq!(data.total_usage(), 15.0);
    }

    #[test]
    fn test_parse_dashboard_json() {
        let json = r#"{"credits_remaining":50.0,"credits_limit":100.0,"usage_breakdown":[],"credits_history":[],"email":"test@example.com","auth_status":"logged_in","account_plan":"Pro 5x","subscription_ends_at":"2026-07-23T00:00:00Z","organization":null,"purchase_url":null}"#;

        let data = parse_dashboard_json(json).unwrap();
        assert_eq!(data.credits_remaining, Some(50.0));
        assert_eq!(data.email, Some("test@example.com".to_string()));
        assert_eq!(data.auth_status, Some("logged_in".to_string()));
        assert_eq!(data.account_plan, Some("Pro 5x".to_string()));
        assert_eq!(
            data.subscription_ends_at,
            Some(timestamp("2026-07-23T00:00:00Z"))
        );
    }

    #[test]
    fn parses_authoritative_chatgpt_entitlement_expiry() {
        let json = r#"{
            "accounts": {
                "acct_123": {
                    "entitlement": { "expires_at": "2026-07-23T00:00:00Z" }
                }
            }
        }"#;

        assert_eq!(
            parse_subscription_end_from_accounts_json(
                json,
                Some("acct_123"),
                timestamp("2026-07-22T00:00:00Z")
            ),
            Some(timestamp("2026-07-23T00:00:00Z"))
        );
    }

    #[test]
    fn parses_compact_plan_only_from_the_selected_chatgpt_account() {
        let json = r#"{
            "accounts": {
                "codex_account": {
                    "entitlement": {
                        "subscription_plan": "chatgptpro",
                        "expires_at": "2026-07-23T00:00:00Z"
                    }
                },
                "other_account": {
                    "entitlement": { "subscription_plan": "chatgptteam" }
                }
            }
        }"#;

        assert_eq!(
            parse_chatgpt_plan_from_accounts_json(json, "codex_account").as_deref(),
            Some("Pro")
        );
        assert_eq!(
            parse_chatgpt_plan_from_accounts_json(json, "other_account").as_deref(),
            Some("Team")
        );
        assert_eq!(parse_chatgpt_plan_from_accounts_json(json, "missing"), None);
    }

    #[test]
    fn ignores_past_chatgpt_entitlement_expiry() {
        let json = r#"{
            "accounts": {
                "default": {
                    "entitlement": { "expires_at": "2026-07-21T23:59:59Z" }
                }
            }
        }"#;

        assert_eq!(
            parse_subscription_end_from_accounts_json(
                json,
                None,
                timestamp("2026-07-22T00:00:00Z")
            ),
            None
        );
    }

    #[test]
    fn ignores_missing_chatgpt_entitlement_expiry() {
        let json = r#"{"accounts":{"default":{"entitlement":{}}}}"#;

        assert_eq!(
            parse_subscription_end_from_accounts_json(
                json,
                None,
                timestamp("2026-07-22T00:00:00Z")
            ),
            None
        );
    }

    #[test]
    fn never_falls_back_to_another_chatgpt_account_entitlement() {
        let json = r#"{
            "accounts": {
                "active_without_expiry": { "entitlement": {} },
                "default": {
                    "entitlement": { "expires_at": "2026-07-23T00:00:00Z" }
                }
            }
        }"#;

        assert_eq!(
            parse_subscription_end_from_accounts_json(
                json,
                Some("active_without_expiry"),
                timestamp("2026-07-22T00:00:00Z")
            ),
            None
        );
    }

    #[tokio::test]
    #[ignore = "requires an authenticated Codex/ChatGPT account"]
    async fn live_chatgpt_scrape_has_future_subscription_end() {
        let provider = ChatGPTProvider::new();
        assert_eq!(provider.id(), ProviderId::ChatGPT);
        let context = FetchContext {
            source_mode: SourceMode::Auto,
            ..FetchContext::default()
        };
        let result = provider
            .fetch_usage(&context)
            .await
            .expect("the normal provider path must find the authenticated ChatGPT account");

        assert!(result.usage.account_only);
        assert_eq!(result.source_label, "oauth");
        assert_eq!(result.usage.login_method.as_deref(), Some("Pro"));
        assert!(
            result
                .usage
                .subscription_ends_at
                .is_some_and(|ends_at| ends_at > Utc::now()),
            "the normal provider path did not select a future active-account entitlement"
        );
    }
}
