use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    track_id: String,
    title: String,
    artist: String,
    video_id: String,
    position: f64,
}
impl Snapshot {
    fn valid(&self) -> bool {
        !self.track_id.is_empty()
            && self.track_id.len() <= 128
            && self.title.len() <= 1024
            && self.artist.len() <= 1024
            && self.video_id.len() == 11
            && self
                .video_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            && self.position.is_finite()
            && (0.0..=86400.0).contains(&self.position)
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u8,
    clean: bool,
    snapshot: Option<Snapshot>,
}
pub struct Recovery {
    inner: Mutex<Inner>,
}
struct Inner {
    path: Option<PathBuf>,
    pending: Option<Snapshot>,
    blocked: bool,
}
impl Recovery {
    pub fn open(path: Option<PathBuf>) -> Self {
        let mut inner = Inner {
            path,
            pending: None,
            blocked: false,
        };
        if let Some(path) = &inner.path {
            match std::fs::metadata(path) {
                Ok(meta) if meta.len() <= 16384 => {
                    match std::fs::read(path)
                        .ok()
                        .and_then(|data| serde_json::from_slice::<File>(&data).ok())
                    {
                        Some(file)
                            if file.version == 1
                                && file.snapshot.as_ref().is_none_or(Snapshot::valid) =>
                        {
                            if !file.clean {
                                inner.pending = file.snapshot;
                            }
                        }
                        _ => inner.blocked = true,
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => inner.blocked = true,
            }
        }
        Self {
            inner: Mutex::new(inner),
        }
    }
    pub fn clean(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "Recovery unavailable")?;
        if inner.path.as_ref().is_some_and(|p| p.exists()) {
            inner.write(None, true)?;
        }
        inner.pending = None;
        Ok(())
    }
}
impl Inner {
    fn write(&self, snapshot: Option<Snapshot>, clean: bool) -> Result<(), String> {
        if self.blocked {
            return Err("Recovery file is invalid; preserved without overwriting".into());
        }
        let path = self.path.as_ref().ok_or("Recovery directory unavailable")?;
        let bytes = serde_json::to_vec(&File {
            version: 1,
            clean,
            snapshot,
        })
        .map_err(|_| "Cannot encode recovery")?;
        let temporary = path.with_extension("json.next");
        std::fs::write(&temporary, bytes)
            .and_then(|()| std::fs::rename(&temporary, path))
            .map_err(|_| "Cannot save recovery".into())
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Read,
    Save { snapshot: Snapshot },
    Discard,
}
#[tauri::command]
pub fn crash_recovery(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Recovery>,
    request: Request,
) -> Result<Option<Snapshot>, String> {
    if window.label() != "main" {
        return Err("Untrusted recovery request".into());
    }
    let mut inner = state.inner.lock().map_err(|_| "Recovery unavailable")?;
    match request {
        Request::Read => {
            if inner.blocked {
                return Err("Recovery file is invalid".into());
            }
            Ok(inner.pending.clone())
        }
        Request::Save { snapshot } => {
            if !snapshot.valid() {
                return Err("Invalid recovery snapshot".into());
            }
            inner.write(Some(snapshot), false)?;
            inner.pending = None;
            Ok(None)
        }
        Request::Discard => {
            inner.write(None, true)?;
            inner.pending = None;
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_reject_urls_nonfinite_positions_and_old_wave_references() {
        let mut snapshot = Snapshot {
            track_id: "123".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            video_id: "Aaaaaaaaaaa".into(),
            position: 0.0,
        };
        assert!(snapshot.valid());
        for position in [f64::NAN, f64::INFINITY, -1.0, 86401.0] {
            snapshot.position = position;
            assert!(!snapshot.valid());
        }
        snapshot.position = 1.0;
        snapshot.video_id = "https://example.com".into();
        assert!(!snapshot.valid());
        assert!(serde_json::from_value::<Snapshot>(serde_json::json!({"trackId":"123","title":"Song","artist":"Artist","videoId":"Aaaaaaaaaaa","position":1,"waveRef":"old-session"})).is_err());
    }
    #[test]
    fn dirty_restart_offers_checkpoint_and_clean_exit_clears_it() {
        let dir = std::env::temp_dir().join(format!(
            "ycore-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("recovery.json");
        let first = Recovery::open(Some(path.clone()));
        let snapshot = Snapshot {
            track_id: "123".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            video_id: "Aaaaaaaaaaa".into(),
            position: 42.5,
        };
        first
            .inner
            .lock()
            .unwrap()
            .write(Some(snapshot), false)
            .unwrap();
        let restarted = Recovery::open(Some(path.clone()));
        assert_eq!(
            restarted
                .inner
                .lock()
                .unwrap()
                .pending
                .as_ref()
                .unwrap()
                .position,
            42.5
        );
        restarted.clean().unwrap();
        assert!(Recovery::open(Some(path.clone()))
            .inner
            .lock()
            .unwrap()
            .pending
            .is_none());
        std::fs::write(&path, b"{\"version\":99,\"clean\":false,\"snapshot\":null}").unwrap();
        let blocked = Recovery::open(Some(path.clone()));
        assert!(blocked.clean().is_err());
        assert!(String::from_utf8(std::fs::read(&path).unwrap())
            .unwrap()
            .contains("99"));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
