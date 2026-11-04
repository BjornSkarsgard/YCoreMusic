//! Session playback events are separate from the user's library reactions.
use crate::{
    credentials, library,
    source::{Source, WaveOrigin},
    storage::{PlayProgress, StorageState, Store},
    yandex,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct Delivery(Arc<Mutex<()>>);
struct Pending {
    key: String,
    session: String,
    body: Value,
}
pub fn queue_shutdown(connection: &mut rusqlite::Connection) -> Result<(), &'static str> {
    let transaction = connection
        .transaction()
        .map_err(|_| "Cannot finish Wave events")?;
    let rows = {
        let mut statement=transaction.prepare("SELECT e.account_id,e.session_id,e.body_json,m.playback_id,m.listened_ms FROM wave_events e JOIN play_metrics m ON e.event_key=e.account_id||':'||m.playback_id||':start' WHERE m.source='my_wave' AND m.end_reason IS NULL").map_err(|_|"Cannot query unfinished Wave events")?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|_| "Cannot read unfinished Wave events")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Invalid unfinished Wave event")?;
        rows
    };
    let timestamp = chrono::Utc::now().to_rfc3339();
    for (uid, session, body, id, listened) in rows {
        let mut body: Value = serde_json::from_str(&body).map_err(|_| "Invalid Wave event")?;
        body["event"]["type"] = json!("trackFinished");
        body["event"]["timestamp"] = json!(timestamp);
        body["event"]["totalPlayedSeconds"] = json!(listened as f64 / 1000.0);
        transaction.execute("INSERT OR IGNORE INTO wave_events(event_key,account_id,session_id,body_json,created_at,status,attempts) VALUES(?1,?2,?3,?4,?5,'pending',0)",rusqlite::params![format!("{uid}:{id}:end"),uid,session,body.to_string(),timestamp]).map_err(|_|"Cannot save final Wave event")?;
    }
    transaction
        .commit()
        .map_err(|_| "Cannot commit final Wave events")?;
    Ok(())
}

pub fn enqueue(store: &Store, source: &Source, event: &PlayProgress) -> Result<(), &'static str> {
    if event.source != "my_wave" {
        return Ok(());
    }
    let Some(origin) = event
        .wave_ref
        .as_deref()
        .and_then(|reference| source.origin(reference))
    else {
        return Ok(());
    };
    enqueue_origin(store, &origin, event)
}
fn enqueue_origin(
    store: &Store,
    origin: &WaveOrigin,
    event: &PlayProgress,
) -> Result<(), &'static str> {
    let mut connection = store.0.lock().map_err(|_| "History unavailable")?;
    let transaction = connection
        .transaction()
        .map_err(|_| "Cannot start Wave event")?;
    let started: Option<String> = transaction
        .query_row(
            "SELECT started_at FROM play_history WHERE playback_id=?1 AND track_id=?2",
            rusqlite::params![event.playback_id, origin.track],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Cannot bind Wave event")?;
    let Some(started) = started else {
        return Ok(());
    };
    let timestamp = chrono::Utc::now().to_rfc3339();
    let mut events = vec![
        (
            format!("{}:{}:radio", origin.uid, origin.session),
            json!({"type":"radioStarted","timestamp":started}),
        ),
        (
            format!("{}:{}:start", origin.uid, event.playback_id),
            json!({"type":"trackStarted","timestamp":started,"trackId":origin.track}),
        ),
    ];
    if let Some(reason) = event.end_reason.as_deref() {
        // Only an explicit Next becomes skip. A technical failure never becomes dislike/skip.
        let kind = if reason == "skip" {
            "skip"
        } else {
            "trackFinished"
        };
        events.push((format!("{}:{}:end",origin.uid,event.playback_id),json!({"type":kind,"timestamp":timestamp,"trackId":origin.track,"totalPlayedSeconds":event.listened_ms as f64/1000.0})));
    }
    for (key, event) in events {
        let mut body = json!({"event":event});
        if let Some(batch) = &origin.batch {
            body["batchId"] = json!(batch);
        }
        transaction.execute("INSERT OR IGNORE INTO wave_events(event_key,account_id,session_id,body_json,created_at,status,attempts) VALUES(?1,?2,?3,?4,?5,'pending',0)",rusqlite::params![key,origin.uid,origin.session,body.to_string(),timestamp]).map_err(|_|"Cannot save Wave event")?;
    }
    transaction
        .commit()
        .map_err(|_| "Cannot commit Wave event")?;
    Ok(())
}
fn flush(
    store: &Store,
    uid: &str,
    mut send: impl FnMut(&str, &Value) -> Result<(), &'static str>,
) -> Result<usize, &'static str> {
    let pending = {
        let connection = store.0.lock().map_err(|_| "History unavailable")?;
        // A previous session must never be silently attached to a newly created session.
        connection.execute("UPDATE wave_events SET status='expired' WHERE status='pending' AND (created_at<?1 OR attempts>=8)",[ (chrono::Utc::now()-chrono::Duration::hours(24)).to_rfc3339()]).map_err(|_|"Cannot expire Wave events")?;
        let mut statement=connection.prepare("SELECT event_key,session_id,body_json FROM wave_events WHERE account_id=?1 AND status='pending' ORDER BY rowid LIMIT 25").map_err(|_|"Cannot query Wave events")?;
        let rows = statement
            .query_map([uid], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| "Cannot read Wave events")?;
        rows.map(|row| {
            let (key, session, body) = row.map_err(|_| "Invalid Wave row")?;
            Ok(Pending {
                key,
                session,
                body: serde_json::from_str(&body).map_err(|_| "Invalid Wave event")?,
            })
        })
        .collect::<Result<Vec<_>, &'static str>>()?
    };
    for event in pending {
        let exists:bool=store.0.lock().map_err(|_|"History unavailable")?.query_row("SELECT EXISTS(SELECT 1 FROM wave_events WHERE event_key=?1 AND account_id=?2 AND status='pending')",rusqlite::params![event.key,uid],|row|row.get(0)).map_err(|_|"Cannot check Wave event")?;
        if !exists {
            continue;
        }
        let result = send(&event.session, &event.body);
        let connection = store.0.lock().map_err(|_| "History unavailable")?;
        connection.execute("UPDATE wave_events SET attempts=attempts+1,status=CASE WHEN ?2 THEN 'sent' ELSE status END WHERE event_key=?1 AND account_id=?3",rusqlite::params![event.key,result.is_ok(),uid]).map_err(|_|"Cannot acknowledge Wave event")?;
        result?;
    }
    store
        .0
        .lock()
        .map_err(|_| "History unavailable")?
        .query_row(
            "SELECT COUNT(*) FROM wave_events WHERE account_id=?1 AND status='pending'",
            [uid],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count as usize)
        .map_err(|_| "Cannot count Wave events")
}
#[tauri::command]
pub async fn wave_sync(
    window: tauri::WebviewWindow,
    delivery: tauri::State<'_, Delivery>,
    storage: tauri::State<'_, StorageState>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if storage.test_mode {
        return Ok(json!({"disabled":true,"pending":0,"sent":0}));
    }
    let store = storage
        .store
        .as_ref()
        .map_err(|error| error.to_string())?
        .clone();
    let delivery = delivery.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = delivery.0.lock().map_err(|_| "Wave delivery unavailable")?;
        let pending: bool = store
            .0
            .lock()
            .map_err(|_| "History unavailable")?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM wave_events WHERE status='pending')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "Cannot read Wave events")?;
        if !pending {
            return Ok(json!({"pending":0,"sent":0,"disabled":false}));
        }
        // Re-identify the current credential before selecting this account's outbox.
        let (client, auth, uid) = library::context()?;
        let mut sent = 0;
        let pending = flush(&store, &uid, |session, body| {
            let current = credentials::load()?;
            if yandex::authorization(&current)? != auth {
                return Err("Authorization changed during delivery");
            }
            if session.is_empty()
                || session.len() > 256
                || !session
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
            {
                return Err("Invalid Wave session");
            }
            let result = yandex::request(
                &client,
                &format!("rotor/session/{session}/feedback"),
                &auth,
                Some(body),
            )?;
            if result.get("result").is_some_and(Value::is_object)
                && result
                    .pointer("/result/unknownSession")
                    .and_then(Value::as_bool)
                    != Some(true)
                && result
                    .pointer("/result/terminated")
                    .and_then(Value::as_bool)
                    != Some(true)
            {
                sent += 1;
                Ok(())
            } else {
                Err("Wave event was not confirmed")
            }
        })?;
        Ok(json!({"pending":pending,"sent":sent,"disabled":false}))
    })
    .await
    .map_err(|_| "Wave worker failed".to_string())?
    .map_err(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Store, WaveOrigin, PlayProgress) {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store
            .record(&crate::storage::PlayRecord {
                playback_id: "wave-interleaved".into(),
                track_id: "2".into(),
                title: "Fixture".into(),
                artist: "Fixture".into(),
                video_id: "M7lc1UVf-VE".into(),
            })
            .unwrap();
        (
            store,
            WaveOrigin {
                uid: "10".into(),
                session: "session-two".into(),
                batch: None,
                track: "2".into(),
            },
            PlayProgress {
                playback_id: "wave-interleaved".into(),
                source: "my_wave".into(),
                listened_ms: 0,
                duration_ms: None,
                end_reason: None,
                wave_ref: None,
            },
        )
    }
    #[test]
    fn a_new_end_event_can_commit_while_network_delivery_is_pending() {
        let (store, origin, mut event) = fixture();
        enqueue_origin(&store, &origin, &event).unwrap();
        let mut sent = Vec::new();
        let pending = flush(&store, "10", |_, body| {
            sent.push(body["event"]["type"].as_str().unwrap().to_owned());
            if sent.len() == 1 {
                event.end_reason = Some("skip".into());
                event.listened_ms = 1000;
                enqueue_origin(&store, &origin, &event).unwrap();
            }
            Ok(())
        })
        .unwrap();
        assert_eq!(pending, 1);
        assert_eq!(sent, ["radioStarted", "trackStarted"]);
        assert_eq!(
            flush(&store, "10", |_, body| {
                assert_eq!(body["event"]["type"], "skip");
                Ok(())
            })
            .unwrap(),
            0
        );
    }
    #[test]
    fn expired_events_are_not_reassigned_to_a_new_session_or_reported_as_sent() {
        let (store, origin, event) = fixture();
        enqueue_origin(&store, &origin, &event).unwrap();
        store
            .0
            .lock()
            .unwrap()
            .execute(
                "UPDATE wave_events SET created_at='1970-01-01T00:00:00+00:00'",
                [],
            )
            .unwrap();
        assert_eq!(
            flush(&store, "10", |_, _| panic!("Expired event delivery")).unwrap(),
            0
        );
        assert_eq!(
            store
                .0
                .lock()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM wave_events WHERE status='expired'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            2
        );
    }
    #[test]
    fn normal_shutdown_finishes_a_started_wave_at_the_last_persisted_listening_watermark() {
        let (store, origin, mut event) = fixture();
        event.listened_ms = 1500;
        store.progress(&event).unwrap();
        enqueue_origin(&store, &origin, &event).unwrap();
        flush(&store, "10", |_, _| Ok(())).unwrap();
        store.finish_open().unwrap();
        assert_eq!(
            flush(&store, "10", |_, body| {
                assert_eq!(body["event"]["type"], "trackFinished");
                assert_eq!(body["event"]["totalPlayedSeconds"], 1.5);
                Ok(())
            })
            .unwrap(),
            0
        );
        assert_eq!(
            store.history("", None).unwrap()[0].end_reason.as_deref(),
            Some("shutdown")
        );
    }
    #[test]
    fn clearing_history_cancels_remaining_not_yet_sent_events() {
        let (store, origin, event) = fixture();
        enqueue_origin(&store, &origin, &event).unwrap();
        let mut sent = 0;
        assert_eq!(
            flush(&store, "10", |_, _| {
                sent += 1;
                store.clear_history().unwrap();
                Ok(())
            })
            .unwrap(),
            0
        );
        assert_eq!(sent, 1);
    }
    #[test]
    fn events_are_ordered_idempotent_account_scoped_and_never_turn_technical_end_into_skip() {
        let store = Store::open(std::path::Path::new(":memory:")).unwrap();
        store
            .record(&crate::storage::PlayRecord {
                playback_id: "wave-1".into(),
                track_id: "1".into(),
                title: "Fixture".into(),
                artist: "Fixture".into(),
                video_id: "M7lc1UVf-VE".into(),
            })
            .unwrap();
        let origin = WaveOrigin {
            uid: "10".into(),
            session: "session-one".into(),
            batch: Some("batch-one".into()),
            track: "1".into(),
        };
        let mut event = PlayProgress {
            playback_id: "wave-1".into(),
            source: "my_wave".into(),
            listened_ms: 0,
            duration_ms: None,
            end_reason: None,
            wave_ref: None,
        };
        enqueue_origin(&store, &origin, &event).unwrap();
        enqueue_origin(&store, &origin, &event).unwrap();
        event.listened_ms = 2500;
        event.end_reason = Some("error".into());
        enqueue_origin(&store, &origin, &event).unwrap();
        assert_eq!(
            flush(&store, "other", |_, _| panic!("Wrong account delivery")).unwrap(),
            0
        );
        assert!(flush(&store, "10", |_, _| Err("Network/TLS error")).is_err());
        let mut sent = Vec::new();
        assert_eq!(
            flush(&store, "10", |session, body| {
                assert_eq!(session, "session-one");
                assert_eq!(body["batchId"], "batch-one");
                sent.push(body["event"]["type"].as_str().unwrap().to_owned());
                if body["event"]["type"] == "trackFinished" {
                    assert_eq!(body["event"]["totalPlayedSeconds"], 2.5);
                }
                Ok(())
            })
            .unwrap(),
            0
        );
        assert_eq!(sent, ["radioStarted", "trackStarted", "trackFinished"]);
        enqueue_origin(&store, &origin, &event).unwrap();
        assert_eq!(
            flush(&store, "10", |_, _| panic!("Already delivered")).unwrap(),
            0
        );
        store.clear_history().unwrap();
        enqueue_origin(&store, &origin, &event).unwrap();
        assert_eq!(
            flush(&store, "10", |_, _| panic!("Cleared history")).unwrap(),
            0
        );
    }
}
