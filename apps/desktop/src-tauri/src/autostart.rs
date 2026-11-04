use serde::Serialize;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

pub const ARGUMENT: &str = "--encore-autostart";
pub fn requested<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    args.into_iter()
        .any(|argument| argument.as_ref() == std::ffi::OsStr::new(ARGUMENT))
}
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_autostart::Builder::new()
        .app_name(
            if cfg!(debug_assertions) && std::env::var_os("ENCORE_TEST_DATA_DIR").is_some() {
                "Encore Native Test"
            } else {
                "Encore"
            },
        )
        .args([ARGUMENT]);
    #[cfg(target_os = "macos")]
    let builder = builder.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    builder.build()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    can_change: bool,
}
fn allow_change(test_mode: bool) -> Result<(), &'static str> {
    if test_mode {
        Err("Autostart changes are disabled in isolated tests")
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn autostart_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::storage::StorageState>,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let can_change = !state.test_mode;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let enabled = app
            .autolaunch()
            .is_enabled()
            .map_err(|_| "Cannot read autostart setting".to_string())?;
        Ok(Status {
            enabled,
            can_change,
        })
    })
    .await
    .map_err(|_| "Autostart worker failed".to_string())?
}
#[tauri::command]
pub async fn autostart_set(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::storage::StorageState>,
    enabled: bool,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    allow_change(state.test_mode)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.autolaunch();
        if enabled {
            manager.enable()
        } else {
            manager.disable()
        }
        .map_err(|_| "Cannot change autostart setting".to_string())?;
        let enabled = manager
            .is_enabled()
            .map_err(|_| "Cannot verify autostart setting".to_string())?;
        Ok(Status {
            enabled,
            can_change: true,
        })
    })
    .await
    .map_err(|_| "Autostart worker failed".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordinary_launch_is_visible_and_only_the_exact_autostart_argument_requests_tray() {
        assert!(!requested(Vec::<String>::new()));
        assert!(!requested([
            "--encore-autostart=false",
            "--autostart",
            "encore-autostart"
        ]));
        assert!(requested(["--other", ARGUMENT]));
        assert!(requested([std::ffi::OsString::from(ARGUMENT)]));
    }
    #[test]
    fn isolated_native_tests_cannot_register_or_remove_real_autostart_entries() {
        assert!(allow_change(true).is_err());
        assert!(allow_change(false).is_ok());
    }
}
