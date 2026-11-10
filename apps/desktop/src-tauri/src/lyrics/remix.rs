use super::matches_track;
use crate::{catalogue, source::Track, yandex};
use chrono::NaiveDate;
use reqwest::blocking::Client;
use serde_json::Value;
use url::form_urlencoded;

pub(super) fn original_track(
    client: &Client,
    id: &str,
    title: &str,
    artist: &str,
) -> Option<Track> {
    if !catalogue::is_remix_version(title) {
        return None;
    }
    let remix = track_details(client, id)?;
    if !matches_track(
        &catalogue::playback_title(&remix)?,
        &catalogue::artists(&remix),
        title,
        artist,
    ) {
        return None;
    }
    let base = base_title(&remix)?;
    let released = first_release(&remix)?;

    if let Some(results) = search(client, base, artist) {
        if let Some(original) = candidates(&results, base, artist, id, released)
            .filter(|candidate| same_performers(&remix, candidate))
            .min_by_key(|candidate| first_release(candidate))
        {
            return catalogue::track(original);
        }
    }

    // Artist-owned labels can credit a guest remixer as the only performer.
    // Require the original's performer to be the label's namesake and the
    // older release to carry the very same catalogue label ID.
    let (label_id, label_name) = artist_label(&remix)?;
    if matches_track(base, label_name, base, artist) {
        return None;
    }
    let results = search(client, base, label_name)?;
    let candidate = candidates(&results, base, label_name, id, released)
        .min_by_key(|candidate| first_release(candidate))?;
    let candidate_id = catalogue::id(&candidate["id"])?;
    let candidate = track_details(client, &candidate_id)?;
    original_for_label(&candidate, base, &label_id, label_name, released)
}

fn track_details(client: &Client, id: &str) -> Option<Value> {
    let mut response =
        yandex::public_request(client, &format!("tracks/{id}"), None, 256 * 1024).ok()?;
    let track = response.pointer_mut("/result/0")?.take();
    (catalogue::id(&track["id"])?.as_str() == id).then_some(track)
}

fn search(client: &Client, title: &str, artist: &str) -> Option<Value> {
    let query = format!("{artist} {title}");
    if query.len() > 512 {
        return None;
    }
    let query = form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("text", query.as_str()),
            ("type", "all"),
            ("nocorrect", "False"),
            ("playlist-in-best", "True"),
            ("page", "0"),
        ])
        .finish();
    yandex::public_request(client, &format!("search?{query}"), None, 1024 * 1024).ok()
}

fn base_title(track: &Value) -> Option<&str> {
    let title = track["title"].as_str()?.trim();
    if let Some((base, suffix)) = title
        .strip_suffix(')')
        .and_then(|title| title.rsplit_once('('))
    {
        if catalogue::is_remix_version(suffix) {
            return Some(base.trim()).filter(|base| !base.is_empty());
        }
    }
    track["version"]
        .as_str()
        .filter(|version| catalogue::is_remix_version(version))?;
    Some(title).filter(|title| !title.is_empty())
}

fn albums(track: &Value) -> impl Iterator<Item = &Value> {
    track["albums"].as_array().into_iter().flatten()
}

fn release(album: &Value) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(album["releaseDate"].as_str()?.get(..10)?, "%Y-%m-%d").ok()
}

fn first_release(track: &Value) -> Option<NaiveDate> {
    albums(track).filter_map(release).min()
}

fn same_performers(remix: &Value, original: &Value) -> bool {
    fn artist_ids(track: &Value) -> Option<Vec<String>> {
        let mut ids = track["artists"]
            .as_array()?
            .iter()
            .map(|artist| catalogue::id(&artist["id"]))
            .collect::<Option<Vec<_>>>()?;
        ids.sort_unstable();
        Some(ids)
    }
    matches!((artist_ids(remix), artist_ids(original)), (Some(a), Some(b)) if !a.is_empty() && a == b)
}

fn artist_label(track: &Value) -> Option<(String, &str)> {
    let (_, album) = albums(track)
        .filter_map(|album| Some((release(album)?, album)))
        .min_by_key(|(date, _)| *date)?;
    let [label] = album["labels"].as_array()?.as_slice() else {
        return None;
    };
    let name = label["name"].as_str()?.trim();
    (!name.is_empty()).then_some((catalogue::id(&label["id"])?, name))
}

fn is_original(track: &Value, title: &str, artist: &str, before: NaiveDate) -> bool {
    track["version"]
        .as_str()
        .is_none_or(|version| version.trim().is_empty())
        && matches_track(
            track["title"].as_str().unwrap_or_default(),
            &catalogue::artists(track),
            title,
            artist,
        )
        && first_release(track).is_some_and(|date| date < before)
}

fn candidates<'a>(
    results: &'a Value,
    title: &'a str,
    artist: &'a str,
    remix_id: &'a str,
    released: NaiveDate,
) -> impl Iterator<Item = &'a Value> {
    results
        .pointer("/result/tracks/results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(move |track| {
            catalogue::id(&track["id"]).is_some_and(|id| id != remix_id)
                && is_original(track, title, artist, released)
        })
}

fn original_for_label(
    track: &Value,
    title: &str,
    label_id: &str,
    artist: &str,
    released: NaiveDate,
) -> Option<Track> {
    if !is_original(track, title, artist, released) || track["artists"].as_array()?.len() != 1 {
        return None;
    }
    let label_matches = albums(track)
        .filter(|album| release(album).is_some_and(|date| date < released))
        .flat_map(|album| album["labels"].as_array().into_iter().flatten())
        .any(|label| catalogue::id(&label["id"]).as_deref() == Some(label_id));
    if label_matches {
        catalogue::track(track)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn label_fallback_requires_an_older_original_with_the_same_label_and_credited_artist() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 7).unwrap();
        let original = json!({
            "id": "123", "title": "Song", "artists": [{"id": 3, "name": "Original Artist"}],
            "albums": [{"releaseDate": "2020-09-04T00:00:00+03:00",
                "labels": [{"id": 15, "name": "Original Artist"}]}]
        });
        assert!(original_for_label(&original, "Song", "15", "Original Artist", date).is_some());
        assert!(original_for_label(&original, "Song", "99", "Original Artist", date).is_none());
        assert!(original_for_label(&original, "Song", "15", "Other Artist", date).is_none());
        let mut another_remix = original;
        another_remix["version"] = json!("Another Remix");
        assert!(
            original_for_label(&another_remix, "Song", "15", "Original Artist", date).is_none()
        );
    }

    #[test]
    #[ignore = "Read-only public catalogue and lyrics check for the reported remix"]
    fn live_comets_original_lyrics() {
        let lyrics = super::super::search(
            Some("154314873"),
            "Кометы (Skazka Festival Remix)",
            "Saint Rider",
        )
        .expect("Lyrics search failed")
        .expect("Original lyrics missing");
        assert_eq!(lyrics.original_artist.as_deref(), Some("polnalyubvi"));
        assert!(!lyrics.text.trim().is_empty());
    }
}
