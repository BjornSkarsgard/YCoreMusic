use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRecord {
    pub playback_id: String,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub video_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub video_id: String,
    pub started_at: String,
}
fn video_id(value: &str) -> bool {
    value.len() == 11
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}
fn track_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|c| c.is_ascii_digit())
}
fn migrate(connection: &mut Connection) -> Result<(), &'static str> {
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|_| "Cannot configure storage")?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| "Cannot read database schema; existing file preserved")?;
    if version > 1 {
        return Err("Database schema is newer than Encore; existing file preserved");
    }
    if version == 0 {
        let tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",[],|row|row.get(0)).map_err(|_|"Cannot inspect schema")?;
        if tables != 0 {
            return Err("Unrecognized database; existing file preserved");
        }
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start schema migration")?;
        transaction.execute_batch("CREATE TABLE manual_videos(track_id TEXT PRIMARY KEY,video_id TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE play_history(id INTEGER PRIMARY KEY AUTOINCREMENT,playback_id TEXT UNIQUE NOT NULL,track_id TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,video_id TEXT NOT NULL,started_at TEXT NOT NULL,search_text TEXT NOT NULL);
          CREATE INDEX play_history_started ON play_history(started_at);
          PRAGMA user_version=1;").map_err(|_|"Cannot create database schema")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit schema migration")?;
    }
    connection
        .prepare("SELECT track_id,video_id,updated_at FROM manual_videos LIMIT 0")
        .map_err(|_| "Invalid manual video schema")?;
    connection.prepare("SELECT playback_id,track_id,title,artist,video_id,started_at,search_text FROM play_history LIMIT 0").map_err(|_|"Invalid history schema")?;
    Ok(())
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        let mut connection = Connection::open(path).map_err(|_| "Cannot open local database")?;
        migrate(&mut connection)?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }
    pub fn save_video(&self, track: &str, video: &str) -> Result<(), &'static str> {
        if !track_id(track) || !video_id(video) {
            return Err("Invalid manual video");
        }
        self.0.lock().map_err(|_|"Storage unavailable")?.execute("INSERT INTO manual_videos(track_id,video_id,updated_at) VALUES(?1,?2,?3) ON CONFLICT(track_id) DO UPDATE SET video_id=excluded.video_id,updated_at=excluded.updated_at",params![track,video,chrono::Utc::now().to_rfc3339()]).map_err(|_|"Cannot save manual video")?;
        Ok(())
    }
    pub fn saved_video(&self, track: &str) -> Result<Option<String>, &'static str> {
        if !track_id(track) {
            return Err("Invalid track ID");
        }
        self.0
            .lock()
            .map_err(|_| "Storage unavailable")?
            .query_row(
                "SELECT video_id FROM manual_videos WHERE track_id=?1",
                [track],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read manual video")
    }
    pub fn remove_video(&self, track: &str) -> Result<(), &'static str> {
        if !track_id(track) {
            return Err("Invalid track ID");
        }
        self.0
            .lock()
            .map_err(|_| "Storage unavailable")?
            .execute("DELETE FROM manual_videos WHERE track_id=?1", [track])
            .map_err(|_| "Cannot reset manual video")?;
        Ok(())
    }
    pub fn record(&self, event: &PlayRecord) -> Result<(), &'static str> {
        let standalone = event.track_id.strip_prefix("manual:").is_some_and(video_id);
        if (!track_id(&event.track_id) && !standalone)
            || !video_id(&event.video_id)
            || event.playback_id.is_empty()
            || event.playback_id.len() > 64
            || !event
                .playback_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || event.title.len() > 1024
            || event.artist.len() > 1024
        {
            return Err("Invalid play event");
        }
        self.0.lock().map_err(|_|"Storage unavailable")?.execute("INSERT OR IGNORE INTO play_history(playback_id,track_id,title,artist,video_id,started_at,search_text) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![event.playback_id,event.track_id,event.title,event.artist,event.video_id,chrono::Utc::now().to_rfc3339(),format!("{} {}",event.title,event.artist).to_lowercase()]).map_err(|_|"Cannot save playback history")?;
        Ok(())
    }
    pub fn history(&self, query: &str) -> Result<Vec<HistoryEntry>, &'static str> {
        if query.len() > 512 {
            return Err("Search query too long");
        }
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT id,track_id,title,artist,video_id,started_at FROM play_history WHERE instr(search_text,?1)>0 ORDER BY id DESC LIMIT 100").map_err(|_|"Cannot query history")?;
        let rows = statement
            .query_map([query.to_lowercase()], |row| {
                Ok(HistoryEntry {
                    id: row.get(0)?,
                    track_id: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    video_id: row.get(4)?,
                    started_at: row.get(5)?,
                })
            })
            .map_err(|_| "Cannot read history")?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| "Invalid history data")
    }
    pub fn clear_history(&self) -> Result<(), &'static str> {
        self.0
            .lock()
            .map_err(|_| "Storage unavailable")?
            .execute("DELETE FROM play_history", [])
            .map_err(|_| "Cannot clear history")?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn memory() -> Store {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        Store(Arc::new(Mutex::new(connection)))
    }
    #[test]
    fn history_deduplicates_resume_but_records_new_play_and_searches_cyrillic() {
        let store = memory();
        let mut event = PlayRecord {
            playback_id: "event-1".into(),
            track_id: "123".into(),
            title: "Группа крови".into(),
            artist: "Кино".into(),
            video_id: "M7lc1UVf-VE".into(),
        };
        store.record(&event).unwrap();
        store.record(&event).unwrap();
        assert_eq!(store.history("ГРУППА").unwrap().len(), 1);
        event.playback_id = "event-2".into();
        store.record(&event).unwrap();
        assert_eq!(store.history("").unwrap().len(), 2);
        store.save_video("123", "M7lc1UVf-VE").unwrap();
        store.clear_history().unwrap();
        assert!(store.history("").unwrap().is_empty());
        assert!(store.saved_video("123").unwrap().is_some());
    }
    #[test]
    fn manual_override_survives_reopen_and_rejects_invalid_values() {
        let path = std::env::temp_dir().join(format!(
            "encore-store-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.save_video("123", "M7lc1UVf-VE").unwrap();
            assert!(store.save_video("123", "https://evil.test").is_err());
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.saved_video("123").unwrap().as_deref(),
                Some("M7lc1UVf-VE")
            );
            store.remove_video("123").unwrap();
            assert_eq!(store.saved_video("123").unwrap(), None);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_unknown_or_newer_schema_without_deleting_data() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE keep(value TEXT);INSERT INTO keep VALUES('preserve');")
            .unwrap();
        assert!(migrate(&mut connection).is_err());
        connection.pragma_update(None, "user_version", 99).unwrap();
        assert!(migrate(&mut connection).is_err());
        assert_eq!(
            connection
                .query_row("SELECT value FROM keep", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "preserve"
        );
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Status,
    SaveVideo { track_id: String, video_id: String },
    GetVideo { track_id: String },
    RemoveVideo { track_id: String },
    Record { event: PlayRecord },
    History { query: String },
    ClearHistory,
}
pub struct StorageState {
    pub store: Result<Store, &'static str>,
    pub test_mode: bool,
}
#[tauri::command]
pub async fn storage_command(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, StorageState>,
    request: Request,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if matches!(request, Request::Status) {
        return Ok(serde_json::json!({"available":state.store.is_ok(),"testMode":state.test_mode}));
    }
    let store = state
        .store
        .as_ref()
        .map_err(|error| error.to_string())?
        .clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, &'static str> {
        match request {
            Request::SaveVideo { track_id, video_id } => store.save_video(&track_id, &video_id)?,
            Request::GetVideo { track_id } => {
                return Ok(serde_json::json!(store.saved_video(&track_id)?))
            }
            Request::RemoveVideo { track_id } => store.remove_video(&track_id)?,
            Request::Record { event } => store.record(&event)?,
            Request::History { query } => {
                return serde_json::to_value(store.history(&query)?)
                    .map_err(|_| "Cannot serialize history")
            }
            Request::ClearHistory => store.clear_history()?,
            Request::Status => {}
        }
        Ok(serde_json::Value::Null)
    })
    .await
    .map_err(|_| "Storage worker failed".to_string())?
    .map_err(str::to_string)
}
