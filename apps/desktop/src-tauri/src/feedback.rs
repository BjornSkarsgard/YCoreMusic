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
    generation: u64,
    uid: Option<String>,
    liked: HashSet<String>,
    disliked: HashSet<String>,
    updated: Option<Instant>,
}
#[derive(Clone, Default)]
pub struct Feedback {
    cache: Arc<Mutex<Cache>>,
    refresh: Arc<Mutex<()>>,
    sync: Arc<Mutex<()>>,
}
pub struct Profile {
    pub uid: String,
    pub liked: HashSet<String>,
    pub disliked: HashSet<String>,
}
impl Feedback {
    pub fn profile(&self) -> Option<Profile> {
        let cache = self.cache.try_lock().ok()?;
        Some(Profile {
            uid: cache.uid.clone()?,
            liked: cache.liked.clone(),
            disliked: cache.disliked.clone(),
        })
    }
}
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
fn fetch_profile() -> Result<Profile, &'static str> {
    let (client, auth, uid) = library::context()?;
    let liked = library::reaction_ids(&client, &auth, &uid, "likes")?;
    let disliked = library::reaction_ids(&client, &auth, &uid, "dislikes")?;
    Ok(Profile {
        uid,
        liked: liked.into_iter().collect(),
        disliked: disliked.into_iter().collect(),
    })
}
fn fresh(cache: &Cache) -> bool {
    cache
        .updated
        .is_some_and(|time| time.elapsed() <= Duration::from_secs(60))
}
fn refresh_with(
    feedback: &Feedback,
    store: &Store,
    fetch: impl FnOnce() -> Result<Profile, &'static str>,
) -> Result<(), &'static str> {
    // Serialize remote refreshes, but never make a local Set wait for the network.
    let _refresh = feedback
        .refresh
        .lock()
        .map_err(|_| "Feedback refresh unavailable")?;
    let generation = {
        let cache = feedback.cache.lock().map_err(|_| "Feedback unavailable")?;
        if fresh(&cache) {
            return Ok(());
        }
        cache.generation
    };
    let mut profile = fetch()?;
    let pending = store.pending_profile_reactions(&profile.uid)?;
    let mut cache = feedback.cache.lock().map_err(|_| "Feedback unavailable")?;
    if cache.generation != generation {
        return Ok(());
    }
    for record in pending {
        profile.liked.remove(&record.track_id);
        profile.disliked.remove(&record.track_id);
        if record.state == 1 {
            profile.liked.insert(record.track_id);
        } else if record.state == -1 {
            profile.disliked.insert(record.track_id);
        }
    }
    cache.uid = Some(profile.uid);
    cache.liked = profile.liked;
    cache.disliked = profile.disliked;
    cache.updated = Some(Instant::now());
    cache.generation += 1;
    Ok(())
}
fn value(
    cache: &Cache,
    store: &Store,
    record: Reaction,
) -> Result<serde_json::Value, &'static str> {
    let mut value = serde_json::to_value(record).map_err(|_| "Cannot serialize feedback")?;
    value["generation"] = serde_json::json!(cache.generation);
    let complete = fresh(cache)
        && cache.uid.as_deref().is_some_and(|uid| {
            store
                .pending_reactions(uid)
                .is_ok_and(|rows| rows.is_empty())
        });
    if complete {
        value["excludedTrackIds"] = serde_json::json!(cache.disliked.iter().collect::<Vec<_>>());
    }
    Ok(value)
}
fn get(
    feedback: &Feedback,
    store: &Store,
    track: &str,
    fetch: impl FnOnce() -> Result<Profile, &'static str>,
) -> Result<serde_json::Value, &'static str> {
    if !library::valid_id(track) {
        return Err("Invalid feedback track");
    }
    let refreshed = refresh_with(feedback, store, fetch);
    // Record and generation are read in the same short critical section.
    let cache = feedback.cache.lock().map_err(|_| "Feedback unavailable")?;
    let uid = cache.uid.as_deref().ok_or("Account unavailable")?;
    if let Err(error) = refreshed {
        return match store.reaction(uid, track)? {
            Some(record) => value(&cache, store, record),
            None => Err(error),
        };
    }
    let state = if cache.disliked.contains(track) {
        -1
    } else {
        i8::from(cache.liked.contains(track))
    };
    value(&cache, store, store.remember_reaction(uid, track, state)?)
}
fn set_reaction(
    feedback: &Feedback,
    store: &Store,
    track: &str,
    state: i8,
    expected: Option<i64>,
) -> Result<serde_json::Value, &'static str> {
    if !library::valid_id(track) || !(-1..=1).contains(&state) {
        return Err("Invalid feedback");
    }
    let missing = feedback
        .cache
        .lock()
        .map_err(|_| "Feedback unavailable")?
        .uid
        .is_none();
    if missing {
        refresh_with(feedback, store, fetch_profile)?;
    }
    let mut cache = feedback.cache.lock().map_err(|_| "Feedback unavailable")?;
    let uid = cache.uid.as_deref().ok_or("Account unavailable")?;
    let record = store.set_reaction(uid, track, state, expected)?;
    cache.generation += 1;
    cache.liked.remove(track);
    cache.disliked.remove(track);
    if state == 1 {
        cache.liked.insert(track.into());
    } else if state == -1 {
        cache.disliked.insert(track.into());
    }
    value(&cache, store, record)
}
fn sync_outbox(
    feedback: &Feedback,
    store: &Store,
    uid: &str,
    send: impl FnMut(&Reaction) -> Result<(), &'static str>,
) -> Result<usize, &'static str> {
    // Prevent concurrent deliveries from reordering old and new server intentions.
    let _sync = feedback
        .sync
        .lock()
        .map_err(|_| "Feedback sync unavailable")?;
    let result = flush_with(store, uid, send);
    let mut cache = feedback.cache.lock().map_err(|_| "Feedback unavailable")?;
    cache.updated = None;
    cache.generation += 1;
    result
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
        match request {
            Request::Get { track_id } => get(&state, &store, &track_id, fetch_profile),
            Request::Set {
                track_id,
                state: desired,
                expected,
            } => set_reaction(&state, &store, &track_id, desired, expected),
            Request::Sync => {
                if test_mode {
                    return Err("Live feedback writes disabled in native test mode");
                }
                // Re-check the credential's account before delivering its outbox, without locking the cache.
                let (client, auth, uid) = library::context()?;
                let count = sync_outbox(&state, &store, &uid, |record| {
                    send(&client, &auth, &uid, record)
                })?;
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
    fn memory() -> Store {
        Store::open(std::path::Path::new(":memory:")).unwrap()
    }
    fn warm() -> Feedback {
        let feedback = Feedback::default();
        feedback.cache.lock().unwrap().uid = Some("1".into());
        feedback
    }
    fn remote(uid: &str, liked: &[&str], disliked: &[&str]) -> Profile {
        Profile {
            uid: uid.into(),
            liked: liked.iter().map(|s| (*s).into()).collect(),
            disliked: disliked.iter().map(|s| (*s).into()).collect(),
        }
    }
    #[test]
    fn slow_refresh_does_not_block_a_local_set_or_overwrite_its_generation() {
        let feedback = warm();
        let store = memory();
        refresh_with(&feedback, &store, || {
            assert!(
                feedback.profile().is_some(),
                "Network fetch held the profile lock"
            );
            let saved = set_reaction(&feedback, &store, "9", -1, None).unwrap();
            assert_eq!(saved["generation"], 1);
            Ok(remote("1", &["9"], &[]))
        })
        .unwrap();
        assert!(feedback.profile().unwrap().disliked.contains("9"));
        let value = get(&feedback, &store, "9", || Err("Offline")).unwrap();
        assert_eq!(value["state"], -1);
        assert_eq!(value["generation"], 1);
        assert!(value.get("excludedTrackIds").is_none());
        assert!(store.pending_reactions("1").unwrap()[0].pending);
    }
    #[test]
    fn refreshed_profile_overlays_pending_intentions_only_for_its_own_account() {
        let feedback = Feedback::default();
        let store = memory();
        store.set_reaction("1", "9", -1, None).unwrap();
        store.set_reaction("2", "10", 1, None).unwrap();
        refresh_with(&feedback, &store, || Ok(remote("1", &["9"], &["11"]))).unwrap();
        let profile = feedback.profile().unwrap();
        assert!(profile.disliked.contains("9"));
        assert!(profile.disliked.contains("11"));
        assert!(!profile.liked.contains("9"));
        assert!(!profile.liked.contains("10"));
        let value = get(&feedback, &store, "9", || {
            panic!("Fresh cache requested network")
        })
        .unwrap();
        assert_eq!(value["state"], -1);
        assert!(value.get("excludedTrackIds").is_none());
    }
    #[test]
    fn profile_applies_all_pending_reactions_beyond_one_delivery_batch() {
        let feedback = Feedback::default();
        let store = memory();
        let ids: Vec<_> = (1..=60).map(|id| id.to_string()).collect();
        for id in &ids {
            store.set_reaction("1", id, -1, None).unwrap();
        }
        assert_eq!(store.pending_reactions("1").unwrap().len(), 25);
        refresh_with(&feedback, &store, || {
            Ok(Profile {
                uid: "1".into(),
                liked: ids.iter().cloned().collect(),
                disliked: HashSet::new(),
            })
        })
        .unwrap();
        let profile = feedback.profile().unwrap();
        assert_eq!(profile.disliked.len(), 60);
        assert!(profile.liked.is_empty());
        assert!(store.pending_profile_reactions("2").unwrap().is_empty());
        let value = get(&feedback, &store, "60", || {
            panic!("Fresh cache fetched network")
        })
        .unwrap();
        assert_eq!(value["state"], -1);
        assert!(value.get("excludedTrackIds").is_none());
    }
    #[test]
    fn concurrent_delivery_stays_ordered_while_new_clicks_commit_locally() {
        let feedback = warm();
        let store = memory();
        set_reaction(&feedback, &store, "9", 1, None).unwrap();
        let delivered = Arc::new(Mutex::new(Vec::new()));
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let f = feedback.clone();
        let s = store.clone();
        let d = delivered.clone();
        let first = std::thread::spawn(move || {
            sync_outbox(&f, &s, "1", |record| {
                d.lock().unwrap().push(record.state);
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(
            feedback.profile().is_some(),
            "Delivery held the profile lock"
        );
        set_reaction(&feedback, &store, "9", -1, None).unwrap();
        let f = feedback.clone();
        let s = store.clone();
        let d = delivered.clone();
        let second = std::thread::spawn(move || {
            sync_outbox(&f, &s, "1", |record| {
                d.lock().unwrap().push(record.state);
                Ok(())
            })
        });
        release_tx.send(()).unwrap();
        assert_eq!(first.join().unwrap().unwrap(), 1);
        assert_eq!(second.join().unwrap().unwrap(), 0);
        assert_eq!(*delivered.lock().unwrap(), vec![1, -1]);
        assert!(store.pending_reactions("1").unwrap().is_empty());
        let value = get(&feedback, &store, "9", || Err("Offline")).unwrap();
        assert_eq!(value["state"], -1);
        assert_eq!(value["generation"], 4);
        assert!(value.get("excludedTrackIds").is_none());
    }
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
