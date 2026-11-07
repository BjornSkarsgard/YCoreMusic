use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub struct Identity {
    loaded: AtomicBool,
    applied: AtomicBool,
    media_capabilities_disabled: AtomicBool,
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
        "applied":state.applied.load(Ordering::Acquire),
        "mediaCapabilitiesDisabled":state.media_capabilities_disabled.load(Ordering::Acquire)
    }))
}

#[cfg(target_os = "linux")]
pub fn isolated_profile(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if cfg!(debug_assertions) && app.state::<crate::storage::StorageState>().test_mode {
        std::env::var_os("YCORE_TEST_DATA_DIR")
            .map(|root| std::path::PathBuf::from(root).join("webview"))
    } else {
        None
    }
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn defer_main(
    context: &mut tauri::Context<tauri::Wry>,
) -> Option<tauri::utils::config::WindowConfig> {
    let window = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main" && window.create)?;
    let config = window.clone();
    window.create = false;
    Some(config)
}
#[cfg(not(all(target_os = "linux", feature = "linux-embed-referrer")))]
pub fn defer_main(
    _context: &mut tauri::Context<tauri::Wry>,
) -> Option<tauri::utils::config::WindowConfig> {
    None
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn extension_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = if app.state::<crate::storage::StorageState>().test_mode {
        std::env::var_os("YCORE_TEST_DATA_DIR").map(std::path::PathBuf::from)
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
    Ok(directory)
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn create_main(
    app: &tauri::AppHandle,
    config: &tauri::utils::config::WindowConfig,
) -> Result<(), String> {
    let directory = extension_directory(app)?;
    let builder = tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(|_| "Cannot prepare main window")?
        .extensions_path(directory);
    let builder = if let Some(profile) = isolated_profile(app) {
        builder.data_directory(profile)
    } else {
        builder
    };
    builder.build().map_err(|_| "Cannot create main window")?;
    Ok(())
}
#[cfg(not(all(target_os = "linux", feature = "linux-embed-referrer")))]
pub fn create_main(
    _app: &tauri::AppHandle,
    _config: &tauri::utils::config::WindowConfig,
) -> Result<(), String> {
    Err("WebKit identity adapter is unavailable".into())
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    configure_window(&window)
}

#[cfg(all(target_os = "linux", feature = "linux-embed-referrer"))]
pub fn configure_window(window: &WebviewWindow) -> Result<(), String> {
    use webkit2gtk::{glib::translate::ToGlibPtr, UserMessageExt, WebViewExt};
    unsafe extern "C" {
        fn ycore_webkit_configure_media(settings: *mut std::ffi::c_void) -> std::ffi::c_int;
    }
    let handle = window.app_handle().clone();
    window
        .with_webview(move |view| {
            let webview = view.inner();
            // WebKitGTK MediaCapabilities can leave YouTube's decoder selection
            // pending before a media source is attached. Standard MediaSource,
            // the real player, its network requests and decoders remain intact.
            if let Some(settings) = webview.settings() {
                let pointer: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;
                let disabled = unsafe { ycore_webkit_configure_media(pointer.cast()) } != 0;
                handle
                    .state::<Identity>()
                    .media_capabilities_disabled
                    .store(disabled, Ordering::Release);
            }
            webview.connect_user_message_received(move |_, message| {
                let state = handle.state::<Identity>();
                match message.name().as_deref() {
                    Some("ycore-embed-identity-loaded") => {
                        state.loaded.store(true, Ordering::Release)
                    }
                    Some("ycore-embed-identity-applied") => {
                        state.loaded.store(true, Ordering::Release);
                        state.applied.store(true, Ordering::Release)
                    }
                    _ => return false,
                }
                true
            });
        })
        .map_err(|_| "Cannot configure WebKit identity".into())
}

#[cfg(not(all(target_os = "linux", feature = "linux-embed-referrer")))]
pub fn install(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
