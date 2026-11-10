use reqwest::{blocking::Client, redirect, StatusCode};
use scraper::{ElementRef, Node};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io::Read, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
use url::Url;

mod extra;
mod remix;
mod translate;

const WINDOW: &str = "lyrics";
const MAX_TEXT: usize = 48 * 1024;
const NETWORK_ERROR: &str = "Не удалось загрузить текст. Попробуйте ещё раз.";
type Lookup = fn(&Client, &str, &str) -> Result<Option<String>, ()>;

#[derive(Clone, Deserialize, Serialize)]
pub struct Lyrics {
    text: String,
    source: Source,
    #[serde(rename = "originalArtist", skip_serializing_if = "Option::is_none")]
    original_artist: Option<String>,
}

impl Lyrics {
    fn exact(text: String, source: Source) -> Self {
        Self {
            text,
            source,
            original_artist: None,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
enum Source {
    #[serde(rename = "Яндекс Музыка")]
    YandexMusic,
    #[serde(rename = "LRCLIB")]
    Lrclib,
    #[serde(rename = "lyrics.ovh")]
    LyricsOvh,
    #[serde(rename = "LrcAPI")]
    LrcApi,
    #[serde(rename = "Pesni.net")]
    PesniNet,
    #[serde(rename = "KuGou")]
    KuGou,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Snapshot {
    revision: u64,
    title: String,
    artist: String,
    #[serde(flatten)]
    content: Content,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum Content {
    Empty,
    Loading,
    Missing,
    Error,
    Ready { lyrics: Lyrics },
}

#[derive(Default)]
pub struct LyricsWindow(Mutex<Option<Snapshot>>);

impl LyricsWindow {
    fn update(&self, snapshot: Snapshot) -> Result<Option<Snapshot>, String> {
        let mut latest = self.0.lock().map_err(|_| "Lyrics window unavailable")?;
        if latest
            .as_ref()
            .is_some_and(|old| old.revision >= snapshot.revision)
        {
            return Ok(None);
        }
        if let Content::Ready { lyrics } = &snapshot.content {
            if lyrics.text.len() > MAX_TEXT {
                return Err("Lyrics text too long".into());
            }
        }
        *latest = Some(snapshot.clone());
        Ok(Some(snapshot))
    }
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Not available in this window".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn lyrics_search(
    window: WebviewWindow,
    track_id: Option<String>,
    title: String,
    artist: String,
) -> Result<Option<Lyrics>, String> {
    main_only(&window)?;
    if [&title, &artist]
        .iter()
        .any(|value| value.trim().is_empty() || value.len() > 1024)
    {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || search(track_id.as_deref(), &title, &artist))
        .await
        .map_err(|_| NETWORK_ERROR.to_owned())?
}

#[tauri::command]
pub async fn lyrics_translate(window: WebviewWindow, text: String) -> Result<String, String> {
    if !matches!(window.label(), "main" | WINDOW) {
        return Err("Not available in this window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        translate::to_russian(&text).map_err(str::to_owned)
    })
    .await
    .map_err(|_| "Не удалось перевести текст.".to_owned())?
}

fn search(track_id: Option<&str>, title: &str, artist: &str) -> Result<Option<Lyrics>, String> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .redirect(redirect::Policy::none())
        .https_only(true)
        .user_agent(concat!("YCore-Music/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| NETWORK_ERROR.to_owned())?;
    let exact = search_exact(&client, track_id, title, artist);
    if !matches!(exact, Ok(Some(_))) {
        if let Some(original) =
            track_id.and_then(|id| remix::original_track(&client, id, title, artist))
        {
            if let Ok(Some(mut lyrics)) = search_exact(
                &client,
                Some(&original.id),
                &original.title,
                &original.artist,
            ) {
                lyrics.original_artist = Some(original.artist);
                return Ok(Some(lyrics));
            }
        }
    }
    exact
}

fn search_exact(
    client: &Client,
    track_id: Option<&str>,
    title: &str,
    artist: &str,
) -> Result<Option<Lyrics>, String> {
    if let Some(text) = track_id.and_then(|id| extra::yandex_music(client, id)) {
        return Ok(Some(Lyrics::exact(text, Source::YandexMusic)));
    }
    let mut searched = false;
    let providers: [(Source, Lookup); 2] =
        [(Source::Lrclib, lrclib), (Source::LyricsOvh, lyrics_ovh)];
    for (source, lookup) in providers {
        match lookup(client, title, artist) {
            Ok(Some(text)) => return Ok(Some(Lyrics::exact(text, source))),
            Ok(None) => searched = true,
            Err(()) => {}
        }
    }
    let extra: [(Source, Lookup); 3] = [
        (Source::LrcApi, extra::lrcapi),
        (Source::PesniNet, extra::pesni),
        (Source::KuGou, extra::kugou),
    ];
    let lyrics = std::thread::scope(|scope| {
        let handles = extra
            .map(|(source, lookup)| (source, scope.spawn(move || lookup(client, title, artist))));
        for (source, handle) in handles {
            match handle.join() {
                Ok(Ok(Some(text))) => return Some(Lyrics::exact(text, source)),
                Ok(Ok(None)) => searched = true,
                _ => {}
            }
        }
        None
    });
    if lyrics.is_some() {
        return Ok(lyrics);
    }
    if searched {
        Ok(None)
    } else {
        Err(NETWORK_ERROR.to_owned())
    }
}

fn body(client: &Client, url: Url, limit: u64) -> Result<Option<String>, ()> {
    let response = client.get(url).send().map_err(|_| ())?;
    read_body(response, limit)
}

fn read_body(response: reqwest::blocking::Response, limit: u64) -> Result<Option<String>, ()> {
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > limit {
        return Err(());
    }
    String::from_utf8(bytes).map(Some).map_err(|_| ())
}

fn normalized(value: &str) -> String {
    let value = value
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>();
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn matches_track(candidate_title: &str, candidate_artist: &str, title: &str, artist: &str) -> bool {
    let (title, artist) = (normalized(title), normalized(artist));
    !title.is_empty()
        && !artist.is_empty()
        && normalized(candidate_title) == title
        && normalized(candidate_artist) == artist
}

fn append_lyrics(element: ElementRef<'_>, text: &mut String, depth: u8) {
    if depth == 64 || text.len() > MAX_TEXT || element.attr("data-exclude-from-selection").is_some()
    {
        return;
    }
    match element.value().name() {
        "script" | "style" | "button" => return,
        "br" => {
            text.push('\n');
            return;
        }
        _ => {}
    }
    for child in element.children() {
        if let Node::Text(value) = child.value() {
            text.push_str(&value.text);
        } else if let Some(element) = ElementRef::wrap(child) {
            append_lyrics(element, text, depth + 1);
        }
        if text.len() > MAX_TEXT {
            break;
        }
    }
    if matches!(element.value().name(), "p" | "li" | "div") {
        text.push('\n');
    }
}

fn plain_text(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty() && text.len() <= MAX_TEXT && !is_tablature(text))
        .then(|| text.replace("\r\n", "\n"))
}

fn is_tablature(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let tab_credit = ["bass tab", "guitar tab", "drum tab", "tablature"]
        .iter()
        .any(|label| lower.contains(label));
    if tab_credit
        && (lower.contains("akormerkezi.com") || lower.matches("fig.").take(3).count() == 3)
    {
        return true;
    }
    lower
        .lines()
        .filter(|line| {
            let Some((note, notes)) = line.trim().split_once('|') else {
                return false;
            };
            matches!(
                note.trim_end_matches(['#', 'b']),
                "a" | "b" | "c" | "d" | "e" | "f" | "g"
            ) && notes.starts_with('-')
                && notes.contains("---")
        })
        .take(3)
        .count()
        == 3
}

fn timestamp(tag: &str) -> bool {
    let Some((minutes, seconds)) = tag.split_once(':') else {
        return false;
    };
    let digits = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    digits(minutes) && seconds.split(['.', ':']).all(digits)
}

fn timed_text(text: &str) -> Option<String> {
    let mut output = String::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let mut line = line.trim();
        if let Some((tag, _)) = line.strip_prefix('[').and_then(|line| line.split_once(']')) {
            if tag.split_once(':').is_some_and(|(key, _)| {
                matches!(
                    key,
                    "ar" | "ti"
                        | "al"
                        | "by"
                        | "offset"
                        | "re"
                        | "ve"
                        | "length"
                        | "id"
                        | "hash"
                        | "sign"
                        | "qq"
                        | "total"
                )
            }) {
                continue;
            }
        }
        while let Some((tag, rest)) = line.strip_prefix('[').and_then(|line| line.split_once(']')) {
            if !timestamp(tag) {
                break;
            }
            line = rest;
        }
        while let Some((prefix, tail)) = line.split_once('<') {
            output.push_str(prefix);
            if let Some((tag, rest)) = tail.split_once('>') {
                if timestamp(tag) {
                    line = rest;
                    continue;
                }
            }
            output.push('<');
            line = tail;
        }
        output.push_str(line);
        output.push('\n');
    }
    let text = plain_text(&output)?;
    // Timed providers sometimes return a single instrumental notice.
    (text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(2)
        .count()
        == 2)
        .then_some(text)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibRecord {
    track_name: String,
    artist_name: String,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
    instrumental: bool,
}

fn lrclib(client: &Client, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let url = Url::parse_with_params(
        "https://lrclib.net/api/search",
        &[("track_name", title), ("artist_name", artist)],
    )
    .map_err(|_| ())?;
    let Some(body) = body(client, url, 1024 * 1024)? else {
        return Ok(None);
    };
    lrclib_text(&body, title, artist)
}

fn lrclib_text(body: &str, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let records: Vec<LrclibRecord> = serde_json::from_str(body).map_err(|_| ())?;
    let matching = || {
        records.iter().filter(|record| {
            !record.instrumental
                && matches_track(&record.track_name, &record.artist_name, title, artist)
        })
    };
    Ok(matching()
        .find_map(|record| plain_text(record.plain_lyrics.as_deref()?))
        .or_else(|| matching().find_map(|record| timed_text(record.synced_lyrics.as_deref()?))))
}

fn lyrics_ovh(client: &Client, title: &str, artist: &str) -> Result<Option<String>, ()> {
    let mut url = Url::parse("https://api.lyrics.ovh/v1/").map_err(|_| ())?;
    url.path_segments_mut()
        .map_err(|_| ())?
        .pop_if_empty()
        .push(artist)
        .push(title);
    let Some(body) = body(client, url, 128 * 1024)? else {
        return Ok(None);
    };
    let result: Value = serde_json::from_str(&body).map_err(|_| ())?;
    Ok(result["lyrics"].as_str().and_then(plain_text))
}

#[tauri::command]
pub async fn lyrics_open(window: WebviewWindow, snapshot: Snapshot) -> Result<(), String> {
    main_only(&window)?;
    let app = window.app_handle();
    lyrics_publish(window.clone(), snapshot)?;
    let lyrics = if let Some(lyrics) = app.get_webview_window(WINDOW) {
        lyrics
    } else {
        let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("lyrics.html".into()))
            .title("YCore Music · Текст песни")
            .inner_size(480.0, 620.0)
            .min_inner_size(320.0, 260.0)
            .additional_browser_args(
                app.config()
                    .app
                    .windows
                    .first()
                    .and_then(|config| config.additional_browser_args.as_deref())
                    .unwrap_or_default(),
            )
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_navigation(|url| {
                let app = matches!(
                    (url.scheme(), url.host_str()),
                    ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
                ) && url.port().is_none();
                let dev = cfg!(debug_assertions)
                    && url.scheme() == "http"
                    && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                    && url.port() == Some(1420);
                (app || dev) && url.path() == "/lyrics.html"
            });
        #[cfg(target_os = "linux")]
        let builder = if let Some(profile) = crate::embed_identity::isolated_profile(app) {
            builder.data_directory(profile)
        } else {
            builder
        };
        let lyrics = builder.build().map_err(|_| "Cannot create lyrics window")?;
        let app = app.clone();
        lyrics.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                let _ = app.emit_to("main", "lyrics-window-closed", ());
            }
        });
        lyrics
    };
    lyrics
        .unminimize()
        .map_err(|_| "Cannot restore lyrics window")?;
    lyrics
        .set_focus()
        .map_err(|_| "Cannot focus lyrics window".into())
}

#[tauri::command]
pub fn lyrics_publish(window: WebviewWindow, snapshot: Snapshot) -> Result<(), String> {
    main_only(&window)?;
    if let Some(snapshot) = window.state::<LyricsWindow>().update(snapshot)? {
        window
            .emit_to(WINDOW, "lyrics-state", snapshot)
            .map_err(|_| "Cannot update lyrics window")?;
    }
    Ok(())
}

#[tauri::command]
pub fn lyrics_snapshot(window: WebviewWindow) -> Result<Option<Snapshot>, String> {
    if window.label() != WINDOW {
        return Err("Not available in this window".into());
    }
    window
        .state::<LyricsWindow>()
        .0
        .lock()
        .map(|latest| latest.clone())
        .map_err(|_| "Lyrics window unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_instrument_tabs_but_keeps_normal_lyrics() {
        assert!(plain_text(
            "Fig.1 Fig.2 Fig.3 Downfall Bass Tab, AkorMerkezi.com'da yayınlanmıştır."
        )
        .is_none());
        assert!(plain_text("G------------------------------ 2x Children Of Decadence Bass Tab, AkorMerkezi.com'da yayınlanmıştır.").is_none());
        assert!(plain_text("E|---2-----|\nA|---0-----|\nD|---4-----|").is_none());
        assert_eq!(
            plain_text("I keep a guitar tab\nAnd play until the dawn").as_deref(),
            Some("I keep a guitar tab\nAnd play until the dawn")
        );
    }

    #[test]
    fn timed_sources_show_plain_verses_without_metadata_or_timestamps() {
        assert_eq!(
            timed_text(
                "[ar:Artist]\n[01:00.00][01:05.00]One <01:06.0>two\n\n[Chorus]\n[02:00]Three"
            )
            .as_deref(),
            Some("One two\n\n[Chorus]\nThree")
        );
        assert!(timed_text("[99:00.00]Instrumental").is_none());
    }

    #[test]
    fn uses_only_matching_lrclib_plain_text() {
        let body = r#"[
            {"trackName":"Song (Live)","artistName":"Artist","plainLyrics":"Live","instrumental":false},
            {"trackName":"Song","artistName":"Other","plainLyrics":"Other","instrumental":false},
            {"trackName":"Song","artistName":"Artist","syncedLyrics":"[01:00] Timed\n[01:01] Other line","instrumental":false},
            {"trackName":"Song","artistName":"Artist","plainLyrics":"One\nTwo","instrumental":false}
        ]"#;
        assert_eq!(
            lrclib_text(body, "SONG", "Artist").unwrap().as_deref(),
            Some("One\nTwo")
        );
        assert_eq!(lrclib_text(body, "Missing", "Artist").unwrap(), None);
    }
}
