use crate::{
    catalogue::{self, Entity, Kind},
    library,
    source::Track,
    yandex,
};
use serde::Serialize;
use serde_json::Value;
#[derive(Serialize)]
pub struct Discovery {
    pub title: String,
    pub tracks: Vec<Track>,
    pub playlists: Vec<Entity>,
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
    let (client, auth, _) = library::context()?;
    let chart = yandex::request_limited(&client, "landing3/chart", &auth, None, 16_000_000)?;
    let landing = yandex::request_limited(
        &client,
        "landing3?blocks=playlists,new-playlists",
        &auth,
        None,
        16_000_000,
    )?;
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
