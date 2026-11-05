use crate::{
    monitors::{self, Display},
    scenes::{self, Scenes},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    maximized: bool,
    fullscreen: bool,
    topmost: bool,
    hidden: bool,
}
impl Placement {
    fn valid(&self) -> bool {
        [self.left, self.top, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.left.abs() < 100_000.0
            && self.top.abs() < 100_000.0
            && (100.0..=20000.0).contains(&self.width)
            && (100.0..=20000.0).contains(&self.height)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Config {
    version: u8,
    scenes: BTreeMap<String, Placement>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            scenes: BTreeMap::new(),
        }
    }
}
impl Config {
    fn valid(&self) -> bool {
        self.version == 1
            && self
                .scenes
                .iter()
                .all(|(id, p)| scenes::label_for(Some(id)).is_ok() && p.valid())
    }
}
#[derive(Default)]
pub struct Layouts {
    config: Config,
    saved: Option<Config>,
    path: Option<PathBuf>,
    blocked: bool,
    persistence_error: bool,
    revision: u64,
    detached: HashSet<String>,
    settling: BTreeMap<String, Instant>,
    background: bool,
    test_connected: Option<HashSet<String>>,
}
impl Layouts {
    fn persist(&mut self) {
        if self.blocked {
            self.persistence_error = true;
            return;
        }
        if self.saved.as_ref() == Some(&self.config) {
            return;
        }
        let Some(path) = &self.path else {
            self.persistence_error = true;
            return;
        };
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let bytes = serde_json::to_vec(&self.config)?;
            let temporary = path.with_extension("json.next");
            std::fs::write(&temporary, bytes)?;
            std::fs::rename(temporary, path)?;
            Ok(())
        })();
        self.persistence_error = result.is_err();
        if result.is_ok() {
            self.saved = Some(self.config.clone());
        }
    }
}
pub struct Restore {
    revision: u64,
    placement: Placement,
    display: Display,
}
pub fn restore_current(state: &Scenes, restore: &Restore) -> bool {
    state
        .layouts
        .lock()
        .is_ok_and(|layout| layout.revision == restore.revision)
}
pub fn restore_window(window: &WebviewWindow, restore: &Restore) -> Result<(), String> {
    apply(window, &restore.display, &restore.placement)?;
    if !restore.placement.hidden {
        window.show().map_err(|_| "Cannot restore scene")?;
    }
    Ok(())
}
fn capture(
    window: &WebviewWindow,
    display: &Display,
    previous: Option<&Placement>,
) -> Result<Placement, String> {
    let monitor = display
        .monitor
        .as_ref()
        .ok_or("Display geometry unavailable")?;
    let maximized = window
        .is_maximized()
        .map_err(|_| "Cannot read scene state")?;
    let fullscreen = window
        .is_fullscreen()
        .map_err(|_| "Cannot read scene state")?;
    let mut value = previous.cloned().unwrap_or(Placement {
        left: 20.0,
        top: 20.0,
        width: 960.0,
        height: 600.0,
        maximized: false,
        fullscreen: false,
        topmost: false,
        hidden: false,
    });
    if !maximized && !fullscreen {
        let position = window
            .outer_position()
            .map_err(|_| "Cannot read scene position")?;
        let size = window.inner_size().map_err(|_| "Cannot read scene size")?;
        value.left = f64::from(position.x - monitor.work_area().position.x) / display.scale_factor;
        value.top = f64::from(position.y - monitor.work_area().position.y) / display.scale_factor;
        value.width = f64::from(size.width) / display.scale_factor;
        value.height = f64::from(size.height) / display.scale_factor;
    }
    value.maximized = maximized;
    value.fullscreen = fullscreen;
    value.topmost = window
        .is_always_on_top()
        .map_err(|_| "Cannot read scene topmost")?;
    Ok(value)
}
fn apply(window: &WebviewWindow, display: &Display, value: &Placement) -> Result<(), String> {
    let area = display
        .monitor
        .as_ref()
        .ok_or("Display geometry unavailable")?
        .work_area();
    let scale = display.scale_factor;
    let width = (value.width * scale)
        .round()
        .max(1.0)
        .min(f64::from(area.size.width.saturating_sub(40))) as u32;
    let height = (value.height * scale)
        .round()
        .max(1.0)
        .min(f64::from(area.size.height.saturating_sub(40))) as u32;
    let left = (value.left * scale)
        .round()
        .max(0.0)
        .min(f64::from(area.size.width.saturating_sub(width))) as i32;
    let top = (value.top * scale).round().max(0.0).min(f64::from(
        area.size.height.saturating_sub(height.saturating_add(32)),
    )) as i32;
    window
        .set_fullscreen(false)
        .map_err(|_| "Cannot restore scene mode")?;
    window
        .unmaximize()
        .map_err(|_| "Cannot restore scene mode")?;
    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|_| "Cannot restore scene size")?;
    window
        .set_position(PhysicalPosition::new(
            area.position.x + left,
            area.position.y + top,
        ))
        .map_err(|_| "Cannot restore scene position")?;
    window
        .set_always_on_top(value.topmost)
        .map_err(|_| "Cannot restore scene topmost")?;
    if value.maximized {
        window.maximize().map_err(|_| "Cannot maximize scene")?;
    }
    if value.fullscreen {
        window
            .set_fullscreen(true)
            .map_err(|_| "Cannot restore fullscreen scene")?;
    }
    Ok(())
}
pub fn remember(window: &WebviewWindow, id: &str) -> Result<(), String> {
    let Some(display) = monitors::list(window)?
        .into_iter()
        .find(|d| d.id == id && d.stable)
    else {
        return Ok(());
    };
    let state = window.state::<Scenes>();
    let mut layout = state
        .layouts
        .lock()
        .map_err(|_| "Scene settings unavailable")?;
    let mut value = capture(window, &display, layout.config.scenes.get(id))?;
    value.hidden = false;
    layout.config.scenes.insert(id.into(), value);
    layout.background = false;
    layout.detached.remove(id);
    layout.revision += 1;
    layout
        .settling
        .insert(id.into(), Instant::now() + Duration::from_millis(800));
    layout.persist();
    Ok(())
}
pub fn forget(window: &WebviewWindow, id: &str) {
    if let Ok(mut layout) = window.state::<Scenes>().layouts.lock() {
        layout.config.scenes.remove(id);
        layout.detached.remove(id);
        layout.settling.remove(id);
        layout.revision += 1;
        layout.persist();
    }
}
pub fn hidden(window: &tauri::Window) {
    let Some(id) = window.label().strip_prefix("video-scene-") else {
        return;
    };
    if let Ok(mut layout) = window.state::<Scenes>().layouts.lock() {
        if let Some(value) = layout.config.scenes.get_mut(id) {
            value.hidden = true;
            layout.revision += 1;
            layout.persist();
        }
    }
}
pub fn can_show(window: &WebviewWindow) -> bool {
    let Some(id) = window.label().strip_prefix("video-scene-") else {
        return true;
    };
    let state = window.state::<Scenes>();
    let connected = monitors::list(window).is_ok_and(|all| all.iter().any(|d| d.id == id));
    if !connected {
        return false;
    }
    if let Ok(mut layout) = state.layouts.lock() {
        layout.background = false;
        if layout
            .test_connected
            .as_ref()
            .is_some_and(|ids| !ids.contains(id))
        {
            return false;
        }
        if let Some(value) = layout.config.scenes.get_mut(id) {
            value.hidden = false;
            layout.revision += 1;
            layout.persist();
        }
    }
    true
}
pub fn request_show_all(app: &tauri::AppHandle) {
    if !crate::player_host::supported() {
        return;
    }
    if let Ok(mut layout) = app.state::<Scenes>().layouts.lock() {
        layout.background = false;
        for value in layout.config.scenes.values_mut() {
            value.hidden = false;
        }
        layout.revision += 1;
        layout.persist();
    }
}
pub fn is_detached(window: &WebviewWindow) -> bool {
    let Some(id) = window.label().strip_prefix("video-scene-") else {
        return false;
    };
    window
        .state::<Scenes>()
        .layouts
        .lock()
        .is_ok_and(|layout| layout.detached.contains(id))
}
pub fn append_pending(main: &WebviewWindow, values: &mut Vec<scenes::Status>) {
    if let Ok(layout) = main.state::<Scenes>().layouts.lock() {
        for (id, p) in &layout.config.scenes {
            if !values
                .iter()
                .any(|value| value.screen_id.as_ref() == Some(id))
            {
                values.push(scenes::Status {
                    label: scenes::label_for(Some(id)).ok(),
                    screen_id: Some(id.clone()),
                    enabled: true,
                    visible: false,
                    topmost: p.topmost,
                    fullscreen: p.fullscreen,
                    monitor_id: None,
                    detached: true,
                });
            }
        }
    }
}
#[tauri::command]
pub fn scene_layout_status(window: WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let state = window.state::<Scenes>();
    let layout = state
        .layouts
        .lock()
        .map_err(|_| "Scene settings unavailable")?;
    Ok(
        serde_json::json!({"persistenceError":layout.blocked||layout.persistence_error,"waiting":layout.detached.len()}),
    )
}
pub async fn reconcile(main: &WebviewWindow) -> Result<(), String> {
    if !crate::player_host::supported() {
        return Ok(());
    }
    let state = main.state::<Scenes>();
    let ids: Vec<_> = state
        .layouts
        .lock()
        .map_err(|_| "Scene settings unavailable")?
        .config
        .scenes
        .keys()
        .cloned()
        .collect();
    if ids.is_empty() {
        return Ok(());
    }
    let displays = monitors::list(main)?;
    for id in ids {
        let (mut placement, revision, detached, settling, background, test_connected) = {
            let layout = state
                .layouts
                .lock()
                .map_err(|_| "Scene settings unavailable")?;
            let Some(value) = layout.config.scenes.get(&id) else {
                continue;
            };
            (
                value.clone(),
                layout.revision,
                layout.detached.contains(&id),
                layout.settling.get(&id).copied(),
                layout.background,
                layout
                    .test_connected
                    .as_ref()
                    .is_none_or(|ids| ids.contains(&id)),
            )
        };
        let label = scenes::label_for(Some(&id))?;
        let scene = main.app_handle().get_webview_window(&label);
        let target = displays
            .iter()
            .find(|d| d.id == id && d.stable && test_connected);
        let Some(target) = target else {
            if let Some(scene) = scene {
                scene.hide().map_err(|_| "Cannot hide disconnected scene")?;
                main.state::<crate::player_host::Host>()
                    .mirrors
                    .remove(&label);
            }
            let mut layout = state
                .layouts
                .lock()
                .map_err(|_| "Scene settings unavailable")?;
            if layout.revision == revision && layout.config.scenes.contains_key(&id) {
                layout.detached.insert(id);
            }
            continue;
        };
        if detached || scene.is_none() {
            placement.hidden |= background;
            let restore = Restore {
                revision,
                placement,
                display: target.clone(),
            };
            scenes::change(
                main,
                scenes::WindowAction::Open,
                Some(id.clone()),
                Some(restore),
            )
            .await?;
            let mut layout = state
                .layouts
                .lock()
                .map_err(|_| "Scene settings unavailable")?;
            if layout.revision == revision {
                layout.detached.remove(&id);
                layout
                    .settling
                    .insert(id, Instant::now() + Duration::from_millis(800));
            }
            continue;
        }
        if settling.is_some_and(|until| Instant::now() < until) {
            continue;
        }
        let scene = scene.ok_or("Scene unavailable")?;
        if scene.is_minimized().unwrap_or(false)
            || monitors::current_id(&scene).as_deref() != Some(&id)
        {
            continue;
        }
        let value = capture(&scene, target, Some(&placement))?;
        let mut layout = state
            .layouts
            .lock()
            .map_err(|_| "Scene settings unavailable")?;
        if layout.revision == revision && value != placement {
            layout.config.scenes.insert(id, value);
            layout.revision += 1;
            layout.persist();
        }
    }
    Ok(())
}
pub fn install(app: &tauri::AppHandle, background: bool) {
    if !crate::player_host::supported() {
        return;
    }
    let directory =
        if cfg!(debug_assertions) && app.state::<crate::storage::StorageState>().test_mode {
            std::env::var_os("ENCORE_TEST_DATA_DIR").map(PathBuf::from)
        } else {
            app.path().app_data_dir().ok()
        };
    let state = app.state::<Scenes>();
    if let Ok(mut layout) = state.layouts.lock() {
        layout.background = background;
        layout.path = directory.map(|path| path.join("scene-layouts.json"));
        if let Some(path) = &layout.path {
            match std::fs::metadata(path) {
                Ok(meta) if meta.len() <= 262144 => match std::fs::read(path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Config>(&bytes).ok())
                    .filter(Config::valid)
                {
                    Some(config) => {
                        layout.saved = Some(config.clone());
                        layout.config = config;
                    }
                    None => layout.blocked = true,
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => layout.blocked = true,
            }
        }
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        let Some(main) = app.get_webview_window("main") else {
            break;
        };
        let _ = tauri::async_runtime::block_on(reconcile(&main));
        std::thread::sleep(Duration::from_secs(1));
    });
}
#[tauri::command]
pub async fn scene_test_connected(
    window: WebviewWindow,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    if !cfg!(debug_assertions)
        || window.label() != "main"
        || !window.state::<crate::storage::StorageState>().test_mode
    {
        return Err("Display simulation is restricted to isolated debug tests".into());
    }
    let connected = monitors::list(&window)?;
    if ids
        .as_ref()
        .is_some_and(|ids| ids.iter().any(|id| !connected.iter().any(|d| &d.id == id)))
    {
        return Err("Unknown physical display".into());
    }
    window
        .state::<Scenes>()
        .layouts
        .lock()
        .map_err(|_| "Scene settings unavailable")?
        .test_connected = ids.map(|ids| ids.into_iter().collect());
    reconcile(&window).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn placement() -> Placement {
        Placement {
            left: 10.0,
            top: 20.0,
            width: 640.0,
            height: 420.0,
            maximized: false,
            fullscreen: true,
            topmost: true,
            hidden: false,
        }
    }
    #[test]
    fn config_rejects_new_versions_bad_identity_and_geometry() {
        let mut value = Config::default();
        value
            .scenes
            .insert("monitor-0123456789abcdef".into(), placement());
        assert!(value.valid());
        value.version = 2;
        assert!(!value.valid());
        value.version = 1;
        value.scenes.values_mut().next().unwrap().width = f64::NAN;
        assert!(!value.valid());
        value.scenes.clear();
        value.scenes.insert("auth".into(), placement());
        assert!(!value.valid());
    }
    #[test]
    fn atomic_settings_roundtrip_preserves_independent_monitors_and_targeted_off() {
        let directory =
            std::env::temp_dir().join(format!("ycore-layout-{}", getrandom::u64().unwrap()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("scenes.json");
        let mut layout = Layouts {
            path: Some(path.clone()),
            ..Layouts::default()
        };
        layout
            .config
            .scenes
            .insert("monitor-0123456789abcdef".into(), placement());
        layout
            .config
            .scenes
            .insert("monitor-fedcba9876543210".into(), placement());
        layout.persist();
        let saved: Config = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.scenes.len(), 2);
        assert!(saved.valid());
        layout.config.scenes.remove("monitor-0123456789abcdef");
        layout.persist();
        let saved: Config = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved.scenes.len(), 1);
        assert!(saved.scenes.contains_key("monitor-fedcba9876543210"));
        layout.blocked = true;
        layout.config.scenes.clear();
        layout.persist();
        let preserved: Config = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(preserved, saved);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
