use crate::{
    catalogue::{self, Collection, Entity, Kind},
    credentials,
    source::Track,
    yandex,
};
use reqwest::{blocking::Client, header::HeaderValue, redirect::Policy};
use serde::Serialize;
use serde_json::{json, Value};
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
    pub owned_playlists: Vec<Entity>,
    pub albums: Option<Vec<Entity>>,
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
    let owned_playlists = playlists.clone();
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
    let albums = yandex::request_limited(
        &client,
        &format!("users/{uid}/likes/albums?rich=true"),
        &auth,
        None,
        16_000_000,
    )
    .ok()
    .and_then(|value| {
        Some(
            value["result"]
                .as_array()?
                .iter()
                .filter_map(|item| catalogue::album_entity(item.get("album").unwrap_or(item)))
                .collect(),
        )
    });
    Ok(Overview {
        playlists,
        liked_count,
        owned_playlists,
        albums,
    })
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Create {
        title: String,
    },
    SaveAlbum {
        id: String,
        save: bool,
    },
    Insert {
        kind: String,
        track: String,
    },
    ChangeRow {
        kind: String,
        revision: u64,
        index: usize,
        direction: i8,
    },
}

fn edit(action: Edit) -> Result<Option<String>, &'static str> {
    let (client, auth, uid) = context()?;
    let (kind, expected, edit_row, insert_track) = match action {
        Edit::Create { title } => {
            let title = title.trim();
            if title.is_empty() || title.chars().count() > 100 {
                return Err("Invalid playlist title");
            }
            let result = yandex::request_form(
                &client,
                &format!("users/{uid}/playlists/create"),
                &auth,
                &[("title", title.into()), ("visibility", "private".into())],
            )?;
            return result
                .pointer("/result/kind")
                .and_then(id)
                .map(Some)
                .ok_or("Playlist creation unconfirmed");
        }
        Edit::SaveAlbum { id: album, save } if valid_id(&album) => {
            let method = if save { "add-multiple" } else { "remove" };
            let result = yandex::request_form(
                &client,
                &format!("users/{uid}/likes/albums/{method}"),
                &auth,
                &[("album-ids", album)],
            )?;
            return (result["result"].as_str() == Some("ok"))
                .then_some(None)
                .ok_or("Album change unconfirmed");
        }
        Edit::Insert { kind, track } if valid_id(&track) => (kind, None, None, Some(track)),
        Edit::ChangeRow {
            kind,
            revision,
            index,
            direction,
        } if (-1..=1).contains(&direction) => {
            (kind, Some(revision), Some((index, direction)), None)
        }
        _ => return Err("Invalid library edit"),
    };
    if !valid_id(&kind) {
        return Err("Invalid playlist");
    }
    let owned = yandex::request(&client, &format!("users/{uid}/playlists/list"), &auth, None)?;
    if !playlist_items(&owned, &uid)?
        .iter()
        .any(|entry| entry.id == kind && entry.owner.as_deref() == Some(uid.as_str()))
    {
        return Err("Playlist is not editable");
    }
    let path = format!("users/{uid}/playlists/{kind}");
    let value = yandex::request_limited(&client, &path, &auth, None, 16_000_000)?;
    let revision = value
        .pointer("/result/revision")
        .and_then(Value::as_u64)
        .ok_or("Playlist revision unavailable")?;
    if expected.is_some_and(|expected| expected != revision) {
        return Err("Playlist changed");
    }
    let rows = value
        .pointer("/result/tracks")
        .and_then(Value::as_array)
        .ok_or("Playlist tracks unavailable")?;
    let diff = if let Some(track) = insert_track {
        let metadata = yandex::request(&client, &format!("tracks/{track}"), &auth, None)?;
        let album = metadata
            .pointer("/result/0/albums/0/id")
            .and_then(id)
            .ok_or("Track album unavailable")?;
        json!([{"op":"insert","at":0,"tracks":[{"id":track,"albumId":album}]}])
    } else if let Some((index, direction)) = edit_row {
        let row = rows.get(index).ok_or("Playlist row unavailable")?;
        let remove = json!({"op":"delete","from":index,"to":index + 1});
        if direction == 0 {
            json!([remove])
        } else {
            let target = index
                .checked_add_signed(direction.into())
                .filter(|target| *target < rows.len())
                .ok_or("Invalid playlist position")?;
            let track = row
                .get("id")
                .or_else(|| row.pointer("/track/id"))
                .and_then(id)
                .ok_or("Track unavailable")?;
            let album = row
                .get("albumId")
                .or_else(|| row.pointer("/track/albums/0/id"))
                .and_then(id)
                .ok_or("Track album unavailable")?;
            json!([remove, {"op":"insert","at":target,"tracks":[{"id":track,"albumId":album}]}])
        }
    } else {
        return Err("Invalid library edit");
    };
    let result = yandex::request_form(
        &client,
        &format!("{path}/change"),
        &auth,
        &[
            ("kind", kind),
            ("revision", revision.to_string()),
            ("diff", diff.to_string()),
        ],
    )?;
    result
        .pointer("/result/revision")
        .and_then(Value::as_u64)
        .filter(|next| *next > revision)
        .map(|_| None)
        .ok_or("Playlist change unconfirmed")
}

#[tauri::command]
pub async fn library_edit(
    window: tauri::WebviewWindow,
    action: Edit,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(move || edit(action))
        .await
        .map_err(|_| "Library edit worker failed".to_owned())?
        .map_err(str::to_owned)
}

#[tauri::command]
pub async fn library_owned_playlists(window: tauri::WebviewWindow) -> Result<Vec<Entity>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let (client, auth, uid) = context()?;
        let result = yandex::request_limited(
            &client,
            &format!("users/{uid}/playlists/list"),
            &auth,
            None,
            16_000_000,
        )?;
        Ok::<_, &'static str>(
            playlist_items(&result, &uid)?
                .into_iter()
                .filter(|playlist| playlist.owner.as_deref() == Some(uid.as_str()))
                .collect(),
        )
    })
    .await
    .map_err(|_| "Library worker failed".to_owned())?
    .map_err(str::to_owned)
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
                cover_url: None,
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
        revision: None,
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
