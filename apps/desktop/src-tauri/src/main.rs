#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod catalogue;
#[allow(dead_code)]
mod credentials;
mod desktop;
mod matcher;
mod media;
mod power;
mod source;
mod storage;
use tauri::Manager;
mod window_mode;
#[allow(dead_code)]
mod yandex;
#[tauri::command]
async fn source_fetch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, source::Source>,
    fresh: bool,
    station: Option<String>,
) -> Result<Vec<source::Track>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let source = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        source::fetch(
            &source,
            fresh,
            station.as_deref().unwrap_or("user:onyourwave"),
        )
    })
    .await
    .map_err(|_| "Source worker failed".to_string())?
    .map_err(str::to_string)
}
#[tauri::command]
async fn source_stations(window: tauri::WebviewWindow) -> Result<Vec<source::Station>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(source::stations)
        .await
        .map_err(|_| "Stations worker failed".to_string())?
        .map_err(str::to_string)
}
#[tauri::command]
async fn search_videos(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, matcher::Matcher>,
    title: String,
    artist: String,
) -> Result<Vec<matcher::Candidate>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let matcher = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || matcher::search(&matcher, &title, &artist))
        .await
        .map_err(|_| "Search worker failed".to_string())?
        .map_err(str::to_string)
}
#[tauri::command]
async fn catalogue_search(
    window: tauri::WebviewWindow,
    query: String,
    page: u32,
) -> Result<catalogue::Results, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(move || catalogue::search(&query, page))
        .await
        .map_err(|_| "Catalogue worker failed".to_string())?
        .map_err(str::to_string)
}
#[tauri::command]
async fn catalogue_collection(
    window: tauri::WebviewWindow,
    kind: catalogue::Kind,
    id: String,
    owner: Option<String>,
    page: u32,
) -> Result<catalogue::Collection, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        catalogue::collection(kind, &id, owner.as_deref(), page)
    })
    .await
    .map_err(|_| "Collection worker failed".to_string())?
    .map_err(str::to_string)
}
fn main() {
    let mut context = tauri::generate_context!();
    if cfg!(debug_assertions) && std::env::var_os("ENCORE_TEST_DATA_DIR").is_some() {
        // Separate instance lock and WebView profile; never attach to the user's player.
        context.config_mut().identifier = "io.encore.desktop.test".into();
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.title = "Encore · нативная проверка".into();
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_power_monitor::init())
        .plugin(power::plugin())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = desktop::open(app);
        }))
        .manage(desktop::DesktopState::default())
        .manage(media::MediaState::default())
        .on_window_event(desktop::closing)
        .setup(|app| {
            let test_directory = if cfg!(debug_assertions) {
                std::env::var_os("ENCORE_TEST_DATA_DIR")
            } else {
                None
            };
            let test_mode = test_directory.is_some();
            let directory = match test_directory {
                Some(path) => Ok(std::path::PathBuf::from(path)),
                None => app
                    .path()
                    .app_data_dir()
                    .map_err(|_| "Cannot locate application data"),
            };
            let store = directory.and_then(|directory| {
                std::fs::create_dir_all(&directory)
                    .map_err(|_| "Cannot create application data directory")?;
                storage::Store::open(&directory.join("encore.sqlite"))
            });
            app.manage(storage::StorageState { store, test_mode });
            let _ = desktop::install(app.handle());
            let _ = media::install(app.handle());
            Ok(())
        })
        .manage(source::Source::default())
        .manage(matcher::Matcher::default())
        .manage(window_mode::WindowMode::default())
        .invoke_handler(tauri::generate_handler![
            source_fetch,
            source_stations,
            media::media_update,
            media::media_status,
            desktop::desktop_action,
            desktop::desktop_status,
            desktop::desktop_close,
            catalogue_search,
            catalogue_collection,
            storage::storage_command,
            search_videos,
            window_mode::window_mini,
            window_mode::window_topmost,
            window_mode::window_topmost_state
        ])
        .run(context)
        .expect("failed to run Encore");
}
