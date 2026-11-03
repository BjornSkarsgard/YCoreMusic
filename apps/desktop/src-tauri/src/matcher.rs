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
    canonical_artist: &str,
    kind: &str,
) -> Option<(u32, String, bool)> {
    if kind == "MUSIC_VIDEO_TYPE_ATV" {
        return None;
    }
    let target = words(title);
    let name = words(artist.split(',').next().unwrap_or(artist));
    let candidate = words(candidate_title);
    if !contains_all(&target, &candidate) || name.is_empty() {
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
    let named_in_title = candidate.windows(name.len()).any(|phrase| phrase == name);
    // Canonical performer metadata is used only for OMV music records, never as a channel-name gate.
    let canonical_match = kind == "MUSIC_VIDEO_TYPE_OMV"
        && canonical_artist
            .split(',')
            .any(|credit| words(credit) == name);
    if kind == "MUSIC_VIDEO_TYPE_OMV"
        && !canonical_artist.is_empty()
        && !canonical_match
        && !named_in_title
    {
        return None;
    }
    let needs_review = !named_in_title && !canonical_match;
    let mut score = if needs_review { 40 } else { 100 };
    let reason = if canonical_match {
        score += 100;
        "Музыкальное видео: совпали песня и исполнитель в метаданных"
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
    let byline = artist_runs
        .iter()
        .filter(|run| run.pointer("/navigationEndpoint/browseEndpoint").is_some())
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    let kind=title_runs.pointer("/0/navigationEndpoint/watchEndpoint/watchEndpointMusicSupportedConfigs/watchEndpointMusicConfig/musicVideoType").and_then(Value::as_str).unwrap_or("");
    let canonical_artist = if kind == "MUSIC_VIDEO_TYPE_OMV" {
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
        needs_review,
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
    rank(&mut results);
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
        .is_none());
        assert!(score("Missing", "Oasis", "Wonderwall", "Oasis", "").is_none());
        assert!(score("Wonderwall", "", "Wonderwall", "Oasis", "").is_none());
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
}
