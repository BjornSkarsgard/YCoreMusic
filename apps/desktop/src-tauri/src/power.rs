use tauri::{
    plugin::{Builder, TauriPlugin},
    Listener,
};

// Called only on the event-loop thread: Windows execution state is thread-local.
pub fn request(playing: bool) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Power::{
            SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        };
        let flags = if playing {
            ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        // Does not prevent explicit sleep, shutdown or lock.
        SetThreadExecutionState(flags);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = playing;
}
pub fn plugin() -> TauriPlugin<tauri::Wry> {
    Builder::new("encore-power")
        .setup(|app, _| {
            for event in ["power-monitor://suspend", "power-monitor://resume"] {
                let handle = app.clone();
                app.listen(event, move |_| {
                    let _ = handle.run_on_main_thread(|| request(false));
                });
            }
            Ok(())
        })
        .on_event(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                request(false);
            }
        })
        .build()
}
