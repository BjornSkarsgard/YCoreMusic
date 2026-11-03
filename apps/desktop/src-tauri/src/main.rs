#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[allow(dead_code)]
mod credentials;
mod matcher;
mod source;
mod window_mode;
#[allow(dead_code)]
mod yandex;
#[tauri::command]
async fn source_fetch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, source::Source>,
    fresh: bool,
) -> Result<Vec<source::Track>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let source = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || source::fetch(&source, fresh))
        .await
        .map_err(|_| "Source worker failed".to_string())?
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
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .manage(source::Source::default())
        .manage(matcher::Matcher::default())
        .manage(window_mode::WindowMode::default())
        .invoke_handler(tauri::generate_handler![
            source_fetch,
            search_videos,
            window_mode::window_mini,
            window_mode::window_topmost,
            window_mode::window_topmost_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Encore");
}
