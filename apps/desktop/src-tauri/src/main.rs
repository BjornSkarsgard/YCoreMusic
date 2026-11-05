#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod auth;
mod autostart;
mod catalogue;
#[allow(dead_code)]
mod credentials;
mod desktop;
mod diagnostics;
mod discovery;
mod feedback;
mod library;
mod matcher;
mod media;
mod mirror_probe;
mod monitors;
mod player_host;
mod power;
mod scene_layout;
mod scenes;
mod smart_history;
mod source;
mod storage;
mod video_mirror;
mod wave_feedback;
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
) -> Result<Vec<source::Recommendation>, String> {
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
    if player_host::supported() {
        // All WebViews sharing a WebView2 environment must use identical browser
        // arguments. App-level play intent still prevents startup/wake autoplay.
        for window in &mut context.config_mut().app.windows {
            let args = window
                .additional_browser_args
                .get_or_insert_with(String::new);
            args.push_str(" --autoplay-policy=no-user-gesture-required");
        }
    }
    let background_launch = autostart::requested(std::env::args_os().skip(1));
    if background_launch {
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.visible = false;
        }
    }
    if cfg!(debug_assertions) && std::env::var_os("ENCORE_TEST_DATA_DIR").is_some() {
        // Separate instance lock and WebView profile; never attach to the user's player.
        context.config_mut().identifier = "io.encore.desktop.test".into();
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.title = "YCore Music · нативная проверка".into();
        }
    }
    tauri::Builder::default()
        .plugin(autostart::plugin())
        .plugin(tauri_plugin_power_monitor::init())
        .plugin(power::plugin())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !autostart::requested(args) {
                let _ = desktop::open(app);
            }
        }))
        .manage(desktop::DesktopState::default())
        .manage(media::MediaState::default())
        .on_window_event(desktop::closing)
        .setup(move |app| {
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
            scene_layout::install(app.handle(), background_launch);
            let _ = desktop::install(app.handle());
            if background_launch && !app.state::<desktop::DesktopState>().tray_available() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            let _ = media::install(app.handle());
            Ok(())
        })
        .manage(source::Source::default())
        .manage(wave_feedback::Delivery::default())
        .manage(feedback::Feedback::default())
        .manage(auth::Auth::default())
        .manage(matcher::Matcher::default())
        .manage(window_mode::WindowMode::default())
        .manage(scenes::Scenes::default())
        .manage(mirror_probe::MirrorProbe::default())
        .manage(player_host::Host::default())
        .invoke_handler(tauri::generate_handler![
            source_fetch,
            scenes::scene_window,
            scenes::scene_windows,
            scene_layout::scene_test_connected,
            scene_layout::scene_layout_status,
            scenes::scene_publish,
            scenes::scene_snapshot,
            scenes::scene_control,
            monitors::monitor_list,
            mirror_probe::mirror_probe,
            player_host::player_host_status,
            player_host::player_host_load,
            player_host::player_host_ready,
            player_host::player_host_command,
            player_host::player_host_event,
            player_host::player_host_mirror,
            wave_feedback::wave_sync,
            source_stations,
            autostart::autostart_status,
            diagnostics::diagnostics_status,
            auth::auth_command,
            autostart::autostart_set,
            smart_history::smart_history_fetch,
            media::media_update,
            media::media_status,
            desktop::desktop_action,
            desktop::desktop_status,
            desktop::desktop_close,
            catalogue_search,
            catalogue_collection,
            library::library_overview,
            discovery::discovery_fetch,
            feedback::feedback_command,
            storage::storage_command,
            search_videos,
            window_mode::window_mini,
            window_mode::window_topmost,
            window_mode::window_topmost_state,
            window_mode::window_test_monitor
        ])
        .build(context)
        .expect("failed to build YCore Music")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Ok(store) = &app.state::<storage::StorageState>().store {
                    let _ = store.finish_open();
                }
            }
        });
}
