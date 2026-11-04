use crate::{credentials, source::Track, yandex};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Artist,
    Album,
    Playlist,
    Likes,
}
#[derive(Serialize)]
pub struct Entity {
    pub kind: Kind,
    pub id: String,
    pub owner: Option<String>,
    pub title: String,
    pub subtitle: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub corrected: Option<String>,
    pub artists: Vec<Entity>,
    pub tracks: Vec<Track>,
    pub albums: Vec<Entity>,
    pub playlists: Vec<Entity>,
    pub page: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub title: String,
    pub tracks: Vec<Track>,
    pub has_more: bool,
    pub page: u32,
}
fn id(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    valid_id(&text).then_some(text)
}
fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|c| c.is_ascii_digit())
}
fn artists(value: &Value) -> String {
    value
        .get("artists")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}
pub(crate) fn track(value: &Value) -> Option<Track> {
    let value = value
        .get("track")
        .filter(|track| track.is_object())
        .unwrap_or(value);
    Some(Track {
        id: id(value.get("id")?)?,
        title: value.get("title")?.as_str()?.to_owned(),
        artist: artists(value),
    })
}
fn ordered_track(value: &Value) -> Result<Track, &'static str> {
    if let Some(track) = track(value) {
        return Ok(track);
    }
    let raw = value
        .get("track")
        .filter(|track| track.is_object())
        .unwrap_or(value);
    let id = raw
        .get("id")
        .and_then(id)
        .ok_or("Collection contains an invalid track")?;
    Ok(Track {
        id,
        title: "Недоступный трек".into(),
        artist: String::new(),
    })
}
fn entities(result: &Value, section: &str, kind: Kind) -> Vec<Entity> {
    result
        .pointer(&format!("/{section}/results"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let key = if matches!(kind, Kind::Playlist) {
                        "kind"
                    } else {
                        "id"
                    };
                    let owner = if matches!(kind, Kind::Playlist) {
                        item.pointer("/owner/uid")
                            .or_else(|| item.get("uid"))
                            .and_then(id)
                    } else {
                        None
                    };
                    if matches!(kind, Kind::Playlist) && owner.is_none() {
                        return None;
                    }
                    Some(Entity {
                        kind,
                        id: id(item.get(key)?)?,
                        owner,
                        title: item
                            .get(if matches!(kind, Kind::Artist) {
                                "name"
                            } else {
                                "title"
                            })?
                            .as_str()?
                            .to_owned(),
                        subtitle: if matches!(kind, Kind::Artist) {
                            "Исполнитель".into()
                        } else {
                            artists(item)
                        },
                    })
                })
                .take(30)
                .collect()
        })
        .unwrap_or_default()
}
fn parse_results(value: &Value, page: u32) -> Result<Results, &'static str> {
    let result = value
        .get("result")
        .filter(|value| value.is_object())
        .ok_or("Invalid catalogue search schema")?;
    Ok(Results {
        corrected: result
            .get("misspellResult")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        artists: entities(result, "artists", Kind::Artist),
        albums: entities(result, "albums", Kind::Album),
        playlists: entities(result, "playlists", Kind::Playlist),
        tracks: result
            .pointer("/tracks/results")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(track).take(50).collect())
            .unwrap_or_default(),
        page,
    })
}
fn request(path: &str, params: &[(&str, String)]) -> Result<Value, &'static str> {
    let token = credentials::load()?;
    let auth = yandex::authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize catalogue client")?;
    let mut url = Url::parse(&format!("https://api.music.yandex.net/{path}"))
        .map_err(|_| "Invalid catalogue URL")?;
    url.query_pairs_mut()
        .extend_pairs(params.iter().map(|(key, value)| (*key, value.as_str())));
    let relative = url
        .as_str()
        .strip_prefix("https://api.music.yandex.net/")
        .ok_or("Invalid catalogue origin")?;
    yandex::request(&client, relative, &auth, None)
}
pub fn search(query: &str, page: u32) -> Result<Results, &'static str> {
    if query.trim().chars().count() < 2 || query.len() > 512 || page > 1000 {
        return Err("Invalid catalogue query");
    }
    let value = request(
        "search",
        &[
            ("text", query.trim().to_owned()),
            ("type", "all".into()),
            ("nocorrect", "False".into()),
            ("playlist-in-best", "True".into()),
            ("page", page.to_string()),
        ],
    )?;
    parse_results(&value, page)
}
fn parse_collection(value: &Value, kind: Kind, page: u32) -> Result<Collection, &'static str> {
    let result = value.get("result").ok_or("Invalid collection schema")?;
    let title = result
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Песни исполнителя")
        .to_owned();
    if matches!(kind, Kind::Artist) {
        let items = result
            .get("tracks")
            .and_then(Value::as_array)
            .ok_or("Invalid artist tracks schema")?;
        let tracks = items
            .iter()
            .map(ordered_track)
            .collect::<Result<Vec<_>, _>>()?;
        let total = result.pointer("/pager/total").and_then(Value::as_u64);
        return Ok(Collection {
            title,
            tracks,
            has_more: total
                .map(|total| (page as u64 + 1) * 50 < total)
                .unwrap_or(items.len() == 50),
            page,
        });
    }
    let items: Vec<&Value> = if matches!(kind, Kind::Album) {
        result
            .get("volumes")
            .and_then(Value::as_array)
            .ok_or("Invalid album schema")?
            .iter()
            .filter_map(Value::as_array)
            .flatten()
            .collect()
    } else {
        result
            .get("tracks")
            .and_then(Value::as_array)
            .ok_or("Playlist tracks are unavailable")?
            .iter()
            .collect()
    };
    let start = page as usize * 100;
    let has_more = start + 100 < items.len();
    let tracks = items
        .into_iter()
        .skip(start)
        .take(100)
        .map(ordered_track)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Collection {
        title,
        tracks,
        has_more,
        page,
    })
}
pub fn collection(
    kind: Kind,
    entity_id: &str,
    owner: Option<&str>,
    page: u32,
) -> Result<Collection, &'static str> {
    if !valid_id(entity_id) || page > 1000 {
        return Err("Invalid catalogue entity");
    }
    let value = match kind {
        Kind::Artist => request(
            &format!("artists/{entity_id}/tracks"),
            &[("page", page.to_string()), ("page-size", "50".into())],
        )?,
        Kind::Album => request(&format!("albums/{entity_id}/with-tracks"), &[])?,
        Kind::Playlist => {
            let owner = owner
                .filter(|owner| valid_id(owner))
                .ok_or("Invalid playlist owner")?;
            request(&format!("users/{owner}/playlists/{entity_id}"), &[])?
        }
        Kind::Likes => return crate::library::liked_collection(page),
    };
    parse_collection(&value, kind, page)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn all_sections_keep_ids_owner_and_server_order() {
        let value = json!({"result":{"misspellResult":"Rammstein","artists":{"results":[{"id":1,"name":"Rammstein"}]},"tracks":{"results":[{"id":2,"title":"Du hast","artists":[{"name":"Rammstein"}]}]},"albums":{"results":[{"id":3,"title":"Sehnsucht"}]},"playlists":{"results":[{"kind":4,"owner":{"uid":5},"title":"Playlist"}]}}});
        let result = parse_results(&value, 0).unwrap();
        assert_eq!(result.artists[0].title, "Rammstein");
        assert_eq!(result.tracks[0].id, "2");
        assert_eq!(result.playlists[0].owner.as_deref(), Some("5"));
        assert_eq!(result.corrected.as_deref(), Some("Rammstein"));
    }
    #[test]
    fn album_discs_and_playlist_repeats_are_not_reordered() {
        let album = json!({"result":{"title":"Album","volumes":[[{"id":3,"title":"Three"}],[{"id":1,"title":"One"}]]}});
        assert_eq!(
            parse_collection(&album, Kind::Album, 0)
                .unwrap()
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["3", "1"]
        );
        let playlist = json!({"result":{"title":"Playlist","tracks":[{"track":{"id":2,"title":"Two"}},{"track":{"id":2,"title":"Two"}}]}});
        assert_eq!(
            parse_collection(&playlist, Kind::Playlist, 0)
                .unwrap()
                .tracks
                .len(),
            2
        );
    }
    #[test]
    fn entity_paths_reject_injection_and_partial_items() {
        assert!(!valid_id("../123"));
        assert!(!valid_id("123?x=1"));
        assert!(track(&json!({"id":1})).is_none());
    }
    #[test]
    #[ignore = "Read-only real Yandex catalogue; uses OS credential store"]
    fn live_catalogue() {
        let results = search("рамштайн", 0).unwrap();
        assert!(results
            .artists
            .iter()
            .any(|artist| artist.title.eq_ignore_ascii_case("Rammstein")));
        assert!(
            !results.artists.is_empty()
                && !results.tracks.is_empty()
                && !results.albums.is_empty()
                && !results.playlists.is_empty()
        );
        println!(
            "Catalogue sections: artists={} tracks={} albums={} playlists={}",
            results.artists.len(),
            results.tracks.len(),
            results.albums.len(),
            results.playlists.len()
        );
        for entity in [
            &results.artists[0],
            &results.albums[0],
            &results.playlists[0],
        ] {
            let list = collection(entity.kind, &entity.id, entity.owner.as_deref(), 0).unwrap();
            assert!(!list.tracks.is_empty());
        }
    }
}
