use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    video_mirrors: bool,
    audio_analysis: bool,
}

/// Report implemented adapters, not a promise based on the OS name alone.
#[tauri::command]
pub fn platform_capabilities(window: tauri::WebviewWindow) -> Result<Capabilities, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    Ok(Capabilities {
        video_mirrors: crate::player_host::supported(),
        audio_analysis: crate::player_host::supported()
            && cfg!(all(target_os = "windows", feature = "audio-analysis")),
    })
}
