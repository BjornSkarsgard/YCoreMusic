use super::{append_lyrics, body, matches_track, plain_text, timed_text};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use scraper::{Html, Selector};
use serde_json::Value;
use url::Url;

pub(super) fn yandex_music(client: &Client, id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let token = crate::credentials::load().ok()?;
    let auth = crate::yandex::authorization(&token).ok()?;
    let response = crate::yandex::request_limited(
        client,
        &format!("tracks/{id}/supplement"),
        &auth,
        None,
        128 * 1024,
    )
    .ok()?;
    plain_text(response.pointer("/result/lyrics/fullLyrics")?.as_str()?)
}

pub(super) fn lrcapi(client: &Client, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let url = Url::parse_with_params(
        "https://api.lrc.cx/jsonapi",
        &[("title", title), ("artist", artist)],
    )
    .map_err(|_| ())?;
    let Some(body) = body(client, url, 1024 * 1024)? else {
        return Ok(None);
    };
    let rows: Vec<Value> = serde_json::from_str(&body).map_err(|_| ())?;
    Ok(rows
        .iter()
        .filter(|row| {
            matches_track(
                row["title"].as_str().unwrap_or_default(),
                row["artist"].as_str().unwrap_or_default(),
                title,
                artist,
            )
        })
        .find_map(|row| timed_text(row["lrc"].as_str()?)))
}

pub(super) fn kugou(client: &Client, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let search = Url::parse_with_params(
        "https://lyrics.kugou.com/search",
        &[
            ("ver", "1"),
            ("man", "yes"),
            ("client", "pc"),
            ("keyword", &format!("{artist} {title}")),
        ],
    )
    .map_err(|_| ())?;
    let Some(results) = body(client, search, 256 * 1024)? else {
        return Ok(None);
    };
    let results: Value = serde_json::from_str(&results).map_err(|_| ())?;
    let Some((id, key)) = results["candidates"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|row| {
            if !matches_track(
                row["song"].as_str()?,
                row["singer"].as_str()?,
                title,
                artist,
            ) {
                return None;
            }
            Some((row["id"].as_str()?, row["accesskey"].as_str()?))
        })
    else {
        return Ok(None);
    };
    let url = Url::parse_with_params(
        "https://lyrics.kugou.com/download",
        &[
            ("ver", "1"),
            ("client", "pc"),
            ("fmt", "lrc"),
            ("charset", "utf8"),
            ("id", id),
            ("accesskey", key),
        ],
    )
    .map_err(|_| ())?;
    let Some(result) = body(client, url, 128 * 1024)? else {
        return Ok(None);
    };
    let result: Value = serde_json::from_str(&result).map_err(|_| ())?;
    let Some(encoded) = result["content"].as_str() else {
        return Ok(None);
    };
    let decoded = STANDARD.decode(encoded).map_err(|_| ())?;
    Ok(timed_text(std::str::from_utf8(&decoded).map_err(|_| ())?))
}

pub(super) fn pesni(client: &Client, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let url = Url::parse_with_params(
        "https://www.pesni.net/search",
        &[("q", format!("{artist} {title}"))],
    )
    .map_err(|_| ())?;
    let Some(search) = body(client, url.clone(), 1024 * 1024)? else {
        return Ok(None);
    };
    let html = Html::parse_document(&search);
    let selector = Selector::parse(".search-results a.song-item").map_err(|_| ())?;
    let Some(song) = html.select(&selector).find_map(|link| {
        let label = link.text().collect::<String>();
        let (name, track) = label.split_once(" - ")?;
        if !matches_track(track, name, title, artist) {
            return None;
        }
        let song = url.join(link.attr("href")?).ok()?;
        (song.scheme() == "https"
            && song.host_str() == Some("www.pesni.net")
            && song.port().is_none()
            && song.username().is_empty()
            && song.password().is_none()
            && song.path().starts_with("/text/")
            && song.path_segments()?.count() == 3)
            .then_some(song)
    }) else {
        return Ok(None);
    };
    Ok(body(client, song, 1024 * 1024)?.and_then(|html| pesni_text(&html, title, artist)))
}

fn pesni_text(html: &str, title: &str, artist: &str) -> Option<String> {
    let html = Html::parse_document(html);
    let selector = Selector::parse(".song-page").ok()?;
    let song = html.select(&selector).next()?;
    if !matches_track(
        song.attr("data-quote-title-value")?,
        song.attr("data-quote-artist-value")?,
        title,
        artist,
    ) {
        return None;
    }
    let selector = Selector::parse(".song-block-text").ok()?;
    let mut text = String::new();
    append_lyrics(song.select(&selector).next()?, &mut text, 0);
    plain_text(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Read-only Yandex Music lyrics probe using the saved credential"]
    fn live_yandex_lyrics_probe() {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let results = crate::catalogue::search("Rammstein Sonne", 0).unwrap();
        let track = results
            .tracks
            .iter()
            .find(|track| matches_track(&track.title, &track.artist, "Sonne", "Rammstein"))
            .expect("No exact Yandex catalogue match");
        assert!(
            yandex_music(&client, &track.id).is_some(),
            "No text in Yandex Music supplement"
        );
        let result = super::super::search(Some(&track.id), &track.title, &track.artist).unwrap();
        assert!(matches!(
            result.map(|lyrics| lyrics.source),
            Some(super::super::Source::YandexMusic)
        ));
        for title in ["Downfall", "Children Of Decadence"] {
            let artist = "Children Of Bodom";
            let results = crate::catalogue::search(&format!("{artist} {title}"), 0).unwrap();
            let track = results
                .tracks
                .iter()
                .find(|track| matches_track(&track.title, &track.artist, title, artist))
                .expect("No exact Yandex catalogue match");
            let lyrics = super::super::search(Some(&track.id), &track.title, &track.artist)
                .unwrap()
                .expect("No lyrics found after rejecting instrument tabs");
            assert!(!super::super::is_tablature(&lyrics.text));
            println!(
                "{title}: {}",
                serde_json::to_string(&lyrics.source).unwrap()
            );
        }
    }

    #[test]
    #[ignore = "Read-only public lyrics provider checks"]
    fn live_public_lyrics_providers() {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .build()
            .unwrap();
        for (name, lookup) in [
            ("LrcAPI", lrcapi as super::super::Lookup),
            ("Pesni.net", pesni),
            ("KuGou", kugou),
        ] {
            assert!(
                lookup(&client, "Sonne", "Rammstein")
                    .ok()
                    .flatten()
                    .is_some(),
                "{name} returned no text"
            );
        }
    }

    #[test]
    fn pesni_requires_the_original_track_and_preserves_lines() {
        let html = r#"<div class="song-page" data-quote-artist-value="Artist" data-quote-title-value="Song"><div class="song-block-text">One &amp; two<br><a>Three</a><script>Ignored</script></div><div class="song-block-text">Translation</div></div>"#;
        assert_eq!(
            pesni_text(html, "Song", "Artist").as_deref(),
            Some("One & two\nThree")
        );
        assert_eq!(pesni_text(html, "Song", "Other"), None);
    }
}
