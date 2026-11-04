use crate::{
    catalogue::{self, Entity, Kind},
    credentials, library,
    source::Track,
    yandex,
};
use reqwest::{blocking::Client, redirect::Policy};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
#[derive(Serialize)]
pub struct Discovery {
    pub title: String,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Entity>,
    #[serde(rename = "playlistsAvailable")]
    pub playlists_available: bool,
}
fn parse(chart: &Value, landing: &Value) -> Result<Discovery, &'static str> {
    let chart = chart
        .pointer("/result/chart")
        .ok_or("Invalid chart schema")?;
    let items = chart
        .get("tracks")
        .and_then(Value::as_array)
        .ok_or("Chart tracks unavailable")?;
    let tracks = items
        .iter()
        .map(|item| catalogue::track(item).ok_or("Invalid chart track"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut playlists = Vec::new();
    if let Some(blocks) = landing.pointer("/result/blocks").and_then(Value::as_array) {
        for block in blocks {
            if let Some(items) = block.get("entities").and_then(Value::as_array) {
                for item in items {
                    let item = item
                        .pointer("/data/playlist")
                        .or_else(|| item.get("data"))
                        .unwrap_or(item);
                    let Some(id) = item.get("kind").and_then(number_id) else {
                        continue;
                    };
                    let Some(owner) = item
                        .pointer("/owner/uid")
                        .or_else(|| item.get("uid"))
                        .and_then(number_id)
                    else {
                        continue;
                    };
                    if playlists
                        .iter()
                        .any(|p: &Entity| p.id == id && p.owner.as_deref() == Some(&owner))
                    {
                        continue;
                    }
                    playlists.push(Entity {
                        kind: Kind::Playlist,
                        id,
                        owner: Some(owner),
                        title: item
                            .get("title")
                            .and_then(Value::as_str)
                            .unwrap_or("Подборка Яндекс Музыки")
                            .into(),
                        subtitle: item
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .chars()
                            .take(160)
                            .collect(),
                    });
                }
            }
        }
    }
    Ok(Discovery {
        playlists_available: landing
            .pointer("/result/blocks")
            .is_some_and(Value::is_array),
        title: chart
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Чарт Яндекс Музыки")
            .into(),
        tracks,
        playlists,
    })
}
fn number_id(value: &Value) -> Option<String> {
    let id = match value {
        Value::String(v) => v.clone(),
        Value::Number(v) => v.to_string(),
        _ => return None,
    };
    library::valid_id(&id).then_some(id)
}
pub fn fetch() -> Result<Discovery, &'static str> {
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "Cannot initialize discovery client")?;
    let auth = credentials::load()
        .ok()
        .and_then(|token| yandex::authorization(&token).ok());
    let chart = yandex::public_request(&client, "landing3/chart", auth.as_ref(), 16_000_000)?;
    // Guest landing currently rejects this request. It must not hide the public chart.
    let landing = if let Some(auth) = auth.as_ref() {
        yandex::request_limited(
            &client,
            "landing3?blocks=playlists,new-playlists",
            auth,
            None,
            16_000_000,
        )
        .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    parse(&chart, &landing)
}
#[tauri::command]
pub async fn discovery_fetch(window: tauri::WebviewWindow) -> Result<Discovery, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(fetch)
        .await
        .map_err(|_| "Discovery worker failed".to_string())?
        .map_err(str::to_string)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_editorial_landing_does_not_hide_public_chart_or_reorder_tracks() {
        let value = parse(&serde_json::json!({"result":{"chart":{"title":"Public chart","tracks":[{"track":{"id":"2","title":"Two","artists":[]}},{"track":{"id":"1","title":"One","artists":[]}}]}}}), &Value::Null).unwrap();
        assert_eq!(
            value
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["2", "1"]
        );
        assert!(!value.playlists_available);
        assert!(value.playlists.is_empty());
    }
    #[test]
    #[ignore = "Read-only live chart and editorial playlist probe"]
    fn live_discovery() {
        let result = fetch().unwrap();
        assert!(!result.tracks.is_empty());
        println!(
            "Live discovery: PASS ({} chart tracks, {} editorial playlists)",
            result.tracks.len(),
            result.playlists.len()
        );
    }
}
