use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "video-scene";
#[derive(Default)]
pub struct Scenes(Mutex<Option<Snapshot>>);
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    revision: u64,
    generation: u64,
    video_id: Option<String>,
    title: String,
    artist: String,
    position: f64,
    duration: f64,
    playback: i32,
}
impl Snapshot {
    fn valid(&self) -> bool {
        self.title.len() <= 4096
            && self.artist.len() <= 4096
            && self.position.is_finite()
            && self.duration.is_finite()
            && (0.0..=86400.0).contains(&self.position)
            && (0.0..=86400.0).contains(&self.duration)
            && matches!(self.playback, -1..=3 | 5)
            && self.video_id.as_ref().is_none_or(|id| {
                id.len() == 11
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            })
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    visible: bool,
    topmost: bool,
    fullscreen: bool,
    monitor_id: Option<String>,
}
fn status(window: Option<WebviewWindow>) -> Status {
    Status {
        monitor_id: window.as_ref().and_then(crate::monitors::current_id),
        enabled: window.is_some(),
        visible: window
            .as_ref()
            .is_some_and(|w| w.is_visible().unwrap_or(false)),
        topmost: window
            .as_ref()
            .is_some_and(|w| w.is_always_on_top().unwrap_or(false)),
        fullscreen: window
            .as_ref()
            .is_some_and(|w| w.is_fullscreen().unwrap_or(false)),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowAction {
    Open,
    Off,
    Status,
}

#[tauri::command]
pub async fn scene_window(
    window: WebviewWindow,
    action: WindowAction,
    monitor_id: Option<String>,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let app = window.app_handle();
    match action {
        WindowAction::Open => {
            if let Some(id) = monitor_id.as_deref() {
                if !crate::monitors::list(&window)?
                    .iter()
                    .any(|display| display.id == id)
                {
                    return Err("Selected display is disconnected".into());
                }
            }
            if let Some(scene) = app.get_webview_window(LABEL) {
                scene.show().map_err(|_| "Cannot show scene")?;
                scene.unminimize().map_err(|_| "Cannot restore scene")?;
            } else {
                WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("scene.html".into()))
                    .title("YCore Music · Клип")
                    .inner_size(960.0, 600.0)
                    .min_inner_size(360.0, 260.0)
                    .additional_browser_args(
                        app.config()
                            .app
                            .windows
                            .first()
                            .and_then(|w| w.additional_browser_args.as_deref())
                            .unwrap_or_default(),
                    )
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_navigation(|url| {
                        let local_app = (url.scheme() == "tauri"
                            && url.host_str() == Some("localhost"))
                            || (matches!(url.scheme(), "http" | "https")
                                && url.host_str() == Some("tauri.localhost")
                                && url.port().is_none());
                        let dev = cfg!(debug_assertions)
                            && url.scheme() == "http"
                            && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                            && url.port() == Some(1420);
                        (local_app || dev) && url.path() == "/scene.html"
                    })
                    .build()
                    .map_err(|_| "Cannot create scene window")?;
            }
            if let Some(id) = monitor_id.as_deref() {
                if let Some(scene) = app.get_webview_window(LABEL) {
                    crate::monitors::place(&scene, id)?;
                }
            }
        }
        WindowAction::Off => {
            if let Some(scene) = app.get_webview_window(LABEL) {
                scene.destroy().map_err(|_| "Cannot disable scene")?;
                // Destruction is queued on the platform event loop. Do not report the
                // stale window registry entry as still enabled after a successful Off.
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    for _ in 0..100 {
                        if app.get_webview_window(LABEL).is_none() {
                            return Ok(());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err("Scene window did not close")
                })
                .await
                .map_err(|_| "Scene close worker failed")??;
            }
        }
        WindowAction::Status => {}
    }
    Ok(status(app.get_webview_window(LABEL)))
}

#[tauri::command]
pub fn scene_publish(
    window: WebviewWindow,
    state: tauri::State<'_, Scenes>,
    snapshot: Snapshot,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if !snapshot.valid() {
        return Err("Invalid scene snapshot".into());
    }
    let mut latest = state.0.lock().map_err(|_| "Scene unavailable")?;
    if latest
        .as_ref()
        .is_some_and(|last| last.revision >= snapshot.revision)
    {
        return Ok(());
    }
    *latest = Some(snapshot.clone());
    drop(latest);
    if let Some(scene) = window.app_handle().get_webview_window(LABEL) {
        let visible = scene.is_visible().unwrap_or(false) && !scene.is_minimized().unwrap_or(false);
        scene
            .emit(
                "scene-snapshot",
                serde_json::json!({"snapshot":snapshot,"visible":visible}),
            )
            .map_err(|_| "Cannot update scene")?;
    }
    Ok(())
}

#[tauri::command]
pub fn scene_snapshot(
    window: WebviewWindow,
    state: tauri::State<'_, Scenes>,
) -> Result<Option<Snapshot>, String> {
    if window.label() != LABEL {
        return Err("Untrusted window".into());
    }
    Ok(state.0.lock().map_err(|_| "Scene unavailable")?.clone())
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Control {
    Status,
    Toggle,
    Next,
    Previous,
    Seek { position: f64 },
    Fullscreen,
    Windowed,
    Topmost,
    Hide,
}

#[tauri::command]
pub fn scene_control(window: WebviewWindow, action: Control) -> Result<Status, String> {
    if window.label() != LABEL {
        return Err("Untrusted window".into());
    }
    match action {
        Control::Status => {}
        Control::Toggle | Control::Next | Control::Previous => {
            let command = match action {
                Control::Toggle => "toggle",
                Control::Next => "next",
                _ => "previous",
            };
            window
                .emit_to("main", "encore-control", command)
                .map_err(|_| "Cannot deliver control")?;
        }
        Control::Seek { position } => {
            if !position.is_finite() || !(0.0..=86400.0).contains(&position) {
                return Err("Invalid scene position".into());
            }
            window
                .emit_to(
                    "main",
                    "encore-media",
                    serde_json::json!({"action":"position","value":position}),
                )
                .map_err(|_| "Cannot deliver seek")?;
        }
        Control::Fullscreen => window
            .set_fullscreen(
                !window
                    .is_fullscreen()
                    .map_err(|_| "Cannot read fullscreen")?,
            )
            .map_err(|_| "Cannot change fullscreen")?,
        Control::Windowed => window
            .set_fullscreen(false)
            .map_err(|_| "Cannot exit fullscreen")?,
        Control::Topmost => window
            .set_always_on_top(
                !window
                    .is_always_on_top()
                    .map_err(|_| "Cannot read topmost")?,
            )
            .map_err(|_| "Cannot change topmost")?,
        Control::Hide => window.hide().map_err(|_| "Cannot hide scene")?,
    }
    Ok(status(Some(window)))
}

pub fn closing(window: &tauri::Window, event: &tauri::WindowEvent) -> bool {
    if window.label() != LABEL {
        return false;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        let _ = window.emit("scene-hidden", ());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_rejects_arbitrary_urls_and_invalid_timeline() {
        let mut value = Snapshot {
            revision: 1,
            generation: 1,
            video_id: Some("aqz-KE-bpKQ".into()),
            title: "Example".into(),
            artist: String::new(),
            position: 2.0,
            duration: 600.0,
            playback: 1,
        };
        assert!(value.valid());
        value.video_id = Some("https://example.com".into());
        assert!(!value.valid());
        value.video_id = None;
        value.position = f64::NAN;
        assert!(!value.valid());
        value.position = 0.0;
        value.playback = 4;
        assert!(!value.valid());
    }
}
