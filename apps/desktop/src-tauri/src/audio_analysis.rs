use tauri::WebviewWindow;

#[derive(Default)]
pub struct Analysis {
    #[cfg(all(target_os = "windows", feature = "audio-analysis"))]
    leases: std::sync::Mutex<std::collections::BTreeMap<String, std::time::Instant>>,
    #[cfg(all(target_os = "windows", feature = "audio-analysis"))]
    started: std::sync::atomic::AtomicBool,
}

#[tauri::command]
pub fn analysis_watch(window: WebviewWindow, active: bool) -> Result<(), String> {
    if !crate::scenes::is_scene(window.label()) {
        return Err("Untrusted window".into());
    }
    #[cfg(all(target_os = "windows", feature = "audio-analysis"))]
    {
        use std::{sync::atomic::Ordering, time::Instant};
        use tauri::Manager;
        let state = window.state::<Analysis>();
        let mut leases = state.leases.lock().map_err(|_| "Analysis unavailable")?;
        if active && window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
        {
            leases.insert(window.label().into(), Instant::now());
        } else {
            leases.remove(window.label());
        }
        drop(leases);
        if active && !state.started.swap(true, Ordering::AcqRel) {
            let app = window.app_handle().clone();
            std::thread::spawn(move || worker(app));
        }
        Ok(())
    }
    #[cfg(not(all(target_os = "windows", feature = "audio-analysis")))]
    {
        let _ = active;
        Err("Audio analysis is not available on this platform yet".into())
    }
}

#[cfg(all(target_os = "windows", feature = "audio-analysis"))]
fn targets(app: &tauri::AppHandle) -> Vec<tauri::WebviewWindow> {
    use tauri::Manager;
    let state = app.state::<Analysis>();
    let labels = if let Ok(mut leases) = state.leases.lock() {
        leases.retain(|_, seen| seen.elapsed() < std::time::Duration::from_secs(3));
        leases.keys().cloned().collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    labels
        .into_iter()
        .filter_map(|label| app.get_webview_window(&label))
        .filter(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true)
        })
        .collect()
}

#[cfg(all(target_os = "windows", feature = "audio-analysis"))]
fn worker(app: tauri::AppHandle) {
    use std::time::Duration;
    use tauri::{Emitter, Manager};
    loop {
        if app.webview_windows().is_empty() {
            return;
        }
        if targets(&app).is_empty() {
            std::thread::sleep(Duration::from_millis(250));
            continue;
        }
        // One capture and FFT for every visible subscriber. No per-window
        // decoder, endpoint changes, or transfer of raw PCM to WebViews.
        let result = crate::audio_capture::stream(
            &app,
            || targets(&app).is_empty(),
            |bands| {
                let frame = serde_json::json!({"available":true,"bands":bands.as_slice()});
                for window in targets(&app) {
                    let _ = window.emit("audio-analysis", &frame);
                }
            },
        );
        if let Err(error) = result {
            for window in targets(&app) {
                let _ = window.emit(
                    "audio-analysis",
                    serde_json::json!({"available":false,"error":error}),
                );
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}
