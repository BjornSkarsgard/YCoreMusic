// Windows-only compositor operations; retain portable geometry tests elsewhere.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]
use serde::Deserialize;
use std::{collections::HashMap, sync::Mutex};
#[cfg(target_os = "windows")]
use tauri::Manager;
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 100000.0)
            && self.width >= 0.0
            && self.height >= 0.0
    }
    fn scaled(self, scale: f64) -> Self {
        Self {
            x: self.x * scale,
            y: self.y * scale,
            width: self.width * scale,
            height: self.height * scale,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Surface {
    pub visible: bool,
    pub stage: Rect,
    pub holes: Vec<Rect>,
    pub dimmed: bool,
}
impl Surface {
    pub fn valid(&self) -> bool {
        self.stage.valid() && self.holes.len() <= 16 && self.holes.iter().all(|r| r.valid())
    }
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct Tile {
    pub(crate) destination: Rect,
    source: Rect,
}
fn subtract(rect: Rect, hole: Rect) -> Vec<Rect> {
    let left = rect.x.max(hole.x);
    let top = rect.y.max(hole.y);
    let right = (rect.x + rect.width).min(hole.x + hole.width);
    let bottom = (rect.y + rect.height).min(hole.y + hole.height);
    if left >= right || top >= bottom {
        return vec![rect];
    }
    [
        Rect {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: top - rect.y,
        },
        Rect {
            x: rect.x,
            y: bottom,
            width: rect.width,
            height: rect.y + rect.height - bottom,
        },
        Rect {
            x: rect.x,
            y: top,
            width: left - rect.x,
            height: bottom - top,
        },
        Rect {
            x: right,
            y: top,
            width: rect.x + rect.width - right,
            height: bottom - top,
        },
    ]
    .into_iter()
    .filter(|r| r.width >= 1.0 && r.height >= 1.0)
    .collect()
}
pub(crate) fn tiles(
    stage: Rect,
    holes: &[Rect],
    source_width: f64,
    source_height: f64,
) -> Vec<Tile> {
    if stage.width < 1.0 || stage.height < 1.0 || source_width <= 0.0 || source_height <= 0.0 {
        return vec![];
    }
    let scale = (stage.width / source_width).min(stage.height / source_height);
    let image = Rect {
        x: stage.x + (stage.width - source_width * scale) / 2.0,
        y: stage.y + (stage.height - source_height * scale) / 2.0,
        width: source_width * scale,
        height: source_height * scale,
    };
    let mut rectangles = vec![image];
    for hole in holes {
        rectangles = rectangles
            .into_iter()
            .flat_map(|rect| subtract(rect, *hole))
            .collect();
        if rectangles.len() > 64 {
            return vec![];
        }
    }
    rectangles
        .into_iter()
        .map(|rect| Tile {
            destination: rect,
            source: Rect {
                x: (rect.x - image.x) / scale,
                y: (rect.y - image.y) / scale,
                width: rect.width / scale,
                height: rect.height / scale,
            },
        })
        .collect()
}
#[derive(Default)]
pub struct Mirrors(Mutex<HashMap<String, Vec<isize>>>);
impl Mirrors {
    pub fn count(&self, label: &str) -> usize {
        self.0
            .lock()
            .ok()
            .and_then(|all| all.get(label).map(Vec::len))
            .unwrap_or(0)
    }
    pub fn remove(&self, label: &str) {
        #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
        crate::linux_video::remove(label);
        if let Ok(mut mirrors) = self.0.lock() {
            if let Some(handles) = mirrors.remove(label) {
                unregister(handles);
            }
        }
    }
}
#[cfg(target_os = "windows")]
fn unregister(handles: Vec<isize>) {
    for handle in handles {
        let _ = unsafe { windows::Win32::Graphics::Dwm::DwmUnregisterThumbnail(handle) };
    }
}
#[cfg(not(target_os = "windows"))]
fn unregister(_handles: Vec<isize>) {}
impl Drop for Mirrors {
    fn drop(&mut self) {
        if let Ok(mirrors) = self.0.get_mut() {
            for (_, handles) in mirrors.drain() {
                unregister(handles);
            }
        }
    }
}

pub fn update(window: &WebviewWindow, mirrors: &Mirrors, surface: &Surface) -> Result<(), String> {
    if !surface.valid() {
        return Err("Invalid video surface".into());
    }
    if !surface.visible
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        mirrors.remove(window.label());
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::{Foundation::RECT, Graphics::Dwm::*};
        let Some(source) = window
            .app_handle()
            .get_webview_window(crate::player_host::LABEL)
        else {
            mirrors.remove(window.label());
            return Ok(());
        };
        let size = source
            .inner_size()
            .map_err(|_| "Cannot read video engine size")?;
        let dpi = window
            .scale_factor()
            .map_err(|_| "Cannot read video surface DPI")?;
        let client = window
            .inner_size()
            .map_err(|_| "Cannot read video surface size")?;
        let stage = surface.stage.scaled(dpi);
        if stage.x < -1.0
            || stage.y < -1.0
            || stage.x + stage.width > f64::from(client.width) + 2.0
            || stage.y + stage.height > f64::from(client.height) + 2.0
        {
            mirrors.remove(window.label());
            return Err("Video surface is outside the window".into());
        }
        let holes: Vec<_> = surface.holes.iter().map(|r| r.scaled(dpi)).collect();
        let tiles = tiles(stage, &holes, f64::from(size.width), f64::from(size.height));
        let destination = window
            .hwnd()
            .map_err(|_| "Cannot read destination handle")?;
        let source = source.hwnd().map_err(|_| "Cannot read source handle")?;
        let mut all = mirrors.0.lock().map_err(|_| "Mirrors unavailable")?;
        let handles = all.entry(window.label().to_string()).or_default();
        while handles.len() > tiles.len() {
            if let Some(handle) = handles.pop() {
                let _ = unsafe { DwmUnregisterThumbnail(handle) };
            }
        }
        while handles.len() < tiles.len() {
            handles.push(
                unsafe { DwmRegisterThumbnail(destination, source) }
                    .map_err(|_| "Cannot register video mirror")?,
            );
        }
        let rect = |r: Rect| RECT {
            left: r.x.round() as i32,
            top: r.y.round() as i32,
            right: (r.x + r.width).round() as i32,
            bottom: (r.y + r.height).round() as i32,
        };
        for (handle, tile) in handles.iter().zip(tiles) {
            let props = DWM_THUMBNAIL_PROPERTIES {
                dwFlags: DWM_TNP_RECTDESTINATION
                    | DWM_TNP_RECTSOURCE
                    | DWM_TNP_VISIBLE
                    | DWM_TNP_OPACITY
                    | DWM_TNP_SOURCECLIENTAREAONLY,
                rcDestination: rect(tile.destination),
                rcSource: rect(tile.source),
                opacity: if surface.dimmed { 90 } else { 255 },
                fVisible: true.into(),
                fSourceClientAreaOnly: true.into(),
            };
            unsafe { DwmUpdateThumbnailProperties(*handle, &props) }
                .map_err(|_| "Cannot update video mirror")?;
        }
        Ok(())
    }
    #[cfg(all(target_os = "linux", feature = "linux-player-host"))]
    {
        crate::linux_video::update(window, surface)?;
        mirrors
            .0
            .lock()
            .map_err(|_| "Video surfaces unavailable")?
            .insert(window.label().into(), vec![1]);
        Ok(())
    }
    #[cfg(not(any(
        target_os = "windows",
        all(target_os = "linux", feature = "linux-player-host")
    )))]
    {
        let _ = mirrors;
        Err("Local video mirrors are not available on this platform".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlay_holes_preserve_video_scale_and_do_not_cover_transport() {
        let stage = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let hole = Rect {
            x: 400.0,
            y: 800.0,
            width: 1000.0,
            height: 200.0,
        };
        let result = tiles(stage, &[hole], 1920.0, 1080.0);
        assert_eq!(result.len(), 4);
        let area: f64 = result
            .iter()
            .map(|tile| tile.destination.width * tile.destination.height)
            .sum();
        assert_eq!(area, 1920.0 * 1080.0 - 200000.0);
        for tile in result {
            assert_eq!(tile.destination.x, tile.source.x);
            assert!(
                tile.destination.x + tile.destination.width <= hole.x
                    || tile.destination.x >= hole.x + hole.width
                    || tile.destination.y + tile.destination.height <= hole.y
                    || tile.destination.y >= hole.y + hole.height
            );
        }
    }
    #[test]
    fn letterbox_and_overlapping_holes_do_not_stretch_or_double_draw() {
        let stage = Rect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 100.0,
        };
        let holes = [
            Rect {
                x: 20.0,
                y: 45.0,
                width: 40.0,
                height: 20.0,
            },
            Rect {
                x: 40.0,
                y: 50.0,
                width: 40.0,
                height: 30.0,
            },
        ];
        let result = tiles(stage, &holes, 200.0, 100.0);
        for tile in result {
            assert!(
                tile.destination.y >= 45.0 && tile.destination.y + tile.destination.height <= 95.0
            );
            assert!((tile.destination.width / tile.source.width - 0.5).abs() < 0.001);
        }
    }
}
