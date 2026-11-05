use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "video-scene";
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Content {
    #[default]
    Video,
    Visualizer,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    Low,
    Medium,
    #[default]
    High,
    Ultra,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualOptions {
    pub content: Content,
    pub quality: Quality,
    /// Zero means the display's rAF/VSync, not an automatic performance policy.
    pub fps: u16,
}
impl VisualOptions {
    pub fn valid(&self) -> bool {
        matches!(self.fps, 0 | 30 | 60 | 90 | 120 | 144 | 165 | 180 | 240)
    }
}
pub(crate) fn label_for(monitor_id: Option<&str>) -> Result<String, String> {
    match monitor_id {
        None => Ok(LABEL.into()),
        Some(id)
            if id.len() == 24
                && id.starts_with("monitor-")
                && id[8..].bytes().all(|c| c.is_ascii_hexdigit()) =>
        {
            Ok(format!("{LABEL}-{id}"))
        }
        _ => Err("Invalid display identity".into()),
    }
}
pub fn is_scene(label: &str) -> bool {
    label == LABEL
        || label
            .strip_prefix("video-scene-")
            .is_some_and(|id| label_for(Some(id)).is_ok())
}
#[derive(Default)]
pub struct Scenes {
    snapshot: Mutex<Option<Snapshot>>,
    operations: tauri::async_runtime::Mutex<()>,
    pub(crate) layouts: Mutex<crate::scene_layout::Layouts>,
}
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
    pub(crate) label: Option<String>,
    pub(crate) screen_id: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) visible: bool,
    pub(crate) topmost: bool,
    pub(crate) fullscreen: bool,
    pub(crate) monitor_id: Option<String>,
    pub(crate) detached: bool,
    pub(crate) options: VisualOptions,
}
fn status(window: Option<WebviewWindow>) -> Status {
    Status {
        options: window
            .as_ref()
            .map(crate::scene_layout::options)
            .unwrap_or_default(),
        detached: window
            .as_ref()
            .is_some_and(crate::scene_layout::is_detached),
        label: window.as_ref().map(|w| w.label().to_owned()),
        screen_id: window
            .as_ref()
            .and_then(|w| w.label().strip_prefix("video-scene-").map(str::to_owned)),
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
    options: Option<VisualOptions>,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if let Some(options) = options {
        if !options.valid() {
            return Err("Invalid visualizer settings".into());
        }
        if options.content == Content::Visualizer
            && !cfg!(all(target_os = "windows", feature = "audio-analysis"))
        {
            return Err("Visualizer analysis is not available on this platform yet".into());
        }
        if options.fps > 0 {
            if let Some(display) = crate::monitors::list(&window)?
                .iter()
                .find(|d| Some(&d.id) == monitor_id.as_ref())
            {
                if display
                    .refresh_hz
                    .is_some_and(|hz| f64::from(options.fps) > f64::from(hz) + 0.5)
                {
                    return Err("FPS exceeds display refresh rate".into());
                }
            }
        }
    }
    change(&window, action, monitor_id, None, options).await
}

#[tauri::command]
pub fn scene_options(window: WebviewWindow) -> Result<VisualOptions, String> {
    if !is_scene(window.label()) {
        return Err("Untrusted window".into());
    }
    Ok(crate::scene_layout::options(&window))
}
pub(crate) async fn change(
    window: &WebviewWindow,
    action: WindowAction,
    monitor_id: Option<String>,
    restore: Option<crate::scene_layout::Restore>,
    options: Option<VisualOptions>,
) -> Result<Status, String> {
    let app = window.app_handle();
    let state = window.state::<Scenes>();
    let label = label_for(monitor_id.as_deref())?;
    let _operation = state.operations.lock().await;
    if restore
        .as_ref()
        .is_some_and(|restore| !crate::scene_layout::restore_current(&state, restore))
    {
        return Ok(status(app.get_webview_window(&label)));
    }
    match action {
        WindowAction::Open => {
            if !crate::player_host::supported() {
                return Err("Local video mirrors are not available on this platform yet".into());
            }
            if let Some(id) = monitor_id.as_deref() {
                if !crate::monitors::list(window)?
                    .iter()
                    .any(|display| display.id == id)
                {
                    return Err("Selected display is disconnected".into());
                }
            }
            let existed = app.get_webview_window(&label).is_some();
            if !existed {
                WebviewWindowBuilder::new(app, &label, WebviewUrl::App("scene.html".into()))
                    .title("YCore Music · Клип")
                    .visible(false)
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
            if let Some(scene) = app.get_webview_window(&label) {
                if let Some(restore) = restore.as_ref() {
                    crate::scene_layout::restore_window(&scene, restore)?;
                } else {
                    if let Some(id) = monitor_id.as_deref() {
                        if !existed || crate::monitors::current_id(&scene).as_deref() != Some(id) {
                            crate::monitors::place(&scene, id)?;
                        }
                        crate::scene_layout::remember(&scene, id)?;
                    }
                    scene.show().map_err(|_| "Cannot show scene")?;
                    scene.unminimize().map_err(|_| "Cannot restore scene")?;
                    if let (Some(id), Some(options)) = (monitor_id.as_deref(), options) {
                        crate::scene_layout::set_options(window, id, options)?;
                        let _ = scene.emit("scene-options", options);
                    }
                }
            }
        }
        WindowAction::Off => {
            if let Some(id) = monitor_id.as_deref() {
                crate::scene_layout::forget(window, id);
            }
            if let Some(scene) = app.get_webview_window(&label) {
                app.state::<crate::player_host::Host>()
                    .mirrors
                    .remove(&label);
                scene.destroy().map_err(|_| "Cannot disable scene")?;
                // Destruction is queued on the platform event loop. Do not report the
                // stale window registry entry as still enabled after a successful Off.
                let app = app.clone();
                let closing_label = label.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    for _ in 0..100 {
                        if app.get_webview_window(&closing_label).is_none() {
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
    Ok(status(app.get_webview_window(&label)))
}

#[tauri::command]
pub fn scene_windows(window: WebviewWindow) -> Result<Vec<Status>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let mut values: Vec<_> = window
        .app_handle()
        .webview_windows()
        .into_values()
        .filter(|w| is_scene(w.label()))
        .map(|w| status(Some(w)))
        .collect();
    crate::scene_layout::append_pending(&window, &mut values);
    Ok(values)
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
    let mut latest = state.snapshot.lock().map_err(|_| "Scene unavailable")?;
    if latest
        .as_ref()
        .is_some_and(|last| last.revision >= snapshot.revision)
    {
        return Ok(());
    }
    *latest = Some(snapshot.clone());
    drop(latest);
    for scene in window
        .app_handle()
        .webview_windows()
        .into_values()
        .filter(|w| is_scene(w.label()))
    {
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
    if !is_scene(window.label()) {
        return Err("Untrusted window".into());
    }
    Ok(state
        .snapshot
        .lock()
        .map_err(|_| "Scene unavailable")?
        .clone())
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
    if !is_scene(window.label()) {
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
    if !is_scene(window.label()) {
        return false;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        crate::scene_layout::hidden(window);
        window
            .state::<crate::player_host::Host>()
            .mirrors
            .remove(window.label());
        let _ = window.hide();
        let _ = window.emit("scene-hidden", ());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scene_identity_is_bound_to_a_display_and_never_a_source_or_account_window() {
        let first = label_for(Some("monitor-0123456789abcdef")).unwrap();
        let second = label_for(Some("monitor-fedcba9876543210")).unwrap();
        assert_ne!(first, second);
        assert!(is_scene(&first));
        assert!(is_scene(&second));
        for label in [
            "main",
            "player-host",
            "auth",
            "video-scene-auth",
            "video-scene-monitor-../../",
            "video-scene-monitor-0123",
        ] {
            assert!(!is_scene(label));
        }
        assert!(label_for(Some("missing-display")).is_err());
    }
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
