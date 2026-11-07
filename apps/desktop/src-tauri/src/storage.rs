use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
#[derive(Clone)]
pub struct Store(pub(crate) Arc<Mutex<Connection>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteVideo {
    pub video_id: String,
    pub unavailable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVideos {
    pub videos: Vec<FavoriteVideo>,
    pub last_video_id: Option<String>,
    pub preferred_video_id: Option<String>,
    pub excluded_video_ids: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub track_id: String,
    pub state: i8,
    pub revision: i64,
    pub pending: bool,
}
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
    pub source: Option<String>,
    pub listened_ms: Option<i64>,
    pub duration_ms: Option<i64>,
    pub end_reason: Option<String>,
    pub ended_at: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayProgress {
    pub playback_id: String,
    pub source: String,
    pub listened_ms: i64,
    pub duration_ms: Option<i64>,
    pub end_reason: Option<String>,
    pub wave_ref: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCandidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub history_video_id: String,
    pub weight: f64,
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
    if version > 6 {
        return Err("Database schema is newer than YCore Music; existing file preserved");
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
    if version < 2 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start feedback migration")?;
        transaction.execute_batch("CREATE TABLE track_feedback(account_id TEXT NOT NULL,track_id TEXT NOT NULL,state INTEGER NOT NULL CHECK(state IN(-1,0,1)),revision INTEGER NOT NULL,pending INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(account_id,track_id));CREATE INDEX feedback_outbox ON track_feedback(account_id,pending,updated_at);PRAGMA user_version=2;").map_err(|_|"Cannot migrate feedback storage")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit feedback migration")?;
    }
    connection.prepare("SELECT account_id,track_id,state,revision,pending,updated_at FROM track_feedback LIMIT 0").map_err(|_|"Invalid feedback schema")?;
    if version < 3 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start favorites migration")?;
        transaction.execute_batch("CREATE TABLE video_favorites(track_id TEXT NOT NULL,video_id TEXT NOT NULL,added_at TEXT NOT NULL,unavailable_at TEXT,PRIMARY KEY(track_id,video_id));CREATE TABLE video_play_state(track_id TEXT PRIMARY KEY,video_id TEXT NOT NULL);INSERT INTO video_favorites(track_id,video_id,added_at) SELECT track_id,video_id,updated_at FROM manual_videos;PRAGMA user_version=3;").map_err(|_|"Cannot migrate video favorites")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit favorites migration")?;
    }
    connection
        .prepare("SELECT track_id,video_id,added_at,unavailable_at FROM video_favorites LIMIT 0")
        .map_err(|_| "Invalid favorites schema")?;
    connection
        .prepare("SELECT track_id,video_id FROM video_play_state LIMIT 0")
        .map_err(|_| "Invalid video state schema")?;
    if version < 4 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start listening migration")?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS play_metrics(playback_id TEXT PRIMARY KEY,source TEXT NOT NULL,listened_ms INTEGER NOT NULL CHECK(listened_ms>=0),duration_ms INTEGER,end_reason TEXT,ended_at TEXT);PRAGMA user_version=4;").map_err(|_| "Cannot migrate listening history")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit listening migration")?;
    }
    connection.prepare("SELECT playback_id,source,listened_ms,duration_ms,end_reason,ended_at FROM play_metrics LIMIT 0").map_err(|_| "Invalid listening schema")?;
    if version < 5 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start Wave event migration")?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS wave_events(event_key TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS wave_events_pending ON wave_events(account_id,status);PRAGMA user_version=5;").map_err(|_|"Cannot migrate Wave events")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit Wave event migration")?;
    }
    connection.prepare("SELECT event_key,account_id,session_id,body_json,created_at,status,attempts FROM wave_events LIMIT 0").map_err(|_|"Invalid Wave event schema")?;
    if version < 6 {
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start clip preferences migration")?;
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS video_preferences(track_id TEXT PRIMARY KEY,video_id TEXT NOT NULL);CREATE TABLE IF NOT EXISTS video_exclusions(track_id TEXT NOT NULL,video_id TEXT NOT NULL,PRIMARY KEY(track_id,video_id));PRAGMA user_version=6;").map_err(|_|"Cannot migrate clip preferences")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit clip preferences migration")?;
    }
    connection
        .prepare("SELECT track_id,video_id FROM video_preferences LIMIT 0")
        .map_err(|_| "Invalid clip preference schema")?;
    connection
        .prepare("SELECT track_id,video_id FROM video_exclusions LIMIT 0")
        .map_err(|_| "Invalid clip exclusion schema")?;
    Ok(())
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        let mut connection = Connection::open(path).map_err(|_| "Cannot open local database")?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Cannot read storage version")?;
        if (1..6).contains(&version) && path != Path::new(":memory:") {
            let backup = path.with_extension(format!(
                "v{version}-backup-{}.sqlite",
                chrono::Utc::now().timestamp_millis()
            ));
            connection
                .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .map_err(|_| "Cannot back up database before migration")?;
        }
        migrate(&mut connection)?;
        connection.execute("UPDATE play_metrics SET end_reason='interrupted',ended_at=?1 WHERE end_reason IS NULL",[chrono::Utc::now().to_rfc3339()]).map_err(|_| "Cannot recover unfinished history")?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }
    pub fn reaction(&self, uid: &str, track: &str) -> Result<Option<Reaction>, &'static str> {
        if !track_id(uid) || !track_id(track) {
            return Err("Invalid feedback identity");
        }
        self.0.lock().map_err(|_|"Storage unavailable")?.query_row("SELECT state,revision,pending FROM track_feedback WHERE account_id=?1 AND track_id=?2",params![uid,track],|row|Ok(Reaction{track_id:track.into(),state:row.get(0)?,revision:row.get(1)?,pending:row.get(2)?})).optional().map_err(|_|"Cannot read feedback")
    }
    pub fn set_reaction(
        &self,
        uid: &str,
        track: &str,
        state: i8,
        expected: Option<i64>,
    ) -> Result<Reaction, &'static str> {
        if !track_id(uid) || !track_id(track) || !(-1..=1).contains(&state) {
            return Err("Invalid feedback");
        }
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start feedback transaction")?;
        let previous: i64 = tx
            .query_row(
                "SELECT revision FROM track_feedback WHERE account_id=?1 AND track_id=?2",
                params![uid, track],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read feedback revision")?
            .unwrap_or(0);
        if expected.is_some_and(|revision| revision != previous) {
            return Err("Feedback changed; undo ignored");
        }
        let revision = previous + 1;
        tx.execute("INSERT INTO track_feedback(account_id,track_id,state,revision,pending,updated_at) VALUES(?1,?2,?3,?4,1,?5) ON CONFLICT(account_id,track_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,pending=1,updated_at=excluded.updated_at",params![uid,track,state,revision,chrono::Utc::now().to_rfc3339()]).map_err(|_|"Cannot save feedback")?;
        tx.commit().map_err(|_| "Cannot commit feedback")?;
        Ok(Reaction {
            track_id: track.into(),
            state,
            revision,
            pending: true,
        })
    }
    pub fn remember_reaction(
        &self,
        uid: &str,
        track: &str,
        state: i8,
    ) -> Result<Reaction, &'static str> {
        if !track_id(uid) || !track_id(track) || !(-1..=1).contains(&state) {
            return Err("Invalid feedback");
        }
        self.0.lock().map_err(|_|"Storage unavailable")?.execute("INSERT INTO track_feedback(account_id,track_id,state,revision,pending,updated_at) VALUES(?1,?2,?3,1,0,?4) ON CONFLICT(account_id,track_id) DO UPDATE SET state=excluded.state,revision=track_feedback.revision+CASE WHEN track_feedback.state!=excluded.state THEN 1 ELSE 0 END WHERE track_feedback.pending=0",params![uid,track,state,chrono::Utc::now().to_rfc3339()]).map_err(|_|"Cannot cache remote feedback")?;
        self.reaction(uid, track)?.ok_or("Feedback unavailable")
    }
    pub fn pending_reactions(&self, uid: &str) -> Result<Vec<Reaction>, &'static str> {
        self.pending_reactions_limit(uid, 25)
    }
    pub fn pending_profile_reactions(&self, uid: &str) -> Result<Vec<Reaction>, &'static str> {
        self.pending_reactions_limit(uid, -1)
    }
    fn pending_reactions_limit(
        &self,
        uid: &str,
        limit: i64,
    ) -> Result<Vec<Reaction>, &'static str> {
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT track_id,state,revision FROM track_feedback WHERE account_id=?1 AND pending=1 ORDER BY updated_at LIMIT ?2").map_err(|_|"Cannot read outbox")?;
        let rows = statement
            .query_map(params![uid, limit], |row| {
                Ok(Reaction {
                    track_id: row.get(0)?,
                    state: row.get(1)?,
                    revision: row.get(2)?,
                    pending: true,
                })
            })
            .map_err(|_| "Cannot read outbox")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Cannot read outbox");
        rows
    }
    pub fn acknowledge_reaction(&self, uid: &str, record: &Reaction) -> Result<(), &'static str> {
        self.0.lock().map_err(|_|"Storage unavailable")?.execute("UPDATE track_feedback SET pending=0 WHERE account_id=?1 AND track_id=?2 AND revision=?3",params![uid,record.track_id,record.revision]).map_err(|_|"Cannot acknowledge feedback")?;
        Ok(())
    }
    pub fn save_video(&self, track: &str, video: &str) -> Result<(), &'static str> {
        if !track_id(track) || !video_id(video) {
            return Err("Invalid manual video");
        }
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start favorite transaction")?;
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute("INSERT INTO manual_videos(track_id,video_id,updated_at) VALUES(?1,?2,?3) ON CONFLICT(track_id) DO UPDATE SET video_id=excluded.video_id,updated_at=excluded.updated_at",params![track,video,now]).map_err(|_|"Cannot save manual video")?;
        tx.execute(
            "INSERT OR IGNORE INTO video_favorites(track_id,video_id,added_at) VALUES(?1,?2,?3)",
            params![track, video, now],
        )
        .map_err(|_| "Cannot save video favorite")?;
        tx.commit().map_err(|_| "Cannot commit video favorite")?;
        Ok(())
    }
    pub fn saved_videos(&self, track: &str) -> Result<SavedVideos, &'static str> {
        if !track_id(track) {
            return Err("Invalid track ID");
        }
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT video_id,unavailable_at IS NOT NULL FROM video_favorites WHERE track_id=?1 ORDER BY added_at,video_id").map_err(|_|"Cannot read video favorites")?;
        let videos = statement
            .query_map([track], |row| {
                Ok(FavoriteVideo {
                    video_id: row.get(0)?,
                    unavailable: row.get(1)?,
                })
            })
            .map_err(|_| "Cannot read video favorites")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Cannot read video favorites")?;
        let last_video_id = connection
            .query_row(
                "SELECT video_id FROM video_play_state WHERE track_id=?1",
                [track],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read last video")?;
        Ok(SavedVideos {
            videos,
            last_video_id,
            preferred_video_id: connection
                .query_row(
                    "SELECT video_id FROM video_preferences WHERE track_id=?1",
                    [track],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| "Cannot read preferred clip")?,
            excluded_video_ids: {
                let mut query = connection
                    .prepare(
                        "SELECT video_id FROM video_exclusions WHERE track_id=?1 ORDER BY video_id",
                    )
                    .map_err(|_| "Cannot read excluded clips")?;
                let result = query
                    .query_map([track], |row| row.get(0))
                    .map_err(|_| "Cannot read excluded clips")?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| "Cannot read excluded clips")?;
                result
            },
        })
    }
    pub fn prefer_video(&self, track: &str, video: Option<&str>) -> Result<(), &'static str> {
        if !track_id(track) || video.is_some_and(|id| !video_id(id)) {
            return Err("Invalid clip preference");
        }
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start clip preference transaction")?;
        if let Some(video) = video {
            tx.execute("INSERT INTO video_preferences(track_id,video_id) VALUES(?1,?2) ON CONFLICT(track_id) DO UPDATE SET video_id=excluded.video_id",params![track,video]).map_err(|_|"Cannot prefer clip")?;
            tx.execute(
                "DELETE FROM video_exclusions WHERE track_id=?1 AND video_id=?2",
                params![track, video],
            )
            .map_err(|_| "Cannot allow preferred clip")?;
            tx.execute("INSERT INTO video_favorites(track_id,video_id,added_at) VALUES(?1,?2,?3) ON CONFLICT(track_id,video_id) DO UPDATE SET unavailable_at=NULL",params![track,video,chrono::Utc::now().to_rfc3339()]).map_err(|_|"Cannot save preferred clip")?;
        } else {
            tx.execute("DELETE FROM video_preferences WHERE track_id=?1", [track])
                .map_err(|_| "Cannot clear preferred clip")?;
        }
        tx.commit().map_err(|_| "Cannot commit preferred clip")
    }
    pub fn exclude_video(
        &self,
        track: &str,
        video: &str,
        excluded: bool,
    ) -> Result<(), &'static str> {
        if !track_id(track) || !video_id(video) {
            return Err("Invalid clip exclusion");
        }
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start clip exclusion transaction")?;
        if excluded {
            tx.execute(
                "INSERT OR IGNORE INTO video_exclusions(track_id,video_id) VALUES(?1,?2)",
                params![track, video],
            )
            .map_err(|_| "Cannot exclude clip")?;
            tx.execute(
                "DELETE FROM video_preferences WHERE track_id=?1 AND video_id=?2",
                params![track, video],
            )
            .map_err(|_| "Cannot clear excluded preference")?;
        } else {
            tx.execute(
                "DELETE FROM video_exclusions WHERE track_id=?1 AND video_id=?2",
                params![track, video],
            )
            .map_err(|_| "Cannot restore clip")?;
        }
        tx.commit().map_err(|_| "Cannot commit clip exclusion")
    }
    pub fn remove_favorite(&self, track: &str, video: &str) -> Result<(), &'static str> {
        if !track_id(track) || !video_id(video) {
            return Err("Invalid video favorite");
        }
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start favorite removal")?;
        tx.execute(
            "DELETE FROM video_favorites WHERE track_id=?1 AND video_id=?2",
            params![track, video],
        )
        .map_err(|_| "Cannot remove video favorite")?;
        tx.execute(
            "DELETE FROM manual_videos WHERE track_id=?1 AND video_id=?2",
            params![track, video],
        )
        .map_err(|_| "Cannot remove legacy video binding")?;
        tx.execute(
            "DELETE FROM video_preferences WHERE track_id=?1 AND video_id=?2",
            params![track, video],
        )
        .map_err(|_| "Cannot remove preferred clip")?;
        tx.commit().map_err(|_| "Cannot commit favorite removal")?;
        Ok(())
    }
    pub fn video_failed(&self, track: &str, video: &str) -> Result<(), &'static str> {
        if !track_id(track) || !video_id(video) {
            return Err("Invalid video favorite");
        }
        self.0
            .lock()
            .map_err(|_| "Storage unavailable")?
            .execute(
                "UPDATE video_favorites SET unavailable_at=?3 WHERE track_id=?1 AND video_id=?2",
                params![track, video, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(|_| "Cannot mark unavailable video")?;
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
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let tx = connection
            .transaction()
            .map_err(|_| "Cannot start video reset")?;
        tx.execute("DELETE FROM manual_videos WHERE track_id=?1", [track])
            .map_err(|_| "Cannot reset manual video")?;
        tx.execute("DELETE FROM video_favorites WHERE track_id=?1", [track])
            .map_err(|_| "Cannot reset favorites")?;
        tx.execute("DELETE FROM video_preferences WHERE track_id=?1", [track])
            .map_err(|_| "Cannot reset preferred clip")?;
        tx.commit().map_err(|_| "Cannot commit video reset")?;
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
        if track_id(&event.track_id) {
            let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
            let tx = connection
                .transaction()
                .map_err(|_| "Cannot start last-video update")?;
            tx.execute("INSERT INTO video_play_state(track_id,video_id) VALUES(?1,?2) ON CONFLICT(track_id) DO UPDATE SET video_id=excluded.video_id",params![event.track_id,event.video_id]).map_err(|_|"Cannot remember last video")?;
            tx.execute(
                "UPDATE video_favorites SET unavailable_at=NULL WHERE track_id=?1 AND video_id=?2",
                params![event.track_id, event.video_id],
            )
            .map_err(|_| "Cannot mark video available")?;
            tx.commit().map_err(|_| "Cannot commit last-video update")?;
        }
        Ok(())
    }
    pub fn progress(&self, event: &PlayProgress) -> Result<(), &'static str> {
        const MAX_MS: i64 = 366 * 24 * 60 * 60 * 1000;
        if event.playback_id.is_empty()
            || event.wave_ref.as_ref().is_some_and(|reference| {
                reference.len() != 32 || !reference.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            || event.playback_id.len() > 64
            || !event
                .playback_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || !(0..=MAX_MS).contains(&event.listened_ms)
            || event
                .duration_ms
                .is_some_and(|ms| !(1..=MAX_MS).contains(&ms))
            || !matches!(
                event.source.as_str(),
                "my_wave" | "smart_history" | "catalogue" | "history" | "manual"
            )
            || event.end_reason.as_deref().is_some_and(|reason| {
                !matches!(
                    reason,
                    "natural"
                        | "skip"
                        | "dislike"
                        | "error"
                        | "source_change"
                        | "video_change"
                        | "shutdown"
                )
            })
        {
            return Err("Invalid listening event");
        }
        let ended_at = event
            .end_reason
            .as_ref()
            .map(|_| chrono::Utc::now().to_rfc3339());
        self.0.lock().map_err(|_|"Storage unavailable")?.execute("INSERT INTO play_metrics(playback_id,source,listened_ms,duration_ms,end_reason,ended_at) SELECT ?1,?2,?3,?4,?5,?6 FROM play_history WHERE playback_id=?1 ON CONFLICT(playback_id) DO UPDATE SET listened_ms=MAX(play_metrics.listened_ms,excluded.listened_ms),duration_ms=COALESCE(excluded.duration_ms,play_metrics.duration_ms),end_reason=COALESCE(play_metrics.end_reason,excluded.end_reason),ended_at=COALESCE(play_metrics.ended_at,excluded.ended_at)",params![event.playback_id,event.source,event.listened_ms,event.duration_ms,event.end_reason,ended_at]).map_err(|_|"Cannot save listening progress")?;
        Ok(())
    }
    pub fn finish_open(&self) -> Result<(), &'static str> {
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let queued = crate::wave_feedback::queue_shutdown(&mut connection);
        connection.execute("UPDATE play_metrics SET end_reason='shutdown',ended_at=?1 WHERE end_reason IS NULL",[chrono::Utc::now().to_rfc3339()]).map_err(|_|"Cannot finish listening history")?;
        queued
    }
    pub fn history(
        &self,
        query: &str,
        before_id: Option<i64>,
    ) -> Result<Vec<HistoryEntry>, &'static str> {
        self.history_range(query, before_id, None, None)
    }
    fn history_range(
        &self,
        query: &str,
        before_id: Option<i64>,
        from: Option<i64>,
        until: Option<i64>,
    ) -> Result<Vec<HistoryEntry>, &'static str> {
        if from.zip(until).is_some_and(|(from, until)| from >= until) {
            return Err("Invalid history period");
        }
        let boundary = |seconds: Option<i64>| {
            seconds
                .map(|seconds| {
                    chrono::DateTime::from_timestamp(seconds, 0)
                        .map(|date| date.format("%Y-%m-%dT%H:%M:%S").to_string())
                        .ok_or("Invalid history boundary")
                })
                .transpose()
        };
        let from = boundary(from)?;
        let until = boundary(until)?;
        if before_id.is_some_and(|id| id <= 0) {
            return Err("Invalid history cursor");
        }
        if query.len() > 512 {
            return Err("Search query too long");
        }
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT h.id,h.track_id,h.title,h.artist,h.video_id,h.started_at,m.source,m.listened_ms,m.duration_ms,m.end_reason,m.ended_at FROM play_history h LEFT JOIN play_metrics m ON m.playback_id=h.playback_id WHERE instr(h.search_text,?1)>0 AND (?2 IS NULL OR h.id<?2) AND (?3 IS NULL OR substr(h.started_at,1,19)>=?3) AND (?4 IS NULL OR substr(h.started_at,1,19)<?4) ORDER BY h.id DESC LIMIT 100").map_err(|_|"Cannot query history")?;
        let rows = statement
            .query_map(
                params![query.to_lowercase(), before_id, from, until],
                |row| {
                    Ok(HistoryEntry {
                        id: row.get(0)?,
                        track_id: row.get(1)?,
                        title: row.get(2)?,
                        artist: row.get(3)?,
                        video_id: row.get(4)?,
                        started_at: row.get(5)?,
                        source: row.get(6)?,
                        listened_ms: row.get(7)?,
                        duration_ms: row.get(8)?,
                        end_reason: row.get(9)?,
                        ended_at: row.get(10)?,
                    })
                },
            )
            .map_err(|_| "Cannot read history")?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| "Invalid history data")
    }
    pub fn clear_history(&self) -> Result<(), &'static str> {
        let mut connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "Cannot start history clearing")?;
        transaction
            .execute_batch(
                "DELETE FROM wave_events;DELETE FROM play_metrics;DELETE FROM play_history;",
            )
            .map_err(|_| "Cannot clear history")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit history clearing")?;
        Ok(())
    }
    pub fn smart_history(
        &self,
        profile: Option<&crate::feedback::Profile>,
    ) -> Result<Vec<SmartCandidate>, &'static str> {
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let uid = profile.map(|p| p.uid.as_str());
        let mut statement=connection.prepare("WITH latest AS (SELECT track_id,MAX(id) AS last_id,COUNT(*) AS plays FROM play_history GROUP BY track_id) SELECT e.track_id,e.title,e.artist,e.video_id,e.started_at,l.plays,(SELECT MIN(f.state) FROM track_feedback f WHERE f.track_id=e.track_id AND (?1 IS NULL OR f.account_id=?1)),(SELECT MAX(f.pending) FROM track_feedback f WHERE f.track_id=e.track_id AND (?1 IS NULL OR f.account_id=?1)) FROM latest l JOIN play_history e ON e.id=l.last_id ORDER BY e.id DESC LIMIT 500").map_err(|_|"Cannot query smart history")?;
        let rows = statement
            .query_map([uid], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i8>>(6)?,
                    row.get::<_, Option<bool>>(7)?,
                ))
            })
            .map_err(|_| "Cannot read smart history")?;
        let mut candidates = Vec::new();
        for row in rows {
            let (id, title, artist, video, started, plays, local, pending) =
                row.map_err(|_| "Invalid history row")?;
            let reaction = if pending == Some(true) {
                local.unwrap_or(0)
            } else if let Some(profile) = profile {
                if profile.disliked.contains(&id) {
                    -1
                } else {
                    i8::from(profile.liked.contains(&id))
                }
            } else if local == Some(-1) {
                -1
            } else {
                0
            };
            if reaction == -1 || !video_id(&video) {
                continue;
            }
            let age = chrono::DateTime::parse_from_rfc3339(&started)
                .map(|at| {
                    (chrono::Utc::now() - at.with_timezone(&chrono::Utc))
                        .num_seconds()
                        .max(0) as f64
                        / 86400.0
                })
                .unwrap_or(365.0);
            let weight = 1.0
                + (plays as f64).ln_1p()
                + if reaction == 1 { 4.0 } else { 0.0 }
                + 2.0 / (1.0 + age / 7.0);
            candidates.push(SmartCandidate {
                id,
                title,
                artist,
                history_video_id: video,
                weight,
            });
        }
        Ok(candidates)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn v4_wave_upgrade_keeps_listening_and_creates_a_backup_without_fabricating_feedback() {
        let path = std::env::temp_dir().join(format!(
            "ycore-wave-upgrade-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = Store::open(&path).unwrap();
            store
                .record(&PlayRecord {
                    playback_id: "v4-play".into(),
                    track_id: "1".into(),
                    title: "Fixture".into(),
                    artist: "Fixture".into(),
                    video_id: "M7lc1UVf-VE".into(),
                })
                .unwrap();
            store
                .progress(&PlayProgress {
                    playback_id: "v4-play".into(),
                    source: "catalogue".into(),
                    listened_ms: 4000,
                    duration_ms: Some(120000),
                    end_reason: Some("natural".into()),
                    wave_ref: None,
                })
                .unwrap();
            store
                .0
                .lock()
                .unwrap()
                .execute_batch("DROP TABLE wave_events;PRAGMA user_version=4;")
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let row = store.history("", None).unwrap().remove(0);
            assert_eq!(row.listened_ms, Some(4000));
            assert_eq!(row.end_reason.as_deref(), Some("natural"));
            assert_eq!(
                store
                    .0
                    .lock()
                    .unwrap()
                    .query_row("SELECT COUNT(*) FROM wave_events", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        let prefix = format!("{}.v4-backup-", path.file_stem().unwrap().to_string_lossy());
        let backup = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|entry| {
                entry
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&prefix)
            })
            .unwrap();
        assert_eq!(
            Connection::open(&backup)
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            4
        );
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(backup).unwrap();
    }
    #[test]
    fn listening_progress_is_monotonic_terminal_and_cannot_resurrect_cleared_history() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let event = PlayRecord {
            playback_id: "listen-1".into(),
            track_id: "1".into(),
            title: "One".into(),
            artist: "Fixture".into(),
            video_id: "M7lc1UVf-VE".into(),
        };
        store.record(&event).unwrap();
        let mut progress = PlayProgress {
            wave_ref: None,
            playback_id: event.playback_id.clone(),
            source: "my_wave".into(),
            listened_ms: 12000,
            duration_ms: Some(180000),
            end_reason: None,
        };
        store.progress(&progress).unwrap();
        progress.listened_ms = 3000;
        store.progress(&progress).unwrap();
        progress.listened_ms = 14000;
        progress.end_reason = Some("natural".into());
        store.progress(&progress).unwrap();
        progress.end_reason = Some("error".into());
        progress.listened_ms = 4000;
        store.progress(&progress).unwrap();
        let rows = store.history("", None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].listened_ms, Some(14000));
        assert_eq!(rows[0].source.as_deref(), Some("my_wave"));
        assert_eq!(rows[0].end_reason.as_deref(), Some("natural"));
        assert!(rows[0].ended_at.is_some());
        progress.listened_ms = -1;
        assert!(store.progress(&progress).is_err());
        progress.listened_ms = 10;
        progress.source = "invalid".into();
        assert!(store.progress(&progress).is_err());
        progress.source = "my_wave".into();
        store.clear_history().unwrap();
        store.progress(&progress).unwrap();
        assert!(store.history("", None).unwrap().is_empty());
        assert_eq!(
            store
                .0
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM play_metrics", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn v3_upgrade_preserves_history_and_backups_then_recovers_interrupted_listening() {
        let path = std::env::temp_dir().join(format!(
            "ycore-listening-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let event = PlayRecord {
            playback_id: "listen-2".into(),
            track_id: "2".into(),
            title: "Old history".into(),
            artist: "Fixture".into(),
            video_id: "M7lc1UVf-VE".into(),
        };
        {
            let store = Store::open(&path).unwrap();
            store.record(&event).unwrap();
            store
                .0
                .lock()
                .unwrap()
                .execute_batch("DROP TABLE play_metrics;PRAGMA user_version=3;")
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let rows = store.history("", None).unwrap();
            assert_eq!(rows.len(), 1);
            assert!(rows[0].listened_ms.is_none());
            store
                .progress(&PlayProgress {
                    wave_ref: None,
                    playback_id: event.playback_id.clone(),
                    source: "history".into(),
                    listened_ms: 5000,
                    duration_ms: None,
                    end_reason: None,
                })
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.history("", None).unwrap()[0].end_reason.as_deref(),
                Some("interrupted")
            );
            store
                .record(&PlayRecord {
                    playback_id: "listen-3".into(),
                    ..event
                })
                .unwrap();
            store
                .progress(&PlayProgress {
                    wave_ref: None,
                    playback_id: "listen-3".into(),
                    source: "catalogue".into(),
                    listened_ms: 1000,
                    duration_ms: None,
                    end_reason: None,
                })
                .unwrap();
            store.finish_open().unwrap();
            assert_eq!(
                store.history("", None).unwrap()[0].end_reason.as_deref(),
                Some("shutdown")
            );
        }
        let prefix = format!("{}.v3-backup-", path.file_stem().unwrap().to_string_lossy());
        let backup = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|entry| {
                entry
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&prefix)
            })
            .unwrap();
        assert_eq!(
            Connection::open(&backup)
                .unwrap()
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            3
        );
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(backup).unwrap();
    }
    #[test]
    fn smart_history_deduplicates_weights_and_excludes_local_and_remote_dislikes() {
        let store = memory();
        for (index, id) in ["1", "1", "1", "1", "2", "3", "4", "5"].iter().enumerate() {
            store
                .record(&PlayRecord {
                    playback_id: format!("smart-{index}"),
                    track_id: id.to_string(),
                    title: format!("Track {id}"),
                    artist: "Artist".into(),
                    video_id: "M7lc1UVf-VE".into(),
                })
                .unwrap();
        }
        store
            .0
            .lock()
            .unwrap()
            .execute(
                "UPDATE play_history SET started_at='2020-01-01T00:00:00Z' WHERE track_id='2'",
                [],
            )
            .unwrap();
        store.set_reaction("1", "3", -1, None).unwrap();
        store.set_reaction("1", "5", 1, None).unwrap();
        let profile = crate::feedback::Profile {
            uid: "1".into(),
            liked: ["1".into()].into_iter().collect(),
            disliked: ["4".into(), "5".into()].into_iter().collect(),
        };
        let pool = store.smart_history(Some(&profile)).unwrap();
        assert_eq!(pool.len(), 3);
        assert!(!pool.iter().any(|t| t.id == "3" || t.id == "4"));
        assert!(
            pool.iter().find(|t| t.id == "1").unwrap().weight
                > pool.iter().find(|t| t.id == "2").unwrap().weight
        );
        assert!(
            pool.iter().find(|t| t.id == "5").unwrap().weight
                > pool.iter().find(|t| t.id == "2").unwrap().weight
        );
        assert!(!store
            .smart_history(None)
            .unwrap()
            .iter()
            .any(|t| t.id == "3"));
        store.clear_history().unwrap();
        assert!(store.smart_history(Some(&profile)).unwrap().is_empty());
    }
    #[test]
    fn v2_upgrade_keeps_pending_feedback_and_imports_the_old_manual_binding() {
        let path = std::env::temp_dir().join(format!(
            "ycore-v2-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.save_video("123", "M7lc1UVf-VE").unwrap();
            store.set_reaction("1", "123", -1, None).unwrap();
            store
                .0
                .lock()
                .unwrap()
                .execute_batch(
                    "DROP TABLE video_favorites;DROP TABLE video_play_state;PRAGMA user_version=2;",
                )
                .unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.saved_videos("123").unwrap().videos[0].video_id,
                "M7lc1UVf-VE"
            );
            assert_eq!(store.pending_reactions("1").unwrap()[0].state, -1);
        }
        let prefix = format!("{}.v2-backup-", path.file_stem().unwrap().to_string_lossy());
        let backup = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&prefix)
            })
            .unwrap();
        {
            let connection = Connection::open(&backup).unwrap();
            assert_eq!(
                connection
                    .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                    .unwrap(),
                2
            );
            assert_eq!(
                connection
                    .query_row(
                        "SELECT pending FROM track_feedback WHERE track_id='123'",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                1
            );
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(backup).unwrap();
    }
    #[test]
    fn favorites_keep_multiple_links_unavailable_state_and_actual_last_play_across_restart() {
        let path = std::env::temp_dir().join(format!(
            "ycore-favorites-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.save_video("123", "Aaaaaaaaaaa").unwrap();
            store.save_video("123", "Bbbbbbbbbbb").unwrap();
            store.save_video("123", "Aaaaaaaaaaa").unwrap();
            assert_eq!(store.saved_videos("123").unwrap().videos.len(), 2);
            store.video_failed("123", "Bbbbbbbbbbb").unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let videos = store.saved_videos("123").unwrap();
            assert_eq!(videos.videos.len(), 2);
            assert!(
                videos
                    .videos
                    .iter()
                    .find(|v| v.video_id == "Bbbbbbbbbbb")
                    .unwrap()
                    .unavailable
            );
            store
                .record(&PlayRecord {
                    playback_id: "actual-play".into(),
                    track_id: "123".into(),
                    title: "Keep".into(),
                    artist: "Artist".into(),
                    video_id: "Bbbbbbbbbbb".into(),
                })
                .unwrap();
            let videos = store.saved_videos("123").unwrap();
            assert_eq!(videos.last_video_id.as_deref(), Some("Bbbbbbbbbbb"));
            assert!(!videos.videos.iter().any(|v| v.unavailable));
            store.remove_favorite("123", "Aaaaaaaaaaa").unwrap();
            assert_eq!(store.saved_videos("123").unwrap().videos.len(), 1);
            assert_eq!(store.history("", None).unwrap().len(), 1);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn migration_backs_up_v1_and_preserves_history_and_manual_overrides() {
        let path = std::env::temp_dir().join(format!(
            "ycore-migrate-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        {
            let store = Store::open(&path).unwrap();
            store.save_video("123", "M7lc1UVf-VE").unwrap();
            store
                .record(&PlayRecord {
                    playback_id: "migration-event".into(),
                    track_id: "123".into(),
                    title: "Keep".into(),
                    artist: "Artist".into(),
                    video_id: "M7lc1UVf-VE".into(),
                })
                .unwrap();
            store
                .0
                .lock()
                .unwrap()
                .execute_batch("DROP TABLE track_feedback;DROP TABLE video_favorites;DROP TABLE video_play_state;PRAGMA user_version=1;")
                .unwrap();
        }
        let before: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&path.file_stem().unwrap().to_string_lossy().to_string())
            })
            .collect();
        {
            let store = Store::open(&path).unwrap();
            assert_eq!(
                store.saved_video("123").unwrap().as_deref(),
                Some("M7lc1UVf-VE")
            );
            assert_eq!(store.history("", None).unwrap().len(), 1);
            assert_eq!(
                store.saved_videos("123").unwrap().videos[0].video_id,
                "M7lc1UVf-VE"
            );
            store.set_reaction("1", "123", 1, None).unwrap();
        }
        let backup = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| {
                !before.contains(p)
                    && p.file_stem()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(&path.file_stem().unwrap().to_string_lossy().to_string())
            })
            .unwrap();
        {
            let connection = Connection::open(&backup).unwrap();
            assert_eq!(
                connection
                    .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                connection
                    .query_row("SELECT COUNT(*) FROM play_history", [], |r| r
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(backup).unwrap();
    }
    fn memory() -> Store {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        Store(Arc::new(Mutex::new(connection)))
    }

    #[test]
    fn clip_preferences_are_track_scoped_and_never_change_music_reactions() {
        let store = memory();
        store.save_video("123", "Aaaaaaaaaaa").unwrap();
        store.save_video("123", "Bbbbbbbbbbb").unwrap();
        store.set_reaction("1", "123", 1, None).unwrap();
        store.prefer_video("123", Some("Aaaaaaaaaaa")).unwrap();
        assert_eq!(
            store
                .saved_videos("123")
                .unwrap()
                .preferred_video_id
                .as_deref(),
            Some("Aaaaaaaaaaa")
        );
        store.prefer_video("123", Some("Bbbbbbbbbbb")).unwrap();
        store.exclude_video("123", "Bbbbbbbbbbb", true).unwrap();
        let value = store.saved_videos("123").unwrap();
        assert!(value.preferred_video_id.is_none());
        assert_eq!(value.excluded_video_ids, vec!["Bbbbbbbbbbb"]);
        assert_eq!(value.videos.len(), 2);
        assert!(store
            .saved_videos("456")
            .unwrap()
            .excluded_video_ids
            .is_empty());
        assert_eq!(store.reaction("1", "123").unwrap().unwrap().state, 1);
        store.exclude_video("123", "Bbbbbbbbbbb", false).unwrap();
        store.prefer_video("123", Some("Bbbbbbbbbbb")).unwrap();
        store.remove_favorite("123", "Bbbbbbbbbbb").unwrap();
        assert!(store
            .saved_videos("123")
            .unwrap()
            .preferred_video_id
            .is_none());
        assert!(store
            .prefer_video("../account", Some("Aaaaaaaaaaa"))
            .is_err());
        assert!(store.exclude_video("123", "https://evil", true).is_err());
    }
    #[test]
    fn v5_preferences_upgrade_backs_up_data_and_survives_reopen() {
        let directory =
            std::env::temp_dir().join(format!("ycore-prefs-{}", getrandom::u64().unwrap()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("test.sqlite");
        {
            let store = Store::open(&path).unwrap();
            store.save_video("123", "Aaaaaaaaaaa").unwrap();
            store.0.lock().unwrap().execute_batch("DROP TABLE video_preferences;DROP TABLE video_exclusions;PRAGMA user_version=5;").unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let saved = store.saved_videos("123").unwrap();
            assert_eq!(saved.videos.len(), 1);
            assert!(saved.preferred_video_id.is_none());
            assert!(saved.excluded_video_ids.is_empty());
            store.prefer_video("123", Some("Bbbbbbbbbbb")).unwrap();
            store.exclude_video("123", "Aaaaaaaaaaa", true).unwrap();
        }
        {
            let store = Store::open(&path).unwrap();
            let saved = store.saved_videos("123").unwrap();
            assert_eq!(saved.preferred_video_id.as_deref(), Some("Bbbbbbbbbbb"));
            assert_eq!(saved.excluded_video_ids, vec!["Aaaaaaaaaaa"]);
        }
        let backups: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("v5-backup")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(&backups[0]).unwrap();
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            5
        );
        drop(backup);
        for entry in std::fs::read_dir(&directory).unwrap() {
            std::fs::remove_file(entry.unwrap().path()).unwrap();
        }
        std::fs::remove_dir(directory).unwrap();
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
        assert_eq!(store.history("ГРУППА", None).unwrap().len(), 1);
        event.playback_id = "event-2".into();
        store.record(&event).unwrap();
        assert_eq!(store.history("", None).unwrap().len(), 2);
        store.save_video("123", "M7lc1UVf-VE").unwrap();
        store.clear_history().unwrap();
        assert!(store.history("", None).unwrap().is_empty());
        assert!(store.saved_video("123").unwrap().is_some());
    }
    #[test]
    fn history_cursor_preserves_order_and_repeats_when_new_events_arrive() {
        let store = memory();
        for i in 0..205 {
            store
                .record(&PlayRecord {
                    playback_id: format!("event-{i}"),
                    track_id: "123".into(),
                    title: "Группа крови".into(),
                    artist: "Кино".into(),
                    video_id: "M7lc1UVf-VE".into(),
                })
                .unwrap();
        }
        let first = store.history("КИНО", None).unwrap();
        assert_eq!(first.len(), 100);
        store
            .record(&PlayRecord {
                playback_id: "new-event".into(),
                track_id: "456".into(),
                title: "Новая песня".into(),
                artist: "Кино".into(),
                video_id: "M7lc1UVf-VE".into(),
            })
            .unwrap();
        let second = store
            .history("кино", Some(first.last().unwrap().id))
            .unwrap();
        let third = store
            .history("кино", Some(second.last().unwrap().id))
            .unwrap();
        assert_eq!(second.len(), 100);
        assert_eq!(third.len(), 5);
        let ids: Vec<_> = first
            .iter()
            .chain(&second)
            .chain(&third)
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, (1..=205).rev().collect::<Vec<_>>());
        assert!(store.history("кино", Some(1)).unwrap().is_empty());
        assert!(store.history("", Some(0)).is_err());
        assert!(store.history("", Some(-1)).is_err());
        assert_eq!(store.history("новая", None).unwrap().len(), 1);
        let request: Request =
            serde_json::from_str(r#"{"type":"history","query":"кино","beforeId":106}"#).unwrap();
        assert!(matches!(
            request,
            Request::History {
                before_id: Some(106),
                ..
            }
        ));
        let legacy: Request = serde_json::from_str(r#"{"type":"history","query":"кино"}"#).unwrap();
        assert!(matches!(
            legacy,
            Request::History {
                before_id: None,
                ..
            }
        ));
    }
    #[test]
    fn history_period_keeps_local_day_boundaries_repeats_and_cursor_without_rounding_nanoseconds() {
        let store = memory();
        for (i, time) in [
            "2026-11-03T18:59:59.999999999+00:00",
            "2026-11-03T19:00:00+00:00",
            "2026-11-04T18:59:59.999999999+00:00",
            "2026-11-04T19:00:00+00:00",
        ]
        .into_iter()
        .enumerate()
        {
            let event = PlayRecord {
                playback_id: format!("date-{i}"),
                track_id: "123".into(),
                title: "Range".into(),
                artist: "Fixture".into(),
                video_id: "M7lc1UVf-VE".into(),
            };
            store.record(&event).unwrap();
            store
                .0
                .lock()
                .unwrap()
                .execute(
                    "UPDATE play_history SET started_at=?1 WHERE playback_id=?2",
                    params![time, event.playback_id],
                )
                .unwrap();
        }
        let from = chrono::DateTime::parse_from_rfc3339("2026-11-03T19:00:00Z")
            .unwrap()
            .timestamp();
        let until = from + 86400;
        let ids = |rows: Vec<HistoryEntry>| rows.into_iter().map(|row| row.id).collect::<Vec<_>>();
        assert_eq!(
            ids(store
                .history_range("RANGE", None, Some(from), Some(until))
                .unwrap()),
            vec![3, 2]
        );
        assert_eq!(
            ids(store
                .history_range("range", Some(3), Some(from), Some(until))
                .unwrap()),
            vec![2]
        );
        assert_eq!(
            ids(store
                .history_range("range", None, Some(from), None)
                .unwrap()),
            vec![4, 3, 2]
        );
        assert_eq!(
            ids(store
                .history_range("range", None, None, Some(until))
                .unwrap()),
            vec![3, 2, 1]
        );
        assert!(store
            .history_range("", None, Some(until), Some(from))
            .is_err());
        assert!(store.history_range("", None, Some(i64::MAX), None).is_err());
        assert_eq!(store.history("", None).unwrap().len(), 4);
    }
    #[test]
    fn manual_override_survives_reopen_and_rejects_invalid_values() {
        let path = std::env::temp_dir().join(format!(
            "ycore-store-{}-{}.sqlite",
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
    SaveVideo {
        track_id: String,
        video_id: String,
    },
    GetVideo {
        track_id: String,
    },
    GetVideos {
        track_id: String,
    },
    RemoveFavorite {
        track_id: String,
        video_id: String,
    },
    PreferVideo {
        track_id: String,
        video_id: Option<String>,
    },
    ExcludeVideo {
        track_id: String,
        video_id: String,
        excluded: bool,
    },
    VideoFailed {
        track_id: String,
        video_id: String,
    },
    RemoveVideo {
        track_id: String,
    },
    Record {
        event: PlayRecord,
    },
    Progress {
        event: PlayProgress,
    },
    History {
        query: String,
        before_id: Option<i64>,
        from: Option<i64>,
        until: Option<i64>,
    },
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
    source: tauri::State<'_, crate::source::Source>,
    request: Request,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if matches!(request, Request::Status) {
        return Ok(serde_json::json!({"available":state.store.is_ok(),"testMode":state.test_mode}));
    }
    let source = source.inner().clone();
    let store = state
        .store
        .as_ref()
        .map_err(|error| error.to_string())?
        .clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, &'static str> {
        match request {
            Request::SaveVideo { track_id, video_id } => store.save_video(&track_id, &video_id)?,
            Request::PreferVideo { track_id, video_id } => {
                store.prefer_video(&track_id, video_id.as_deref())?
            }
            Request::ExcludeVideo {
                track_id,
                video_id,
                excluded,
            } => store.exclude_video(&track_id, &video_id, excluded)?,
            Request::GetVideo { track_id } => {
                return Ok(serde_json::json!(store.saved_video(&track_id)?))
            }
            Request::GetVideos { track_id } => {
                return serde_json::to_value(store.saved_videos(&track_id)?)
                    .map_err(|_| "Cannot serialize favorites")
            }
            Request::RemoveFavorite { track_id, video_id } => {
                store.remove_favorite(&track_id, &video_id)?
            }
            Request::VideoFailed { track_id, video_id } => {
                store.video_failed(&track_id, &video_id)?
            }
            Request::RemoveVideo { track_id } => store.remove_video(&track_id)?,
            Request::Record { event } => store.record(&event)?,
            Request::Progress { event } => {
                store.progress(&event)?;
                crate::wave_feedback::enqueue(&store, &source, &event)?;
            }
            Request::History {
                query,
                before_id,
                from,
                until,
            } => {
                let rows = if from.is_none() && until.is_none() {
                    store.history(&query, before_id)?
                } else {
                    store.history_range(&query, before_id, from, until)?
                };
                return serde_json::to_value(rows).map_err(|_| "Cannot serialize history");
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
