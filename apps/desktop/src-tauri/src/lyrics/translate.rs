use super::{read_body, MAX_TEXT};
use reqwest::{blocking::Client, redirect};
use serde_json::Value;
use std::time::{Duration, Instant};

const TRANSLATE_URL: &str = "https://translate.googleapis.com/translate_a/single";
const CHUNK_BYTES: usize = 3500;
const FAILED: &str = "Не удалось перевести текст. Попробуйте ещё раз.";

pub(super) fn to_russian(text: &str) -> Result<String, &'static str> {
    if text.trim().is_empty() || text.len() > MAX_TEXT {
        return Err(FAILED);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .https_only(true)
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|_| FAILED)?;
    let started = Instant::now();
    let mut remaining = text;
    let mut output = String::new();
    while !remaining.is_empty() {
        let (chunk, rest) = remaining.split_at(chunk_end(remaining));
        remaining = rest;
        let content = chunk.trim_end();
        if !content.is_empty() {
            let timeout = Duration::from_secs(15)
                .saturating_sub(started.elapsed())
                .min(Duration::from_secs(5));
            if timeout.is_zero() {
                return Err(FAILED);
            }
            let response = client
                .post(TRANSLATE_URL)
                .timeout(timeout)
                .form(&[
                    ("client", "gtx"),
                    ("sl", "auto"),
                    ("tl", "ru"),
                    ("dt", "t"),
                    ("q", content),
                ])
                .send()
                .map_err(|_| FAILED)?;
            let body = read_body(response, 128 * 1024)
                .map_err(|_| FAILED)?
                .ok_or(FAILED)?;
            let translated = translation(&body).ok_or(FAILED)?;
            output.push_str(translated.trim_end());
        }
        output.push_str(&chunk[content.len()..]);
        if output.len() > 2 * MAX_TEXT {
            return Err(FAILED);
        }
    }
    Ok(output)
}

fn chunk_end(text: &str) -> usize {
    if text.len() <= CHUNK_BYTES {
        return text.len();
    }
    let mut end = CHUNK_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let prefix = &text[..end];
    prefix
        .rfind('\n')
        .map(|index| index + 1)
        .filter(|&index| index > end / 2)
        .or_else(|| {
            prefix
                .char_indices()
                .rev()
                .find(|&(_, c)| c.is_whitespace())
                .map(|(index, c)| index + c.len_utf8())
                .filter(|&index| index > end / 2)
        })
        .unwrap_or(end)
}

fn translation(body: &str) -> Option<String> {
    let json: Value = serde_json::from_str(body).ok()?;
    let result: String = json
        .get(0)?
        .as_array()?
        .iter()
        .filter_map(|part| part.get(0)?.as_str())
        .collect();
    (!result.trim().is_empty()).then_some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_utf8_without_losing_verse_breaks_and_rejoins_provider_segments() {
        let text = "ё".repeat(1500) + "\n\n" + &"я".repeat(500);
        assert_eq!(chunk_end(&text), 3002);
        assert_eq!(chunk_end(&"я".repeat(2000)), CHUNK_BYTES);
        assert_eq!(
            translation(r#"[[["Строка\n\n","Line"],["Куплет","Verse"]],null,"en"]"#).as_deref(),
            Some("Строка\n\nКуплет")
        );
        assert!(translation(r#"{"error":"unavailable"}"#).is_none());
    }

    #[test]
    #[ignore = "Opt-in public translation service probe using synthetic text"]
    fn live_lyrics_translation() {
        let text = to_russian("Hello, world!\n\nGood night.").unwrap();
        assert!(
            text.contains("\n\n") && text.contains("Привет"),
            "Russian translation or verse break missing"
        );
    }
}
