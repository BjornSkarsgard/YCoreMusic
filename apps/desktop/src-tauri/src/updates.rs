use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str =
    "https://github.com/BjornSkarsgard/YCoreMusic/releases/latest/download/latest.json";
const PUBLIC_KEY: &str = include_str!("../updater-public.key");

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    revision: u64,
    phase: Phase,
    version: Option<String>,
    notes: String,
    downloaded: u64,
    total: Option<u64>,
    error: Option<&'static str>,
}
#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    #[default]
    Idle,
    Disabled,
    Checking,
    Current,
    Unpublished,
    Available,
    Downloading,
    Ready,
    Installing,
    Error,
}
impl Phase {
    fn busy(self) -> bool {
        matches!(self, Self::Checking | Self::Downloading | Self::Installing)
    }
}
#[derive(Default)]
struct Session {
    status: Status,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
#[derive(Default)]
pub struct Updates(Mutex<Session>);
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Read,
    Check,
    Download,
    Install,
}

fn trusted_asset(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url
            .path()
            .starts_with("/BjornSkarsgard/YCoreMusic/releases/download/")
        && url
            .path_segments()
            .is_some_and(|segments| segments.count() == 6)
}
fn publish(app: &tauri::AppHandle, state: &Updates) -> Status {
    let status = state
        .0
        .lock()
        .map(|session| session.status.clone())
        .unwrap_or_default();
    let _ = app.emit_to("main", "updates-status", &status);
    status
}
fn failure(session: &mut Session, code: &'static str) {
    session.status.phase = Phase::Error;
    session.status.error = Some(code);
}

enum CheckResult {
    Unpublished,
    Release(Option<Box<Update>>),
}
async fn check(app: &tauri::AppHandle) -> tauri_plugin_updater::Result<CheckResult> {
    // The plugin maps every non-success HTTP status to ReleaseNotFound. Distinguish
    // a genuinely absent first release from a server failure before displaying it.
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?
        .head(ENDPOINT)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(CheckResult::Unpublished);
    }
    response.error_for_status()?;
    let before_exit = app.clone();
    let updater = app
        .updater_builder()
        .pubkey(PUBLIC_KEY.trim())
        .endpoints(vec![ENDPOINT.parse()?])?
        .timeout(Duration::from_secs(30))
        .on_before_exit(move || crate::desktop::prepare_exit(&before_exit))
        .build()?;
    Ok(CheckResult::Release(updater.check().await?.map(Box::new)))
}

#[tauri::command]
pub async fn updates_command(window: WebviewWindow, action: Action) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted update request".into());
    }
    let app = window.app_handle().clone();
    let state = app.state::<Updates>();
    if app.state::<crate::storage::StorageState>().test_mode {
        return Ok(Status {
            phase: Phase::Disabled,
            ..Default::default()
        });
    }
    if matches!(action, Action::Read) {
        return Ok(publish(&app, &state));
    }
    let update = {
        let mut session = state.0.lock().map_err(|_| "Updater unavailable")?;
        if session.status.phase.busy() {
            return Ok(session.status.clone());
        }
        session.status.error = None;
        match action {
            Action::Check => {
                let revision = session.status.revision + 1;
                session.update = None;
                session.bytes = None;
                session.status = Status {
                    revision,
                    phase: Phase::Checking,
                    ..Default::default()
                };
            }
            Action::Download => {
                if session.update.is_none() {
                    return Err("No update selected".into());
                }
                session.bytes = None;
                session.status.revision += 1;
                session.status.phase = Phase::Downloading;
                session.status.downloaded = 0;
                session.status.total = None;
            }
            Action::Install => {
                if session.update.is_none() || session.bytes.is_none() {
                    return Err("Download the update first".into());
                }
                if crate::media::playback_busy(&app) {
                    session.status.phase = Phase::Ready;
                    session.status.error = Some("playback_active");
                    session.status.revision += 1;
                    return Ok(session.status.clone());
                }
                session.status.phase = Phase::Installing;
                session.status.revision += 1;
            }
            Action::Read => unreachable!(),
        }
        session.update.clone()
    };
    publish(&app, &state);
    match action {
        Action::Check => {
            let result = check(&app).await;
            let mut session = state.0.lock().map_err(|_| "Updater unavailable")?;
            match result {
                Ok(CheckResult::Release(Some(mut update)))
                    if trusted_asset(&update.download_url) =>
                {
                    update.timeout = Some(Duration::from_secs(600));
                    session.status.phase = Phase::Available;
                    session.status.version = Some(update.version.clone());
                    session.status.notes = update
                        .body
                        .as_deref()
                        .unwrap_or("")
                        .chars()
                        .take(12000)
                        .collect();
                    session.update = Some(*update);
                }
                Ok(CheckResult::Release(Some(_))) => failure(&mut session, "untrusted_asset"),
                Ok(CheckResult::Release(None)) => session.status.phase = Phase::Current,
                Ok(CheckResult::Unpublished) => session.status.phase = Phase::Unpublished,
                Err(
                    tauri_plugin_updater::Error::TargetNotFound(_)
                    | tauri_plugin_updater::Error::TargetsNotFound(_),
                ) => failure(&mut session, "platform_unavailable"),
                Err(_) => failure(&mut session, "check_failed"),
            }
        }
        Action::Download => {
            let result = update
                .ok_or("No update selected")?
                .download(
                    |chunk, total| {
                        if let Ok(mut session) = state.0.lock() {
                            session.status.downloaded =
                                session.status.downloaded.saturating_add(chunk as u64);
                            session.status.total = total;
                        }
                        // UI reads at 1Hz; avoid an event for every network chunk.
                    },
                    || {},
                )
                .await;
            let mut session = state.0.lock().map_err(|_| "Updater unavailable")?;
            match result {
                Ok(bytes) => {
                    session.bytes = Some(bytes);
                    session.status.phase = Phase::Ready;
                }
                Err(_) => failure(&mut session, "download_or_signature_failed"),
            }
        }
        Action::Install => {
            let update = update.ok_or("No update selected")?;
            let handle = app.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                // Check again after dispatch, before the installer can change files.
                if crate::media::playback_busy(&handle) {
                    return Err("playback_active");
                }
                let bytes = handle
                    .state::<Updates>()
                    .0
                    .lock()
                    .map_err(|_| "install_failed")?
                    .bytes
                    .take()
                    .ok_or("install_failed")?;
                update.install(bytes).map_err(|_| "install_failed")
            })
            .await
            .unwrap_or(Err("install_failed"));
            match result {
                Ok(()) => {
                    crate::desktop::prepare_exit(&app);
                    app.restart();
                }
                Err("playback_active") => {
                    let mut session = state.0.lock().map_err(|_| "Updater unavailable")?;
                    session.status.phase = Phase::Ready;
                    session.status.error = Some("playback_active");
                }
                Err(code) => {
                    let mut session = state.0.lock().map_err(|_| "Updater unavailable")?;
                    failure(&mut session, code);
                }
            }
        }
        Action::Read => unreachable!(),
    }
    state
        .0
        .lock()
        .map_err(|_| "Updater unavailable")?
        .status
        .revision += 1;
    Ok(publish(&app, &state))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packaged_updater_pins_the_same_key_and_requires_version_bound_signatures() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["updater"]["pubkey"], PUBLIC_KEY.trim());
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
        assert_eq!(
            config["plugins"]["updater"]["windows"]["installMode"],
            "quiet"
        );
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            serde_json::json!([ENDPOINT])
        );
    }
    #[test]
    fn update_downloads_are_limited_to_our_https_release_assets() {
        for url in [
            "http://github.com/BjornSkarsgard/YCoreMusic/releases/download/v1/a.exe",
            "https://github.com.evil.test/BjornSkarsgard/YCoreMusic/releases/download/v1/a.exe",
            "https://github.com/other/repo/releases/download/v1/a.exe",
            "https://github.com/BjornSkarsgard/YCoreMusic/releases/download/v1/a.exe?redirect=evil",
            "https://user@github.com/BjornSkarsgard/YCoreMusic/releases/download/v1/a.exe",
        ] {
            assert!(!trusted_asset(&url.parse().unwrap()));
        }
        assert!(trusted_asset(
            &"https://github.com/BjornSkarsgard/YCoreMusic/releases/download/v1.0.0/YCoreMusic.exe"
                .parse()
                .unwrap()
        ));
    }
}

/// Verifies a harmless signed fixture without a network request or installation.
#[tauri::command]
pub fn updates_verify_probe(
    window: WebviewWindow,
    version: String,
    signature: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    if !cfg!(debug_assertions)
        || window.label() != "main"
        || !window.state::<crate::storage::StorageState>().test_mode
        || version.len() > 64
        || signature.len() > 4096
        || bytes.len() > 65536
    {
        return Err("Signature verification probe is restricted to isolated debug tests".into());
    }
    let updater = window
        .app_handle()
        .updater_builder()
        .pubkey(PUBLIC_KEY.trim())
        .target("signature-probe")
        .endpoints(vec![ENDPOINT.parse().map_err(|_| "Invalid endpoint")?])
        .map_err(|_| "Invalid probe endpoint")?
        .build()
        .map_err(|_| "Cannot initialize verifier")?;
    let raw = serde_json::json!({"version":version,"platforms":{"signature-probe":{"url":"https://github.com/BjornSkarsgard/YCoreMusic/releases/download/fixture/never-install.txt","signature":signature}}});
    Ok(updater
        .restore_update(raw)
        .ok()
        .flatten()
        .is_some_and(|update| update.verify(&bytes).is_ok()))
}
