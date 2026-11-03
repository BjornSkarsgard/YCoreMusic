use serde::{Deserialize, Serialize};
use souvlaki::{
    MediaControlEvent as Event, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
    PlatformConfig, SeekDirection,
};
use std::{cell::RefCell, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

// Native controls stay on the Tauri event-loop thread, including on macOS.
thread_local! { static CONTROLS: RefCell<Option<(MediaControls, u64)>> = const { RefCell::new(None) }; }
#[derive(Default)]
pub struct MediaState(pub Mutex<Status>);
#[derive(Clone, Default, Serialize)]
pub struct Status {
    available: bool,
    revision: u64,
    playback: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Playback {
    Stopped,
    Paused,
    Playing,
}
#[derive(Deserialize)]
pub struct Update {
    revision: u64,
    title: String,
    artist: String,
    playback: Playback,
    position: f64,
    duration: f64,
    volume: f64,
}
#[derive(Clone, Serialize)]
struct Control {
    action: &'static str,
    value: f64,
}
fn dispatch(app: &AppHandle, event: Event) {
    let control = match event {
        Event::Play => Control {
            action: "play",
            value: 0.0,
        },
        Event::Pause | Event::Stop => Control {
            action: "pause",
            value: 0.0,
        },
        Event::Toggle => Control {
            action: "toggle",
            value: 0.0,
        },
        Event::Next => Control {
            action: "next",
            value: 0.0,
        },
        Event::Previous => Control {
            action: "previous",
            value: 0.0,
        },
        Event::Seek(direction) => Control {
            action: "seek",
            value: if direction == SeekDirection::Forward {
                5.0
            } else {
                -5.0
            },
        },
        Event::SeekBy(direction, duration) => Control {
            action: "seek",
            value: duration.as_secs_f64()
                * if direction == SeekDirection::Forward {
                    1.0
                } else {
                    -1.0
                },
        },
        Event::SetPosition(position) => Control {
            action: "position",
            value: position.0.as_secs_f64(),
        },
        Event::SetVolume(value) => Control {
            action: "volume",
            value: value.clamp(0.0, 1.0),
        },
        Event::Raise => {
            let _ = crate::desktop::open(app);
            return;
        }
        Event::Quit => {
            let _ = crate::desktop::action(app, crate::desktop::Action::Quit);
            return;
        }
        _ => return,
    };
    let _ = app.emit_to("main", "encore-media", control);
}
pub fn install(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let hwnd = Some(
        app.get_webview_window("main")
            .ok_or("Missing window")?
            .hwnd()
            .map_err(|_| "Missing HWND")?
            .0,
    );
    #[cfg(not(target_os = "windows"))]
    let hwnd = None;
    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: "encore",
        display_name: "Encore",
        hwnd,
    })
    .map_err(|_| "Media controls unavailable")?;
    let handle = app.clone();
    controls
        .attach(move |event| dispatch(&handle, event))
        .map_err(|_| "Cannot attach media controls")?;
    controls
        .set_playback(MediaPlayback::Stopped)
        .map_err(|_| "Cannot initialize media controls")?;
    CONTROLS.with(|slot| *slot.borrow_mut() = Some((controls, 0)));
    if let Ok(mut status) = app.state::<MediaState>().0.lock() {
        status.available = true;
    }
    Ok(())
}
#[tauri::command]
pub fn media_update(window: tauri::WebviewWindow, update: Update) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    if update.title.len() > 2048
        || update.artist.len() > 2048
        || [update.position, update.duration, update.volume]
            .iter()
            .any(|v| !v.is_finite())
    {
        return Err("Invalid media state".into());
    }
    let app = window.app_handle().clone();
    window
        .run_on_main_thread(move || {
            CONTROLS.with(|slot| {
                let mut slot = slot.borrow_mut();
                let Some((controls, revision)) = slot.as_mut() else {
                    crate::power::request(matches!(update.playback, Playback::Playing));
                    return;
                };
                if update.revision <= *revision {
                    return;
                }
                *revision = update.revision;
                crate::power::request(matches!(update.playback, Playback::Playing));
                let progress = Some(MediaPosition(Duration::from_secs_f64(
                    update.position.clamp(0.0, 86400.0),
                )));
                let (playback, name) = match update.playback {
                    Playback::Stopped => (MediaPlayback::Stopped, "stopped"),
                    Playback::Paused => (MediaPlayback::Paused { progress }, "paused"),
                    Playback::Playing => (MediaPlayback::Playing { progress }, "playing"),
                };
                let result = controls
                    .set_metadata(MediaMetadata {
                        title: Some(&update.title),
                        artist: Some(&update.artist),
                        duration: Some(Duration::from_secs_f64(
                            update.duration.clamp(0.0, 86400.0),
                        )),
                        ..Default::default()
                    })
                    .and_then(|_| controls.set_playback(playback));
                #[cfg(target_os = "linux")]
                let result =
                    result.and_then(|_| controls.set_volume(update.volume.clamp(0.0, 1.0)));
                if let Ok(mut status) = app.state::<MediaState>().0.lock() {
                    status.available = result.is_ok();
                    status.revision = *revision;
                    status.playback = name.into();
                }
            });
        })
        .map_err(|_| "Cannot schedule media state".into())
}
#[tauri::command]
pub fn media_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MediaState>,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    state
        .0
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Media state unavailable".into())
}
