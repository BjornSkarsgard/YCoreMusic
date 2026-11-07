use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindow};
pub const LABEL: &str = "player-host";
pub fn supported() -> bool {
    cfg!(all(target_os = "windows", feature = "single-player-host"))
        || cfg!(all(target_os = "linux", feature = "linux-player-host"))
}
#[derive(Default)]
pub struct Host {
    data: Mutex<Data>,
    operations: tauri::async_runtime::Mutex<()>,
    pub mirrors: crate::video_mirror::Mirrors,
}
#[derive(Default)]
struct Data {
    epoch: u64,
    active: bool,
    sequence: u64,
    load: Option<Load>,
    cache: Option<Cache>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Load {
    epoch: u64,
    controls: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Caption {
    language_code: String,
    kind: String,
    name: String,
    display_name: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cache {
    position: f64,
    duration: f64,
    playback: i32,
    quality: String,
    caption_options: Vec<String>,
    caption_tracks: Vec<Caption>,
    iframe_count: usize,
}
impl Cache {
    fn valid(&self) -> bool {
        self.position.is_finite()
            && self.duration.is_finite()
            && (0.0..=86400.0).contains(&self.position)
            && (0.0..=86400.0).contains(&self.duration)
            && matches!(self.playback, -1..=3 | 5)
            && self.quality.len() <= 32
            && self.iframe_count <= 1
            && self.caption_options.len() <= 16
            && self.caption_options.iter().all(|v| v.len() <= 64)
            && self.caption_tracks.len() <= 64
            && self.caption_tracks.iter().all(|t| {
                t.language_code.len() <= 64
                    && t.kind.len() <= 64
                    && t.name.len() <= 1024
                    && t.display_name.len() <= 1024
            })
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Ready,
    State,
    Error,
    Api,
    Quality,
    Blocked,
    Tick,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Packet {
    epoch: u64,
    sequence: u64,
    kind: Kind,
    cache: Cache,
    error_code: Option<u16>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Cue {
        video_id: String,
        position: f64,
    },
    Play,
    Pause,
    Seek {
        position: f64,
    },
    Volume {
        level: u8,
    },
    Destroy,
    LoadCaptions,
    UnloadCaptions,
    CaptionTrack {
        language_code: String,
        kind: String,
        name: String,
    },
    CaptionSize {
        size: i8,
    },
}
impl Command {
    fn valid(&self) -> bool {
        match self {
            Self::Cue { video_id, position } => {
                video_id.len() == 11
                    && video_id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                    && position.is_finite()
                    && (0.0..=86400.0).contains(position)
            }
            Self::Seek { position } => position.is_finite() && (0.0..=86400.0).contains(position),
            Self::Volume { level } => *level <= 100,
            Self::CaptionSize { size } => (-1..=3).contains(size),
            Self::CaptionTrack {
                language_code,
                kind,
                name,
            } => language_code.len() <= 64 && kind.len() <= 64 && name.len() <= 1024,
            _ => true,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    epoch: u64,
    active: bool,
    players: usize,
    source_alpha: Option<u8>,
    click_through: bool,
    mirror_tiles: usize,
}
#[tauri::command]
pub fn player_host_status(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
) -> Result<Status, String> {
    if window.label() != "main" && !crate::scenes::is_scene(window.label()) {
        return Err("Untrusted window".into());
    }
    let data = state.data.lock().map_err(|_| "Video host unavailable")?;
    let (epoch, active, players) = (
        data.epoch,
        data.active,
        if data.active {
            data.cache.as_ref().map_or(0, |c| c.iframe_count)
        } else {
            0
        },
    );
    drop(data);
    #[cfg(target_os = "windows")]
    let (source_alpha, click_through) = {
        let mut source_alpha = None;
        let mut click_through = false;
        if let Some(source) = window.app_handle().get_webview_window(LABEL) {
            if let Ok(hwnd) = source.hwnd() {
                unsafe {
                    use windows::Win32::UI::WindowsAndMessaging::*;
                    let mut alpha = 255;
                    if GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), None).is_ok() {
                        source_alpha = Some(alpha);
                    }
                    click_through =
                        GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT.0 as isize != 0;
                }
            }
        }
        (source_alpha, click_through)
    };
    #[cfg(not(target_os = "windows"))]
    let (source_alpha, click_through) = (None, false);
    Ok(Status {
        supported: supported(),
        epoch,
        active,
        players,
        source_alpha,
        click_through,
        mirror_tiles: state.mirrors.count(window.label()),
    })
}
fn local_page(url: &url::Url) -> bool {
    let packaged = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none());
    let dev = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(1420);
    (packaged || dev) && url.path() == "/player-host.html"
}
fn navigation_allowed(url: &url::Url) -> bool {
    // WebKitGTK reports subframe navigation through the same callback. Allow
    // only the actual YouTube embed there; remote pages still receive no IPC.
    local_page(url)
        || (cfg!(all(target_os = "linux", feature = "linux-player-host"))
            && url.scheme() == "https"
            && url.host_str() == Some("www.youtube.com")
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path().starts_with("/embed/"))
}
async fn ensure(main: &WebviewWindow) -> Result<WebviewWindow, String> {
    let app = main.app_handle();
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let dpi = main.scale_factor().map_err(|_| "Cannot read engine DPI")?;
    let directory =
        if cfg!(debug_assertions) && app.state::<crate::storage::StorageState>().test_mode {
            std::env::var_os("YCORE_TEST_DATA_DIR").map(std::path::PathBuf::from)
        } else {
            app.path().app_cache_dir().ok()
        }
        .ok_or("Cannot locate video profile")?
        .join("player-host");
    let args = app
        .config()
        .app
        .windows
        .first()
        .and_then(|w| w.additional_browser_args.as_deref())
        .unwrap_or_default()
        .to_owned();
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App("player-host.html".into()),
    )
    .title("YCore Music · Video engine")
    .inner_size(1920.0 / dpi, 1080.0 / dpi)
    .visible(false)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .data_directory(directory)
    .additional_browser_args(&args)
    .on_navigation(navigation_allowed)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
    let builder = builder.extensions_path(crate::embed_identity::extension_directory(app)?);
    #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
    let builder = if let Some(profile) = crate::embed_identity::isolated_profile(app) {
        builder.data_directory(profile)
    } else {
        builder
    };
    let window = builder
        .build()
        .map_err(|error| format!("Cannot create the sole video engine: {error}"))?;
    #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
    crate::embed_identity::configure_window(&window)?;
    // The source may initially be created on a display with different DPI than
    // the controller. Keep a real 1920x1080 source instead of scaling by the
    // controller's monitor and accidentally rendering a smaller video surface.
    window
        .set_size(tauri::PhysicalSize::new(1920u32, 1080u32))
        .map_err(|_| "Cannot size video engine")?;
    if let Err(error) = presentation(&window, false).await {
        let _ = window.destroy();
        return Err(error);
    }
    window.show().map_err(|_| "Cannot start video surface")?;
    Ok(window)
}
#[cfg(target_os = "windows")]
async fn presentation(window: &WebviewWindow, interactive: bool) -> Result<(), String> {
    use windows::Win32::{Foundation::COLORREF, UI::WindowsAndMessaging::*};
    window
        .set_skip_taskbar(!interactive)
        .map_err(|_| "Cannot set video window presentation")?;
    window
        .set_focusable(interactive)
        .map_err(|_| "Cannot set video window focus")?;
    window
        .set_decorations(interactive)
        .map_err(|_| "Cannot set video window frame")?;
    if interactive {
        window
            .set_focus()
            .map_err(|_| "Cannot focus video settings")?;
    }
    // Tauri/Tao presentation setters enqueue work on the UI thread. Applying
    // layered styles on the IPC worker races with that work and loses LWA_ALPHA.
    // Queue the final native styles after the setters and await their result.
    let (sender, receiver) = std::sync::mpsc::channel();
    let surface = window.clone();
    window
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let hwnd = surface
                    .hwnd()
                    .map_err(|_| "Cannot read video engine handle")?;
                unsafe {
                    let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED.0 as isize;
                    if interactive {
                        style &= !(WS_EX_TRANSPARENT.0 as isize | WS_EX_NOACTIVATE.0 as isize);
                    } else {
                        style |= WS_EX_TRANSPARENT.0 as isize | WS_EX_NOACTIVATE.0 as isize;
                    }
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
                    SetLayeredWindowAttributes(
                        hwnd,
                        COLORREF(0),
                        if interactive { 255 } else { 0 },
                        LWA_ALPHA,
                    )
                    .map_err(|_| "Cannot set engine visibility")?;
                }
                Ok(())
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| "Cannot dispatch video presentation")?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "Video presentation interrupted".to_string())
    })
    .await
    .map_err(|_| "Video presentation worker failed")??
}
#[cfg(all(target_os = "linux", feature = "linux-player-host"))]
async fn presentation(window: &WebviewWindow, interactive: bool) -> Result<(), String> {
    use gtk::prelude::*;
    let window = window.clone();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    window
        .clone()
        .run_on_main_thread(move || {
            let result = (|| {
                let native = window
                    .gtk_window()
                    .map_err(|_| "Cannot read video engine window")?;
                native.set_accept_focus(interactive);
                native.set_keep_below(!interactive);
                native.set_opacity(if interactive { 1.0 } else { 0.0 });
                native.show_all();
                let region = gtk::cairo::Region::create();
                native.input_shape_combine_region(if interactive { None } else { Some(&region) });
                Ok(())
            })();
            let _ = sender.blocking_send(result);
        })
        .map_err(|_| "Cannot configure video engine")?;
    receiver
        .recv()
        .await
        .ok_or_else(|| "Video engine interrupted".to_string())?
}

#[cfg(not(any(
    target_os = "windows",
    all(target_os = "linux", feature = "linux-player-host")
)))]
async fn presentation(_window: &WebviewWindow, _interactive: bool) -> Result<(), String> {
    Err("Video host is not available on this platform".into())
}
#[tauri::command]
pub async fn player_host_load(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
    options: Load,
) -> Result<(), String> {
    if window.label() != "main" || !supported() {
        return Err("Untrusted or unsupported video host".into());
    }
    if options.epoch == 0 || options.epoch > 9_007_199_254_740_991 {
        return Err("Invalid player generation".into());
    }
    let _operation = state.operations.lock().await;
    {
        let mut data = state.data.lock().map_err(|_| "Video host unavailable")?;
        if options.epoch <= data.epoch {
            return Ok(());
        }
        data.epoch = options.epoch;
        data.sequence = 0;
        data.active = true;
        data.cache = None;
        data.load = Some(options.clone());
    }
    let source = ensure(&window).await?;
    presentation(&source, options.controls).await?;
    source
        .emit("player-host-load", options)
        .map_err(|_| "Cannot load video engine".into())
}
#[tauri::command]
pub async fn player_host_presentation(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
    interactive: bool,
) -> Result<(), String> {
    if window.label() != "main" || interactive || !supported() {
        return Err("Untrusted video presentation request".into());
    }
    let _operation = state.operations.lock().await;
    let source = window
        .app_handle()
        .get_webview_window(LABEL)
        .ok_or("Video source is unavailable")?;
    presentation(&source, false).await
}
#[tauri::command]
pub fn player_host_ready(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
) -> Result<Option<Load>, String> {
    if window.label() != LABEL || !supported() {
        return Err("Untrusted window".into());
    }
    Ok(state
        .data
        .lock()
        .map_err(|_| "Video host unavailable")?
        .load
        .clone())
}
#[tauri::command]
pub fn player_host_command(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
    epoch: u64,
    command: Command,
) -> Result<(), String> {
    if window.label() != "main" || !supported() {
        return Err("Untrusted window".into());
    }
    if !command.valid() {
        return Err("Invalid video command".into());
    }
    {
        let mut data = state.data.lock().map_err(|_| "Video host unavailable")?;
        if epoch != data.epoch || !data.active {
            return Ok(());
        }
        if matches!(command, Command::Destroy) {
            data.active = false;
            data.load = None;
            data.cache = None;
        }
    }
    if let Some(source) = window.app_handle().get_webview_window(LABEL) {
        source
            .emit(
                "player-host-command",
                serde_json::json!({"epoch":epoch,"command":command}),
            )
            .map_err(|_| "Cannot control video engine")?;
    }
    Ok(())
}
#[tauri::command]
pub fn player_host_event(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
    packet: Packet,
) -> Result<(), String> {
    if window.label() != LABEL || !supported() {
        return Err("Untrusted window".into());
    }
    if !packet.cache.valid() {
        return Err("Invalid video state".into());
    }
    {
        let mut data = state.data.lock().map_err(|_| "Video host unavailable")?;
        if !data.active || packet.epoch != data.epoch || packet.sequence <= data.sequence {
            return Ok(());
        }
        data.sequence = packet.sequence;
        data.cache = Some(packet.cache.clone());
    }
    window
        .emit_to("main", "player-host-event", packet)
        .map_err(|_| "Cannot publish video state".into())
}
#[tauri::command]
pub fn player_host_mirror(
    window: WebviewWindow,
    state: tauri::State<'_, Host>,
    surface: crate::video_mirror::Surface,
) -> Result<(), String> {
    if (window.label() != "main" && !crate::scenes::is_scene(window.label())) || !supported() {
        return Err("Untrusted or unsupported video surface".into());
    }
    if let Some(source) = window.app_handle().get_webview_window(LABEL) {
        if source.is_minimized().unwrap_or(false) {
            let _ = source.unminimize();
        }
    }
    crate::video_mirror::update(&window, &state.mirrors, &surface)
}
pub fn closing(window: &tauri::Window, event: &tauri::WindowEvent) -> bool {
    if window.label() != LABEL {
        return false;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if let Some(source) = window.app_handle().get_webview_window(LABEL) {
            tauri::async_runtime::spawn(async move {
                if presentation(&source, false).await.is_ok() {
                    let _ = source.emit_to("main", "player-host-panel-closed", ());
                }
            });
        }
    }
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_rejects_urls_nonfinite_timeline_and_invalid_volume() {
        assert!(Command::Cue {
            video_id: "aqz-KE-bpKQ".into(),
            position: 0.0
        }
        .valid());
        assert!(!Command::Cue {
            video_id: "https://example.com".into(),
            position: 0.0
        }
        .valid());
        assert!(!Command::Seek { position: f64::NAN }.valid());
        assert!(!Command::Volume { level: 101 }.valid());
    }
    #[test]
    fn engine_page_never_navigates_to_remote_or_account_pages() {
        assert!(local_page(
            &url::Url::parse("http://tauri.localhost/player-host.html").unwrap()
        ));
        assert!(!local_page(
            &url::Url::parse("https://oauth.yandex.ru/player-host.html").unwrap()
        ));
        assert!(!local_page(
            &url::Url::parse("http://tauri.localhost/scene.html").unwrap()
        ));
    }
    #[test]
    fn webkit_embed_navigation_does_not_grant_arbitrary_remote_navigation() {
        let embed = url::Url::parse("https://www.youtube.com/embed/aqz-KE-bpKQ").unwrap();
        assert_eq!(
            navigation_allowed(&embed),
            cfg!(all(target_os = "linux", feature = "linux-player-host"))
        );
        for uri in [
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "https://www.youtube.com.evil.test/embed/",
            "https://www.youtube.com:444/embed/",
            "http://www.youtube.com/embed/",
            "https://user@www.youtube.com/embed/",
        ] {
            assert!(!navigation_allowed(&url::Url::parse(uri).unwrap()));
        }
    }
    #[test]
    fn caption_commands_match_the_renderer_protocol() {
        let command:Command=serde_json::from_value(serde_json::json!({"type":"caption_track","languageCode":"en","kind":"asr","name":"English"})).unwrap();
        assert!(command.valid());
        assert_eq!(
            serde_json::to_value(command).unwrap(),
            serde_json::json!({"type":"caption_track","languageCode":"en","kind":"asr","name":"English"})
        );
        assert!(serde_json::from_value::<Command>(serde_json::json!({"type":"cue","videoId":"aqz-KE-bpKQ","position":0,"token":"forbidden"})).is_err());
    }
}
