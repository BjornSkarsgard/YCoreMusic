use std::sync::Mutex;
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};
#[derive(Default)]
pub struct WindowMode(Mutex<Option<Placement>>);
#[tauri::command]
pub fn window_test_monitor(
    window: WebviewWindow,
    state: tauri::State<'_, crate::storage::StorageState>,
    monitor_id: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) || !state.test_mode || window.label() != "main" {
        return Err("Display verification is restricted to isolated debug tests".into());
    }
    crate::monitors::place(&window, &monitor_id)
}
struct Placement {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    maximized: bool,
    fullscreen: bool,
}
#[tauri::command]
pub fn window_mini(
    window: WebviewWindow,
    state: tauri::State<'_, WindowMode>,
    compact: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let mut saved = state.0.lock().map_err(|_| "Window state unavailable")?;
    if compact && saved.is_none() {
        let previous = Placement {
            size: window.inner_size().map_err(|_| "Cannot read size")?,
            position: window
                .outer_position()
                .map_err(|_| "Cannot read position")?,
            maximized: window
                .is_maximized()
                .map_err(|_| "Cannot read window mode")?,
            fullscreen: window
                .is_fullscreen()
                .map_err(|_| "Cannot read fullscreen")?,
        };
        if previous.fullscreen {
            window
                .set_fullscreen(false)
                .map_err(|_| "Cannot exit fullscreen")?;
        }
        if previous.maximized {
            window.unmaximize().map_err(|_| "Cannot unmaximize")?;
        }
        window
            .set_min_size(Some(LogicalSize::new(360.0, 470.0)))
            .map_err(|_| "Cannot set minimum size")?;
        if window.set_size(LogicalSize::new(480.0, 500.0)).is_err() {
            let _ = window.set_min_size(Some(LogicalSize::new(800.0, 650.0)));
            return Err("Cannot resize window".into());
        }
        *saved = Some(previous);
    } else if !compact {
        if let Some(previous) = saved.as_ref() {
            window
                .set_size(previous.size)
                .map_err(|_| "Cannot restore size")?;
            window
                .set_position(previous.position)
                .map_err(|_| "Cannot restore position")?;
            window
                .set_min_size(Some(LogicalSize::new(800.0, 650.0)))
                .map_err(|_| "Cannot restore minimum size")?;
            if previous.maximized {
                window
                    .maximize()
                    .map_err(|_| "Cannot restore maximized mode")?;
            }
            if previous.fullscreen {
                window
                    .set_fullscreen(true)
                    .map_err(|_| "Cannot restore fullscreen")?;
            }
            *saved = None;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn window_topmost(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    window
        .set_always_on_top(enabled)
        .map_err(|_| "Window manager rejected topmost".to_string())
}

#[tauri::command]
pub fn window_topmost_state(window: WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    window
        .is_always_on_top()
        .map_err(|_| "Cannot read window state".to_string())
}
