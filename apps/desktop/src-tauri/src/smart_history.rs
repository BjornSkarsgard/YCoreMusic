use crate::{
    feedback::Feedback,
    storage::{SmartCandidate, StorageState},
};
#[tauri::command]
pub async fn smart_history_fetch(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Feedback>,
    storage: tauri::State<'_, StorageState>,
) -> Result<Vec<SmartCandidate>, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let profile = state.profile();
    let store = storage.store.as_ref().map_err(|e| e.to_string())?.clone();
    tauri::async_runtime::spawn_blocking(move || store.smart_history(profile.as_ref()))
        .await
        .map_err(|_| "History worker failed".to_string())?
        .map_err(str::to_string)
}
