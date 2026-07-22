//! Persisted X watchlist notifications for the tray-opened dashboard.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use codexbar::x_notifications::{XPost, XWatchTarget};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

pub const X_NOTIFICATIONS_CHANGED_EVENT: &str = "x-notifications-changed";
const INITIAL_REFRESH_DELAY: Duration = Duration::from_secs(4);
const REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);
const FAILURE_RETRY_INITIAL: Duration = Duration::from_secs(30);
const RATE_LIMIT_RETRY_MINIMUM: Duration = Duration::from_secs(15 * 60);
const POLL_JITTER_PERCENT: u128 = 10;
const NOTIFICATION_HISTORY_DAYS: i64 = 7;
const WATCH_TARGETS: [XWatchTarget; 3] = [
    XWatchTarget {
        handle: "thsottiaux",
    },
    XWatchTarget { handle: "OpenAI" },
    XWatchTarget { handle: "sama" },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XNotificationSnapshot {
    pub unread_count: usize,
    pub items: Vec<XPost>,
    pub watched_handles: Vec<String>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotifiedXPost {
    id: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PersistedXNotifications {
    notified_posts: Vec<NotifiedXPost>,
    unread: Vec<XPost>,
    last_checked_at: Option<DateTime<Utc>>,
    last_success_at: Option<DateTime<Utc>>,
}

struct RefreshCycle {
    snapshot: XNotificationSnapshot,
    succeeded: bool,
    saw_429: bool,
}

pub struct XNotificationState {
    store: Mutex<PersistedXNotifications>,
    refresh_gate: tokio::sync::Mutex<()>,
    last_error: Mutex<Option<String>>,
}

impl XNotificationState {
    pub fn load() -> Self {
        let mut store = state_path()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        normalize_store(&mut store, Utc::now());
        Self {
            store: Mutex::new(store),
            refresh_gate: tokio::sync::Mutex::new(()),
            last_error: Mutex::new(None),
        }
    }

    fn snapshot(&self) -> XNotificationSnapshot {
        let store = self.store.lock().unwrap_or_else(|error| error.into_inner());
        let last_error = self
            .last_error
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        XNotificationSnapshot {
            unread_count: store.unread.len(),
            items: store.unread.clone(),
            watched_handles: WATCH_TARGETS
                .iter()
                .map(|target| target.handle.to_string())
                .collect(),
            last_checked_at: store.last_checked_at,
            last_success_at: store.last_success_at,
            last_error,
        }
    }
}

fn state_path() -> Option<PathBuf> {
    codexbar::settings::Settings::settings_path().map(|path| {
        path.parent()
            .map(|parent| parent.join("x-notifications.json"))
            .unwrap_or_else(|| PathBuf::from("x-notifications.json"))
    })
}

fn persist(store: &PersistedXNotifications) -> Result<(), String> {
    let Some(path) = state_path() else {
        return Err("Could not resolve the CodexBar settings directory".into());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn normalize_store(store: &mut PersistedXNotifications, now: DateTime<Utc>) {
    let cutoff = now - ChronoDuration::days(NOTIFICATION_HISTORY_DAYS);
    store.unread.retain(|post| post.created_at >= cutoff);
    sort_and_dedupe_posts(&mut store.unread);

    let mut notified_ids = store
        .notified_posts
        .iter()
        .filter(|item| item.created_at >= cutoff)
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    store
        .notified_posts
        .retain(|item| item.created_at >= cutoff);
    for post in &store.unread {
        if notified_ids.insert(post.id.clone()) {
            store.notified_posts.push(NotifiedXPost {
                id: post.id.clone(),
                created_at: post.created_at,
            });
        }
    }
    store
        .notified_posts
        .sort_by_key(|item| std::cmp::Reverse(item.created_at));
    let mut retained_ids = HashSet::new();
    store
        .notified_posts
        .retain(|item| retained_ids.insert(item.id.clone()));
}

fn merge_posts(store: &mut PersistedXNotifications, posts: Vec<XPost>, succeeded: bool) {
    merge_posts_at(store, posts, Utc::now(), succeeded);
}

fn merge_posts_at(
    store: &mut PersistedXNotifications,
    mut posts: Vec<XPost>,
    now: DateTime<Utc>,
    succeeded: bool,
) {
    normalize_store(store, now);
    let cutoff = now - ChronoDuration::days(NOTIFICATION_HISTORY_DAYS);
    posts.retain(|post| post.created_at >= cutoff);
    sort_and_dedupe_posts(&mut posts);

    let mut notified_ids = store
        .notified_posts
        .iter()
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    let mut unread_ids = store
        .unread
        .iter()
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    let mut incoming = Vec::new();
    for post in posts {
        if !notified_ids.insert(post.id.clone()) {
            continue;
        }
        store.notified_posts.push(NotifiedXPost {
            id: post.id.clone(),
            created_at: post.created_at,
        });
        if unread_ids.insert(post.id.clone()) {
            incoming.push(post);
        }
    }

    incoming.append(&mut store.unread);
    sort_and_dedupe_posts(&mut incoming);
    store.unread = incoming;
    store
        .notified_posts
        .sort_by_key(|item| std::cmp::Reverse(item.created_at));
    store.last_checked_at = Some(now);
    if succeeded {
        store.last_success_at = Some(now);
    }
}

fn sort_and_dedupe_posts(posts: &mut Vec<XPost>) {
    posts.sort_by_key(|post| std::cmp::Reverse(post.created_at));
    let mut ids = HashSet::new();
    posts.retain(|post| ids.insert(post.id.clone()));
}

fn take_unread_notification(
    store: &mut PersistedXNotifications,
    id: &str,
) -> Result<XPost, String> {
    let Some(index) = store.unread.iter().position(|item| item.id == id) else {
        return Err("X notification is no longer available".into());
    };
    Ok(store.unread.remove(index))
}

fn mark_all_notifications_read(
    store: &mut PersistedXNotifications,
    persist_store: impl FnOnce(&PersistedXNotifications) -> Result<(), String>,
) -> Result<(), String> {
    let unread = std::mem::take(&mut store.unread);
    if let Err(error) = persist_store(store) {
        store.unread = unread;
        return Err(error);
    }
    Ok(())
}

fn open_unread_notification(
    store: &mut PersistedXNotifications,
    id: &str,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<XPost, String> {
    let item = store
        .unread
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| "X notification is no longer available".to_string())?;
    open(&item.url)?;
    take_unread_notification(store, id)
}

fn next_poll_delay(consecutive_failures: u32, saw_429: bool) -> Duration {
    if saw_429 {
        return RATE_LIMIT_RETRY_MINIMUM;
    }
    if consecutive_failures == 0 {
        return REFRESH_INTERVAL;
    }

    let exponent = consecutive_failures.saturating_sub(1).min(4);
    let seconds = FAILURE_RETRY_INITIAL
        .as_secs()
        .saturating_mul(1_u64 << exponent)
        .min(REFRESH_INTERVAL.as_secs());
    Duration::from_secs(seconds)
}

fn jittered_delay(delay: Duration, entropy: u128, minimum: Duration) -> Duration {
    let base_millis = delay.as_millis();
    let jitter_range = base_millis.saturating_mul(POLL_JITTER_PERCENT) / 100;
    if jitter_range == 0 {
        return delay.max(minimum);
    }

    let offset = (entropy % (jitter_range.saturating_mul(2) + 1)) as i128 - jitter_range as i128;
    let jittered_millis = (base_millis as i128 + offset).max(0) as u128;
    let jittered = Duration::from_millis(u64::try_from(jittered_millis).unwrap_or(u64::MAX));
    jittered.max(minimum)
}

fn randomized_delay(delay: Duration, minimum: Duration) -> Duration {
    jittered_delay(delay, Uuid::new_v4().as_u128(), minimum)
}

fn randomized_next_poll_delay(consecutive_failures: u32, saw_429: bool) -> Duration {
    let delay = next_poll_delay(consecutive_failures, saw_429);
    let minimum = if saw_429 {
        RATE_LIMIT_RETRY_MINIMUM
    } else {
        Duration::ZERO
    };
    randomized_delay(delay, minimum)
}

fn classify_refresh(
    posts: &[XPost],
    errors: &[codexbar::x_notifications::XNotificationError],
) -> (bool, bool) {
    let succeeded = !posts.is_empty() || errors.is_empty();
    let saw_429 = errors.iter().any(|error| error.is_rate_limited());
    (succeeded, saw_429)
}

async fn refresh_and_emit(app: &AppHandle, state: &XNotificationState) -> RefreshCycle {
    let _refresh_guard = state.refresh_gate.lock().await;
    let (posts, errors) = codexbar::x_notifications::fetch_watchlist(&WATCH_TARGETS).await;
    let (succeeded, saw_429) = classify_refresh(&posts, &errors);
    let mut store = state
        .store
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    merge_posts(&mut store, posts, succeeded);
    if let Err(error) = persist(&store) {
        tracing::warn!("Could not persist X notifications: {error}");
    }
    drop(store);

    let error_message = if errors.is_empty() {
        None
    } else {
        Some(
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        )
    };
    *state
        .last_error
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = error_message;

    let snapshot = state.snapshot();
    let _ = app.emit(X_NOTIFICATIONS_CHANGED_EVENT, &snapshot);
    RefreshCycle {
        snapshot,
        succeeded,
        saw_429,
    }
}

pub fn install(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(randomized_delay(INITIAL_REFRESH_DELAY, Duration::ZERO)).await;
        let mut consecutive_failures = 0_u32;
        loop {
            let state = app.state::<XNotificationState>();
            let cycle = refresh_and_emit(&app, &state).await;
            if cycle.succeeded {
                consecutive_failures = 0;
            } else {
                consecutive_failures = consecutive_failures.saturating_add(1);
            }
            tokio::time::sleep(randomized_next_poll_delay(
                consecutive_failures,
                cycle.saw_429,
            ))
            .await;
        }
    });
}

#[tauri::command]
pub fn get_x_notifications(state: tauri::State<'_, XNotificationState>) -> XNotificationSnapshot {
    state.snapshot()
}

#[tauri::command]
pub async fn refresh_x_notifications(
    app: AppHandle,
    state: tauri::State<'_, XNotificationState>,
) -> Result<XNotificationSnapshot, String> {
    Ok(refresh_and_emit(&app, &state).await.snapshot)
}

#[tauri::command]
pub fn open_x_notification(
    app: AppHandle,
    id: String,
    state: tauri::State<'_, XNotificationState>,
) -> Result<XNotificationSnapshot, String> {
    let id = id.trim();
    if id.is_empty() || id.len() > 32 || !id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Invalid X notification id".into());
    }
    {
        let mut store = state
            .store
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let item = open_unread_notification(&mut store, id, |url| {
            crate::commands::open_external_url(url.to_string())
        })?;
        if let Err(error) = persist(&store) {
            store.unread.push(item);
            sort_and_dedupe_posts(&mut store.unread);
            return Err(error);
        }
    }
    let snapshot = state.snapshot();
    let _ = app.emit(X_NOTIFICATIONS_CHANGED_EVENT, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn mark_all_x_notifications_read(
    app: AppHandle,
    state: tauri::State<'_, XNotificationState>,
) -> Result<XNotificationSnapshot, String> {
    {
        let mut store = state
            .store
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        mark_all_notifications_read(&mut store, persist)?;
    }
    let snapshot = state.snapshot();
    let _ = app.emit(X_NOTIFICATIONS_CHANGED_EVENT, &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use codexbar::x_notifications::XPostKind;

    fn timestamp(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn post(id: &str, handle: &str, created_at: &str) -> XPost {
        XPost {
            id: id.into(),
            handle: handle.into(),
            display_name: handle.into(),
            text: format!("post {id}"),
            created_at: timestamp(created_at),
            url: format!("https://x.com/{handle}/status/{id}"),
            avatar_url: None,
            kind: XPostKind::Post,
        }
    }

    #[test]
    fn first_refresh_notifies_every_unseen_post_from_the_last_seven_days() {
        let mut store = PersistedXNotifications::default();
        merge_posts_at(
            &mut store,
            vec![
                post("1", "OpenAI", "2026-07-09T00:00:00Z"),
                post("2", "OpenAI", "2026-07-14T00:00:00Z"),
                post("3", "sama", "2026-07-15T01:00:00Z"),
                post("old", "sama", "2026-07-07T23:59:59Z"),
            ],
            timestamp("2026-07-15T00:00:00Z"),
            true,
        );
        assert_eq!(store.unread.len(), 3);
        assert_eq!(store.unread[0].id, "3");
        assert_eq!(store.unread[1].id, "2");
        assert_eq!(store.unread[2].id, "1");
        assert_eq!(store.notified_posts.len(), 3);
        assert!(store.unread.iter().all(|post| post.id != "old"));
        assert_eq!(
            store.last_success_at,
            Some(timestamp("2026-07-15T00:00:00Z"))
        );
    }

    #[test]
    fn later_refresh_adds_only_unseen_items() {
        let mut store = PersistedXNotifications::default();
        merge_posts_at(
            &mut store,
            vec![post("1", "OpenAI", "2026-07-14T00:00:00Z")],
            timestamp("2026-07-15T00:00:00Z"),
            true,
        );
        store.unread.clear();
        merge_posts_at(
            &mut store,
            vec![
                post("1", "OpenAI", "2026-07-14T00:00:00Z"),
                post("2", "OpenAI", "2026-07-15T00:00:00Z"),
            ],
            timestamp("2026-07-15T01:00:00Z"),
            true,
        );
        assert_eq!(
            store
                .unread
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["2"]
        );
        assert_eq!(store.notified_posts.len(), 2);
    }

    #[test]
    fn a_read_post_stays_in_the_notification_ledger_and_is_not_readded() {
        let mut store = PersistedXNotifications::default();
        let item = post("1", "OpenAI", "2026-07-14T00:00:00Z");
        merge_posts_at(
            &mut store,
            vec![item.clone()],
            timestamp("2026-07-15T00:00:00Z"),
            true,
        );
        take_unread_notification(&mut store, "1").expect("unread item");

        merge_posts_at(
            &mut store,
            vec![item],
            timestamp("2026-07-15T01:00:00Z"),
            true,
        );

        assert!(store.unread.is_empty());
        assert_eq!(store.notified_posts.len(), 1);
        assert_eq!(store.notified_posts[0].id, "1");
    }

    #[test]
    fn mark_all_read_restores_unread_items_when_persistence_fails() {
        let mut store = PersistedXNotifications {
            unread: vec![
                post("2", "sama", "2026-07-15T00:00:00Z"),
                post("1", "OpenAI", "2026-07-14T00:00:00Z"),
            ],
            ..Default::default()
        };
        let expected = store.unread.clone();

        let result =
            mark_all_notifications_read(
                &mut store,
                |_| Err("simulated persistence failure".into()),
            );

        assert_eq!(result, Err("simulated persistence failure".into()));
        assert_eq!(store.unread, expected);
    }

    #[test]
    fn mark_all_read_keeps_unread_empty_after_persistence_succeeds() {
        let mut store = PersistedXNotifications {
            unread: vec![post("1", "OpenAI", "2026-07-14T00:00:00Z")],
            ..Default::default()
        };

        mark_all_notifications_read(&mut store, |persisted| {
            assert!(persisted.unread.is_empty());
            Ok(())
        })
        .expect("mark all read");

        assert!(store.unread.is_empty());
    }

    #[test]
    fn rolling_history_prunes_notifications_and_unread_items_after_seven_days() {
        let mut store = PersistedXNotifications::default();
        merge_posts_at(
            &mut store,
            vec![post("1", "OpenAI", "2026-07-08T00:00:00Z")],
            timestamp("2026-07-08T00:00:00Z"),
            true,
        );
        assert_eq!(store.unread.len(), 1);

        merge_posts_at(
            &mut store,
            Vec::new(),
            timestamp("2026-07-15T00:00:01Z"),
            true,
        );

        assert!(store.unread.is_empty());
        assert!(store.notified_posts.is_empty());
    }

    #[test]
    fn legacy_seen_ids_do_not_hide_posts_that_were_never_notified() {
        let mut store: PersistedXNotifications = serde_json::from_str(
            r#"{
                "initializedHandles":["OpenAI"],
                "seenIds":["1"],
                "unread":[],
                "lastCheckedAt":"2026-07-14T00:00:00Z"
            }"#,
        )
        .expect("legacy state");
        assert_eq!(store.last_success_at, None);

        merge_posts_at(
            &mut store,
            vec![post("1", "OpenAI", "2026-07-14T00:00:00Z")],
            timestamp("2026-07-15T00:00:00Z"),
            true,
        );

        assert_eq!(store.unread.len(), 1);
        assert_eq!(store.notified_posts.len(), 1);
        let serialized = serde_json::to_string(&store).expect("new state");
        assert!(!serialized.contains("seenIds"));
        assert!(serialized.contains("notifiedPosts"));
        assert!(serialized.contains("lastSuccessAt"));
    }

    #[test]
    fn failed_cycle_advances_checked_time_without_overwriting_last_success() {
        let mut store = PersistedXNotifications::default();
        merge_posts_at(
            &mut store,
            vec![post("1", "OpenAI", "2026-07-14T00:00:00Z")],
            timestamp("2026-07-15T00:00:00Z"),
            true,
        );

        merge_posts_at(
            &mut store,
            Vec::new(),
            timestamp("2026-07-15T00:05:00Z"),
            false,
        );

        assert_eq!(
            store.last_checked_at,
            Some(timestamp("2026-07-15T00:05:00Z"))
        );
        assert_eq!(
            store.last_success_at,
            Some(timestamp("2026-07-15T00:00:00Z"))
        );
    }

    #[test]
    fn taking_notification_returns_exact_status_url_and_marks_only_it_read() {
        let selected = post("123456", "OpenAI", "2026-07-15T00:00:00Z");
        let remaining = post("789012", "sama", "2026-07-15T01:00:00Z");
        let mut store = PersistedXNotifications {
            unread: vec![selected, remaining],
            ..Default::default()
        };

        let item = take_unread_notification(&mut store, "123456").expect("selected item");

        assert_eq!(item.url, "https://x.com/OpenAI/status/123456");
        assert_eq!(
            store
                .unread
                .iter()
                .map(|notification| notification.id.as_str())
                .collect::<Vec<_>>(),
            vec!["789012"]
        );
    }

    #[test]
    fn taking_unknown_notification_leaves_unread_state_unchanged() {
        let mut store = PersistedXNotifications {
            unread: vec![post("123456", "OpenAI", "2026-07-15T00:00:00Z")],
            ..Default::default()
        };

        let error = take_unread_notification(&mut store, "999999").expect_err("missing item");

        assert_eq!(error, "X notification is no longer available");
        assert_eq!(store.unread.len(), 1);
        assert_eq!(store.unread[0].id, "123456");
    }

    #[test]
    fn browser_open_failure_leaves_unread_state_unchanged() {
        let mut store = PersistedXNotifications {
            unread: vec![post("123456", "OpenAI", "2026-07-15T00:00:00Z")],
            ..Default::default()
        };

        let error =
            open_unread_notification(&mut store, "123456", |_| Err("browser unavailable".into()))
                .expect_err("browser failure");

        assert_eq!(error, "browser unavailable");
        assert_eq!(store.unread.len(), 1);
        assert_eq!(store.unread[0].id, "123456");
    }

    #[test]
    fn poll_backoff_uses_the_exact_capped_sequence_and_rate_limit_floor() {
        let cases = [
            (0, false, Duration::from_secs(300)),
            (1, false, Duration::from_secs(30)),
            (2, false, Duration::from_secs(60)),
            (3, false, Duration::from_secs(120)),
            (4, false, Duration::from_secs(240)),
            (5, false, Duration::from_secs(300)),
            (32, false, Duration::from_secs(300)),
            (0, true, Duration::from_secs(900)),
            (4, true, Duration::from_secs(900)),
        ];

        for (failures, saw_429, expected) in cases {
            assert_eq!(next_poll_delay(failures, saw_429), expected);
        }
    }

    #[test]
    fn poll_jitter_spans_ten_percent_and_never_breaks_a_minimum() {
        let delay = Duration::from_secs(100);
        assert_eq!(
            jittered_delay(delay, 0, Duration::ZERO),
            Duration::from_secs(90)
        );
        assert_eq!(
            jittered_delay(delay, 20_000, Duration::ZERO),
            Duration::from_secs(110)
        );
        assert_eq!(
            jittered_delay(RATE_LIMIT_RETRY_MINIMUM, 0, RATE_LIMIT_RETRY_MINIMUM),
            RATE_LIMIT_RETRY_MINIMUM
        );
    }

    #[test]
    fn partial_success_with_rate_limit_uses_success_state_and_rate_limit_floor() {
        let posts = vec![post("123456", "OpenAI", "2026-07-15T00:00:00Z")];
        let errors = vec![codexbar::x_notifications::XNotificationError::Request {
            handle: "OpenAI".into(),
            timeline: "embedded timeline".into(),
            message: "HTTP 429".into(),
        }];

        let (succeeded, saw_429) = classify_refresh(&posts, &errors);

        assert!(succeeded);
        assert!(saw_429);
        assert_eq!(next_poll_delay(0, saw_429), RATE_LIMIT_RETRY_MINIMUM);
    }
}
