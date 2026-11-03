use crate::{credentials, yandex};
use reqwest::{blocking::Client, redirect::Policy};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Serialize)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
}
struct Session {
    id: String,
    received: Vec<String>,
    last: Vec<String>,
}
#[derive(Clone, Default)]
pub struct Source(Arc<Mutex<Option<Session>>>);
fn tracks(value: &Value) -> Result<Vec<Track>, &'static str> {
    let ids = yandex::session_batch(value)?;
    let items = value
        .pointer("/result/sequence")
        .and_then(Value::as_array)
        .ok_or("Invalid sequence")?;
    Ok(items
        .iter()
        .zip(ids)
        .map(|(item, id)| {
            let title = item
                .pointer("/track/title")
                .and_then(Value::as_str)
                .unwrap_or("Без названия")
                .to_owned();
            let artist = item
                .pointer("/track/artists")
                .and_then(Value::as_array)
                .map(|artists| {
                    artists
                        .iter()
                        .filter_map(|a| a.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            Track { id, title, artist }
        })
        .collect())
}
pub fn fetch(source: &Source, fresh: bool) -> Result<Vec<Track>, &'static str> {
    let mut state = source.0.lock().map_err(|_| "Source state unavailable")?;
    let token = credentials::load()?;
    let auth = yandex::authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize HTTPS")?;
    if fresh {
        let value = yandex::request(
            &client,
            "rotor/session/new",
            &auth,
            Some(&json!({"seeds":["user:onyourwave"],"includeTracksInResponse":true})),
        )?;
        let id = yandex::session_id(&value)?.to_owned();
        let tracks = tracks(&value)?;
        let received: Vec<_> = tracks.iter().map(|track| track.id.clone()).collect();
        *state = Some(Session {
            id,
            last: received.clone(),
            received,
        });
        Ok(tracks)
    } else {
        let session = state.as_mut().ok_or("Start a source session first")?;
        let value = yandex::request(
            &client,
            &format!("rotor/session/{}/tracks", session.id),
            &auth,
            Some(&json!({"queue": session.received})),
        )?;
        let tracks = tracks(&value)?;
        let ids: Vec<_> = tracks.iter().map(|track| track.id.clone()).collect();
        if ids == session.last {
            return Err("Identical batch returned; queue unchanged");
        }
        session.received.extend(ids.iter().cloned());
        session.last = ids;
        Ok(tracks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_preserves_order_and_duplicate_tracks() {
        let value = json!({"result":{"sequence":[
            {"track":{"id":"9","title":"<b>track</b>","artists":[{"name":"One"},{"name":"Two"}]}},
            {"track":{"id":"9"}}
        ]}});
        let result = tracks(&value).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].artist, "One, Two");
        assert_eq!(result[0].title, "<b>track</b>");
        assert_eq!(result[1].title, "Без названия");
    }
}
