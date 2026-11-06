use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub struct Identity {
    loaded: AtomicBool,
    applied: AtomicBool,
}

#[tauri::command]
pub fn embed_identity_status(window: WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let state = window.state::<Identity>();
    Ok(serde_json::json!({
        "supported":cfg!(all(target_os="linux",feature="linux-embed-referrer")),
        "loaded":state.loaded.load(Ordering::Acquire),
        "applied":state.applied.load(Ordering::Acquire)
    }))
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    use webkit2gtk::{glib::variant::ToVariant, UserMessageExt, WebContextExt, WebViewExt};
    let directory = if app.state::<crate::storage::StorageState>().test_mode {
        std::env::var_os("ENCORE_TEST_DATA_DIR").map(std::path::PathBuf::from)
    } else {
        app.path().app_cache_dir().ok()
    }
    .ok_or("Cannot locate WebKit helper directory")?
    .join("embed-identity");
    std::fs::create_dir_all(&directory).map_err(|_| "Cannot prepare WebKit helper directory")?;
    let target = directory.join("libycore-embed-identity.so");
    let temporary = directory.join("libycore-embed-identity.so.next");
    std::fs::write(
        &temporary,
        include_bytes!(concat!(env!("OUT_DIR"), "/libycore-embed-identity.so")),
    )
    .map_err(|_| "Cannot prepare WebKit identity helper")?;
    std::fs::rename(temporary, target).map_err(|_| "Cannot install WebKit identity helper")?;
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    let handle = app.clone();
    let identifier = app.config().identifier.clone();
    window
        .with_webview(move |view| {
            let webview = view.inner();
            webview.connect_user_message_received(move |_, message| {
                let state = handle.state::<Identity>();
                match message.name().as_deref() {
                    Some("ycore-embed-identity-loaded") => {
                        state.loaded.store(true, Ordering::Release)
                    }
                    Some("ycore-embed-identity-applied") => {
                        state.applied.store(true, Ordering::Release)
                    }
                    _ => return false,
                }
                true
            });
            if let Some(context) = webview.context() {
                context.set_web_extensions_directory(&directory.to_string_lossy());
                context.set_web_extensions_initialization_user_data(&identifier.to_variant());
                // The initial local UI may already have spawned a WebProcess. Start
                // its configured replacement before any player has been requested.
                webview.terminate_web_process();
                webview.reload();
            }
        })
        .map_err(|_| "Cannot configure WebKit identity".into())
}

#[cfg(not(all(target_os = "linux", feature = "linux-embed-referrer")))]
pub fn install(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
