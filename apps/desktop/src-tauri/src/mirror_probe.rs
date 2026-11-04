//! Isolated Windows spike. Never creates another WebView or YouTube connection.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
#[allow(dead_code)]
pub struct MirrorProbe(Mutex<Option<isize>>, Mutex<Option<ConcealState>>);
#[allow(dead_code)]
struct ConcealState {
    style: isize,
    color: u32,
    alpha: u8,
    flags: u32,
    had_attributes: bool,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crop {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[allow(dead_code)]
impl Crop {
    fn valid(self, width: f64, height: f64) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.x >= 0.0
            && self.y >= 0.0
            && self.width >= 32.0
            && self.height >= 32.0
            && self.x + self.width <= width + 1.0
            && self.y + self.height <= height + 1.0
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Open,
    OpenSurface,
    Update,
    Capture,
    Conceal,
    Reveal,
    Close,
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    source_visible: bool,
    webviews: usize,
    windows: usize,
    frame_hash: Option<String>,
    non_black_ratio: Option<f64>,
    artifact: Option<String>,
    center_rgb: Option<[u8; 3]>,
    source_alpha: Option<u8>,
    mouse_passthrough: bool,
    hit_test_passed: Option<bool>,
}

#[tauri::command]
pub async fn mirror_probe(
    window: WebviewWindow,
    state: tauri::State<'_, MirrorProbe>,
    action: Action,
    crop: Option<Crop>,
    save: Option<bool>,
) -> Result<Report, String> {
    if window.label() != "main"
        || !cfg!(debug_assertions)
        || !window.state::<crate::storage::StorageState>().test_mode
    {
        return Err("Mirror probe is restricted to the isolated debug profile".into());
    }
    #[cfg(all(target_os = "windows", debug_assertions, feature = "mirror-probe"))]
    {
        imp::run(&window, &state, action, crop, save.unwrap_or(false))
    }
    #[cfg(not(all(target_os = "windows", debug_assertions, feature = "mirror-probe")))]
    {
        let _ = (state, action, crop, save);
        Err("Windows-only mirror probe".into())
    }
}

#[cfg(all(target_os = "windows", debug_assertions, feature = "mirror-probe"))]
mod imp {
    use super::*;
    use windows::Win32::{
        Foundation::{POINT, RECT},
        Graphics::{Dwm::*, Gdi::*},
        UI::WindowsAndMessaging::{
            GetAncestor, GetClientRect, GetLayeredWindowAttributes, GetWindowLongPtrW,
            SetLayeredWindowAttributes, SetWindowLongPtrW, WindowFromPoint, GA_ROOT, GWL_EXSTYLE,
            LAYERED_WINDOW_ATTRIBUTES_FLAGS, LWA_ALPHA, WS_EX_LAYERED, WS_EX_NOACTIVATE,
            WS_EX_TRANSPARENT,
        },
    };
    const LABEL: &str = "mirror-probe";
    fn conceal(main: &WebviewWindow, state: &MirrorProbe) -> Result<(), String> {
        let hwnd = main.hwnd().map_err(|_| "Cannot read source handle")?;
        let mut saved = state
            .1
            .lock()
            .map_err(|_| "Probe source style unavailable")?;
        if saved.is_some() {
            return Ok(());
        }
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let mut color = windows::Win32::Foundation::COLORREF(0);
            let mut alpha = 255;
            let mut flags = LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
            let had_attributes = GetLayeredWindowAttributes(
                hwnd,
                Some(&mut color),
                Some(&mut alpha),
                Some(&mut flags),
            )
            .is_ok();
            *saved = Some(ConcealState {
                style,
                color: color.0,
                alpha,
                flags: flags.0,
                had_attributes,
            });
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                style
                    | WS_EX_LAYERED.0 as isize
                    | WS_EX_TRANSPARENT.0 as isize
                    | WS_EX_NOACTIVATE.0 as isize,
            );
            SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 0, LWA_ALPHA)
                .map_err(|_| "Cannot make probe source transparent")?;
        }
        Ok(())
    }
    fn reveal(main: &WebviewWindow, state: &MirrorProbe) -> Result<(), String> {
        let hwnd = main.hwnd().map_err(|_| "Cannot read source handle")?;
        if let Some(saved) = state
            .1
            .lock()
            .map_err(|_| "Probe source style unavailable")?
            .take()
        {
            unsafe {
                if saved.had_attributes {
                    SetLayeredWindowAttributes(
                        hwnd,
                        windows::Win32::Foundation::COLORREF(saved.color),
                        saved.alpha,
                        LAYERED_WINDOW_ATTRIBUTES_FLAGS(saved.flags),
                    )
                    .map_err(|_| "Cannot restore source transparency")?;
                } else {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, saved.style & !(WS_EX_LAYERED.0 as isize));
                }
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, saved.style);
            }
        }
        Ok(())
    }
    fn update(main: &WebviewWindow, handle: isize, crop: Crop) -> Result<(), String> {
        let scale = main.scale_factor().map_err(|_| "Cannot read source DPI")?;
        let size = main.inner_size().map_err(|_| "Cannot read source size")?;
        if !crop.valid(
            f64::from(size.width) / scale,
            f64::from(size.height) / scale,
        ) {
            return Err("Video is outside the visible source client area".into());
        }
        let target = main
            .app_handle()
            .get_window(LABEL)
            .ok_or("Mirror window is missing")?;
        let destination = target.inner_size().map_err(|_| "Cannot read mirror size")?;
        let source = RECT {
            left: (crop.x * scale).round() as i32,
            top: (crop.y * scale).round() as i32,
            right: ((crop.x + crop.width) * scale).round() as i32,
            bottom: ((crop.y + crop.height) * scale).round() as i32,
        };
        let ratio = (f64::from(destination.width) / crop.width)
            .min(f64::from(destination.height) / crop.height);
        let width = (crop.width * ratio).round() as i32;
        let height = (crop.height * ratio).round() as i32;
        let left = (destination.width as i32 - width) / 2;
        let top = (destination.height as i32 - height) / 2;
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION
                | DWM_TNP_RECTSOURCE
                | DWM_TNP_VISIBLE
                | DWM_TNP_OPACITY
                | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: RECT {
                left,
                top,
                right: left + width,
                bottom: top + height,
            },
            rcSource: source,
            opacity: 255,
            fVisible: true.into(),
            fSourceClientAreaOnly: true.into(),
        };
        unsafe { DwmUpdateThumbnailProperties(handle, &props) }
            .map_err(|_| "DWM rejected mirror properties".to_string())
    }
    fn pixels(main: &WebviewWindow) -> Result<(Vec<u8>, i32, i32), String> {
        let target = main
            .app_handle()
            .get_window(LABEL)
            .ok_or("Mirror window is missing")?;
        let hwnd = target.hwnd().map_err(|_| "Cannot read mirror handle")?;
        let mut rect = RECT::default();
        let mut origin = POINT::default();
        unsafe { GetClientRect(hwnd, &mut rect) }.map_err(|_| "Cannot read mirror bounds")?;
        if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
            return Err("Cannot locate mirror client area".into());
        }
        let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
        if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
            return Err("Invalid mirror capture size".into());
        }
        // Read only this application's probe client rectangle, never the desktop.
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err("Cannot read compositor".into());
            }
            let memory = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            if memory.is_invalid() || bitmap.is_invalid() {
                let _ = DeleteDC(memory);
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
                ReleaseDC(None, screen);
                return Err("Cannot allocate probe capture".into());
            }
            let old = SelectObject(memory, HGDIOBJ(bitmap.0));
            let result = (|| {
                BitBlt(
                    memory,
                    0,
                    0,
                    width,
                    height,
                    Some(screen),
                    origin.x,
                    origin.y,
                    SRCCOPY | CAPTUREBLT,
                )
                .map_err(|_| "Cannot capture mirror client")?;
                SelectObject(memory, old);
                let mut data = vec![0u8; width as usize * height as usize * 4];
                let mut info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: width,
                        biHeight: -height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                if GetDIBits(
                    memory,
                    bitmap,
                    0,
                    height as u32,
                    Some(data.as_mut_ptr().cast()),
                    &mut info,
                    DIB_RGB_COLORS,
                ) == 0
                {
                    return Err("Cannot read mirror pixels");
                }
                Ok((data, width, height))
            })();
            SelectObject(memory, old);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
            result.map_err(str::to_string)
        }
    }
    fn bmp(data: &[u8], width: i32, height: i32) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(data.len() + 54);
        bytes.extend(b"BM");
        bytes.extend(((data.len() + 54) as u32).to_le_bytes());
        bytes.extend([0u8; 4]);
        bytes.extend(54u32.to_le_bytes());
        bytes.extend(40u32.to_le_bytes());
        bytes.extend(width.to_le_bytes());
        bytes.extend((-height).to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(32u16.to_le_bytes());
        bytes.extend([0u8; 24]);
        bytes.extend(data);
        bytes
    }
    pub fn run(
        main: &WebviewWindow,
        state: &MirrorProbe,
        action: Action,
        crop: Option<Crop>,
        save: bool,
    ) -> Result<Report, String> {
        let app = main.app_handle();
        match action {
            Action::Conceal => conceal(main, state)?,
            Action::Reveal => reveal(main, state)?,
            Action::Open | Action::OpenSurface => {
                let crop = crop.ok_or("Video rectangle is required")?;
                if state
                    .0
                    .lock()
                    .map_err(|_| "Mirror probe unavailable")?
                    .is_some()
                {
                    return Err("Mirror probe already exists".into());
                }
                let target = tauri::WindowBuilder::new(app, LABEL)
                    .title("Encore · DWM mirror probe")
                    .inner_size(640.0, 360.0)
                    .resizable(false)
                    .always_on_top(true)
                    .background_color(tauri::window::Color(0, 0, 0, 255))
                    .build()
                    .map_err(|_| "Cannot create mirror probe")?;
                if matches!(action, Action::OpenSurface) {
                    target
                        .add_child(
                            tauri::webview::WebviewBuilder::new(
                                "mirror-probe-surface",
                                tauri::WebviewUrl::App("mirror-probe.html".into()),
                            )
                            .additional_browser_args(
                                app.config()
                                    .app
                                    .windows
                                    .first()
                                    .and_then(|w| w.additional_browser_args.as_deref())
                                    .unwrap_or_default(),
                            )
                            .auto_resize(),
                            tauri::LogicalPosition::new(0.0, 0.0),
                            tauri::LogicalSize::new(640.0, 360.0),
                        )
                        .map_err(|_| "Cannot create local destination surface")?;
                }
                if let Ok(monitors) = main.available_monitors() {
                    if let Some(display) = monitors.iter().find(|display| {
                        main.current_monitor()
                            .ok()
                            .flatten()
                            .is_some_and(|current| display.position() != current.position())
                    }) {
                        let area = display.work_area();
                        let _ = target.set_position(tauri::PhysicalPosition::new(
                            area.position.x + 40,
                            area.position.y + 40,
                        ));
                    }
                }
                let handle = unsafe {
                    DwmRegisterThumbnail(
                        target.hwnd().map_err(|_| "Cannot read mirror handle")?,
                        main.hwnd().map_err(|_| "Cannot read source handle")?,
                    )
                }
                .map_err(|_| "DWM thumbnail registration failed")?;
                if let Err(error) = update(main, handle, crop) {
                    let _ = unsafe { DwmUnregisterThumbnail(handle) };
                    let _ = target.destroy();
                    return Err(error);
                }
                *state.0.lock().map_err(|_| "Mirror probe unavailable")? = Some(handle);
            }
            Action::Update => {
                let handle = state
                    .0
                    .lock()
                    .map_err(|_| "Mirror probe unavailable")?
                    .ok_or("Mirror probe is missing")?;
                update(main, handle, crop.ok_or("Video rectangle is required")?)?;
            }
            Action::Close => {
                reveal(main, state)?;
                if let Some(handle) = state
                    .0
                    .lock()
                    .map_err(|_| "Mirror probe unavailable")?
                    .take()
                {
                    let _ = unsafe { DwmUnregisterThumbnail(handle) };
                }
                if let Some(target) = app.get_window(LABEL) {
                    target.destroy().map_err(|_| "Cannot close mirror probe")?;
                }
            }
            Action::Capture => {}
        }
        let mut report = Report {
            source_visible: main.is_visible().unwrap_or(false),
            webviews: app.webviews().len(),
            windows: app.windows().len(),
            ..Report::default()
        };
        let hwnd = main.hwnd().map_err(|_| "Cannot read source handle")?;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            report.mouse_passthrough = style & WS_EX_TRANSPARENT.0 as isize != 0;
            let mut alpha = 255;
            if GetLayeredWindowAttributes(hwnd, None, Some(&mut alpha), None).is_ok() {
                report.source_alpha = Some(alpha);
            }
            if matches!(action, Action::Conceal) {
                let mut origin = POINT::default();
                let mut area = RECT::default();
                GetClientRect(hwnd, &mut area).map_err(|_| "Cannot read source area")?;
                if ClientToScreen(hwnd, &mut origin).as_bool() {
                    let hit = WindowFromPoint(POINT {
                        x: origin.x + (area.right - area.left) / 2,
                        y: origin.y + (area.bottom - area.top) / 2,
                    });
                    report.hit_test_passed = Some(GetAncestor(hit, GA_ROOT) != hwnd);
                }
            }
        }
        if matches!(action, Action::Capture) {
            let (data, width, height) = pixels(main)?;
            let mut hash = 0xcbf29ce484222325u64;
            let mut non_black = 0;
            for pixel in data.as_chunks::<4>().0 {
                for byte in &pixel[..3] {
                    hash ^= u64::from(*byte);
                    hash = hash.wrapping_mul(0x100000001b3);
                }
                if pixel[..3].iter().any(|value| *value > 16) {
                    non_black += 1;
                }
            }
            report.frame_hash = Some(format!("{hash:016x}"));
            let center = ((height as usize / 2) * width as usize + width as usize / 2) * 4;
            report.center_rgb = Some([data[center + 2], data[center + 1], data[center]]);
            report.non_black_ratio =
                Some(non_black as f64 / (f64::from(width) * f64::from(height)));
            if save {
                let directory = std::env::var_os("ENCORE_TEST_DATA_DIR")
                    .map(std::path::PathBuf::from)
                    .ok_or("Isolated probe directory missing")?;
                std::fs::write(
                    directory.join("mirror-probe-last.bmp"),
                    bmp(&data, width, height),
                )
                .map_err(|_| "Cannot save probe artifact")?;
                report.artifact = Some("mirror-probe-last.bmp".into());
            }
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_rejects_offscreen_nonfinite_and_empty_video() {
        assert!(Crop {
            x: 5.0,
            y: 5.0,
            width: 320.0,
            height: 200.0
        }
        .valid(800.0, 600.0));
        assert!(!Crop {
            x: -10000.0,
            y: 0.0,
            width: 320.0,
            height: 200.0
        }
        .valid(800.0, 600.0));
        assert!(!Crop {
            x: 0.0,
            y: 0.0,
            width: f64::NAN,
            height: 200.0
        }
        .valid(800.0, 600.0));
    }
}
