//! OAuth callback stays native; no token or account identity crosses IPC.
use crate::{credentials, diagnostics, feedback::Feedback, storage::StorageState, yandex};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use zeroize::Zeroizing;

const CLIENT_ID: &str = "23cabbbdc6cd418abb4b39c32c41195d";
const LABEL: &str = "yandex-login";
const LIFETIME: Duration = Duration::from_secs(600);
#[derive(Clone, Copy, Default, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    Idle,
    Waiting,
    Checking,
    Connected,
    Cancelled,
    Expired,
    Denied,
    NetworkError,
    ServiceError,
    StoreError,
    TestMode,
}
#[derive(Default)]
struct Session {
    nonce: String,
    started: Option<Instant>,
    status: Status,
}
#[derive(Clone, Default)]
pub struct Auth(Arc<Mutex<Session>>);
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Begin,
    Status,
    Cancel,
    Disconnect,
}

fn callback(url: &Url, nonce: &str) -> Option<Result<Zeroizing<String>, Status>> {
    if url.scheme() != "https"
        || url.host_str() != Some("music.yandex.ru")
        || url.port().is_some()
        || url.path() != "/"
    {
        return None;
    }
    let params: Vec<_> =
        url::form_urlencoded::parse(url.fragment().unwrap_or_default().as_bytes()).collect();
    let one = |key: &str| {
        let mut values = params.iter().filter(|(name, _)| name == key);
        let first = values.next().map(|(_, value)| value.as_ref());
        if values.next().is_some() {
            None
        } else {
            first
        }
    };
    if nonce.is_empty() || one("state") != Some(nonce) {
        return Some(Err(Status::Denied));
    }
    if one("error").is_some() {
        return Some(Err(Status::Denied));
    }
    Some(
        one("access_token")
            .filter(|token| yandex::authorization(token).is_ok())
            .map(|token| Zeroizing::new(token.to_owned()))
            .ok_or(Status::Denied),
    )
}
fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.host_str().is_some_and(|host| {
            host == "yandex.ru"
                || host.ends_with(".yandex.ru")
                || host == "yandex.com"
                || host.ends_with(".yandex.com")
        })
}
fn active(session: &Session, nonce: &str) -> bool {
    session.nonce == nonce
        && matches!(session.status, Status::Waiting | Status::Checking)
        && session.started.is_some_and(|at| at.elapsed() < LIFETIME)
}
fn close(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}
fn close_attempt(app: &tauri::AppHandle, nonce: &str) {
    let state = app.state::<Auth>();
    if state.0.lock().is_ok_and(|session| session.nonce == nonce) {
        close(app);
    }
}
fn check(token: &str) -> Status {
    let Ok(client) = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .build()
    else {
        return Status::NetworkError;
    };
    let Ok(auth) = yandex::authorization(token) else {
        return Status::Denied;
    };
    match diagnostics::account_state(yandex::request(&client, "account/status", &auth, None)) {
        diagnostics::YandexState::Connected => Status::Connected,
        diagnostics::YandexState::AuthorizationDenied => Status::Denied,
        diagnostics::YandexState::NetworkUnavailable => Status::NetworkError,
        _ => Status::ServiceError,
    }
}
fn navigate(app: &tauri::AppHandle, state: &Auth, nonce: &str, url: &Url) -> bool {
    let Some(result) = callback(url, nonce) else {
        return allowed(url);
    };
    let Ok(mut session) = state.0.lock() else {
        return false;
    };
    if !active(&session, nonce) || session.status != Status::Waiting {
        return false;
    }
    let token = match result {
        Ok(token) => token,
        Err(status) => {
            session.status = status;
            drop(session);
            let app = app.clone();
            let nonce = nonce.to_owned();
            let _ = app
                .clone()
                .run_on_main_thread(move || close_attempt(&app, &nonce));
            return false;
        }
    };
    session.status = Status::Checking;
    drop(session);
    let app = app.clone();
    let state = state.clone();
    let nonce = nonce.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let verified = check(&token);
        if let Ok(mut session) = state.0.lock() {
            // Cancel, timeout or a newer attempt must defeat late validation.
            if !active(&session, &nonce) || session.status != Status::Checking {
                return;
            }
            session.status = if verified != Status::Connected {
                verified
            } else if app.state::<StorageState>().test_mode {
                Status::TestMode
            } else if credentials::save(&token).is_err() {
                Status::StoreError
            } else {
                app.state::<Feedback>().invalidate();
                Status::Connected
            };
        }
        let _ = app
            .clone()
            .run_on_main_thread(move || close_attempt(&app, &nonce));
    });
    false // Never render the callback URL/token in the WebView.
}

#[tauri::command]
pub async fn auth_command(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Auth>,
    action: Action,
) -> Result<Status, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let app = window.app_handle().clone();
    match action {
        Action::Begin => {
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes).map_err(|_| "Cannot start secure login")?;
            let nonce: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            {
                let mut session = state.0.lock().map_err(|_| "Login unavailable")?;
                if matches!(session.status, Status::Waiting | Status::Checking) {
                    return Ok(session.status);
                }
                *session = Session {
                    nonce: nonce.clone(),
                    started: Some(Instant::now()),
                    status: Status::Waiting,
                };
            }
            let mut url =
                Url::parse("https://oauth.yandex.ru/authorize").map_err(|_| "Login unavailable")?;
            url.query_pairs_mut().extend_pairs([
                ("response_type", "token"),
                ("client_id", CLIENT_ID),
                ("state", &nonce),
                ("force_confirm", "yes"),
            ]);
            let auth = state.inner().clone();
            let handler = app.clone();
            let navigation_nonce = nonce.clone();
            let login_directory = app
                .path()
                .app_cache_dir()
                .map_err(|_| "Cannot locate login profile")?
                .join("yandex-login");
            let popup = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(url))
                .title("Вход в Яндекс · YCore Music")
                .inner_size(520.0, 720.0)
                .incognito(true)
                .data_directory(login_directory)
                .additional_browser_args(
                    app.config()
                        .app
                        .windows
                        .first()
                        .and_then(|window| window.additional_browser_args.as_deref())
                        .unwrap_or_default(),
                )
                .devtools(false)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_navigation(move |url| navigate(&handler, &auth, &navigation_nonce, url))
                .build();
            match popup {
                Ok(popup) => {
                    let auth = state.inner().clone();
                    let status = auth.0.lock().map_err(|_| "Login unavailable")?.status;
                    if !matches!(status, Status::Waiting | Status::Checking) {
                        let _ = popup.destroy();
                        return Ok(status);
                    }
                    popup.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::CloseRequested { .. }
                                | tauri::WindowEvent::Destroyed
                        ) {
                            if let Ok(mut session) = auth.0.lock() {
                                if session.nonce == nonce
                                    && matches!(session.status, Status::Waiting | Status::Checking)
                                {
                                    session.status = Status::Cancelled;
                                }
                            }
                        }
                    });
                    Ok(status)
                }
                Err(_) => {
                    if let Ok(mut session) = state.0.lock() {
                        session.status = Status::ServiceError;
                    }
                    Err("Cannot open Yandex login".into())
                }
            }
        }
        Action::Status | Action::Cancel => {
            let mut session = state.0.lock().map_err(|_| "Login unavailable")?;
            if matches!(session.status, Status::Waiting | Status::Checking) {
                if matches!(action, Action::Cancel) {
                    session.status = Status::Cancelled;
                } else if session.started.is_some_and(|at| at.elapsed() >= LIFETIME) {
                    session.status = Status::Expired;
                }
            }
            let status = session.status;
            let nonce = session.nonce.clone();
            drop(session);
            if matches!(status, Status::Cancelled | Status::Expired) {
                close_attempt(&app, &nonce);
            }
            Ok(status)
        }
        Action::Disconnect => {
            if app.state::<StorageState>().test_mode {
                return Ok(Status::TestMode);
            }
            let auth = state.inner().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut session = auth.0.lock().map_err(|_| "Login unavailable".to_string())?;
                credentials::forget().map_err(str::to_string)?;
                app.state::<Feedback>().invalidate();
                session.status = Status::Cancelled;
                let nonce = session.nonce.clone();
                drop(session);
                let _ = app
                    .clone()
                    .run_on_main_thread(move || close_attempt(&app, &nonce));
                Ok(Status::Idle)
            })
            .await
            .map_err(|_| "Login worker failed".to_string())?
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callbacks_require_exact_origin_path_state_and_single_token() {
        let parse = |text: &str| callback(&Url::parse(text).unwrap(), "nonce");
        assert!(
            parse("https://music.yandex.ru/#state=nonce&access_token=fixture")
                .unwrap()
                .is_ok()
        );
        for url in [
            "https://evil.test/verification_code#state=nonce&access_token=fixture",
            "https://oauth.yandex.ru.evil.test/verification_code#state=nonce&access_token=fixture",
            "http://oauth.yandex.ru/verification_code#state=nonce&access_token=fixture",
            "https://oauth.yandex.ru/other#state=nonce&access_token=fixture",
        ] {
            assert!(parse(url).is_none());
        }
        for fragment in [
            "state=wrong&access_token=fixture",
            "access_token=fixture",
            "state=nonce&state=nonce&access_token=fixture",
            "state=nonce&access_token=a&access_token=b",
            "state=nonce&access_token=a%0Ab",
            "state=nonce&error=access_denied",
        ] {
            assert_eq!(
                parse(&format!("https://music.yandex.ru/#{fragment}"))
                    .unwrap()
                    .unwrap_err(),
                Status::Denied
            );
        }
    }
    #[test]
    fn navigation_and_late_completion_guards() {
        assert!(allowed(
            &Url::parse("https://passport.yandex.ru/auth").unwrap()
        ));
        assert!(!allowed(
            &Url::parse("https://yandex.ru.evil.test/auth").unwrap()
        ));
        assert!(!allowed(
            &Url::parse("http://passport.yandex.ru/auth").unwrap()
        ));
        let mut session = Session {
            nonce: "current".into(),
            started: Some(Instant::now()),
            status: Status::Checking,
        };
        assert!(active(&session, "current"));
        assert!(!active(&session, "old"));
        session.status = Status::Cancelled;
        assert!(!active(&session, "current"));
        session.status = Status::Checking;
        session.started = Some(Instant::now() - LIFETIME);
        assert!(!active(&session, "current"));
        assert_eq!(
            serde_json::to_string(&Status::Connected).unwrap(),
            "\"connected\""
        );
    }
}
