use crate::{
    catalogue::{self, Collection, Entity, Kind},
    credentials,
    source::Track,
    yandex,
};
use reqwest::{blocking::Client, header::HeaderValue, redirect::Policy};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, time::Duration};

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_digit())
}
fn id(value: &Value) -> Option<String> {
    let id = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    valid_id(&id).then_some(id)
}
pub fn context() -> Result<(Client, HeaderValue, String), &'static str> {
    let token = credentials::load()?;
    let auth = yandex::authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize HTTPS")?;
    let account = yandex::request(&client, "account/status", &auth, None)?;
    let uid = account
        .pointer("/result/account/uid")
        .and_then(id)
        .ok_or("Account unavailable")?;
    Ok((client, auth, uid))
}
pub fn reaction_ids(
    client: &Client,
    auth: &HeaderValue,
    uid: &str,
    kind: &str,
) -> Result<Vec<String>, &'static str> {
    if !valid_id(uid) || !matches!(kind, "likes" | "dislikes") {
        return Err("Invalid library request");
    }
    let value = yandex::request_limited(
        client,
        &format!("users/{uid}/{kind}/tracks"),
        auth,
        None,
        16_000_000,
    )?;
    let items = value
        .pointer("/result/library/tracks")
        .and_then(Value::as_array)
        .ok_or("Invalid library tracks schema")?;
    items
        .iter()
        .map(|item| {
            item.get("id")
                .and_then(id)
                .ok_or("Invalid library track ID")
        })
        .collect()
}
#[derive(Serialize)]
pub struct Overview {
    pub playlists: Vec<Entity>,
    pub liked_count: usize,
}
fn playlist_items(value: &Value, uid: &str) -> Result<Vec<Entity>, &'static str> {
    let items = value
        .get("result")
        .and_then(Value::as_array)
        .ok_or("Invalid playlists schema")?;
    items
        .iter()
        .map(|item| {
            let item = item.get("playlist").unwrap_or(item);
            Ok(Entity {
                kind: Kind::Playlist,
                id: item.get("kind").and_then(id).ok_or("Invalid playlist ID")?,
                owner: Some(
                    item.pointer("/owner/uid")
                        .or_else(|| item.get("uid"))
                        .and_then(id)
                        .unwrap_or_else(|| uid.into()),
                ),
                title: item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Плейлист")
                    .into(),
                subtitle: item
                    .get("trackCount")
                    .and_then(Value::as_u64)
                    .map(|n| format!("{n} треков"))
                    .unwrap_or_default(),
            })
        })
        .collect()
}
pub fn overview() -> Result<Overview, &'static str> {
    let (client, auth, uid) = context()?;
    let value = yandex::request_limited(
        &client,
        &format!("users/{uid}/playlists/list"),
        &auth,
        None,
        16_000_000,
    )?;
    let mut playlists = playlist_items(&value, &uid)?;
    let saved = yandex::request_limited(
        &client,
        &format!("users/{uid}/likes/playlists"),
        &auth,
        None,
        16_000_000,
    )?;
    for playlist in playlist_items(&saved, &uid)? {
        if !playlists
            .iter()
            .any(|p| p.owner == playlist.owner && p.id == playlist.id)
        {
            playlists.push(playlist);
        }
    }
    let liked_count = reaction_ids(&client, &auth, &uid, "likes")?.len();
    Ok(Overview {
        playlists,
        liked_count,
    })
}
fn ordered_metadata(ids: &[String], value: &Value) -> Result<Vec<Track>, &'static str> {
    let items = value
        .get("result")
        .and_then(Value::as_array)
        .ok_or("Invalid track metadata schema")?;
    let metadata: HashMap<_, _> = items
        .iter()
        .filter_map(catalogue::track)
        .map(|t| (t.id.clone(), t))
        .collect();
    Ok(ids
        .iter()
        .map(|id| {
            metadata.get(id).cloned().unwrap_or_else(|| Track {
                id: id.clone(),
                title: "Недоступный трек".into(),
                artist: String::new(),
            })
        })
        .collect())
}
pub fn liked_collection(page: u32) -> Result<Collection, &'static str> {
    if page > 1000 {
        return Err("Invalid library page");
    }
    let (client, auth, uid) = context()?;
    let ids = reaction_ids(&client, &auth, &uid, "likes")?;
    let selected: Vec<_> = ids
        .iter()
        .skip(page as usize * 100)
        .take(100)
        .cloned()
        .collect();
    let tracks = if selected.is_empty() {
        Vec::new()
    } else {
        let value = yandex::request_form(
            &client,
            "tracks",
            &auth,
            &[("track-ids", selected.join(","))],
        )?;
        ordered_metadata(&selected, &value)?
    };
    Ok(Collection {
        title: "Мне нравится".into(),
        tracks,
        page,
        has_more: (page as usize + 1) * 100 < ids.len(),
    })
}
#[tauri::command]
pub async fn library_overview(window: tauri::WebviewWindow) -> Result<Overview, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(overview)
        .await
        .map_err(|_| "Library worker failed".to_string())?
        .map_err(str::to_string)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn metadata_restores_server_order_duplicates_and_unavailable_entries() {
        let ids = vec!["2".into(), "1".into(), "2".into(), "3".into()];
        let tracks = ordered_metadata(
            &ids,
            &json!({"result":[{"id":1,"title":"First"},{"id":2,"title":"Second"}]}),
        )
        .unwrap();
        assert_eq!(
            tracks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["2", "1", "2", "3"]
        );
        assert_eq!(tracks[3].title, "Недоступный трек");
    }
    #[test]
    fn saved_playlists_preserve_their_owner() {
        let list = playlist_items(
            &json!({"result":[{"playlist":{"kind":7,"owner":{"uid":9},"title":"Saved"}}]}),
            "1",
        )
        .unwrap();
        assert_eq!(list[0].owner.as_deref(), Some("9"));
    }
    #[test]
    #[ignore = "Read-only personal library probe; counts only"]
    fn live_library() {
        let value = overview().unwrap();
        let likes = liked_collection(0).unwrap();
        println!(
            "Personal library: PASS ({} playlists, {} likes, {} metadata entries)",
            value.playlists.len(),
            value.liked_count,
            likes.tracks.len()
        );
    }
}
