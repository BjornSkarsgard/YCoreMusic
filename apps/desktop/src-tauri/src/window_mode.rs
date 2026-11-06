use tauri::async_runtime::Mutex;
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
    position: Option<PhysicalPosition<i32>>,
    maximized: bool,
    fullscreen: bool,
}
#[tauri::command]
pub async fn window_mini(
    window: WebviewWindow,
    state: tauri::State<'_, WindowMode>,
    compact: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    // GTK resize requests are asynchronous. Keep the transition serialized until
    // the WM confirms it, so a second toggle cannot save a stale compact size.
    let mut saved = state.0.lock().await;
    if compact && saved.is_none() {
        let previous = Placement {
            size: window.inner_size().map_err(|_| "Cannot read size")?,
            position: match window.outer_position() {
                Ok(position) => Some(position),
                Err(_)
                    if cfg!(target_os = "linux")
                        && std::env::var_os("WAYLAND_DISPLAY").is_some() =>
                {
                    None
                }
                Err(_) => return Err("Cannot read position".into()),
            },
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
        #[cfg(target_os = "linux")]
        settle_size(
            &window,
            LogicalSize::new(480.0, 500.0).to_physical(
                window
                    .scale_factor()
                    .map_err(|_| "Cannot read window scale")?,
            ),
        )
        .await?;
        *saved = Some(previous);
    } else if !compact {
        if let Some(previous) = saved.as_ref() {
            window
                .set_size(previous.size)
                .map_err(|_| "Cannot restore size")?;
            // Wayland delegates global placement to the compositor; restoring
            // a size must not depend on an unsupported global position query.
            if let Some(position) = previous.position {
                window
                    .set_position(position)
                    .map_err(|_| "Cannot restore position")?;
            }
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
            #[cfg(target_os = "linux")]
            settle_size(&window, previous.size).await?;
            *saved = None;
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn settle_size(window: &WebviewWindow, expected: PhysicalSize<u32>) -> Result<(), String> {
    // Wayland applies the compositor's configure after the renderer changes
    // its layout. Waiting here would keep the renderer in its full-size layout
    // and its GTK minimum requisition would prevent the requested compact size.
    // The actual configured size is still verified by the native UI scenario.
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return Ok(());
    }
    let window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        loop {
            let actual = window
                .inner_size()
                .map_err(|_| "Cannot read resized window")?;
            if actual.width.abs_diff(expected.width) <= 1
                && actual.height.abs_diff(expected.height) <= 1
            {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err("Window manager did not confirm the requested size".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    })
    .await
    .map_err(|_| "Window transition worker failed".to_string())?
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
    topmost_state(&window)
}

pub(crate) fn topmost_state(window: &WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    if let Some(above) = x11_topmost(window)? {
        return Ok(above);
    }
    window
        .is_always_on_top()
        .map_err(|_| "Cannot read window state".to_string())
}

// On GTK/X11 the toolkit's cached ABOVE flag can lag behind the WM property
// indefinitely. Read the actual EWMH state; never substitute the requested flag.
#[cfg(target_os = "linux")]
fn x11_topmost(window: &WebviewWindow) -> Result<Option<bool>, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt};
    let handle = window
        .window_handle()
        .map_err(|_| "Cannot read native window")?;
    let id = match handle.as_raw() {
        RawWindowHandle::Xlib(handle) => {
            u32::try_from(handle.window).map_err(|_| "Invalid X11 window")?
        }
        RawWindowHandle::Xcb(handle) => handle.window.get(),
        _ => return Ok(None), // Wayland retains its own compositor/toolkit path.
    };
    let (connection, _) = x11rb::connect(None).map_err(|_| "Cannot connect to X11")?;
    let atom = |name: &[u8]| -> Result<u32, String> {
        Ok(connection
            .intern_atom(false, name)
            .map_err(|_| "Cannot read X11 state")?
            .reply()
            .map_err(|_| "Cannot read X11 state")?
            .atom)
    };
    let state = atom(b"_NET_WM_STATE")?;
    let above = atom(b"_NET_WM_STATE_ABOVE")?;
    let reply = connection
        .get_property(false, id, state, AtomEnum::ATOM, 0, 64)
        .map_err(|_| "Cannot read X11 window state")?
        .reply()
        .map_err(|_| "Cannot read X11 window state")?;
    Ok(Some(reply.value32().is_some_and(|mut atoms| {
        atoms.any(|value| value == above)
    })))
}
