use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
#[derive(Clone)]
pub struct Store(Arc<Mutex<Connection>>);
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
    if version > 3 {
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
    Ok(())
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        let mut connection = Connection::open(path).map_err(|_| "Cannot open local database")?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| "Cannot read storage version")?;
        if version == 1 || version == 2 {
            let backup = path.with_extension(format!(
                "v{version}-backup-{}.sqlite",
                chrono::Utc::now().timestamp_millis()
            ));
            connection
                .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                .map_err(|_| "Cannot back up database before migration")?;
        }
        migrate(&mut connection)?;
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
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT track_id,state,revision FROM track_feedback WHERE account_id=?1 AND pending=1 ORDER BY updated_at LIMIT 25").map_err(|_|"Cannot read outbox")?;
        let rows = statement
            .query_map([uid], |row| {
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
        })
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
    pub fn history(
        &self,
        query: &str,
        before_id: Option<i64>,
    ) -> Result<Vec<HistoryEntry>, &'static str> {
        if before_id.is_some_and(|id| id <= 0) {
            return Err("Invalid history cursor");
        }
        if query.len() > 512 {
            return Err("Search query too long");
        }
        let connection = self.0.lock().map_err(|_| "Storage unavailable")?;
        let mut statement=connection.prepare("SELECT id,track_id,title,artist,video_id,started_at FROM play_history WHERE instr(search_text,?1)>0 AND (?2 IS NULL OR id<?2) ORDER BY id DESC LIMIT 100").map_err(|_|"Cannot query history")?;
        let rows = statement
            .query_map(params![query.to_lowercase(), before_id], |row| {
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
            "encore-v2-{}-{}.sqlite",
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
            "encore-favorites-{}-{}.sqlite",
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
            "encore-migrate-{}-{}.sqlite",
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
    History {
        query: String,
        before_id: Option<i64>,
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
            Request::History { query, before_id } => {
                return serde_json::to_value(store.history(&query, before_id)?)
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
