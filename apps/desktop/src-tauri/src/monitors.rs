use serde::Serialize;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    pub name: String,
    pub stable: bool,
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub refresh_hz: Option<u32>,
    #[serde(skip)]
    pub monitor: Option<tauri::Monitor>,
}

// Explicit FNV-1a, rather than Rust's unspecified DefaultHasher. The original
// Windows device interface name remains native and is never a display index.
fn key(identity: &str) -> String {
    let mut value = 0xcbf29ce484222325u64;
    for byte in identity.to_lowercase().bytes() {
        value ^= u64::from(byte);
        value = value.wrapping_mul(0x100000001b3);
    }
    format!("monitor-{value:016x}")
}

#[cfg(target_os = "windows")]
fn platform_identity(name: &str) -> Option<(String, String, Option<u32>)> {
    use windows::{
        core::PCWSTR,
        Win32::Graphics::Gdi::{
            EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW,
            DISPLAY_DEVICE_ACTIVE, ENUM_CURRENT_SETTINGS,
        },
    };
    fn wide(value: &[u16]) -> String {
        String::from_utf16_lossy(
            &value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())],
        )
    }
    let adapter: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut devices = Vec::new();
    for index in 0..64 {
        let mut device = DISPLAY_DEVICEW {
            cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        // EDD_GET_DEVICE_INTERFACE_NAME: retrieve GUID_DEVINTERFACE_MONITOR path.
        if !unsafe { EnumDisplayDevicesW(PCWSTR(adapter.as_ptr()), index, &mut device, 1) }
            .as_bool()
        {
            break;
        }
        if device.StateFlags.0 & DISPLAY_DEVICE_ACTIVE.0 != 0 {
            let identity = wide(&device.DeviceID);
            if !identity.is_empty() {
                devices.push((identity, wide(&device.DeviceString)));
            }
        }
    }
    // A cloned/ambiguous adapter is not a reliable one-monitor identity.
    if devices.len() != 1 {
        return None;
    }
    let mut mode = DEVMODEW {
        dmSize: std::mem::size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    let refresh = if unsafe {
        EnumDisplaySettingsW(PCWSTR(adapter.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode)
    }
    .as_bool()
        && (20..=1000).contains(&mode.dmDisplayFrequency)
    {
        Some(mode.dmDisplayFrequency)
    } else {
        None
    };
    let (id, title) = devices.pop()?;
    Some((id, title, refresh))
}
#[cfg(not(target_os = "windows"))]
fn platform_identity(_name: &str) -> Option<(String, String, Option<u32>)> {
    None
}

fn describe(monitor: tauri::Monitor, primary: bool) -> Display {
    let name = monitor.name().cloned().unwrap_or_else(|| "Экран".into());
    let identity = platform_identity(&name);
    let (id, title, stable, refresh) = match identity {
        Some((identity, title, refresh)) => (key(&identity), title, true, refresh),
        None => (
            key(&format!(
                "temporary:{name}:{}:{}",
                monitor.position().x,
                monitor.position().y
            )),
            name,
            false,
            None,
        ),
    };
    Display {
        id,
        name: title,
        stable,
        primary,
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
        scale_factor: monitor.scale_factor(),
        refresh_hz: refresh,
        monitor: Some(monitor),
    }
}
pub fn list(window: &WebviewWindow) -> Result<Vec<Display>, String> {
    let primary = window
        .primary_monitor()
        .map_err(|_| "Cannot read primary display")?;
    let mut result: Vec<_> = window
        .available_monitors()
        .map_err(|_| "Cannot enumerate displays")?
        .into_iter()
        .map(|monitor| {
            let is_primary = primary
                .as_ref()
                .is_some_and(|p| p.position() == monitor.position() && p.size() == monitor.size());
            describe(monitor, is_primary)
        })
        .collect();
    let mut counts = std::collections::HashMap::new();
    for display in &result {
        *counts.entry(display.id.clone()).or_insert(0) += 1;
    }
    for display in &mut result {
        if counts[&display.id] > 1 {
            display.stable = false;
        }
    }
    Ok(result)
}
pub fn current_id(window: &WebviewWindow) -> Option<String> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| describe(monitor, false).id)
}
pub fn place(window: &WebviewWindow, id: &str) -> Result<(), String> {
    let display = list(window)?
        .into_iter()
        .find(|display| display.id == id)
        .ok_or("Selected display is disconnected")?;
    let monitor = display.monitor.ok_or("Display geometry unavailable")?;
    let area = monitor.work_area();
    let width = ((960.0 * display.scale_factor) as u32).min(area.size.width.saturating_sub(40));
    let height = ((600.0 * display.scale_factor) as u32).min(area.size.height.saturating_sub(40));
    if width == 0 || height == 0 {
        return Err("Display work area unavailable".into());
    }
    window
        .set_fullscreen(false)
        .map_err(|_| "Cannot exit fullscreen")?;
    window.unmaximize().map_err(|_| "Cannot restore scene")?;
    window
        .set_position(PhysicalPosition::new(
            area.position.x + ((area.size.width - width) / 2) as i32,
            area.position.y + ((area.size.height - height) / 2) as i32,
        ))
        .map_err(|_| "Cannot move scene")?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|_| "Cannot resize scene")?;
    Ok(())
}
#[tauri::command]
pub fn monitor_list(window: WebviewWindow) -> Result<Vec<Display>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    list(&window)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn display_key_is_case_insensitive_and_not_an_enumeration_index() {
        assert_eq!(key("DISPLAY#ABC"), key("display#abc"));
        assert_ne!(key("display#abc"), key("display#xyz"));
        assert_eq!(key("display#abc").len(), 24);
    }
}
