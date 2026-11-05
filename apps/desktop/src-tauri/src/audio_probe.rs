//! Isolated S6 experiment: only this application's process tree, no microphone,
//! endpoint-wide capture, routing changes or audio files. Not a product feature.
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub struct AudioProbeState {
    #[cfg(all(target_os = "windows", debug_assertions, feature = "audio-probe"))]
    pub(crate) muted: std::sync::Mutex<Vec<crate::audio_capture::Muted>>,
}
#[tauri::command]
pub async fn audio_probe_mute(
    window: WebviewWindow,
    muted: bool,
) -> Result<serde_json::Value, String> {
    if window.label() != "main"
        || !cfg!(debug_assertions)
        || !window.state::<crate::storage::StorageState>().test_mode
    {
        return Err("Audio verification is restricted to isolated debug tests".into());
    }
    #[cfg(all(target_os = "windows", debug_assertions, feature = "audio-probe"))]
    {
        let app = window.app_handle().clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            crate::audio_capture::mute_owned(&app, muted)
        })
        .await
        .map_err(|_| "Audio verification worker failed".to_string())?;
        Ok(match result {
            Ok(count) => serde_json::json!(count),
            Err(error) => {
                serde_json::json!({"verified":false,"code":format!("0x{:08X}",error.code().0 as u32)})
            }
        })
    }
    #[cfg(not(all(target_os = "windows", debug_assertions, feature = "audio-probe")))]
    {
        let _ = muted;
        Err("Build an isolated Windows audio-probe profile first".into())
    }
}

#[tauri::command]
pub async fn audio_probe(window: WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main"
        || !cfg!(debug_assertions)
        || !window.state::<crate::storage::StorageState>().test_mode
    {
        return Err("Audio verification is restricted to isolated debug tests".into());
    }
    #[cfg(all(target_os = "windows", debug_assertions, feature = "audio-probe"))]
    {
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn_blocking(move || crate::audio_capture::run(&app))
            .await
            .map_err(|_| "Audio verification worker failed".into())
    }
    #[cfg(not(all(target_os = "windows", debug_assertions, feature = "audio-probe")))]
    {
        Err("Build an isolated Windows audio-probe profile first".into())
    }
}
