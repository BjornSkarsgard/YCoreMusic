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
    pub byline: String,
    #[serde(rename = "needsReview")]
    pub needs_review: bool,
    pub views: Option<u64>,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: Option<u32>,
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
fn artist_credits(value: &str) -> Vec<Vec<String>> {
    let normalized = value
        .to_lowercase()
        .replace(" featuring ", ",")
        .replace(" feat. ", ",")
        .replace(" feat ", ",")
        .replace(" ft. ", ",")
        .replace(" ft ", ",")
        .replace(['&', ';'], ",");
    let mut credits = Vec::new();
    for credit in normalized
        .split(',')
        .map(words)
        .filter(|name| !name.is_empty())
    {
        if !credits.contains(&credit) {
            credits.push(credit);
        }
    }
    credits
}

fn close_credit(expected: &[String], actual: &[String]) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    let mut differences = 0;
    for (left, right) in expected.iter().zip(actual) {
        if left == right {
            continue;
        }
        // A bounded final-letter spelling variation is useful only with full
        // collaboration corroboration, never as a single-artist identity gate.
        let (short, long) = if left.chars().count() < right.chars().count() {
            (left, right)
        } else {
            (right, left)
        };
        if short.chars().count() < 3
            || long.chars().count() != short.chars().count() + 1
            || !long.starts_with(short)
        {
            return false;
        }
        differences += 1;
    }
    differences <= 1
}

fn collaboration_match(expected: &[Vec<String>], actual: &[Vec<String>]) -> bool {
    if expected.len() < 2 || expected.len() > 8 || expected.len() != actual.len() {
        return false;
    }
    fn assign(expected: &[Vec<String>], actual: &[Vec<String>], used: u16) -> bool {
        let Some((first, rest)) = expected.split_first() else {
            return true;
        };
        actual.iter().enumerate().any(|(index, name)| {
            used & (1 << index) == 0
                && close_credit(first, name)
                && assign(rest, actual, used | (1 << index))
        })
    }
    assign(expected, actual, 0)
}

fn score(
    title: &str,
    artist: &str,
    candidate_title: &str,
    canonical_artist: &str,
    kind: &str,
) -> Option<(u32, String, bool)> {
    let target = words(title);
    let names = artist_credits(artist);
    let candidate = words(candidate_title);
    if !contains_all(&target, &candidate) || names.is_empty() {
        return None;
    }
    let blocked = [
        "cover",
        "covers",
        "karaoke",
        "reaction",
        "tutorial",
        "nightcore",
        "slowed",
        "mashup",
        "fanmade",
        "tribute",
        "playthrough",
        "backing",
        "playalong",
        "instrumental",
        "кавер",
        "караоке",
        "реакция",
        "обучение",
        "минусовка",
    ];
    if candidate
        .iter()
        .any(|word| blocked.contains(&word.as_str()) && !target.contains(word))
    {
        return None;
    }
    if candidate
        .iter()
        .any(|word| ["remix", "ремикс"].contains(&word.as_str()))
        && !target
            .iter()
            .any(|word| ["remix", "ремикс"].contains(&word.as_str()))
    {
        return None;
    }
    let exact_title_credit = names
        .iter()
        .any(|name| candidate.windows(name.len()).any(|phrase| phrase == name));
    let title_parts = candidate_title
        .replace(" — ", " | ")
        .replace(" – ", " | ")
        .replace(" - ", " | ");
    let named_in_title = exact_title_credit
        || title_parts
            .split(" | ")
            .any(|part| collaboration_match(&names, &artist_credits(part)));
    let canonical_names = artist_credits(canonical_artist);
    let music_record = matches!(kind, "MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_ATV");
    let exact_credit = names.iter().any(|name| canonical_names.contains(name));
    let canonical_match = music_record
        && (words(artist) == words(canonical_artist)
            || exact_credit
            || collaboration_match(&names, &canonical_names));
    if music_record && !canonical_artist.is_empty() && !canonical_match && !named_in_title {
        return None;
    }
    // Official audio records must have a real performer credit. An arbitrary
    // uploader/byline, even if named like the artist, cannot establish it.
    if kind == "MUSIC_VIDEO_TYPE_ATV" && !canonical_match {
        return None;
    }
    let needs_review = !named_in_title && !canonical_match;
    let mut score = if needs_review { 40 } else { 100 };
    let reason = if canonical_match {
        score += 100;
        if kind == "MUSIC_VIDEO_TYPE_ATV" {
            "Официальная запись YouTube: совпали песня и исполнители"
        } else {
            "Музыкальное видео: совпали песня и исполнитель в метаданных"
        }
    } else if named_in_title
        && candidate
            .iter()
            .any(|word| ["live", "concert", "концерт"].contains(&word.as_str()))
    {
        score += 30;
        "Группа и песня указаны в названии live-видео; канал не ограничивается"
    } else if named_in_title
        && candidate
            .iter()
            .any(|word| ["lyric", "lyrics", "visualizer"].contains(&word.as_str()))
    {
        score += 40;
        "Группа и песня указаны в названии lyric/visualizer"
    } else if named_in_title {
        score += 10;
        "Группа и песня указаны в названии; канал не ограничивается"
    } else {
        "Совпала песня, исполнитель в видео не подтверждён — выберите вручную"
    };
    if target == candidate {
        score += 20;
    }
    Some((score, reason.into(), needs_review))
}

fn view_count(value: &str) -> Option<u64> {
    let raw = value
        .trim()
        .strip_suffix(" views")
        .or_else(|| value.trim().strip_suffix(" view"))?
        .trim();
    let (number, multiplier) = match raw.chars().last()? {
        'K' | 'k' => (&raw[..raw.len() - 1], 1_000.0),
        'M' | 'm' => (&raw[..raw.len() - 1], 1_000_000.0),
        'B' | 'b' => (&raw[..raw.len() - 1], 1_000_000_000.0),
        _ => (raw, 1.0),
    };
    let count = number.replace(',', "").parse::<f64>().ok()? * multiplier;
    if !count.is_finite() || count < 0.0 {
        return None;
    }
    Some(count.round() as u64)
}
fn rank(results: &mut [Candidate]) {
    results.sort_by_key(|candidate| {
        (
            candidate.needs_review,
            std::cmp::Reverse(candidate.views.unwrap_or(0)),
            std::cmp::Reverse(candidate.score),
        )
    });
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
        .pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text/runs")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let views = artist_runs
        .iter()
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .find_map(view_count);
    let duration_seconds = duration(row.get("fixedColumns").unwrap_or(&Value::Null))
        .or_else(|| duration(row.get("flexColumns").unwrap_or(&Value::Null)));
    let byline = artist_runs
        .iter()
        .filter(|run| run.pointer("/navigationEndpoint/browseEndpoint").is_some())
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    let kind=title_runs.pointer("/0/navigationEndpoint/watchEndpoint/watchEndpointMusicSupportedConfigs/watchEndpointMusicConfig/musicVideoType").and_then(Value::as_str).unwrap_or("");
    let canonical_artist = if matches!(kind, "MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_ATV") {
        artist_runs.iter().filter(|run|run.pointer("/navigationEndpoint/browseEndpoint/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType").and_then(Value::as_str)==Some("MUSIC_PAGE_TYPE_ARTIST")).filter_map(|run|run.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(", ")
    } else {
        String::new()
    };
    let (score, reason, needs_review) =
        score(title, artist, &candidate_title, &canonical_artist, kind)?;
    Some(Candidate {
        id: id.into(),
        title: candidate_title,
        byline,
        views,
        duration_seconds,
        needs_review,
        score,
        reason,
    })
}
fn duration(value: &Value) -> Option<u32> {
    fn clock(text: &str) -> Option<u32> {
        let parts = text.trim().split(':').collect::<Vec<_>>();
        if !(2..=3).contains(&parts.len())
            || parts
                .iter()
                .any(|s| s.is_empty() || s.len() > 3 || !s.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
        let mut seconds = 0u32;
        for (index, part) in parts.iter().enumerate() {
            let value = part.parse::<u32>().ok()?;
            if index > 0 && value >= 60 {
                return None;
            }
            seconds = seconds.checked_mul(60)?.checked_add(value)?;
        }
        Some(seconds)
    }
    match value {
        Value::String(s) => clock(s),
        Value::Array(items) => items.iter().find_map(duration),
        Value::Object(items) => items
            .iter()
            .filter(|(key, _)| {
                matches!(
                    key.as_str(),
                    "text"
                        | "simpleText"
                        | "runs"
                        | "musicResponsiveListItemFixedColumnRenderer"
                        | "musicResponsiveListItemFlexColumnRenderer"
                )
            })
            .find_map(|(_, v)| duration(v)),
        _ => None,
    }
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
    rank(&mut results);
    let mut seen = HashSet::new();
    results.retain(|candidate| seen.insert(candidate.id.clone()));
    results.truncate(5);
    results
}
fn request_candidates(
    client: &Client,
    title: &str,
    artist: &str,
    params: &str,
    timeout: Duration,
) -> Result<Vec<Candidate>, &'static str> {
    let response=client.post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false").timeout(timeout).header("Origin","https://music.youtube.com").json(&json!({
        "context":{"client":{"clientName":"WEB_REMIX","clientVersion":format!("1.{}.01.00",chrono::Utc::now().format("%Y%m%d")),"hl":"en"}},
        "query":format!("{artist} {title}"),"params":params
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
    Ok(parse(&value, title, artist))
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
    {
        let cache = matcher.0.lock().map_err(|_| "Search unavailable")?;
        if let Some((time, results)) = cache.get(&key) {
            if time.elapsed()
                < Duration::from_secs(if results.iter().any(|candidate| !candidate.needs_review) {
                    3600
                } else {
                    30
                })
            {
                return Ok(results.clone());
            }
        }
    } // Do not serialize independent prefetch requests behind network I/O.
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize search")?;
    let started = Instant::now();
    let mut results = request_candidates(
        &client,
        title,
        artist,
        "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D",
        Duration::from_secs(15),
    )?;
    if !results.iter().any(|candidate| !candidate.needs_review) {
        // A real music video remains the first choice. Official recordings are
        // a second bounded metadata query, played by the very same iframe.
        let remaining = Duration::from_secs(15).saturating_sub(started.elapsed());
        if !remaining.is_zero() {
            match request_candidates(
                &client,
                title,
                artist,
                "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
                remaining,
            ) {
                Ok(recordings) => results.extend(recordings),
                Err(error) if results.is_empty() => return Err(error),
                Err(_) => {} // Retain manually selectable candidates on a failed fallback.
            }
        }
        rank(&mut results);
        let mut seen = HashSet::new();
        results.retain(|candidate| seen.insert(candidate.id.clone()));
        results.truncate(5);
    }
    let mut cache = matcher.0.lock().map_err(|_| "Search unavailable")?;
    if cache.len() >= 128 {
        cache.clear();
    }
    // Incomplete search responses must not mask a fresh request when a
    // prefetched track becomes current. The coordinator bounds that retry.
    if results.iter().any(|candidate| !candidate.needs_review) {
        cache.insert(key, (Instant::now(), results.clone()));
    }
    Ok(results)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paket_video_uses_performer_metadata_when_title_has_no_artist() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/youtube-sqwoz-paket.json"))
                .unwrap();
        let found = parse(&fixture, "ПАКЕТ", "SQWOZ BAB");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "4P1s3MgIm1o");
        assert!(!found[0].needs_review);
        assert_eq!(found[0].duration_seconds, Some(209));
        assert!(parse(&fixture, "ПАКЕТ", "Другой исполнитель").is_empty());
    }
    #[test]
    fn real_collaboration_recording_is_not_discarded_by_video_type_or_spelling() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/youtube-collaboration.json"))
                .unwrap();
        let found = parse(&fixture, "Мой сельский", "GORILLA GLU, LIL NAKU");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "eWBdgvhNwF8");
        assert!(!found[0].needs_review);
        assert_eq!(found[0].duration_seconds, Some(105));
        assert!(parse(&fixture, "Другая песня", "GORILLA GLU, LIL NAKU").is_empty());
        assert!(parse(&fixture, "Мой сельский", "Другая группа, Другой артист").is_empty());
    }
    #[test]
    fn collaborations_accept_reordered_credits_and_features_for_other_artists() {
        for kind in ["MUSIC_VIDEO_TYPE_OMV", "MUSIC_VIDEO_TYPE_ATV"] {
            for (expected, actual) in [
                (
                    "Daft Punk, Pharrell Williams",
                    "Pharrell Williams & Daft Punk",
                ),
                ("Artist One feat. Artist Two", "Artist Two, Artist One"),
                ("Beyoncé, Shakira", "Shakira & Beyonce"),
            ] {
                assert!(!score("Song", expected, "Song", actual, kind).unwrap().2);
            }
        }
        // One near-looking artist cannot be treated as a verified alias.
        assert!(score("Song", "Artist", "Song", "Artists", "MUSIC_VIDEO_TYPE_ATV").is_none());
        assert!(!collaboration_match(
            &artist_credits("Artist One, Artist Two"),
            &artist_credits("Artist Ones, Unrelated Band")
        ));
        assert!(!collaboration_match(
            &artist_credits("Artist One, Artist Two"),
            &artist_credits("Artist Ones, Artist Ones")
        ));
    }
    #[test]
    fn third_party_concerts_remain_eligible_and_bad_versions_remain_blocked() {
        assert!(
            !score(
                "Мой сельский",
                "GORILLA GLU, LIL NAKU",
                "GORILLA GLUE & LIL NAKUR — Мой сельский (live)",
                "Случайный зритель",
                "MUSIC_VIDEO_TYPE_UGC"
            )
            .unwrap()
            .2
        );
        assert!(
            !score(
                "Группа крови",
                "Кино",
                "Кино — Группа крови, концерт",
                "Случайный зритель",
                "MUSIC_VIDEO_TYPE_UGC"
            )
            .unwrap()
            .2
        );
        for suffix in ["cover", "karaoke", "remix", "reaction", "slowed"] {
            assert!(score(
                "Song",
                "Artist One, Artist Two",
                &format!("Artist One & Artist Two - Song {suffix}"),
                "Unrelated channel",
                "MUSIC_VIDEO_TYPE_UGC"
            )
            .is_none());
        }
        assert!(
            score(
                "Song",
                "Artist One, Artist Two",
                "Song",
                "Artist One & Artist Two",
                "MUSIC_VIDEO_TYPE_UGC"
            )
            .unwrap()
            .2
        );
    }
    #[test]
    #[ignore = "Explicit public metadata regression; no credentials or media downloads"]
    fn live_user_collaboration_regression() {
        let found = search(&Matcher::default(), "Мой сельский", "GORILLA GLU, LIL NAKU").unwrap();
        assert!(found
            .iter()
            .any(|c| c.id == "eWBdgvhNwF8" && !c.needs_review));
    }
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
    fn popularity_ranks_only_after_relevance_and_rejects_cover() {
        assert_eq!(view_count("1.4M views"), Some(1_400_000));
        assert_eq!(view_count("713M views"), Some(713_000_000));
        assert_eq!(view_count("1,234 views"), Some(1234));
        assert_eq!(view_count("unknown"), None);
        let make = |id: &str, views, needs_review, score| Candidate {
            id: id.into(),
            title: "Fixture".into(),
            byline: "Unrelated uploader".into(),
            views: Some(views),
            duration_seconds: None,
            needs_review,
            score,
            reason: String::new(),
        };
        let mut items = vec![
            make("official", 100, false, 200),
            make("popular-live", 1000, false, 130),
            make("uncertain", 10000, true, 40),
        ];
        rank(&mut items);
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["popular-live", "official", "uncertain"]
        );
        assert!(score(
            "Living Dead Beat",
            "Children Of Bodom",
            "Children Of Bodom Living Dead Beat drum cover",
            "",
            "MUSIC_VIDEO_TYPE_UGC"
        )
        .is_none());
    }
    #[test]
    fn channel_name_never_decides_acceptance() {
        for byline in ["Oasis Tribute Band", "Not Oasis", ""] {
            assert!(score(
                "Wonderwall",
                "Oasis",
                "Oasis - Wonderwall live",
                byline,
                "MUSIC_VIDEO_TYPE_UGC"
            )
            .is_some());
            assert!(
                score(
                    "Wonderwall",
                    "Oasis",
                    "Wonderwall",
                    byline,
                    "MUSIC_VIDEO_TYPE_UGC"
                )
                .unwrap()
                .2
            );
        }
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
    fn living_dead_beat_finds_original_band_live_on_unrelated_channel() {
        let value: Value =
            serde_json::from_str(include_str!("../tests/fixtures/bodom-search.json")).unwrap();
        let candidates = parse(&value, "Living Dead Beat", "Children Of Bodom");
        assert!(!candidates.is_empty());
        assert_eq!(candidates[0].id, "v-UX4hmUESg");
        assert_eq!(candidates[0].byline, "Berar Emanuel");
        assert!(!candidates[0].needs_review);
        println!(
            "Public regression top candidate: {} views={:?}",
            candidates[0].id, candidates[0].views
        );
        for candidate in candidates {
            let title = candidate.title.to_lowercase();
            assert!(
                !title.contains("cover")
                    && !title.contains("backing")
                    && !title.contains("playthrough")
            );
        }
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
        .is_some());
        assert!(score(
            "Wonderwall",
            "Oasis",
            "Wonderwall",
            "Cover Artist",
            "MUSIC_VIDEO_TYPE_ATV"
        )
        .is_none());
        assert!(score("Missing", "Oasis", "Wonderwall", "Oasis", "").is_none());
        assert!(score("Wonderwall", "", "Wonderwall", "Oasis", "").is_none());
    }
    #[test]
    fn duration_reads_metadata_clocks_without_treating_view_counts_as_time() {
        assert_eq!(
            duration(
                &json!([{"musicResponsiveListItemFixedColumnRenderer":{"text":{"runs":[{"text":"1:02:03"}]}}}])
            ),
            Some(3723)
        );
        assert_eq!(
            duration(&json!({"text":{"runs":[{"text":"4:31"}]}})),
            Some(271)
        );
        assert_eq!(duration(&json!({"text":"31M views"})), None);
        assert_eq!(duration(&json!({"text":"4:99"})), None);
    }
    #[test]
    #[ignore = "Read-only real video duration metadata probe"]
    fn live_video_durations() {
        let result = search(&Matcher::default(), "Wonderwall", "Oasis").unwrap();
        assert!(!result.is_empty());
        let known = result
            .iter()
            .filter(|v| v.duration_seconds.is_some())
            .count();
        println!("Video duration metadata: {} / {}", known, result.len());
        assert!(known > 0);
    }
    #[test]
    #[ignore = "Opt-in user-reported metadata regression"]
    fn live_bodom_regression() {
        let candidates =
            search(&Matcher::default(), "Living Dead Beat", "Children Of Bodom").unwrap();
        assert!(!candidates.is_empty());
        assert!(!candidates[0].needs_review);
        assert!(contains_all(
            &words("Living Dead Beat"),
            &words(&candidates[0].title)
        ));
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
            assert!(score("Группа крови", "Кино", &candidate.title, "", "").is_some());
        }
    }
    #[test]
    #[ignore = "Read-only user-reported Catch-22 metadata probe"]
    fn live_catch22_regression() {
        let result = search(&Matcher::default(), "What I Need", "Catch-22 NZ")
            .expect("Public metadata request failed");
        println!("Catch-22 candidates: {result:?}");
        assert!(result.iter().any(|candidate| !candidate.needs_review));
    }
    #[test]
    #[ignore = "Read-only user-reported SQWOZ BAB metadata probe"]
    fn live_sqwoz_paket_regression() {
        let result = search(&Matcher::default(), "ПАКЕТ", "SQWOZ BAB")
            .expect("Public metadata request failed");
        println!("SQWOZ BAB candidates: {result:?}");
        assert!(result.iter().any(|candidate| !candidate.needs_review));
    }
    #[test]
    #[ignore = "Read-only user-reported Absence metadata probe"]
    fn live_absence_regression() {
        let result =
            search(&Matcher::default(), "Absence", "Xalv").expect("Public metadata request failed");
        println!("Absence candidates: {result:?}");
        assert!(result.iter().any(|candidate| !candidate.needs_review));
    }
}
