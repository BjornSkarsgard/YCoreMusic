use crate::{credentials, yandex};
use reqwest::{blocking::Client, redirect::Policy};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Serialize)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(rename = "coverUrl", skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
}
struct Session {
    id: String,
    uid: String,
    seed: String,
    received: Vec<String>,
    last: Vec<String>,
}
#[derive(Clone, Default)]
pub struct Source(Arc<Mutex<Option<Session>>>, Arc<Mutex<Origins>>);
#[derive(Default)]
struct Origins {
    entries: HashMap<String, WaveOrigin>,
    order: VecDeque<String>,
}
#[derive(Clone)]
pub struct WaveOrigin {
    pub uid: String,
    pub session: String,
    pub batch: Option<String>,
    pub track: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    #[serde(flatten)]
    pub track: Track,
    pub wave_ref: String,
}
impl Source {
    pub fn origin(&self, reference: &str) -> Option<WaveOrigin> {
        self.1.lock().ok()?.entries.get(reference).cloned()
    }
    fn tag(
        &self,
        tracks: Vec<Track>,
        uid: &str,
        session: &str,
        batch: Option<String>,
    ) -> Result<Vec<Recommendation>, &'static str> {
        let mut origins = self.1.lock().map_err(|_| "Wave references unavailable")?;
        tracks
            .into_iter()
            .map(|track| {
                let mut bytes = [0u8; 16];
                getrandom::fill(&mut bytes).map_err(|_| "Cannot create Wave reference")?;
                let reference: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
                origins.entries.insert(
                    reference.clone(),
                    WaveOrigin {
                        uid: uid.into(),
                        session: session.into(),
                        batch: batch.clone(),
                        track: track.id.clone(),
                    },
                );
                origins.order.push_back(reference.clone());
                while origins.order.len() > 4096 {
                    if let Some(old) = origins.order.pop_front() {
                        origins.entries.remove(&old);
                    }
                }
                Ok(Recommendation {
                    track,
                    wave_ref: reference,
                })
            })
            .collect()
    }
}
fn batch_id(value: &Value) -> Option<String> {
    value
        .pointer("/result/batchId")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty() && id.len() <= 512 && id.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .map(str::to_owned)
}
fn account_id(value: &Value) -> Result<String, &'static str> {
    let value = value
        .pointer("/result/account/uid")
        .ok_or("Account unavailable")?;
    let id = match value {
        Value::String(id) => id.clone(),
        Value::Number(id) => id.to_string(),
        _ => return Err("Account unavailable"),
    };
    (id != "0" && crate::library::valid_id(&id))
        .then_some(id)
        .ok_or("Account unavailable")
}
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
                .get("track")
                .and_then(crate::catalogue::playback_title)
                .unwrap_or_else(|| "Без названия".into());
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
            Track {
                id,
                title,
                artist,
                cover_url: item.get("track").and_then(crate::catalogue::artwork),
            }
        })
        .collect())
}
pub fn fetch(
    source: &Source,
    fresh: bool,
    seed: &str,
) -> Result<Vec<Recommendation>, &'static str> {
    let (base, settings) = seed.split_once(',').unwrap_or((seed, ""));
    validate_seed(base)?;
    let mut seeds = vec![base];
    let mut setting_types = std::collections::HashSet::new();
    if !settings.is_empty() {
        for setting in settings.split(',') {
            let (kind, _) = setting.split_once(':').ok_or("Invalid wave setting")?;
            if !valid_wave_setting(setting) || !setting_types.insert(kind) {
                return Err("Invalid wave setting");
            }
            seeds.push(setting);
        }
    }
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
    let uid = account_id(&yandex::request(&client, "account/status", &auth, None)?)?;
    if fresh {
        let value = yandex::request(
            &client,
            "rotor/session/new",
            &auth,
            Some(&json!({"seeds":seeds,"includeTracksInResponse":true})),
        )?;
        let id = yandex::session_id(&value)?.to_owned();
        let tracks = tracks(&value)?;
        let received: Vec<_> = tracks.iter().map(|track| track.id.clone()).collect();
        *state = Some(Session {
            id: id.clone(),
            uid: uid.clone(),
            seed: seed.to_owned(),
            last: received.clone(),
            received,
        });
        source.tag(tracks, &uid, &id, batch_id(&value))
    } else {
        let session = state.as_mut().ok_or("Start a source session first")?;
        if session.uid != uid {
            return Err("Authorization changed; start a new session");
        }
        if session.seed != seed {
            return Err("Station changed; start a new session");
        }
        let value = yandex::request(
            &client,
            &format!("rotor/session/{}/tracks", session.id),
            &auth,
            Some(&json!({"queue": session.received})),
        )?;
        let batch = tracks(&value);
        let mut batch_reference = batch_id(&value);
        let tracks = if renewal_needed(&value, batch.as_ref().ok(), &session.last) {
            // Transport/auth errors propagate above. Renew only a stale session,
            // carrying recent queue IDs forward without inventing feedback.
            let replacement = yandex::request(
                &client,
                "rotor/session/new",
                &auth,
                Some(
                    &json!({"seeds":seeds,"queue":session.received,"includeTracksInResponse":true}),
                ),
            )?;
            let id = yandex::session_id(&replacement)?.to_owned();
            let items = tracks(&replacement)?;
            if items.iter().map(|t| &t.id).eq(session.last.iter()) {
                return Err("Identical batch returned; queue unchanged");
            }
            session.id = id;
            batch_reference = batch_id(&replacement);
            items
        } else {
            batch?
        };
        let ids: Vec<_> = tracks.iter().map(|track| track.id.clone()).collect();
        session.received.extend(ids.iter().cloned());
        if session.received.len() > 500 {
            session.received.drain(..session.received.len() - 500);
        }
        session.last = ids;
        source.tag(tracks, &uid, &session.id, batch_reference)
    }
}

fn renewal_needed(value: &Value, batch: Option<&Vec<Track>>, previous: &[String]) -> bool {
    value
        .pointer("/result/unknownSession")
        .and_then(Value::as_bool)
        == Some(true)
        || value.pointer("/result/terminated").and_then(Value::as_bool) == Some(true)
        || value
            .pointer("/result/sequence")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        || batch.is_some_and(|items| items.iter().map(|t| &t.id).eq(previous.iter()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wave_references_keep_duplicates_and_old_batches_without_exposing_account_or_session() {
        let source = Source::default();
        let track = Track {
            id: "1".into(),
            title: "Fixture".into(),
            artist: "Fixture".into(),
            cover_url: None,
        };
        let first = source
            .tag(
                vec![track.clone(), track.clone()],
                "123",
                "old-session",
                Some("old-batch".into()),
            )
            .unwrap();
        assert_ne!(first[0].wave_ref, first[1].wave_ref);
        source
            .tag(vec![track], "456", "new-session", Some("new-batch".into()))
            .unwrap();
        let origin = source.origin(&first[0].wave_ref).unwrap();
        assert_eq!(origin.uid, "123");
        assert_eq!(origin.session, "old-session");
        assert_eq!(origin.batch.as_deref(), Some("old-batch"));
        let value = serde_json::to_value(&first[0]).unwrap();
        let mut keys = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(keys, ["artist", "id", "title", "waveRef"]);
        assert!(account_id(&json!({"result":{"account":{"uid":0}}})).is_err());
    }
    #[test]
    fn renews_stale_sessions_without_hiding_malformed_responses() {
        let previous = vec!["9".to_owned()];
        for value in [
            json!({"result":{"unknownSession":true}}),
            json!({"result":{"terminated":true}}),
            json!({"result":{"sequence":[]}}),
            json!({"result":{"sequence":[{"track":{"id":"9"}}]}}),
        ] {
            assert!(renewal_needed(
                &value,
                tracks(&value).as_ref().ok(),
                &previous
            ));
        }
        assert!(!renewal_needed(&json!({"result":{}}), None, &previous));
        let next = json!({"result":{"sequence":[{"track":{"id":"10"}}]}});
        assert!(!renewal_needed(
            &next,
            tracks(&next).as_ref().ok(),
            &previous
        ));
    }
    #[test]
    fn genre_stations_validate_ids_and_only_use_server_names() {
        let value = json!({"result":[{"station":{"id":{"type":"genre","tag":"metal"},"name":"Метал"}},{"station":{"id":{"type":"mood","tag":"happy"},"name":"Happy"}},{"station":{"id":{"type":"genre","tag":"../bad"},"name":"bad"}}]});
        let stations = parse_stations(&value).unwrap();
        assert_eq!(stations.len(), 1);
        assert_eq!(stations[0].id, "genre:metal");
        assert!(validate_seed("genre:metal").is_ok());
        assert!(validate_seed("genre:metal?x=1").is_err());
    }
    #[test]
    #[ignore = "Live read-only genre discovery/session fetch through OS credential store"]
    fn live_genre_session() {
        let stations = stations().unwrap();
        assert!(!stations.is_empty());
        let station = stations
            .iter()
            .find(|station| station.id == "genre:metal")
            .unwrap_or(&stations[0]);
        let source = Source::default();
        let first = fetch(&source, true, &station.id).unwrap();
        let next = fetch(&source, false, &station.id).unwrap();
        assert!(!first.is_empty() && !next.is_empty());
        println!(
            "Genre stations/session/next batch: PASS ({} genres, {} + {} tracks)",
            stations.len(),
            first.len(),
            next.len()
        );
    }
    #[test]
    fn metadata_preserves_order_and_duplicate_tracks() {
        let value = json!({"result":{"sequence":[
            {"track":{"id":"9","title":"<b>track</b>","artists":[{"name":"One"},{"name":"Two"}]}},
            {"track":{"id":"9"}},
            {"track":{"id":"10","title":"Кометы","version":"Skazka Festival Remix","artists":[{"name":"Saint Rider"}]}}
        ]}});
        let result = tracks(&value).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].artist, "One, Two");
        assert_eq!(result[0].title, "<b>track</b>");
        assert_eq!(result[1].title, "Без названия");
        assert_eq!(result[2].title, "Кометы (Skazka Festival Remix)");
    }
}

#[derive(Clone, Serialize)]
pub struct Station {
    pub id: String,
    pub title: String,
}
fn validate_seed(seed: &str) -> Result<(), &'static str> {
    let numeric_id =
        |id: &str| !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_digit());
    if seed == "user:onyourwave"
        || seed
            .strip_prefix("track:")
            .or_else(|| seed.strip_prefix("artist:"))
            .is_some_and(numeric_id)
        || seed
            .strip_prefix("playlist:")
            .and_then(|tag| tag.split_once(':'))
            .is_some_and(|(owner, kind)| numeric_id(owner) && numeric_id(kind))
        || seed.strip_prefix("genre:").is_some_and(|tag| {
            !tag.is_empty()
                && tag.len() <= 100
                && tag
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        })
    {
        Ok(())
    } else {
        Err("Invalid station")
    }
}

fn valid_wave_setting(seed: &str) -> bool {
    seed.split_once(':').is_some_and(|(kind, tag)| {
        matches!(
            kind,
            "settingDiversity"
                | "settingMood"
                | "settingEnergy"
                | "settingMoodEnergy"
                | "activity"
                | "context"
                | "mood"
        ) && !tag.is_empty()
            && tag.len() <= 100
            && tag
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    })
}

#[tauri::command]
pub async fn wave_settings(window: tauri::WebviewWindow) -> Result<Vec<Station>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(|| {
        let (client, auth, _) = crate::library::context()?;
        let value = yandex::request(
            &client,
            "rotor/wave/settings?seeds=user%3Aonyourwave",
            &auth,
            None,
        )?;
        let mut options = Vec::new();
        let mut add = |seed: &str, title: &str| {
            if valid_wave_setting(seed) && !options.iter().any(|option: &Station| option.id == seed)
            {
                options.push(Station {
                    id: seed.into(),
                    title: title.chars().take(100).collect(),
                });
            }
        };
        for field in ["diversity", "mood", "energy", "moodEnergy"] {
            if let Some(setting) = value.pointer(&format!("/result/settingRestrictions/{field}")) {
                let entries = setting
                    .get("possibleValues")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .chain(setting.get("min"))
                    .chain(setting.get("max"));
                for entry in entries {
                    if let (Some(seed), Some(title)) =
                        (entry["serializedSeed"].as_str(), entry["name"].as_str())
                    {
                        add(seed, title);
                    }
                }
            }
        }
        if let Some(blocks) = value.pointer("/result/blocks").and_then(Value::as_array) {
            for entry in blocks
                .iter()
                .filter_map(|block| block["items"].as_array())
                .flatten()
            {
                let station = entry.get("station").unwrap_or(entry);
                if let (Some(kind), Some(tag), Some(title)) = (
                    station.pointer("/id/type").and_then(Value::as_str),
                    station.pointer("/id/tag").and_then(Value::as_str),
                    station["name"].as_str(),
                ) {
                    add(&format!("{kind}:{tag}"), title);
                }
            }
        }
        Ok::<_, &'static str>(options)
    })
    .await
    .map_err(|_| "Wave settings worker failed".to_owned())?
    .map_err(str::to_owned)
}
fn parse_stations(value: &Value) -> Result<Vec<Station>, &'static str> {
    let items = value
        .get("result")
        .and_then(Value::as_array)
        .ok_or("Invalid stations response")?;
    Ok(items
        .iter()
        .filter_map(|item| {
            let station = item.get("station")?;
            if station.pointer("/id/type")?.as_str()? != "genre" {
                return None;
            }
            let id = format!("genre:{}", station.pointer("/id/tag")?.as_str()?);
            validate_seed(&id).ok()?;
            let title = station.get("name")?.as_str()?;
            if title.is_empty() || title.len() > 256 {
                return None;
            }
            Some(Station {
                id,
                title: title.into(),
            })
        })
        .collect())
}
pub fn stations() -> Result<Vec<Station>, &'static str> {
    let token = credentials::load()?;
    let auth = yandex::authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize HTTPS")?;
    parse_stations(&yandex::request_limited(
        &client,
        "rotor/stations/list?language=ru",
        &auth,
        None,
        16_000_000,
    )?)
}
