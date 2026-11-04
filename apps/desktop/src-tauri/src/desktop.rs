use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
#[derive(Default)]
pub struct DesktopState {
    available: AtomicBool,
    quitting: AtomicBool,
}
impl DesktopState {
    pub fn tray_available(&self) -> bool {
        self.available.load(Ordering::Relaxed)
    }
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Open,
    Toggle,
    Quit,
}
#[derive(Serialize)]
pub struct Status {
    pub process_id: u32,
    pub tray_available: bool,
    pub visible: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub quitting: bool,
}
pub fn open(app: &AppHandle) -> Result<(), String> {
    for window in app.webview_windows().values() {
        if !window
            .is_visible()
            .map_err(|_| "Cannot read window visibility")?
        {
            window.show().map_err(|_| "Cannot restore window")?;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        window
            .unminimize()
            .map_err(|_| "Cannot restore minimized window")?;
        window.set_focus().map_err(|_| "Cannot focus window")?;
    }
    Ok(())
}
pub fn action(app: &AppHandle, action: Action) -> Result<(), String> {
    match action {
        Action::Open => open(app),
        Action::Toggle => app
            .emit_to("main", "encore-control", "toggle")
            .map_err(|_| "Cannot deliver playback command".into()),
        Action::Quit => {
            app.state::<DesktopState>()
                .quitting
                .store(true, Ordering::Release);
            app.exit(0);
            Ok(())
        }
    }
}
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Открыть Encore", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Воспроизвести / пауза", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти из Encore", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &toggle, &quit])?;
    let mut builder = TrayIconBuilder::with_id("encore")
        .tooltip("Encore")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let selected = match event.id.as_ref() {
                "open" => Some(Action::Open),
                "toggle" => Some(Action::Toggle),
                "quit" => Some(Action::Quit),
                _ => None,
            };
            if let Some(selected) = selected {
                let _ = action(app, selected);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = open(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.state::<DesktopState>()
        .available
        .store(true, Ordering::Release);
    Ok(())
}
pub fn closing(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<DesktopState>();
        if state.available.load(Ordering::Acquire) && !state.quitting.load(Ordering::Acquire) {
            api.prevent_close();
            if window.hide().is_err() {
                let _ = window.emit("encore-lifecycle-error", "Не удалось скрыть окно.");
            }
        }
    }
}
#[tauri::command]
pub fn desktop_action(window: tauri::WebviewWindow, action: Action) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    self::action(window.app_handle(), action)
}
#[tauri::command]
pub fn desktop_status(window: tauri::WebviewWindow) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let state = window.state::<DesktopState>();
    Ok(Status {
        process_id: std::process::id(),
        tray_available: state.available.load(Ordering::Acquire),
        visible: window.is_visible().map_err(|_| "Cannot read visibility")?,
        minimized: window
            .is_minimized()
            .map_err(|_| "Cannot read minimized state")?,
        maximized: window
            .is_maximized()
            .map_err(|_| "Cannot read maximized state")?,
        quitting: state.quitting.load(Ordering::Acquire),
    })
}
#[tauri::command]
pub fn desktop_close(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    window.close().map_err(|_| "Cannot close window".into())
}
