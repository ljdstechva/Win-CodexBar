//! Authenticated X GraphQL timeline access.
//!
//! The operation ids and feature switches mirror X's responsive web client.
//! They are intentionally isolated here because X rotates them periodically.
//! Any request failure is surfaced to the caller, which retains the public
//! HTML/syndication pipeline as its fallback for that refresh cycle.

mod transaction_id;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::{
    MAX_PROFILE_BYTES, XNotificationError, XPost, XPostKind, XTimeline, sort_and_dedupe_posts,
};

const GRAPHQL_TIMELINE: XTimeline = XTimeline {
    suffix: "",
    label: "authenticated GraphQL timeline",
};
const PUBLIC_WEB_BEARER_TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=\
     1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const USER_BY_SCREEN_NAME_OPERATION: &str = "UserByScreenName";
const USER_TWEETS_AND_REPLIES_OPERATION: &str = "UserTweetsAndReplies";

/// Observed in X's live responsive-web bundle on 2026-07-24.
pub(super) const CURRENT_QUERY_IDS: GraphQlQueryIds = GraphQlQueryIds {
    user_by_screen_name: "2qvSHpkWTMS9i0zJAwDNiA",
    user_tweets_and_replies: "oIJfrsg7CvLF7zuhvDyYPA",
};

/// Values served in the live X feature-switch bootstrap on 2026-07-24.
const USER_BY_SCREEN_NAME_FEATURES: &str = r#"{
  "hidden_profile_subscriptions_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": true,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "subscriptions_verification_info_is_identity_verified_enabled": true,
  "subscriptions_verification_info_verified_since_enabled": true,
  "highlights_tweets_tab_ui_enabled": true,
  "responsive_web_twitter_article_notes_tab_enabled": true,
  "subscriptions_feature_can_gift_premium": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true
}"#;

/// Values served in the live X feature-switch bootstrap on 2026-07-24.
const USER_TWEETS_AND_REPLIES_FEATURES: &str = r#"{
  "rweb_video_screen_enabled": false,
  "rweb_cashtags_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": true,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
  "responsive_web_grok_analyze_post_followups_enabled": false,
  "rweb_cashtags_composer_attachment_enabled": true,
  "responsive_web_jetfuel_frame": true,
  "responsive_web_grok_share_attachment_enabled": true,
  "responsive_web_grok_annotations_enabled": true,
  "articles_preview_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "rweb_conversational_replies_downvote_enabled": false,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "content_disclosure_indicator_enabled": true,
  "content_disclosure_ai_generated_indicator_enabled": true,
  "responsive_web_grok_show_grok_translated_post": true,
  "responsive_web_grok_analysis_button_from_backend": true,
  "post_ctas_fetch_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": false,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_grok_imagine_annotation_enabled": true,
  "responsive_web_grok_community_note_auto_translation_is_enabled": true,
  "responsive_web_enhance_cards_enabled": false
}"#;

const USER_BY_SCREEN_NAME_FIELD_TOGGLES: &str = r#"{
  "withPayments": false,
  "withAuxiliaryUserLabels": false
}"#;

const USER_TWEETS_AND_REPLIES_FIELD_TOGGLES: &str = r#"{
  "withPayments": false,
  "withAuxiliaryUserLabels": false,
  "withArticleRichContentState": true,
  "withArticlePlainText": false,
  "withArticleSummaryText": false,
  "withArticleVoiceOver": false,
  "withGrokAnalyze": false,
  "withDisallowedReplyControls": false
}"#;

static USER_ID_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static TRANSACTION_MATERIAL: OnceLock<Mutex<Option<transaction_id::TransactionIdMaterial>>> =
    OnceLock::new();

#[derive(Clone, Copy)]
pub(super) struct GraphQlQueryIds {
    pub(super) user_by_screen_name: &'static str,
    pub(super) user_tweets_and_replies: &'static str,
}

/// An authenticated X web session. Deliberately does not implement `Debug` so
/// neither the cookie header nor CSRF value can be printed accidentally.
#[derive(Clone)]
pub(super) struct GraphQlSession {
    cookie_header: String,
    csrf_token: String,
}

impl GraphQlSession {
    pub(super) fn from_cookie_header(cookie_header: &str) -> Option<Self> {
        let cookies = cookie_pairs(cookie_header);
        let has_auth_token = cookies
            .get("auth_token")
            .is_some_and(|value| !value.is_empty());
        let csrf_token = cookies.get("ct0").filter(|value| !value.is_empty())?;
        has_auth_token.then(|| Self {
            cookie_header: cookie_header.to_string(),
            csrf_token: csrf_token.to_string(),
        })
    }
}

async fn transaction_material(
    client: &reqwest::Client,
    session: &GraphQlSession,
    handle: &str,
) -> Result<transaction_id::TransactionIdMaterial, XNotificationError> {
    let cache = TRANSACTION_MATERIAL.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock()
        && let Some(material) = guard.as_ref()
    {
        return Ok(material.clone());
    }

    let home_html = fetch_transaction_document(
        client,
        handle,
        "https://x.com",
        Some(&session.cookie_header),
    )
    .await?;
    let ondemand_url = transaction_id::extract_ondemand_url(&home_html)
        .map_err(|message| transaction_material_error(handle, message))?;
    let ondemand_js = fetch_transaction_document(client, handle, &ondemand_url, None).await?;
    let material = transaction_id::TransactionIdMaterial::from_documents(&home_html, &ondemand_js)
        .map_err(|message| transaction_material_error(handle, message))?;

    if let Ok(mut guard) = cache.lock() {
        *guard = Some(material.clone());
    }
    Ok(material)
}

async fn fetch_transaction_document(
    client: &reqwest::Client,
    handle: &str,
    url: &str,
    cookie_header: Option<&str>,
) -> Result<String, XNotificationError> {
    let mut request = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/javascript;q=0.9,*/*;q=0.8",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9");
    if let Some(cookie_header) = cookie_header {
        request = request.header(reqwest::header::COOKIE, cookie_header);
    }
    let response = request
        .send()
        .await
        .map_err(|error| request_error(handle, error))?;
    if !response.status().is_success() {
        return Err(transaction_material_error(
            handle,
            format!("HTTP {}", response.status().as_u16()),
        ));
    }
    if response.content_length().unwrap_or(0) > MAX_PROFILE_BYTES as u64 {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        });
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| request_error(handle, error))?;
    if bytes.len() > MAX_PROFILE_BYTES {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        });
    }
    String::from_utf8(bytes.to_vec())
        .map_err(|_| transaction_material_error(handle, "invalid UTF-8 response"))
}

fn transaction_material_error(handle: &str, message: impl Into<String>) -> XNotificationError {
    XNotificationError::Request {
        handle: handle.to_string(),
        timeline: GRAPHQL_TIMELINE.label.to_string(),
        message: format!("transaction bootstrap: {}", message.into()),
    }
}

pub(super) async fn fetch_profile(
    client: &reqwest::Client,
    session: &GraphQlSession,
    handle: &str,
    query_ids: GraphQlQueryIds,
) -> Result<Vec<XPost>, XNotificationError> {
    let transaction = transaction_material(client, session, handle).await?;
    let user_id = match cached_user_id(handle) {
        Some(user_id) => user_id,
        None => {
            let user_id = fetch_user_id(
                client,
                session,
                &transaction,
                handle,
                query_ids.user_by_screen_name,
            )
            .await?;
            cache_user_id(handle, &user_id);
            user_id
        }
    };
    let root = request_graphql(
        client,
        session,
        &transaction,
        handle,
        query_ids.user_tweets_and_replies,
        USER_TWEETS_AND_REPLIES_OPERATION,
        json!({
            "userId": user_id,
            "count": 40,
            "includePromotedContent": true,
            "withCommunity": true,
            "withVoice": true
        }),
        USER_TWEETS_AND_REPLIES_FEATURES,
        USER_TWEETS_AND_REPLIES_FIELD_TOGGLES,
    )
    .await?;
    let mut posts = parse_tweets_and_replies(handle, &user_id, &root);
    sort_and_dedupe_posts(&mut posts);
    if posts.is_empty() {
        return Err(XNotificationError::TimelineUnavailable {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        });
    }
    Ok(posts)
}

async fn fetch_user_id(
    client: &reqwest::Client,
    session: &GraphQlSession,
    transaction: &transaction_id::TransactionIdMaterial,
    handle: &str,
    query_id: &str,
) -> Result<String, XNotificationError> {
    let root = request_graphql(
        client,
        session,
        transaction,
        handle,
        query_id,
        USER_BY_SCREEN_NAME_OPERATION,
        json!({
            "screen_name": handle,
            "withGrokTranslatedBio": false
        }),
        USER_BY_SCREEN_NAME_FEATURES,
        USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    )
    .await?;
    root.pointer("/data/user/result/rest_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| XNotificationError::TimelineUnavailable {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        })
}

#[allow(clippy::too_many_arguments)]
async fn request_graphql(
    client: &reqwest::Client,
    session: &GraphQlSession,
    transaction: &transaction_id::TransactionIdMaterial,
    handle: &str,
    query_id: &str,
    operation: &str,
    variables: Value,
    features: &str,
    field_toggles: &str,
) -> Result<Value, XNotificationError> {
    let path = format!("/i/api/graphql/{query_id}/{operation}");
    let url = format!("https://x.com{path}");
    let transaction_id = transaction.generate("GET", &path);
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {PUBLIC_WEB_BEARER_TOKEN}"),
        )
        .header(reqwest::header::COOKIE, &session.cookie_header)
        .header("x-csrf-token", &session.csrf_token)
        .header("x-twitter-auth-type", "OAuth2Session")
        .header("x-twitter-active-user", "yes")
        .header("x-twitter-client-language", "en")
        .header("x-client-transaction-id", transaction_id)
        .query(&[
            ("variables", variables.to_string()),
            ("features", features.to_string()),
            ("fieldToggles", field_toggles.to_string()),
        ])
        .send()
        .await
        .map_err(|error| request_error(handle, error))?;
    if !response.status().is_success() {
        return Err(XNotificationError::Request {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
            message: format!("HTTP {}", response.status().as_u16()),
        });
    }
    if response.content_length().unwrap_or(0) > MAX_PROFILE_BYTES as u64 {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        });
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| request_error(handle, error))?;
    if bytes.len() > MAX_PROFILE_BYTES {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: GRAPHQL_TIMELINE.label.to_string(),
        });
    }
    serde_json::from_slice(&bytes).map_err(|_| XNotificationError::TimelineUnavailable {
        handle: handle.to_string(),
        timeline: GRAPHQL_TIMELINE.label.to_string(),
    })
}

fn request_error(handle: &str, error: impl std::fmt::Display) -> XNotificationError {
    XNotificationError::Request {
        handle: handle.to_string(),
        timeline: GRAPHQL_TIMELINE.label.to_string(),
        message: error.to_string(),
    }
}

fn cookie_pairs(cookie_header: &str) -> HashMap<&str, &str> {
    cookie_header
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .map(|(name, value)| (name.trim(), value.trim()))
        .collect()
}

fn cached_user_id(handle: &str) -> Option<String> {
    USER_ID_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&handle.to_ascii_lowercase())
        .cloned()
}

fn cache_user_id(handle: &str, user_id: &str) {
    USER_ID_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(handle.to_ascii_lowercase(), user_id.to_string());
}

#[cfg(test)]
pub(super) fn clear_cached_user_id(handle: &str) {
    USER_ID_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&handle.to_ascii_lowercase());
}

pub(super) fn parse_tweets_and_replies(
    handle: &str,
    target_user_id: &str,
    root: &Value,
) -> Vec<XPost> {
    let mut tweet_results = Vec::new();
    collect_tweet_results(root, &mut tweet_results);
    let mut posts = tweet_results
        .into_iter()
        .filter_map(|result| parse_tweet_result(handle, target_user_id, result))
        .collect::<Vec<_>>();
    sort_and_dedupe_posts(&mut posts);
    posts
}

fn collect_tweet_results<'a>(value: &'a Value, results: &mut Vec<&'a Value>) {
    match value {
        Value::Object(object) => {
            if let Some(result) = object
                .get("tweet_results")
                .and_then(|value| value.get("result"))
            {
                results.push(result);
            }
            for child in object.values() {
                collect_tweet_results(child, results);
            }
        }
        Value::Array(array) => {
            for child in array {
                collect_tweet_results(child, results);
            }
        }
        _ => {}
    }
}

fn parse_tweet_result(handle: &str, target_user_id: &str, result: &Value) -> Option<XPost> {
    let result = if result
        .get("__typename")
        .and_then(Value::as_str)
        .is_some_and(|name| name == "TweetWithVisibilityResults")
    {
        result.get("tweet")?
    } else {
        result
    };
    let id = result.get("rest_id").and_then(Value::as_str)?;
    let author = result.pointer("/core/user_results/result")?;
    let author_id = author.get("rest_id").and_then(Value::as_str)?;
    if author_id != target_user_id {
        return None;
    }
    let legacy = result.get("legacy")?;
    let legacy_text = legacy
        .get("full_text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let note_text = result
        .pointer("/note_tweet/note_tweet_results/result/text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let text = if note_text.len() > legacy_text.len() {
        note_text
    } else {
        legacy_text
    }
    .trim();
    if text.is_empty() {
        return None;
    }
    let created_at = legacy
        .get("created_at")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_str(value, "%a %b %d %H:%M:%S %z %Y").ok())?
        .with_timezone(&Utc);
    let is_repost = legacy
        .get("retweeted_status_result")
        .is_some_and(|value| !value.is_null())
        || result
            .get("retweeted_status_result")
            .is_some_and(|value| !value.is_null());
    let is_reply = legacy
        .get("in_reply_to_status_id_str")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty());
    let kind = if is_repost {
        XPostKind::Repost
    } else if is_reply {
        XPostKind::Reply
    } else {
        XPostKind::Post
    };
    let screen_name = author
        .pointer("/legacy/screen_name")
        .or_else(|| author.pointer("/core/screen_name"))
        .and_then(Value::as_str)
        .unwrap_or(handle);
    let display_name = author
        .pointer("/legacy/name")
        .or_else(|| author.pointer("/core/name"))
        .and_then(Value::as_str)
        .unwrap_or(handle);
    let avatar_url = author
        .pointer("/legacy/profile_image_url_https")
        .or_else(|| author.pointer("/avatar/image_url"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Some(XPost {
        id: id.to_string(),
        handle: handle.to_string(),
        display_name: display_name.to_string(),
        text: text.to_string(),
        created_at,
        url: format!("https://x.com/{screen_name}/status/{id}"),
        avatar_url,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SANITIZED_GRAPHQL_FIXTURE: &str =
        include_str!("../../tests/fixtures/x_user_tweets_and_replies_sanitized.json");

    #[test]
    fn extracts_only_complete_authenticated_session_without_debug_output() {
        assert!(GraphQlSession::from_cookie_header("guest_id=one; ct0=csrf").is_none());
        assert!(GraphQlSession::from_cookie_header("auth_token=session; guest_id=one").is_none());
        let session = GraphQlSession::from_cookie_header(
            "guest_id=one; auth_token=session; ct0=csrf-value; lang=en",
        )
        .expect("authenticated session");
        assert_eq!(session.csrf_token, "csrf-value");
    }

    #[test]
    fn current_operation_ids_and_feature_payloads_are_explicit() {
        assert_eq!(
            CURRENT_QUERY_IDS.user_by_screen_name,
            "2qvSHpkWTMS9i0zJAwDNiA"
        );
        assert_eq!(
            CURRENT_QUERY_IDS.user_tweets_and_replies,
            "oIJfrsg7CvLF7zuhvDyYPA"
        );
        for payload in [
            USER_BY_SCREEN_NAME_FEATURES,
            USER_TWEETS_AND_REPLIES_FEATURES,
            USER_BY_SCREEN_NAME_FIELD_TOGGLES,
            USER_TWEETS_AND_REPLIES_FIELD_TOGGLES,
        ] {
            assert!(serde_json::from_str::<Value>(payload).is_ok());
        }
    }

    #[test]
    fn captured_fixture_excludes_foreign_conversation_authors() {
        let root = serde_json::from_str::<Value>(SANITIZED_GRAPHQL_FIXTURE).expect("fixture");
        let posts = parse_tweets_and_replies("target", "100", &root);

        assert_eq!(posts.len(), 2);
        assert!(posts.iter().all(|post| post.handle == "target"));
        assert!(posts.iter().all(|post| post.id != "foreign-1"));
        assert_eq!(posts[0].id, "target-note");
        assert_eq!(
            posts[0].text,
            "This is the longer note-tweet text from the target author."
        );
        assert_eq!(posts[1].kind, XPostKind::Reply);
    }

    #[test]
    fn repost_marker_takes_precedence_over_reply_marker() {
        let root = json!({
            "tweet_results": {
                "result": {
                    "__typename": "Tweet",
                    "rest_id": "repost-1",
                    "core": {"user_results": {"result": {
                        "rest_id": "100",
                        "core": {"screen_name": "target", "name": "Target"}
                    }}},
                    "legacy": {
                        "created_at": "Thu Jul 23 10:00:00 +0000 2026",
                        "full_text": "RT @someone: text",
                        "in_reply_to_status_id_str": "parent",
                        "retweeted_status_result": {"result": {"rest_id": "original"}}
                    }
                }
            }
        });
        let posts = parse_tweets_and_replies("target", "100", &root);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].kind, XPostKind::Repost);
    }
}
