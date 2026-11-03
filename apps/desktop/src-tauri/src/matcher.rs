//! Experimental public YouTube Music metadata search; never requests player/media endpoints.
use reqwest::{blocking::Client, redirect::Policy};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
#[derive(Clone, Serialize, Debug)]
pub struct Candidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub score: u32,
    pub reason: String,
}
type Cache = HashMap<String, (Instant, Vec<Candidate>)>;
#[derive(Clone, Default)]
pub struct Matcher(Arc<Mutex<Cache>>);
fn words(value: &str) -> Vec<String> {
    value
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}
fn contains_all(expected: &[String], actual: &[String]) -> bool {
    !expected.is_empty() && expected.iter().all(|word| actual.contains(word))
}
fn score(
    title: &str,
    artist: &str,
    candidate_title: &str,
    candidate_artist: &str,
    kind: &str,
) -> Option<(u32, String)> {
    if kind == "MUSIC_VIDEO_TYPE_ATV" {
        return None;
    }
    let target = words(title);
    let name = words(artist.split(',').next().unwrap_or(artist));
    let candidate = words(candidate_title);
    let performer = words(candidate_artist);
    let blocked = [
        "cover",
        "karaoke",
        "reaction",
        "tutorial",
        "nightcore",
        "slowed",
        "mashup",
        "fanmade",
        "tribute",
        "кавер",
        "караоке",
        "реакция",
        "обучение",
    ];
    if candidate
        .iter()
        .any(|word| blocked.contains(&word.as_str()) && !target.contains(word))
        || performer
            .iter()
            .any(|word| blocked.contains(&word.as_str()) && !name.contains(word))
    {
        return None;
    }
    if candidate
        .iter()
        .any(|word| word == "remix" || word == "ремикс")
        && !target
            .iter()
            .any(|word| word == "remix" || word == "ремикс")
    {
        return None;
    }
    if !contains_all(&target, &candidate)
        || !candidate_artist
            .split(',')
            .any(|credit| words(credit) == name && !name.is_empty())
    {
        return None;
    }
    let mut score = 100;
    let reason = if kind == "MUSIC_VIDEO_TYPE_OMV" {
        score += 100;
        "Совпали название и исполнитель; метка музыкального видео"
    } else if candidate
        .iter()
        .any(|word| ["lyric", "lyrics", "visualizer"].contains(&word.as_str()))
    {
        score += 30;
        "Совпали название и исполнитель; lyric/visualizer"
    } else if candidate
        .iter()
        .any(|word| ["live", "concert", "концерт"].contains(&word.as_str()))
    {
        score += 10;
        "Совпали название и исполнитель; live"
    } else {
        "Совпали название и исполнитель"
    };
    if target == candidate {
        score += 20;
    }
    Some((score, reason.into()))
}
fn text(runs: &Value) -> String {
    runs.as_array()
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("text").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default()
}
fn row(row: &Value, title: &str, artist: &str) -> Option<Candidate> {
    let id = row.pointer("/playlistItemData/videoId")?.as_str()?;
    if id.len() != 11
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return None;
    }
    let title_runs =
        row.pointer("/flexColumns/0/musicResponsiveListItemFlexColumnRenderer/text/runs")?;
    let candidate_title = text(title_runs);
    let artist_runs = row
        .pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")?
        .as_array()?;
    let candidate_artist = artist_runs
        .iter()
        .filter(|run| run.pointer("/navigationEndpoint/browseEndpoint").is_some())
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    let kind=title_runs.pointer("/0/navigationEndpoint/watchEndpoint/watchEndpointMusicSupportedConfigs/watchEndpointMusicConfig/musicVideoType").and_then(Value::as_str).unwrap_or("");
    let (score, reason) = score(title, artist, &candidate_title, &candidate_artist, kind)?;
    Some(Candidate {
        id: id.into(),
        title: candidate_title,
        artist: candidate_artist,
        score,
        reason,
    })
}
fn parse(value: &Value, title: &str, artist: &str) -> Vec<Candidate> {
    fn walk(value: &Value, title: &str, artist: &str, depth: usize, out: &mut Vec<Candidate>) {
        if depth > 64 || out.len() >= 40 {
            return;
        }
        if let Some(renderer) = value.get("musicResponsiveListItemRenderer") {
            if let Some(candidate) = row(renderer, title, artist) {
                out.push(candidate);
            }
        }
        match value {
            Value::Array(values) => {
                for value in values {
                    walk(value, title, artist, depth + 1, out)
                }
            }
            Value::Object(values) => {
                for value in values.values() {
                    walk(value, title, artist, depth + 1, out)
                }
            }
            _ => {}
        }
    }
    let mut results = Vec::new();
    walk(value, title, artist, 0, &mut results);
    results.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));
    let mut seen = HashSet::new();
    results.retain(|candidate| seen.insert(candidate.id.clone()));
    results.truncate(5);
    results
}
pub fn search(
    matcher: &Matcher,
    title: &str,
    artist: &str,
) -> Result<Vec<Candidate>, &'static str> {
    if title.trim().is_empty() || artist.trim().is_empty() || title.len() + artist.len() > 512 {
        return Err("Invalid search metadata");
    }
    let key = format!("{}\n{}", title, artist);
    let mut cache = matcher.0.lock().map_err(|_| "Search unavailable")?;
    if let Some((time, results)) = cache.get(&key) {
        if time.elapsed() < Duration::from_secs(if results.is_empty() { 30 } else { 3600 }) {
            return Ok(results.clone());
        }
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize search")?;
    let response=client.post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false").header("Origin","https://music.youtube.com").json(&json!({
        "context":{"client":{"clientName":"WEB_REMIX","clientVersion":format!("1.{}.01.00",chrono::Utc::now().format("%Y%m%d")),"hl":"en"}},
        "query":format!("{artist} {title}"),"params":"EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D"
    })).send().map_err(|_|"Search network error")?;
    if !response.status().is_success() {
        return Err("Search service unavailable");
    }
    let mut bytes = Vec::new();
    response
        .take(3_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Search response failed")?;
    if bytes.len() > 3_000_000 {
        return Err("Search response too large");
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Search schema changed")?;
    if value.get("contents").is_none() {
        return Err("Search schema changed");
    }
    let results = parse(&value, title, artist);
    if cache.len() >= 128 {
        cache.clear();
    }
    cache.insert(key, (Instant::now(), results.clone()));
    Ok(results)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_cover_wrong_artist_and_unrequested_remix() {
        for (title, artist) in [
            ("Wonderwall cover", "Oasis"),
            ("Wonderwall", "Cover Artist"),
            ("Wonderwall remix", "Oasis"),
        ] {
            assert!(score("Wonderwall", "Oasis", title, artist, "MUSIC_VIDEO_TYPE_OMV").is_none());
        }
        assert!(score("Группа крови", "Кино", "Группа крови (live)", "Кино", "").is_some());
    }
    #[test]
    fn original_video_beats_live_without_duration_bias() {
        let official = score(
            "Yellow",
            "Coldplay",
            "Yellow",
            "Coldplay",
            "MUSIC_VIDEO_TYPE_OMV",
        )
        .unwrap()
        .0;
        let live = score("Yellow", "Coldplay", "Yellow live", "Coldplay", "")
            .unwrap()
            .0;
        assert!(official > live);
        assert!(score("Halo", "Beyoncé", "Halo", "Beyonce", "").is_some());
    }
    #[test]
    fn rejects_artist_name_substrings_and_keeps_legitimate_cover_title() {
        assert!(score(
            "Wonderwall",
            "Oasis",
            "Wonderwall",
            "Oasis Tribute Band",
            ""
        )
        .is_none());
        assert!(score("Wonderwall", "Oasis", "Wonderwall", "Not Oasis", "").is_none());
        assert!(score(
            "Cover Me",
            "Depeche Mode",
            "Cover Me",
            "Depeche Mode",
            "MUSIC_VIDEO_TYPE_OMV"
        )
        .is_some());
        assert!(score("Группа крови", "Кино", "Звезда по имени Солнце", "Кино", "").is_none());
    }
    #[test]
    fn no_match_for_missing_title_or_artist() {
        assert!(score(
            "Wonderwall",
            "Oasis",
            "Wonderwall",
            "Oasis",
            "MUSIC_VIDEO_TYPE_ATV"
        )
        .is_none());
        assert!(score("Missing", "Oasis", "Wonderwall", "Oasis", "").is_none());
        assert!(score("Wonderwall", "", "Wonderwall", "Oasis", "").is_none());
    }
    #[test]
    #[ignore = "Opt-in real metadata-only S10 probe"]
    fn live_metadata_probe() {
        let matcher = Matcher::default();
        for (title, artist) in [("Wonderwall", "Oasis"), ("Yellow", "Coldplay")] {
            assert!(
                !search(&matcher, title, artist)
                    .expect("metadata search failed")
                    .is_empty(),
                "No accepted candidate: {artist} / {title}"
            );
        }
        // A valid search may return no safe candidate. Never relax matching to satisfy a test.
        for candidate in search(&matcher, "Группа крови", "Кино").expect("Cyrillic query failed")
        {
            assert!(score(
                "Группа крови",
                "Кино",
                &candidate.title,
                &candidate.artist,
                ""
            )
            .is_some());
        }
    }
}
