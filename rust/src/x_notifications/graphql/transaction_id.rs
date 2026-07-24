//! X web-client transaction-id generation.
//!
//! X conditionally validates `x-client-transaction-id` on authenticated API
//! requests. The public inputs are served in the signed-in HTML bootstrap and
//! its `ondemand.s` chunk; no cookie or account data is retained here.
//!
//! The animation and encoding algorithm is adapted from `xitter-txid`:
//! <https://github.com/amaanq/xitter-txid>
//!
//! MIT License
//!
//! Copyright (c) 2025 Amaan Qureshi <contact@amaanq.com>
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to
//! deal in the Software without restriction, including without limitation the
//! rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
//! sell copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in
//! all copies or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//! FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
//! IN THE SOFTWARE.

use std::iter;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};

const ONDEMAND_BASE_URL: &str = "https://abs.twimg.com/responsive-web/client-web";
const HASH_SALT: &str = "obfiowerehiring";
const X_EPOCH: u64 = 1_682_924_400;
const TOTAL_ANIMATION_TIME: f64 = 4096.0;
const FRAME_COUNT: u8 = 4;
const ROW_INDEX_MODULUS: u8 = 16;
const FRAME_SELECTOR_INDEX: usize = 5;
const MIN_FRAME_VALUES: usize = 11;

#[derive(Clone)]
pub(super) struct TransactionIdMaterial {
    key_bytes: Vec<u8>,
    animation_key: String,
}

impl TransactionIdMaterial {
    pub(super) fn from_documents(home_html: &str, ondemand_js: &str) -> Result<Self, String> {
        let (row_index, key_byte_indices) = parse_indices(ondemand_js)?;
        let verification_key = verification_key(home_html)?;
        let key_bytes = STANDARD
            .decode(verification_key)
            .map_err(|error| format!("invalid verification key: {error}"))?;
        let animation_key =
            compute_animation_key(&key_bytes, home_html, row_index, &key_byte_indices)?;

        Ok(Self {
            key_bytes,
            animation_key,
        })
    }

    pub(super) fn generate(&self, method: &str, path: &str) -> String {
        let time = current_time();
        self.generate_at(method, path, time)
    }

    fn generate_at(&self, method: &str, path: &str, time: u32) -> String {
        let hash_input = format!("{method}!{path}!{time}{HASH_SALT}{}", self.animation_key);
        let hash = Sha256::digest(hash_input.as_bytes());
        let random_byte = hash[16];

        let mut payload = Vec::with_capacity(self.key_bytes.len() + 4 + 16 + 1);
        payload.extend_from_slice(&self.key_bytes);
        payload.extend_from_slice(&time.to_le_bytes());
        payload.extend_from_slice(&hash[..16]);
        payload.push(3);

        let mut encoded = Vec::with_capacity(payload.len() + 1);
        encoded.push(random_byte);
        encoded.extend(payload.into_iter().map(|byte| byte ^ random_byte));
        STANDARD.encode(encoded).trim_end_matches('=').to_owned()
    }
}

pub(super) fn extract_ondemand_url(home_html: &str) -> Result<String, String> {
    if let Some(hash) = legacy_ondemand_hash(home_html) {
        return Ok(format!("{ONDEMAND_BASE_URL}/ondemand.s.{hash}a.js"));
    }

    let operation_marker = ":\"ondemand.s\"";
    let operation_position = home_html
        .find(operation_marker)
        .ok_or_else(|| "missing ondemand.s chunk name".to_string())?;
    let chunk_id = digits_before_colon(home_html, operation_position)
        .ok_or_else(|| "missing ondemand.s chunk id".to_string())?;
    let hash_marker = format!("{chunk_id}:\"");
    let mut search_position = operation_position + operation_marker.len();

    while let Some(relative_position) = home_html
        .get(search_position..)
        .and_then(|rest| rest.find(&hash_marker))
    {
        let value_start = search_position + relative_position + hash_marker.len();
        let Some(rest) = home_html.get(value_start..) else {
            break;
        };
        let Some(value_end) = rest.find('"') else {
            break;
        };
        let value = &rest[..value_end];
        if !value.is_empty()
            && value
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Ok(format!("{ONDEMAND_BASE_URL}/ondemand.s.{value}a.js"));
        }
        search_position = value_start + value_end + 1;
    }

    Err("missing ondemand.s chunk hash".to_string())
}

fn legacy_ondemand_hash(home_html: &str) -> Option<&str> {
    for marker in ["\"ondemand.s\"", "'ondemand.s'"] {
        let Some(position) = home_html.find(marker) else {
            continue;
        };
        let Some(after_marker) = home_html.get(position + marker.len()..) else {
            continue;
        };
        let Some(rest) = after_marker.trim_start().strip_prefix(':') else {
            continue;
        };
        let rest = rest.trim_start();
        let (quote, rest) = if let Some(rest) = rest.strip_prefix('"') {
            ('"', rest)
        } else if let Some(rest) = rest.strip_prefix('\'') {
            ('\'', rest)
        } else {
            continue;
        };
        let Some(end) = rest.find(quote) else {
            continue;
        };
        let hash = &rest[..end];
        if !hash.is_empty()
            && hash
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Some(hash);
        }
    }
    None
}

fn digits_before_colon(value: &str, colon_position: usize) -> Option<&str> {
    let prefix = value.get(..colon_position)?;
    let digit_start = prefix
        .char_indices()
        .rev()
        .take_while(|(_, character)| character.is_ascii_digit())
        .last()
        .map_or(colon_position, |(index, _)| index);
    (digit_start < colon_position).then(|| &value[digit_start..colon_position])
}

fn current_time() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| {
            duration
                .as_secs()
                .saturating_sub(X_EPOCH)
                .try_into()
                .unwrap_or(u32::MAX)
        })
        .unwrap_or(0)
}

fn parse_indices(ondemand_js: &str) -> Result<(usize, Vec<usize>), String> {
    let mut indices = Vec::new();
    let bytes = ondemand_js.as_bytes();

    for index in 0..bytes.len() {
        if bytes.get(index) != Some(&b'(') || bytes.get(index + 2) != Some(&b'[') {
            continue;
        }
        let start = index + 3;
        let mut end = start;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        let Some(rest) = ondemand_js.get(end..) else {
            continue;
        };
        if end > start
            && (rest.starts_with("], 16)") || rest.starts_with("],16)"))
            && let Some(value) = ondemand_js.get(start..end)
            && let Ok(value) = value.parse::<usize>()
        {
            indices.push(value);
        }
    }

    let row_index = indices
        .first()
        .copied()
        .ok_or_else(|| "missing transaction key-byte indices".to_string())?;
    Ok((row_index, indices.into_iter().skip(1).collect()))
}

fn verification_key(html: &str) -> Result<&str, String> {
    let marker = "name=\"twitter-site-verification\"";
    let position = html
        .find(marker)
        .ok_or_else(|| "missing twitter-site-verification meta tag".to_string())?;
    let tag_start = html
        .get(..position)
        .and_then(|value| value.rfind('<'))
        .unwrap_or(0);
    let tag_end = html
        .get(position..)
        .and_then(|value| value.find('>'))
        .map_or(html.len(), |offset| position + offset);
    let tag = html
        .get(tag_start..tag_end)
        .ok_or_else(|| "malformed verification meta tag".to_string())?;
    let content_marker = "content=\"";
    let content_position = tag
        .find(content_marker)
        .ok_or_else(|| "missing verification content attribute".to_string())?;
    let value_start = content_position + content_marker.len();
    let rest = tag
        .get(value_start..)
        .ok_or_else(|| "malformed verification content attribute".to_string())?;
    let value_end = rest
        .find('"')
        .ok_or_else(|| "unterminated verification content attribute".to_string())?;
    rest.get(..value_end)
        .ok_or_else(|| "invalid verification content attribute".to_string())
}

fn compute_animation_key(
    key_bytes: &[u8],
    html: &str,
    row_index: usize,
    key_byte_indices: &[usize],
) -> Result<String, String> {
    let row_selector = key_bytes
        .get(row_index)
        .ok_or_else(|| "transaction row selector is out of bounds".to_string())?;
    let row = usize::from(row_selector % ROW_INDEX_MODULUS);
    let frame_time = key_byte_indices
        .iter()
        .filter_map(|index| key_bytes.get(*index))
        .map(|byte| f64::from(byte % ROW_INDEX_MODULUS))
        .product::<f64>();
    let frame_time = js_round(frame_time / 10.0) * 10.0;
    let frame_data = animation_frame_data(key_bytes, html)?;
    let frame = frame_data
        .get(row)
        .ok_or_else(|| "transaction animation row is out of bounds".to_string())?;
    animate(frame, frame_time / TOTAL_ANIMATION_TIME)
}

fn animation_frame_data(key_bytes: &[u8], html: &str) -> Result<Vec<Vec<i32>>, String> {
    let frames = animation_frames(html);
    let selector = key_bytes
        .get(FRAME_SELECTOR_INDEX)
        .ok_or_else(|| "verification key is too short".to_string())?;
    let frame = frames
        .get(usize::from(selector % FRAME_COUNT))
        .ok_or_else(|| "missing transaction animation frame".to_string())?;
    Ok(parse_path_coordinates(frame))
}

fn animation_frames(html: &str) -> Vec<String> {
    let mut frames = Vec::new();
    let mut search_position = 0;

    while let Some(position) = html
        .get(search_position..)
        .and_then(|value| value.find("id=\"loading-x-anim"))
    {
        let absolute_position = search_position + position;
        let Some(svg_content) = html
            .get(absolute_position..)
            .and_then(|value| value.find("</svg>").map(|end| &value[..end]))
        else {
            break;
        };
        let mut path_search = 0;
        while let Some(path_position) = svg_content
            .get(path_search..)
            .and_then(|value| value.find("<path"))
        {
            let path_start = path_search + path_position;
            let path_end = svg_content
                .get(path_start..)
                .and_then(|value| value.find("/>").or_else(|| value.find("></path>")));
            if let Some(path_end) = path_end
                && let Some(path_tag) = svg_content.get(path_start..path_start + path_end)
                && let Some(path) = extract_path(path_tag)
                && path.contains('C')
            {
                frames.push(path.to_owned());
                break;
            }
            path_search = path_start + 5;
        }
        search_position = absolute_position + svg_content.len();
    }

    frames
}

fn extract_path(path_tag: &str) -> Option<&str> {
    let position = path_tag.find(" d=\"")?;
    let rest = path_tag.get(position + 4..)?;
    rest.get(..rest.find('"')?)
}

fn parse_path_coordinates(path: &str) -> Vec<Vec<i32>> {
    path.get(9..)
        .unwrap_or(path)
        .split('C')
        .map(|segment| {
            segment
                .replace(
                    |character: char| !character.is_ascii_digit() && character != '-',
                    " ",
                )
                .split_whitespace()
                .filter_map(|value| value.parse::<i32>().ok())
                .collect()
        })
        .collect()
}

fn animate(frame: &[i32], target_time: f64) -> Result<String, String> {
    if frame.len() < MIN_FRAME_VALUES {
        return Err(format!(
            "transaction animation frame has {} values",
            frame.len()
        ));
    }
    let from_color = frame[..3]
        .iter()
        .map(|value| f64::from(*value))
        .chain(iter::once(1.0))
        .collect::<Vec<_>>();
    let to_color = frame[3..6]
        .iter()
        .map(|value| f64::from(*value))
        .chain(iter::once(1.0))
        .collect::<Vec<_>>();
    let from_rotation = [0.0];
    let to_rotation = [solve(f64::from(frame[6]), 60.0, 360.0, true)];
    let curves = frame[7..]
        .iter()
        .enumerate()
        .map(|(index, value)| solve(f64::from(*value), odd_coefficient(index), 1.0, false))
        .collect::<Vec<_>>();
    let interpolation_factor = Cubic::new(curves).value(target_time);
    let colors = interpolate(&from_color, &to_color, interpolation_factor)?
        .into_iter()
        .map(|value| value.clamp(0.0, 255.0))
        .collect::<Vec<_>>();
    let rotation = interpolate(&from_rotation, &to_rotation, interpolation_factor)?;
    let matrix = rotation_matrix(rotation[0]);

    let mut parts = Vec::with_capacity(9);
    for value in &colors[..colors.len() - 1] {
        parts.push(format!("{:x}", value.round() as i32));
    }
    for value in matrix {
        let rounded = (value * 100.0).round() / 100.0;
        let hex = float_to_hex(rounded.abs()).to_lowercase();
        if hex.starts_with('.') {
            parts.push(format!("0{hex}"));
        } else if hex.is_empty() {
            parts.push("0".to_string());
        } else {
            parts.push(hex);
        }
    }
    parts.push("0".to_string());
    parts.push("0".to_string());
    Ok(parts.join("").replace(['.', '-'], ""))
}

fn solve(value: f64, minimum: f64, maximum: f64, rounding: bool) -> f64 {
    let result = value.mul_add((maximum - minimum) / 255.0, minimum);
    if rounding {
        result.floor()
    } else {
        (result * 100.0).round() / 100.0
    }
}

fn interpolate(from: &[f64], to: &[f64], factor: f64) -> Result<Vec<f64>, String> {
    if from.len() != to.len() {
        return Err("transaction interpolation length mismatch".to_string());
    }
    Ok(from
        .iter()
        .zip(to)
        .map(|(from, to)| from.mul_add(1.0 - factor, to * factor))
        .collect())
}

fn rotation_matrix(degrees: f64) -> [f64; 4] {
    let radians = degrees.to_radians();
    let cosine = radians.cos();
    let sine = radians.sin();
    [cosine, -sine, sine, cosine]
}

const fn odd_coefficient(index: usize) -> f64 {
    if index % 2 == 1 { -1.0 } else { 0.0 }
}

fn js_round(value: f64) -> f64 {
    let fractional = value - value.trunc();
    if fractional == -0.5 {
        value.ceil()
    } else {
        value.round()
    }
}

fn float_to_hex(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    let mut result = String::new();
    let mut quotient = value.floor() as i64;
    let mut fraction = value - quotient as f64;
    let digit = |value: i64| {
        if value > 9 {
            char::from_u32(value as u32 + 55).unwrap_or('?')
        } else {
            char::from_digit(value as u32, 10).unwrap_or('?')
        }
    };

    if quotient == 0 {
        result.push('0');
    } else {
        while quotient > 0 {
            result.insert(0, digit(quotient % 16));
            quotient /= 16;
        }
    }
    if fraction > 0.0 {
        result.push('.');
        while fraction > 0.0 {
            fraction *= 16.0;
            let integer = fraction.floor() as i64;
            fraction -= integer as f64;
            result.push(digit(integer));
            if result.len() > 20 {
                break;
            }
        }
    }
    result
}

struct Cubic {
    curves: Vec<f64>,
}

impl Cubic {
    fn new(curves: Vec<f64>) -> Self {
        Self { curves }
    }

    fn value(&self, time: f64) -> f64 {
        if time <= 0.0 {
            let gradient = if self.curves[0] > 0.0 {
                self.curves[1] / self.curves[0]
            } else if self.curves[1] == 0.0 && self.curves[2] > 0.0 {
                self.curves[3] / self.curves[2]
            } else {
                0.0
            };
            return gradient * time;
        }
        if time >= 1.0 {
            let gradient = if self.curves[2] < 1.0 {
                (self.curves[3] - 1.0) / (self.curves[2] - 1.0)
            } else if self.curves[2] == 1.0 && self.curves[0] < 1.0 {
                (self.curves[1] - 1.0) / (self.curves[0] - 1.0)
            } else {
                0.0
            };
            return 1.0 + gradient * (time - 1.0);
        }

        let mut low = 0.0_f64;
        let mut high = 1.0_f64;
        let mut midpoint;
        loop {
            midpoint = (low + high) / 2.0;
            let estimate = Self::bezier(self.curves[0], self.curves[2], midpoint);
            if (time - estimate).abs() < 0.00001 {
                return Self::bezier(self.curves[1], self.curves[3], midpoint);
            }
            if (high - low).abs() < f64::EPSILON {
                break;
            }
            if estimate < time {
                low = midpoint;
            } else {
                high = midpoint;
            }
        }
        Self::bezier(self.curves[1], self.curves[3], midpoint)
    }

    fn bezier(first: f64, second: f64, parameter: f64) -> f64 {
        let complement = 1.0 - parameter;
        let complement_squared = complement * complement;
        let parameter_squared = parameter * parameter;
        (3.0 * first * complement_squared).mul_add(
            parameter,
            (3.0 * second * complement).mul_add(parameter_squared, parameter_squared * parameter),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_chunk_manifest_resolves_ondemand_url() {
        let html = r#"59924:"ondemand.s",60041:"i18n/emoji-gu"
                      59862:"684ba55",59924:"964027d",60041:"74fb946""#;
        assert_eq!(
            extract_ondemand_url(html).unwrap(),
            "https://abs.twimg.com/responsive-web/client-web/ondemand.s.964027da.js"
        );
    }

    #[test]
    fn legacy_chunk_manifest_resolves_ondemand_url() {
        let html = r#""ondemand.s": "abc123def""#;
        assert_eq!(
            extract_ondemand_url(html).unwrap(),
            "https://abs.twimg.com/responsive-web/client-web/ondemand.s.abc123defa.js"
        );
        let html = "'ondemand.s': 'xyz789'";
        assert_eq!(
            extract_ondemand_url(html).unwrap(),
            "https://abs.twimg.com/responsive-web/client-web/ondemand.s.xyz789a.js"
        );
    }

    #[test]
    fn key_indices_match_minified_ondemand_shape() {
        let javascript = "value(n[29],16),other(n[40], 16),third(n[46],16),fourth(n[29],16)";
        assert_eq!(parse_indices(javascript).unwrap(), (29, vec![40, 46, 29]));
    }

    #[test]
    fn generated_id_encodes_time_and_protocol_without_padding() {
        let material = TransactionIdMaterial {
            key_bytes: vec![1, 2, 3, 4],
            animation_key: "animation".to_string(),
        };
        let encoded = material.generate_at("GET", "/i/api/graphql/test", 0x0102_0304);
        assert!(!encoded.ends_with('='));
        let mut padded = encoded.clone();
        while !padded.len().is_multiple_of(4) {
            padded.push('=');
        }
        let decoded = STANDARD.decode(padded).unwrap();
        let mask = decoded[0];
        let payload = decoded[1..]
            .iter()
            .map(|byte| byte ^ mask)
            .collect::<Vec<_>>();
        assert_eq!(&payload[..4], &[1, 2, 3, 4]);
        assert_eq!(&payload[4..8], &0x0102_0304_u32.to_le_bytes());
        assert_eq!(payload.last(), Some(&3));
    }
}
