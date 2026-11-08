//! Opt-in acceptance probe for the actual Mac WKWebView. Compiled into debug
//! builds only, and requires the isolated test profile plus an explicit flag.
use std::ffi::{c_char, c_void, CString};
use tauri::Manager;

unsafe extern "C" {
    fn ycore_macos_native_probe(webview: *mut c_void, directory: *const c_char);
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("YCORE_MACOS_NATIVE_PROBE").as_deref() != Ok("1") {
        return Ok(());
    }
    let directory = CString::new(std::env::var("YCORE_TEST_DATA_DIR")?)?;
    let main = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    main.with_webview(move |view| unsafe {
        ycore_macos_native_probe(view.inner(), directory.as_ptr());
    })?;
    Ok(())
}
