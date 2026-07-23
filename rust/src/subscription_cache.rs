//! Last-known-good authoritative subscription boundaries.
//!
//! This store deliberately persists only a provider plan label and two
//! timestamps. Authentication material, account identity, and provider
//! payloads never enter this module.

use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{core::ProviderId, settings::Settings};

const CACHE_MAX_AGE_DAYS: i64 = 7;

static CACHE_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscriptionCacheEntry {
    plan_label: String,
    ends_at: DateTime<Utc>,
    fetched_at: DateTime<Utc>,
}

type PersistedSubscriptionCache = BTreeMap<String, SubscriptionCacheEntry>;

#[derive(Debug, Clone)]
pub(crate) struct SubscriptionCache {
    path: PathBuf,
}

impl SubscriptionCache {
    pub(crate) fn from_settings() -> Option<Self> {
        Settings::settings_path().map(|path| Self {
            path: path
                .parent()
                .map(|parent| parent.join("subscription-cache.json"))
                .unwrap_or_else(|| PathBuf::from("subscription-cache.json")),
        })
    }

    #[cfg(test)]
    pub(crate) fn at_path(path: PathBuf) -> Self {
        Self { path }
    }

    pub(crate) fn store_authoritative(
        &self,
        provider: ProviderId,
        plan_label: &str,
        ends_at: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<(), String> {
        let Some(plan_label) = nonempty_plan_label(plan_label) else {
            return Ok(());
        };
        if ends_at <= now {
            return self.remove(provider);
        }

        let _guard = CACHE_IO_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut cache = self.load();
        cache.insert(
            provider.cli_name().to_string(),
            SubscriptionCacheEntry {
                plan_label: plan_label.to_string(),
                ends_at,
                fetched_at: now,
            },
        );
        self.persist(&cache)
    }

    pub(crate) fn cached_end(
        &self,
        provider: ProviderId,
        live_plan_label: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<DateTime<Utc>>, String> {
        let Some(live_plan_label) = nonempty_plan_label(live_plan_label) else {
            return Ok(None);
        };

        let _guard = CACHE_IO_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut cache = self.load();
        let key = provider.cli_name();
        let Some(entry) = cache.get(key).cloned() else {
            return Ok(None);
        };

        let fresh =
            entry.fetched_at <= now && entry.fetched_at >= now - Duration::days(CACHE_MAX_AGE_DAYS);
        let future = entry.ends_at > now;
        let same_plan = plan_labels_match(&entry.plan_label, live_plan_label);

        if future && fresh && same_plan {
            return Ok(Some(entry.ends_at));
        }

        // Expired, stale, future-dated, and plan-mismatched entries are no
        // longer valid last-known-good evidence for the live account.
        cache.remove(key);
        self.persist(&cache)?;
        Ok(None)
    }

    fn remove(&self, provider: ProviderId) -> Result<(), String> {
        let _guard = CACHE_IO_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut cache = self.load();
        if cache.remove(provider.cli_name()).is_some() {
            self.persist(&cache)?;
        }
        Ok(())
    }

    fn load(&self) -> PersistedSubscriptionCache {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn persist(&self, cache: &PersistedSubscriptionCache) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(cache).map_err(|error| error.to_string())?;
        std::fs::write(&self.path, bytes).map_err(|error| error.to_string())
    }
}

fn nonempty_plan_label(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn normalized_plan_label(value: &str) -> Option<String> {
    let compact = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    let normalized = compact
        .strip_prefix("chatgpt")
        .or_else(|| compact.strip_prefix("claude"))
        .unwrap_or(&compact);
    (!normalized.is_empty() && !matches!(normalized, "oauth" | "cli" | "web"))
        .then(|| normalized.to_string())
}

pub(crate) fn plan_labels_match(left: &str, right: &str) -> bool {
    let Some(left) = normalized_plan_label(left) else {
        return false;
    };
    let Some(right) = normalized_plan_label(right) else {
        return false;
    };
    left.starts_with(&right) || right.starts_with(&left)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn write_entry(
        store: &SubscriptionCache,
        provider: ProviderId,
        plan_label: &str,
        ends_at: DateTime<Utc>,
        fetched_at: DateTime<Utc>,
    ) {
        let mut cache = PersistedSubscriptionCache::new();
        cache.insert(
            provider.cli_name().to_string(),
            SubscriptionCacheEntry {
                plan_label: plan_label.to_string(),
                ends_at,
                fetched_at,
            },
        );
        store.persist(&cache).unwrap();
    }

    #[test]
    fn failure_after_success_survives_a_new_store_instance() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("subscription-cache.json");
        let now = timestamp("2026-07-22T00:00:00Z");
        let ends_at = timestamp("2026-08-22T00:00:00Z");
        SubscriptionCache::at_path(path.clone())
            .store_authoritative(ProviderId::Claude, "Claude Max 5x", ends_at, now)
            .unwrap();

        let restarted_store = SubscriptionCache::at_path(path);
        assert_eq!(
            restarted_store
                .cached_end(ProviderId::Claude, "Claude Max", now + Duration::hours(1))
                .unwrap(),
            Some(ends_at)
        );
    }

    #[test]
    fn eight_day_old_cache_is_ignored_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let store = SubscriptionCache::at_path(dir.path().join("subscription-cache.json"));
        let now = timestamp("2026-07-22T00:00:00Z");
        write_entry(
            &store,
            ProviderId::Claude,
            "Claude Max 5x",
            timestamp("2026-08-22T00:00:00Z"),
            now - Duration::days(8),
        );

        assert_eq!(
            store
                .cached_end(ProviderId::Claude, "Claude Max 5x", now)
                .unwrap(),
            None
        );
        assert!(store.load().is_empty());
    }

    #[test]
    fn past_boundary_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let store = SubscriptionCache::at_path(dir.path().join("subscription-cache.json"));
        let now = timestamp("2026-07-22T00:00:00Z");
        write_entry(
            &store,
            ProviderId::ChatGPT,
            "ChatGPT Pro",
            now - Duration::seconds(1),
            now - Duration::hours(1),
        );

        assert_eq!(
            store
                .cached_end(ProviderId::ChatGPT, "ChatGPT Pro", now)
                .unwrap(),
            None
        );
        assert!(store.load().is_empty());
    }

    #[test]
    fn plan_change_invalidates_the_entry() {
        let dir = tempfile::tempdir().unwrap();
        let store = SubscriptionCache::at_path(dir.path().join("subscription-cache.json"));
        let now = timestamp("2026-07-22T00:00:00Z");
        write_entry(
            &store,
            ProviderId::Claude,
            "Claude Max 5x",
            timestamp("2026-08-22T00:00:00Z"),
            now,
        );

        assert_eq!(
            store
                .cached_end(ProviderId::Claude, "Claude Pro", now)
                .unwrap(),
            None
        );
        assert!(store.load().is_empty());
    }

    #[test]
    fn serialized_provider_entry_contains_only_the_three_allowed_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("subscription-cache.json");
        let store = SubscriptionCache::at_path(path.clone());
        store
            .store_authoritative(
                ProviderId::Claude,
                "Claude Max 5x",
                timestamp("2026-08-22T00:00:00Z"),
                timestamp("2026-07-22T00:00:00Z"),
            )
            .unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let keys = value["claude"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        assert_eq!(
            keys,
            BTreeSet::from([
                "endsAt".to_string(),
                "fetchedAt".to_string(),
                "planLabel".to_string(),
            ])
        );
    }

    #[test]
    fn normalized_plan_prefixes_match_in_both_directions() {
        assert!(plan_labels_match("Claude Max", "Claude Max 5x"));
        assert!(plan_labels_match("Claude Max 20x", "Max"));
        assert!(plan_labels_match("ChatGPT Pro", "Pro"));
        assert!(!plan_labels_match("Claude Pro", "Claude Max 5x"));
    }
}
