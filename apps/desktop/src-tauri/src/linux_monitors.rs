//! Read-only XRandR identity. Geometry locates the output; it is never its ID.
use x11rb::{
    connection::Connection,
    protocol::{
        randr::{Connection as OutputConnection, ConnectionExt as _, ModeFlag, ModeInfo},
        xproto::{AtomEnum, ConnectionExt as _},
    },
};

fn edid_identity(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 128
        || bytes[..8] != [0, 255, 255, 255, 255, 255, 255, 0]
        || bytes[..128]
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte))
            != 0
    {
        return None;
    }
    // Exclude extension blocks: driver/connection changes can expose a different
    // list of supported modes without changing the physical monitor.
    Some(
        bytes[..128]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

fn refresh(mode: &ModeInfo) -> Option<u32> {
    let denominator = u64::from(mode.htotal) * u64::from(mode.vtotal);
    if denominator == 0 {
        return None;
    }
    let mut rate = f64::from(mode.dot_clock) / denominator as f64;
    if mode.mode_flags.contains(ModeFlag::INTERLACE) {
        rate *= 2.0;
    }
    if mode.mode_flags.contains(ModeFlag::DOUBLE_SCAN) {
        rate /= 2.0;
    }
    let rate = rate.round() as u32;
    (20..=1000).contains(&rate).then_some(rate)
}

pub fn identity(monitor: &tauri::Monitor) -> Option<(String, String, Option<u32>)> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return wayland_identity(monitor);
    }
    let (connection, screen) = x11rb::connect(None).ok()?;
    let root = connection.setup().roots.get(screen)?.root;
    let resources = connection
        .randr_get_screen_resources_current(root)
        .ok()?
        .reply()
        .ok()?;
    let atom = connection
        .intern_atom(true, b"EDID")
        .ok()?
        .reply()
        .ok()?
        .atom;
    if atom == 0 {
        return None;
    }
    let mut candidates = Vec::new();
    for output in resources.outputs {
        let info = connection
            .randr_get_output_info(output, resources.config_timestamp)
            .ok()?
            .reply()
            .ok()?;
        if info.connection != OutputConnection::CONNECTED || info.crtc == 0 {
            continue;
        }
        let crtc = connection
            .randr_get_crtc_info(info.crtc, resources.config_timestamp)
            .ok()?
            .reply()
            .ok()?;
        if i32::from(crtc.x) != monitor.position().x
            || i32::from(crtc.y) != monitor.position().y
            || u32::from(crtc.width) != monitor.size().width
            || u32::from(crtc.height) != monitor.size().height
        {
            continue;
        }
        let property = connection
            .randr_get_output_property(output, atom, AtomEnum::ANY, 0, 64, false, false)
            .ok()?
            .reply()
            .ok()?;
        if property.format != 8 {
            continue;
        }
        let Some(edid) = edid_identity(&property.data) else {
            continue;
        };
        let name = String::from_utf8(info.name).ok()?;
        let hz = resources
            .modes
            .iter()
            .find(|mode| mode.id == crtc.mode)
            .and_then(refresh);
        candidates.push((format!("linux-xrandr:{name}:{edid}"), name, hz));
    }
    // Clone configurations cannot be assigned unambiguously to one display.
    (candidates.len() == 1).then(|| candidates.remove(0))
}

fn wayland_identity(monitor: &tauri::Monitor) -> Option<(String, String, Option<u32>)> {
    extern "C" {
        fn ycore_wayland_output(
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            identity: *mut std::ffi::c_char,
            capacity: usize,
            hz: *mut i32,
        ) -> i32;
    }
    let mut id = [0 as std::ffi::c_char; 1024];
    let mut hz = 0;
    // The protocol reports compositor logical rectangles. XWayland uses the
    // same layout; account for GTK's integer scale without using it as identity.
    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let position = monitor.position();
    let size = monitor.size();
    let found = unsafe {
        ycore_wayland_output(
            (f64::from(position.x) / scale).round() as i32,
            (f64::from(position.y) / scale).round() as i32,
            (f64::from(size.width) / scale).round() as i32,
            (f64::from(size.height) / scale).round() as i32,
            id.as_mut_ptr(),
            id.len(),
            &mut hz,
        )
    };
    if found == 0 {
        return None;
    }
    let identity = unsafe { std::ffi::CStr::from_ptr(id.as_ptr()) }
        .to_str()
        .ok()?
        .to_owned();
    let name = identity
        .strip_prefix("linux-wayland:")?
        .split(':')
        .next()?
        .to_owned();
    Some((
        identity,
        name,
        (20..=1000).contains(&hz).then_some(hz as u32),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edid_requires_a_complete_valid_base_block_and_ignores_extensions() {
        let mut base = vec![0u8; 128];
        base[..8].copy_from_slice(&[0, 255, 255, 255, 255, 255, 255, 0]);
        base[127] = 0u8.wrapping_sub(base[..127].iter().fold(0u8, |a, b| a.wrapping_add(*b)));
        let id = edid_identity(&base).unwrap();
        assert!(edid_identity(&base[..127]).is_none());
        base.extend_from_slice(&[1, 2, 3]);
        assert_eq!(edid_identity(&base).unwrap(), id);
        base[10] ^= 1;
        assert!(edid_identity(&base).is_none());
    }
    #[test]
    fn refresh_accounts_for_interlaced_and_double_scan_modes() {
        let mut mode = ModeInfo {
            dot_clock: 148_500_000,
            htotal: 2200,
            vtotal: 1125,
            ..Default::default()
        };
        assert_eq!(refresh(&mode), Some(60));
        mode.mode_flags = ModeFlag::INTERLACE;
        assert_eq!(refresh(&mode), Some(120));
        mode.mode_flags = ModeFlag::DOUBLE_SCAN;
        assert_eq!(refresh(&mode), Some(30));
        mode.htotal = 0;
        assert_eq!(refresh(&mode), None);
    }
}
