//! Best-effort X profile monitoring for the Windows tray dashboard.
//!
//! X profile pages currently ship a React Flight payload containing the
//! visible profile timeline. We parse only the small, stable subset needed by
//! the notification surface: author identity, post id, text, and timestamp.
//! Public access is attempted first; if X serves a login/interstitial page, a
//! locally logged-in browser session is retried without ever persisting or
//! logging the cookie header.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

const MAX_PROFILE_BYTES: usize = 5 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/126.0 Safari/537.36 CodexBar/0.42";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct XTimeline {
    suffix: &'static str,
    label: &'static str,
}

const PROFILE_TIMELINES: [XTimeline; 2] = [
    XTimeline {
        suffix: "",
        label: "posts",
    },
    XTimeline {
        suffix: "/with_replies",
        label: "replies",
    },
];
const SYNDICATION_TIMELINE: XTimeline = XTimeline {
    suffix: "",
    label: "embedded timeline",
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct XWatchTarget {
    pub handle: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XPost {
    pub id: String,
    pub handle: String,
    pub display_name: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
    pub url: String,
    pub avatar_url: Option<String>,
    pub kind: XPostKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XPostKind {
    Post,
    Reply,
    Repost,
}

#[derive(Debug, thiserror::Error)]
pub enum XNotificationError {
    #[error("X {timeline} request failed for @{handle}: {message}")]
    Request {
        handle: String,
        timeline: String,
        message: String,
    },
    #[error("X returned too much {timeline} data for @{handle}")]
    ResponseTooLarge { handle: String, timeline: String },
    #[error("X did not return a readable {timeline} timeline for @{handle}")]
    TimelineUnavailable { handle: String, timeline: String },
}

impl XNotificationError {
    pub fn is_rate_limited(&self) -> bool {
        matches!(
            self,
            Self::Request { message, .. } if message == "HTTP 429"
        )
    }
}

#[derive(Debug)]
struct Assignment<'a> {
    key: &'a str,
    body: &'a str,
}

/// Fetch all watched profiles concurrently. A failed profile does not hide
/// successful profiles; callers receive both the posts and readable errors.
pub async fn fetch_watchlist(targets: &[XWatchTarget]) -> (Vec<XPost>, Vec<XNotificationError>) {
    let futures = targets
        .iter()
        .map(|target| fetch_profile_timelines(target.handle));
    let mut posts = Vec::new();
    let mut errors = Vec::new();
    for (mut profile_posts, mut profile_errors) in futures::future::join_all(futures).await {
        posts.append(&mut profile_posts);
        errors.append(&mut profile_errors);
    }
    sort_and_dedupe_posts(&mut posts);
    (posts, errors)
}

pub async fn fetch_profile(handle: &str) -> Result<Vec<XPost>, XNotificationError> {
    let (posts, mut errors) = fetch_profile_timelines(handle).await;
    if posts.is_empty() {
        Err(errors
            .drain(..)
            .next()
            .unwrap_or_else(|| timeline_unavailable(handle, PROFILE_TIMELINES[0])))
    } else {
        Ok(posts)
    }
}

async fn fetch_profile_timelines(handle: &str) -> (Vec<XPost>, Vec<XNotificationError>) {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| request_error(handle, PROFILE_TIMELINES[0], error));
    let client = match client {
        Ok(client) => client,
        Err(error) => return (Vec::new(), vec![error]),
    };

    let public_futures = futures::future::join_all(
        PROFILE_TIMELINES
            .iter()
            .copied()
            .map(|timeline| fetch_profile_html(&client, handle, timeline, None)),
    );
    let (public_results, syndication_result) =
        tokio::join!(public_futures, fetch_syndication_html(&client, handle));
    let mut posts = Vec::new();
    let mut missing = Vec::new();
    for (timeline, result) in PROFILE_TIMELINES.into_iter().zip(public_results) {
        match result {
            Ok(html) => {
                let mut timeline_posts = parse_profile_html(handle, &html);
                if timeline_posts.is_empty() {
                    missing.push((timeline, timeline_unavailable(handle, timeline)));
                } else {
                    posts.append(&mut timeline_posts);
                }
            }
            Err(error) => missing.push((timeline, error)),
        }
    }
    let mut syndication_error = None;
    match syndication_result {
        Ok(html) => {
            let mut timeline_posts = parse_syndication_html(handle, &html);
            remove_syndication_covered_timelines(handle, &timeline_posts, &mut missing);
            posts.append(&mut timeline_posts);
        }
        Err(error) => syndication_error = Some(error),
    }

    // Browser cookie extraction can touch locked browser databases, so keep it
    // off the async runtime thread. The value is used only for missing
    // timelines and is never persisted or logged.
    let cookie_header = if missing.is_empty() {
        None
    } else {
        tokio::task::spawn_blocking(|| {
            crate::browser::cookies::get_cookie_header_for_domains(&["x.com", "twitter.com"]).ok()
        })
        .await
        .ok()
        .flatten()
    };

    let mut errors = Vec::new();
    if let Some(cookie_header) = cookie_header {
        for (timeline, _public_error) in missing {
            match fetch_profile_html(&client, handle, timeline, Some(&cookie_header)).await {
                Ok(html) => {
                    let mut timeline_posts = parse_profile_html(handle, &html);
                    if timeline_posts.is_empty() {
                        errors.push(timeline_unavailable(handle, timeline));
                    } else {
                        posts.append(&mut timeline_posts);
                    }
                }
                Err(error) => errors.push(error),
            }
        }
    } else {
        errors.extend(missing.into_iter().map(|(_, error)| error));
    }

    finalize_profile_fetch(posts, errors, syndication_error)
}

async fn fetch_syndication_html(
    client: &reqwest::Client,
    handle: &str,
) -> Result<String, XNotificationError> {
    // The embed endpoint currently ignores `showReplies=true` (verified by the
    // ignored live watchlist probe), so use its stable URL and let the explicit
    // `/with_replies` timeline plus cookie fallback supply authored replies.
    let url = format!("https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}");
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|error| request_error(handle, SYNDICATION_TIMELINE, error))?;
    if !response.status().is_success() {
        return Err(XNotificationError::Request {
            handle: handle.to_string(),
            timeline: SYNDICATION_TIMELINE.label.to_string(),
            message: format!("HTTP {}", response.status().as_u16()),
        });
    }
    if response.content_length().unwrap_or(0) > MAX_PROFILE_BYTES as u64 {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: SYNDICATION_TIMELINE.label.to_string(),
        });
    }
    let body = response
        .text()
        .await
        .map_err(|error| request_error(handle, SYNDICATION_TIMELINE, error))?;
    if body.len() > MAX_PROFILE_BYTES {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: SYNDICATION_TIMELINE.label.to_string(),
        });
    }
    Ok(body)
}

async fn fetch_profile_html(
    client: &reqwest::Client,
    handle: &str,
    timeline: XTimeline,
    cookie_header: Option<&str>,
) -> Result<String, XNotificationError> {
    let url = format!("https://x.com/{handle}{}", timeline.suffix);
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9");
    if let Some(cookie_header) = cookie_header {
        request = request.header(reqwest::header::COOKIE, cookie_header);
    }
    let response = request
        .send()
        .await
        .map_err(|error| request_error(handle, timeline, error))?;
    if !response.status().is_success() {
        return Err(XNotificationError::Request {
            handle: handle.to_string(),
            timeline: timeline.label.to_string(),
            message: format!("HTTP {}", response.status().as_u16()),
        });
    }
    if response.content_length().unwrap_or(0) > MAX_PROFILE_BYTES as u64 {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: timeline.label.to_string(),
        });
    }
    let body = response
        .text()
        .await
        .map_err(|error| request_error(handle, timeline, error))?;
    if body.len() > MAX_PROFILE_BYTES {
        return Err(XNotificationError::ResponseTooLarge {
            handle: handle.to_string(),
            timeline: timeline.label.to_string(),
        });
    }
    Ok(body)
}

fn request_error(
    handle: &str,
    timeline: XTimeline,
    error: impl std::fmt::Display,
) -> XNotificationError {
    XNotificationError::Request {
        handle: handle.to_string(),
        timeline: timeline.label.to_string(),
        message: error.to_string(),
    }
}

fn timeline_unavailable(handle: &str, timeline: XTimeline) -> XNotificationError {
    XNotificationError::TimelineUnavailable {
        handle: handle.to_string(),
        timeline: timeline.label.to_string(),
    }
}

fn sort_and_dedupe_posts(posts: &mut Vec<XPost>) {
    posts.sort_by_key(|post| std::cmp::Reverse(post.created_at));
    let mut ids = HashSet::new();
    posts.retain(|post| ids.insert(post.id.clone()));
}

fn finalize_profile_fetch(
    mut posts: Vec<XPost>,
    mut errors: Vec<XNotificationError>,
    syndication_error: Option<XNotificationError>,
) -> (Vec<XPost>, Vec<XNotificationError>) {
    if let Some(error) = syndication_error {
        errors.push(error);
    }
    sort_and_dedupe_posts(&mut posts);
    (posts, errors)
}

fn remove_syndication_covered_timelines(
    handle: &str,
    syndication_posts: &[XPost],
    missing: &mut Vec<(XTimeline, XNotificationError)>,
) {
    let includes_authored_reply = syndication_posts
        .iter()
        .any(|post| post.handle.eq_ignore_ascii_case(handle) && post.kind == XPostKind::Reply);
    if includes_authored_reply {
        missing.retain(|(timeline, _)| timeline.label != "replies");
    }
}

/// Parse the assignment stream embedded in X's React Flight response.
/// Unknown fields are ignored so the parser remains narrow and resilient.
pub fn parse_profile_html(handle: &str, html: &str) -> Vec<XPost> {
    let assignments = assignments(html);
    let mut target_user_ref = None;
    let mut display_name = handle.to_string();

    for assignment in &assignments {
        if !assignment.body.contains("__typename:\"UserCore\"") {
            continue;
        }
        let Some(screen_name) = string_field(assignment.body, "screen_name") else {
            continue;
        };
        if !screen_name.eq_ignore_ascii_case(handle) {
            continue;
        }
        if let Some(user_ref) = assignment
            .key
            .strip_prefix("client:")
            .and_then(|key| key.strip_suffix(":core"))
        {
            target_user_ref = Some(user_ref.to_string());
            display_name = string_field(assignment.body, "name").unwrap_or(screen_name);
            break;
        }
    }
    let Some(target_user_ref) = target_user_ref else {
        return Vec::new();
    };

    let user_result_refs: HashSet<&str> = assignments
        .iter()
        .filter(|assignment| {
            assignment.body.contains("__typename:\"UserResults\"")
                && assignment
                    .body
                    .contains(&format!("__ref:\"{target_user_ref}\""))
        })
        .map(|assignment| assignment.key)
        .collect();

    let tweet_refs: HashSet<String> = assignments
        .iter()
        .filter(|assignment| assignment.body.contains("__typename:\"TweetCore\""))
        .filter(|assignment| {
            user_result_refs
                .iter()
                .any(|reference| assignment.body.contains(&format!("__ref:\"{reference}\"")))
        })
        .filter_map(|assignment| {
            assignment
                .key
                .strip_prefix("client:")
                .and_then(|key| key.strip_suffix(":core"))
                .map(str::to_string)
        })
        .collect();

    let avatar_url = assignments
        .iter()
        .find(|assignment| {
            assignment.key == format!("client:{target_user_ref}:avatar")
                && assignment.body.contains("__typename:\"UserAvatar\"")
        })
        .and_then(|assignment| string_field(assignment.body, "image_url"));

    let tweet_ids: HashMap<&str, String> = assignments
        .iter()
        .filter(|assignment| {
            tweet_refs.contains(assignment.key) && assignment.body.contains("__typename:\"Tweet\"")
        })
        .filter_map(|assignment| {
            string_field(assignment.body, "rest_id").map(|id| (assignment.key, id))
        })
        .collect();

    let mut posts = Vec::new();
    for tweet_ref in tweet_refs {
        let Some(id) = tweet_ids.get(tweet_ref.as_str()).cloned() else {
            continue;
        };
        let details_key = format!("client:{tweet_ref}:details");
        let Some(details) = assignments.iter().find(|assignment| {
            assignment.key == details_key && assignment.body.contains("__typename:\"TBirdData\"")
        }) else {
            continue;
        };
        let Some(created_at_ms) = integer_field(details.body, "created_at_ms") else {
            continue;
        };
        let Some(created_at) = Utc.timestamp_millis_opt(created_at_ms).single() else {
            continue;
        };
        let mut text = string_field(details.body, "full_text").unwrap_or_default();
        if let Some(note_text) = assignments
            .iter()
            .find(|assignment| assignment.key == format!("client:{tweet_ref}:note_tweet"))
            .and_then(|assignment| string_field(assignment.body, "text"))
            .filter(|note| note.len() > text.len())
        {
            text = note_text;
        }
        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let kind = if text.starts_with("RT @") {
            XPostKind::Repost
        } else if string_field(details.body, "in_reply_to_status_id_str").is_some()
            || text.starts_with('@')
        {
            XPostKind::Reply
        } else {
            XPostKind::Post
        };
        posts.push(XPost {
            id: id.clone(),
            handle: handle.to_string(),
            display_name: display_name.clone(),
            text,
            created_at,
            url: format!("https://x.com/{handle}/status/{id}"),
            avatar_url: avatar_url.clone(),
            kind,
        });
    }
    sort_and_dedupe_posts(&mut posts);
    posts
}

/// Parse the public embedded-profile payload. X's embed service uses a
/// separate JSON representation from the main React Flight page and can
/// include authored replies that the default profile tab omits.
pub fn parse_syndication_html(handle: &str, html: &str) -> Vec<XPost> {
    const OPEN: &str = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
    const CLOSE: &str = "</script>";
    let Some(json_start) = html.find(OPEN).map(|index| index + OPEN.len()) else {
        return Vec::new();
    };
    let Some(json_end) = html[json_start..]
        .find(CLOSE)
        .map(|index| json_start + index)
    else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&html[json_start..json_end]) else {
        return Vec::new();
    };
    let Some(entries) = root
        .pointer("/props/pageProps/timeline/entries")
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };

    let mut posts = Vec::new();
    for entry in entries {
        let Some(tweet) = entry.pointer("/content/tweet") else {
            continue;
        };
        let Some(screen_name) = tweet
            .pointer("/user/screen_name")
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        if !screen_name.eq_ignore_ascii_case(handle) {
            continue;
        }
        let Some(id) = tweet.get("id_str").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Some(text) = tweet
            .get("full_text")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        else {
            continue;
        };
        let Some(created_at) = tweet
            .get("created_at")
            .and_then(serde_json::Value::as_str)
            .and_then(|value| DateTime::parse_from_str(value, "%a %b %d %H:%M:%S %z %Y").ok())
            .map(|value| value.with_timezone(&Utc))
        else {
            continue;
        };
        let is_reply = tweet
            .get("in_reply_to_status_id_str")
            .is_some_and(|value| !value.is_null());
        let kind = if tweet
            .get("retweeted_status")
            .is_some_and(|value| !value.is_null())
            || text.starts_with("RT @")
        {
            XPostKind::Repost
        } else if is_reply {
            XPostKind::Reply
        } else {
            XPostKind::Post
        };
        posts.push(XPost {
            id: id.to_string(),
            handle: handle.to_string(),
            display_name: tweet
                .pointer("/user/name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(handle)
                .to_string(),
            text: text.to_string(),
            created_at,
            url: format!("https://x.com/{handle}/status/{id}"),
            avatar_url: tweet
                .pointer("/user/profile_image_url_https")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            kind,
        });
    }
    sort_and_dedupe_posts(&mut posts);
    posts
}

fn assignments(input: &str) -> Vec<Assignment<'_>> {
    let bytes = input.as_bytes();
    let mut parsed = Vec::new();
    let mut search_from = 0;
    while let Some(relative) = input[search_from..].find(":$R[") {
        let colon = search_from + relative;
        let Some(key) = assignment_key(input, colon) else {
            search_from = colon + 4;
            continue;
        };
        let Some(open_relative) = input[colon..].find("]={") else {
            break;
        };
        let open = colon + open_relative + 2;
        let Some(close) = matching_brace(bytes, open) else {
            search_from = open + 1;
            continue;
        };
        parsed.push(Assignment {
            key,
            body: &input[open + 1..close],
        });
        // Keep scanning inside the just-parsed body. React Flight nests its
        // relay-record assignments under a larger dehydratedData assignment;
        // jumping to the outer closing brace would hide every tweet record.
        search_from = colon + 4;
    }
    parsed
}

fn assignment_key(input: &str, colon: usize) -> Option<&str> {
    let bytes = input.as_bytes();
    if colon == 0 {
        return None;
    }
    if bytes[colon - 1] == b'"' {
        let mut index = colon - 1;
        while index > 0 {
            index -= 1;
            if bytes[index] == b'"' && (index == 0 || bytes[index - 1] != b'\\') {
                return Some(&input[index + 1..colon - 1]);
            }
        }
        return None;
    }
    let mut start = colon;
    while start > 0
        && matches!(
            bytes[start - 1],
            b'a'..=b'z'
                | b'A'..=b'Z'
                | b'0'..=b'9'
                | b'_'
                | b'-'
                | b'+'
                | b'/'
                | b'='
        )
    {
        start -= 1;
    }
    (start < colon).then_some(&input[start..colon])
}

fn matching_brace(bytes: &[u8], open: usize) -> Option<usize> {
    if bytes.get(open) != Some(&b'{') {
        return None;
    }
    let mut depth = 0_u32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, byte) in bytes.iter().enumerate().skip(open) {
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match *byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn string_field(body: &str, field: &str) -> Option<String> {
    let marker = format!("{field}:\"");
    let start = field_start(body, &marker)? + marker.len();
    let bytes = body.as_bytes();
    let mut escaped = false;
    for index in start..bytes.len() {
        if escaped {
            escaped = false;
            continue;
        }
        if bytes[index] == b'\\' {
            escaped = true;
        } else if bytes[index] == b'"' {
            let raw = &body[start..index];
            return serde_json::from_str::<String>(&format!("\"{raw}\"")).ok();
        }
    }
    None
}

fn integer_field(body: &str, field: &str) -> Option<i64> {
    let marker = format!("{field}:");
    let start = field_start(body, &marker)? + marker.len();
    let digits = body[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '-')
        .collect::<String>();
    digits.parse().ok()
}

fn field_start(body: &str, marker: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(relative) = body[search_from..].find(marker) {
        let start = search_from + relative;
        if start == 0 || body.as_bytes().get(start.wrapping_sub(1)) == Some(&b',') {
            return Some(start);
        }
        search_from = start + marker.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
      "client:USER:core":$R[1]={__id:"client:USER:core",__typename:"UserCore",name:"Sample User",screen_name:"sample",created_at_ms:1},
      "client:USER:avatar":$R[2]={__id:"client:USER:avatar",__typename:"UserAvatar",image_url:"https://example.test/avatar.jpg"},
      "USER_RESULTS":$R[3]={__id:"USER_RESULTS",__typename:"UserResults",result:$R[4]={__ref:"USER"}},
      "client:TWEET:core":$R[5]={__id:"client:TWEET:core",__typename:"TweetCore",user_results:$R[6]={__ref:"USER_RESULTS"}},
      "TWEET":$R[7]={__id:"TWEET",__typename:"Tweet",rest_id:"123456",counts:$R[8]={__ref:"counts"}},
      "client:TWEET:details":$R[9]={__id:"client:TWEET:details",__typename:"TBirdData",created_at_ms:1783900000000,in_reply_to_status_id_str:"42",display_text_range:$R[10]=[0,20],full_text:"Hello \"world\"\nSecond line",hashtag_entities:$R[11]={__refs:$R[12]=[]}}
    "#;

    const SYNDICATION_SAMPLE: &str = r#"
      <script id="__NEXT_DATA__" type="application/json">{
        "props":{"pageProps":{"timeline":{"entries":[
          {"content":{"tweet":{
            "id_str":"222",
            "created_at":"Tue Jul 14 08:30:00 +0000 2026",
            "full_text":"A reply without a leading mention",
            "in_reply_to_status_id_str":"111",
            "user":{"screen_name":"sample","name":"Sample User","profile_image_url_https":"https://example.test/avatar.jpg"}
          }}},
          {"content":{"tweet":{
            "id_str":"333",
            "created_at":"Tue Jul 14 09:30:00 +0000 2026",
            "full_text":"Another person's reply",
            "in_reply_to_status_id_str":"222",
            "user":{"screen_name":"someone_else","name":"Someone Else"}
          }}}
        ]}}}
      }</script>
    "#;

    #[test]
    fn parses_target_authored_reply() {
        let posts = parse_profile_html("sample", SAMPLE);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "123456");
        assert_eq!(posts[0].display_name, "Sample User");
        assert_eq!(posts[0].kind, XPostKind::Reply);
        assert!(
            posts[0].text.contains("Second line"),
            "parsed text: {:?}",
            posts[0].text
        );
        assert_eq!(posts[0].url, "https://x.com/sample/status/123456");
    }

    #[test]
    fn rejects_posts_authored_by_another_user() {
        assert!(parse_profile_html("someone-else", SAMPLE).is_empty());
    }

    #[test]
    fn assignment_parser_handles_nested_reference_objects() {
        let parsed = assignments(SAMPLE);
        let details = parsed
            .iter()
            .find(|assignment| assignment.key == "client:TWEET:details")
            .expect("details assignment");
        assert!(details.body.contains("full_text:"));
        assert!(details.body.contains("hashtag_entities:"));
    }

    #[test]
    fn parses_only_target_authored_replies_from_syndication_payload() {
        let posts = parse_syndication_html("sample", SYNDICATION_SAMPLE);
        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].id, "222");
        assert_eq!(posts[0].kind, XPostKind::Reply);
        assert_eq!(posts[0].display_name, "Sample User");
        assert_eq!(posts[0].url, "https://x.com/sample/status/222");
    }

    #[test]
    fn syndication_without_replies_keeps_replies_timeline_missing() {
        let mut missing = vec![(
            PROFILE_TIMELINES[1],
            timeline_unavailable("sample", PROFILE_TIMELINES[1]),
        )];
        let posts = vec![XPost {
            id: "111".into(),
            handle: "sample".into(),
            display_name: "Sample User".into(),
            text: "A regular post".into(),
            created_at: Utc.timestamp_opt(0, 0).single().unwrap(),
            url: "https://x.com/sample/status/111".into(),
            avatar_url: None,
            kind: XPostKind::Post,
        }];

        remove_syndication_covered_timelines("sample", &posts, &mut missing);

        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].0.label, "replies");
    }

    #[test]
    fn syndication_authored_reply_covers_replies_timeline() {
        let mut missing = vec![(
            PROFILE_TIMELINES[1],
            timeline_unavailable("sample", PROFILE_TIMELINES[1]),
        )];
        let posts = parse_syndication_html("sample", SYNDICATION_SAMPLE);

        remove_syndication_covered_timelines("sample", &posts, &mut missing);

        assert!(missing.is_empty());
    }

    #[test]
    fn partial_success_preserves_syndication_rate_limit_error() {
        let posts = parse_profile_html("sample", SAMPLE);
        let rate_limit = XNotificationError::Request {
            handle: "sample".into(),
            timeline: SYNDICATION_TIMELINE.label.into(),
            message: "HTTP 429".into(),
        };

        let (posts, errors) = finalize_profile_fetch(posts, Vec::new(), Some(rate_limit));

        assert_eq!(posts.len(), 1);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].is_rate_limited());
    }

    #[tokio::test]
    #[ignore = "live X network probe"]
    async fn live_watchlist_profiles_have_posts() {
        for handle in ["thsottiaux", "OpenAI", "sama"] {
            let posts = fetch_profile(handle).await.expect("live profile fetch");
            assert!(!posts.is_empty(), "no posts parsed for @{handle}");
            assert!(posts.iter().all(|post| post.handle == handle));
        }
    }

    #[tokio::test]
    #[ignore = "live X network probe"]
    async fn live_watchlist_includes_recent_replies() {
        let (posts, errors) = fetch_watchlist(&[
            XWatchTarget {
                handle: "thsottiaux",
            },
            XWatchTarget { handle: "OpenAI" },
            XWatchTarget { handle: "sama" },
        ])
        .await;
        let cutoff = Utc::now() - chrono::Duration::days(7);
        let recent = posts
            .iter()
            .filter(|post| post.created_at >= cutoff)
            .collect::<Vec<_>>();
        let reply_count = recent
            .iter()
            .filter(|post| post.kind == XPostKind::Reply)
            .count();
        eprintln!(
            "live X probe: total={}, recent={}, replies={}, diagnostics={}",
            posts.len(),
            recent.len(),
            reply_count,
            errors.len()
        );
        assert!(
            reply_count > 0,
            "no recent replies were captured; diagnostics: {:?}",
            errors
        );
    }
}
