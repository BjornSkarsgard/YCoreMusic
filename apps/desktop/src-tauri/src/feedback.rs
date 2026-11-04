use crate::{
    library,
    storage::{Reaction, StorageState, Store},
    yandex,
};
use serde::Deserialize;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[derive(Default)]
struct Cache {
    uid: Option<String>,
    liked: HashSet<String>,
    disliked: HashSet<String>,
    updated: Option<Instant>,
}
#[derive(Clone, Default)]
pub struct Feedback(Arc<Mutex<Cache>>);
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Get {
        track_id: String,
    },
    Set {
        track_id: String,
        state: i8,
        expected: Option<i64>,
    },
    Sync,
}
fn refresh(cache: &mut Cache) -> Result<(), &'static str> {
    let (client, auth, uid) = library::context()?;
    let liked = library::reaction_ids(&client, &auth, &uid, "likes")?;
    let disliked = library::reaction_ids(&client, &auth, &uid, "dislikes")?;
    cache.uid = Some(uid);
    cache.liked = liked.into_iter().collect();
    cache.disliked = disliked.into_iter().collect();
    cache.updated = Some(Instant::now());
    Ok(())
}
fn get(cache: &mut Cache, store: &Store, track: &str) -> Result<Reaction, &'static str> {
    if !library::valid_id(track) {
        return Err("Invalid feedback track");
    }
    if cache
        .updated
        .is_none_or(|t| t.elapsed() > Duration::from_secs(60))
    {
        if let Err(error) = refresh(cache) {
            if let Some(uid) = &cache.uid {
                if let Some(record) = store.reaction(uid, track)? {
                    return Ok(record);
                }
            }
            return Err(error);
        }
    }
    let uid = cache.uid.as_deref().ok_or("Account unavailable")?;
    let state = if cache.disliked.contains(track) {
        -1
    } else {
        i8::from(cache.liked.contains(track))
    };
    store.remember_reaction(uid, track, state)
}
fn send(
    client: &reqwest::blocking::Client,
    auth: &reqwest::header::HeaderValue,
    uid: &str,
    record: &Reaction,
) -> Result<(), &'static str> {
    let actions: &[(&str, &str)] = match record.state {
        1 => &[("likes", "add-multiple")],
        -1 => &[("dislikes", "add-multiple")],
        _ => &[("likes", "remove"), ("dislikes", "remove")],
    };
    for (kind, action) in actions {
        let value = yandex::request_form(
            client,
            &format!("users/{uid}/{kind}/tracks/{action}"),
            auth,
            &[("track-ids", record.track_id.clone())],
        )?;
        if value.pointer("/result/revision").is_none() {
            return Err("Feedback was not confirmed by Yandex");
        }
    }
    Ok(())
}
fn flush_with(
    store: &Store,
    uid: &str,
    mut send: impl FnMut(&Reaction) -> Result<(), &'static str>,
) -> Result<usize, &'static str> {
    for record in store.pending_reactions(uid)? {
        send(&record)?;
        store.acknowledge_reaction(uid, &record)?;
    }
    Ok(store.pending_reactions(uid)?.len())
}
#[tauri::command]
pub async fn feedback_command(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Feedback>,
    storage: tauri::State<'_, StorageState>,
    request: Request,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let state = state.inner().clone();
    let store = storage.store.as_ref().map_err(|e| e.to_string())?.clone();
    let test_mode = storage.test_mode;
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, &'static str> {
        let mut cache = state.0.lock().map_err(|_| "Feedback unavailable")?;
        match request {
            Request::Get { track_id } => serde_json::to_value(get(&mut cache, &store, &track_id)?)
                .map_err(|_| "Cannot serialize feedback"),
            Request::Set {
                track_id,
                state,
                expected,
            } => {
                if cache.uid.is_none() {
                    refresh(&mut cache)?;
                }
                let uid = cache.uid.as_deref().ok_or("Account unavailable")?;
                serde_json::to_value(store.set_reaction(uid, &track_id, state, expected)?)
                    .map_err(|_| "Cannot serialize feedback")
            }
            Request::Sync => {
                if test_mode {
                    return Err("Live feedback writes disabled in native test mode");
                }
                // Always re-check the credential's account before delivering its outbox.
                let (client, auth, uid) = library::context()?;
                let count = flush_with(&store, &uid, |record| send(&client, &auth, &uid, record))?;
                cache.updated = None;
                Ok(serde_json::json!({"pending":count}))
            }
        }
    })
    .await
    .map_err(|_| "Feedback worker failed".to_string())?
    .map_err(str::to_string)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn outbox_survives_failure_coalesces_actions_and_does_not_acknowledge_a_newer_click() {
        let path = std::env::temp_dir().join(format!(
            "encore-feedback-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.set_reaction("1", "9", 1, None).unwrap();
            assert!(flush_with(&store, "1", |_| Err("Offline")).is_err());
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.pending_reactions("1").unwrap().len(), 1);
        let record = store.set_reaction("1", "9", -1, None).unwrap();
        assert!(store
            .set_reaction("1", "9", 0, Some(record.revision - 1))
            .is_err());
        flush_with(&store, "1", |_| {
            store.set_reaction("1", "9", 1, None)?;
            Ok(())
        })
        .unwrap();
        assert_eq!(store.pending_reactions("1").unwrap()[0].state, 1);
        assert!(store.pending_reactions("2").unwrap().is_empty());
        flush_with(&store, "1", |_| Ok(())).unwrap();
        assert!(store.pending_reactions("1").unwrap().is_empty());
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
}
