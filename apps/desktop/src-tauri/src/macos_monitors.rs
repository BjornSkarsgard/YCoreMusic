use core_foundation::{
    base::{kCFAllocatorDefault, TCFType},
    string::CFString,
    uuid::{CFUUIDCreateString, CFUUIDRef, CFUUID},
};
use core_graphics::display::CGDisplay;
use tauri::{Monitor, PhysicalPosition, PhysicalSize};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayCreateUUIDFromDisplayID(display: u32) -> CFUUIDRef;
}

pub fn identity(monitor: &Monitor) -> Option<(String, String, Option<u32>)> {
    // Tauri exposes Tao's geometry and model name, but not the display ID.
    // Match all three against CoreGraphics before trusting a persistent UUID.
    let name = monitor.name()?;
    let scale = monitor.scale_factor();
    let mut matches = CGDisplay::active_displays()
        .ok()?
        .into_iter()
        .map(CGDisplay::new)
        .filter(|display| {
            let bounds = display.bounds();
            let position = PhysicalPosition::new(
                (bounds.origin.x * scale).round() as i32,
                (bounds.origin.y * scale).round() as i32,
            );
            let size = PhysicalSize::new(
                (display.pixels_wide() as f64 * scale).round() as u32,
                (display.pixels_high() as f64 * scale).round() as u32,
            );
            name == &format!("Monitor #{}", display.model_number())
                && *monitor.position() == position
                && *monitor.size() == size
        });
    let display = matches.next()?;
    if matches.next().is_some() || display.is_in_mirror_set() {
        return None;
    }
    let identity = unsafe {
        let uuid = CGDisplayCreateUUIDFromDisplayID(display.id);
        if uuid.is_null() {
            return None;
        }
        let uuid = CFUUID::wrap_under_create_rule(uuid);
        let string = CFUUIDCreateString(kCFAllocatorDefault, uuid.as_concrete_TypeRef());
        if string.is_null() {
            return None;
        }
        CFString::wrap_under_create_rule(string).to_string()
    };
    let refresh = display.display_mode().and_then(|mode| {
        let hz = mode.refresh_rate();
        (20.0..=1000.0).contains(&hz).then(|| hz.round() as u32)
    });
    Some((format!("macos:{identity}"), name.clone(), refresh))
}
