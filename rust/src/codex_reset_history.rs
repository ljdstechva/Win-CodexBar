//! Persisted Codex reset-credit history.
//!
//! The live reset-credit endpoint only returns currently relevant credits, so
//! this ledger preserves every banked credit previously observed. It also
//! records watched-X announcements for fleet-wide resets that are not banked
//! to an individual account. Authentication material and account identifiers
//! never enter this file.

use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{providers::codex::CodexResetCredit, settings::Settings};

const LEDGER_FILE_NAME: &str = "codex-reset-credits.json";

static LEDGER_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CodexResetHistoryEntry {
    Banked {
        id: String,
        granted_at: DateTime<Utc>,
        expires_at: Option<DateTime<Utc>>,
        redeemed_at: Option<DateTime<Utc>>,
        redeem_started_at: Option<DateTime<Utc>>,
        status: String,
        title: String,
        description: String,
        grantor: Option<String>,
        reset_type: String,
        recorded_at: DateTime<Utc>,
    },
    Announced {
        post_id: String,
        post_date: DateTime<Utc>,
        handle: String,
        url: String,
        snippet: String,
        recorded_at: DateTime<Utc>,
    },
}

impl CodexResetHistoryEntry {
    fn sort_date(&self) -> DateTime<Utc> {
        match self {
            Self::Banked { granted_at, .. } => *granted_at,
            Self::Announced { post_date, .. } => *post_date,
        }
    }

    fn with_derived_status(mut self, now: DateTime<Utc>) -> Self {
        if let Self::Banked {
            expires_at, status, ..
        } = &mut self
            && status.eq_ignore_ascii_case("available")
            && expires_at.is_some_and(|expires_at| expires_at <= now)
        {
            *status = "expired".to_string();
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexResetHistorySnapshot {
    pub entries: Vec<CodexResetHistoryEntry>,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexResetAnnouncement {
    pub post_id: String,
    pub post_date: DateTime<Utc>,
    pub handle: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistedCodexResetHistory {
    entries: Vec<CodexResetHistoryEntry>,
}

#[derive(Debug, Clone)]
pub struct CodexResetHistoryStore {
    path: PathBuf,
}

impl CodexResetHistoryStore {
    pub fn from_settings() -> Result<Self, String> {
        let settings_path = Settings::settings_path()
            .ok_or_else(|| "Could not resolve the CodexBar settings directory".to_string())?;
        Ok(Self {
            path: settings_path
                .parent()
                .map(|parent| parent.join(LEDGER_FILE_NAME))
                .unwrap_or_else(|| PathBuf::from(LEDGER_FILE_NAME)),
        })
    }

    #[cfg(test)]
    fn at_path(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn merge_banked(
        &self,
        credits: &[CodexResetCredit],
        now: DateTime<Utc>,
    ) -> Result<CodexResetHistorySnapshot, String> {
        let _guard = ledger_lock();
        let mut ledger = self.load_unlocked()?;
        for credit in credits {
            upsert_banked(&mut ledger.entries, credit, now);
        }
        sort_entries(&mut ledger.entries);
        self.persist_unlocked(&ledger)?;
        Ok(snapshot_from_entries(ledger.entries, now, false))
    }

    pub fn append_announcements(
        &self,
        announcements: &[CodexResetAnnouncement],
        now: DateTime<Utc>,
    ) -> Result<(), String> {
        if announcements.is_empty() {
            return Ok(());
        }

        let _guard = ledger_lock();
        let mut ledger = self.load_unlocked()?;
        let mut changed = false;
        for announcement in announcements {
            if ledger.entries.iter().any(|entry| {
                matches!(
                    entry,
                    CodexResetHistoryEntry::Announced { post_id, .. }
                        if post_id == &announcement.post_id
                )
            }) {
                continue;
            }
            ledger.entries.push(CodexResetHistoryEntry::Announced {
                post_id: announcement.post_id.clone(),
                post_date: announcement.post_date,
                handle: announcement.handle.clone(),
                url: announcement.url.clone(),
                snippet: announcement.snippet.chars().take(200).collect(),
                recorded_at: now,
            });
            changed = true;
        }
        if changed {
            sort_entries(&mut ledger.entries);
            self.persist_unlocked(&ledger)?;
        }
        Ok(())
    }

    pub fn snapshot(
        &self,
        now: DateTime<Utc>,
        stale: bool,
    ) -> Result<CodexResetHistorySnapshot, String> {
        let _guard = ledger_lock();
        let ledger = self.load_unlocked()?;
        Ok(snapshot_from_entries(ledger.entries, now, stale))
    }

    fn load_unlocked(&self) -> Result<PersistedCodexResetHistory, String> {
        if !self.path.exists() {
            return Ok(PersistedCodexResetHistory::default());
        }
        let bytes = std::fs::read(&self.path)
            .map_err(|error| format!("Could not read Codex reset history: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Could not parse Codex reset history: {error}"))
    }

    fn persist_unlocked(&self, ledger: &PersistedCodexResetHistory) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("Could not create CodexBar settings directory: {error}")
            })?;
        }
        let bytes = serde_json::to_vec_pretty(ledger)
            .map_err(|error| format!("Could not serialize Codex reset history: {error}"))?;
        std::fs::write(&self.path, bytes)
            .map_err(|error| format!("Could not persist Codex reset history: {error}"))
    }
}

fn ledger_lock() -> std::sync::MutexGuard<'static, ()> {
    LEDGER_IO_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

fn upsert_banked(
    entries: &mut Vec<CodexResetHistoryEntry>,
    credit: &CodexResetCredit,
    now: DateTime<Utc>,
) {
    let existing_index = entries.iter().position(|entry| {
        matches!(
            entry,
            CodexResetHistoryEntry::Banked { id, .. } if id == &credit.id
        )
    });
    let recorded_at = existing_index
        .and_then(|index| match &entries[index] {
            CodexResetHistoryEntry::Banked { recorded_at, .. } => Some(*recorded_at),
            CodexResetHistoryEntry::Announced { .. } => None,
        })
        .unwrap_or(now);
    let entry = CodexResetHistoryEntry::Banked {
        id: credit.id.clone(),
        granted_at: credit.granted_at,
        expires_at: credit.expires_at,
        redeemed_at: credit.redeemed_at,
        redeem_started_at: credit.redeem_started_at,
        status: credit.status.clone(),
        title: credit.title.clone(),
        description: credit.description.clone(),
        grantor: credit.profile_user_id.clone(),
        reset_type: credit.reset_type.clone(),
        recorded_at,
    };
    if let Some(index) = existing_index {
        entries[index] = entry;
    } else {
        entries.push(entry);
    }
}

fn snapshot_from_entries(
    entries: Vec<CodexResetHistoryEntry>,
    now: DateTime<Utc>,
    stale: bool,
) -> CodexResetHistorySnapshot {
    let mut entries = entries
        .into_iter()
        .map(|entry| entry.with_derived_status(now))
        .collect::<Vec<_>>();
    sort_entries(&mut entries);
    CodexResetHistorySnapshot { entries, stale }
}

fn sort_entries(entries: &mut [CodexResetHistoryEntry]) {
    entries.sort_by(|left, right| {
        right
            .sort_date()
            .cmp(&left.sort_date())
            .then_with(|| history_key(left).cmp(history_key(right)))
    });
}

fn history_key(entry: &CodexResetHistoryEntry) -> &str {
    match entry {
        CodexResetHistoryEntry::Banked { id, .. } => id,
        CodexResetHistoryEntry::Announced { post_id, .. } => post_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn credit(id: &str, granted_at: &str, expires_at: &str) -> CodexResetCredit {
        CodexResetCredit {
            id: id.to_string(),
            reset_type: "codex_rate_limits".to_string(),
            is_supported_by_plan: true,
            status: "available".to_string(),
            granted_at: timestamp(granted_at),
            expires_at: Some(timestamp(expires_at)),
            redeem_started_at: None,
            redeemed_at: None,
            profile_image_url: Some("https://example.test/grantor.png".to_string()),
            profile_user_id: Some("Codex Team".to_string()),
            title: "Full reset".to_string(),
            description: "Reset all Codex rate limits.".to_string(),
        }
    }

    fn announcement(id: &str, date: &str) -> CodexResetAnnouncement {
        CodexResetAnnouncement {
            post_id: id.to_string(),
            post_date: timestamp(date),
            handle: "OpenAI".to_string(),
            url: format!("https://x.com/OpenAI/status/{id}"),
            snippet: "Codex rate limits have been reset.".to_string(),
        }
    }

    #[test]
    fn banked_entries_survive_restart_and_an_empty_api_response() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(LEDGER_FILE_NAME);
        let observed_at = timestamp("2026-07-14T00:00:00Z");
        CodexResetHistoryStore::at_path(path.clone())
            .merge_banked(
                &[credit(
                    "RateLimitResetCredit_1",
                    "2026-07-13T17:49:11Z",
                    "2026-08-12T17:49:11Z",
                )],
                observed_at,
            )
            .unwrap();

        let restarted = CodexResetHistoryStore::at_path(path);
        restarted.merge_banked(&[], observed_at).unwrap();
        let snapshot = restarted.snapshot(observed_at, true).unwrap();

        assert!(snapshot.stale);
        assert_eq!(snapshot.entries.len(), 1);
        assert!(matches!(
            &snapshot.entries[0],
            CodexResetHistoryEntry::Banked {
                id,
                recorded_at,
                ..
            } if id == "RateLimitResetCredit_1" && *recorded_at == observed_at
        ));
    }

    #[test]
    fn banked_upsert_refreshes_status_without_changing_recorded_at() {
        let directory = tempfile::tempdir().unwrap();
        let store = CodexResetHistoryStore::at_path(directory.path().join(LEDGER_FILE_NAME));
        let first_seen = timestamp("2026-07-14T00:00:00Z");
        let mut item = credit(
            "RateLimitResetCredit_1",
            "2026-07-13T17:49:11Z",
            "2026-08-12T17:49:11Z",
        );
        store.merge_banked(&[item.clone()], first_seen).unwrap();
        item.status = "redeemed".to_string();
        item.redeemed_at = Some(timestamp("2026-07-15T10:00:00Z"));
        store
            .merge_banked(&[item], timestamp("2026-07-15T11:00:00Z"))
            .unwrap();

        let snapshot = store
            .snapshot(timestamp("2026-07-15T11:00:00Z"), false)
            .unwrap();
        assert!(matches!(
            &snapshot.entries[0],
            CodexResetHistoryEntry::Banked {
                status,
                redeemed_at: Some(redeemed_at),
                recorded_at,
                ..
            } if status == "redeemed"
                && *redeemed_at == timestamp("2026-07-15T10:00:00Z")
                && *recorded_at == first_seen
        ));
    }

    #[test]
    fn available_credit_is_derived_as_expired_only_when_read_after_expiry() {
        let directory = tempfile::tempdir().unwrap();
        let store = CodexResetHistoryStore::at_path(directory.path().join(LEDGER_FILE_NAME));
        store
            .merge_banked(
                &[credit(
                    "RateLimitResetCredit_1",
                    "2026-07-13T17:49:11Z",
                    "2026-08-12T17:49:11Z",
                )],
                timestamp("2026-07-14T00:00:00Z"),
            )
            .unwrap();

        let before = store
            .snapshot(timestamp("2026-08-12T17:49:10Z"), false)
            .unwrap();
        let after = store
            .snapshot(timestamp("2026-08-12T17:49:12Z"), false)
            .unwrap();

        assert!(matches!(
            &before.entries[0],
            CodexResetHistoryEntry::Banked { status, .. } if status == "available"
        ));
        assert!(matches!(
            &after.entries[0],
            CodexResetHistoryEntry::Banked { status, .. } if status == "expired"
        ));
    }

    #[test]
    fn announced_entries_dedupe_and_coexist_with_banked_entries_sorted_by_date() {
        let directory = tempfile::tempdir().unwrap();
        let store = CodexResetHistoryStore::at_path(directory.path().join(LEDGER_FILE_NAME));
        let now = timestamp("2026-07-16T00:00:00Z");
        store
            .merge_banked(
                &[credit(
                    "RateLimitResetCredit_1",
                    "2026-07-13T17:49:11Z",
                    "2026-08-12T17:49:11Z",
                )],
                now,
            )
            .unwrap();
        let mut item = announcement("200", "2026-07-15T00:00:00Z");
        item.snippet = "é".repeat(250);
        store
            .append_announcements(&[item.clone(), item], now)
            .unwrap();

        let snapshot = store.snapshot(now, false).unwrap();
        assert_eq!(snapshot.entries.len(), 2);
        assert!(matches!(
            &snapshot.entries[0],
            CodexResetHistoryEntry::Announced {
                post_id,
                url,
                snippet,
                ..
            } if post_id == "200"
                && url == "https://x.com/OpenAI/status/200"
                && snippet.chars().count() == 200
        ));
        assert!(matches!(
            &snapshot.entries[1],
            CodexResetHistoryEntry::Banked { .. }
        ));
    }
}
