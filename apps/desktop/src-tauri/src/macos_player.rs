//! Bundled player on a private HTTP origin so WebKit sends a real Referer.
//! There is no native IPC, account data, or media forwarding on this origin.
use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use std::{
    fmt::Write,
    net::{Ipv4Addr, SocketAddrV4},
    sync::Mutex,
};
use tauri::{AppHandle, WebviewWindow};

const CSP: &str = "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'";

#[derive(Default)]
pub struct Page(Mutex<Option<String>>);

fn asset_path(path: &str, prefix: &str) -> Option<String> {
    let path = path.strip_prefix(prefix)?;
    if path == "player-host.html" {
        return Some(path.into());
    }
    let name = path.strip_prefix("assets/")?;
    if name.is_empty()
        || name.len() > 128
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || ![".js", ".css", ".svg", ".png"]
            .iter()
            .any(|ext| name.ends_with(ext))
    {
        return None;
    }
    Some(path.into())
}

fn serve(app: &AppHandle, host: &str, prefix: &str, request: Request<Body>) -> Response {
    if request.method() != axum::http::Method::GET
        || request
            .headers()
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            != Some(host)
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(path) = asset_path(request.uri().path(), prefix) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let document = path == "player-host.html";
    let Some(mut asset) = app.asset_resolver().get(path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if document {
        let Ok(html) = String::from_utf8(asset.bytes) else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        asset.bytes = html.replace("\"/assets/", "\"./assets/").into_bytes();
    }
    (
        [
            (header::CONTENT_TYPE, asset.mime_type.as_str()),
            (header::CONTENT_SECURITY_POLICY, CSP),
            (header::REFERRER_POLICY, "strict-origin-when-cross-origin"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        asset.bytes,
    )
        .into_response()
}

#[tauri::command]
pub async fn macos_player_url(
    window: WebviewWindow,
    state: tauri::State<'_, Page>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Untrusted player controller".into());
    }
    let mut started = state.0.lock().map_err(|_| "Local player is unavailable")?;
    if let Some(url) = started.as_ref() {
        return Ok(url.clone());
    }
    let listener = std::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| "Cannot bind local player")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Cannot configure local player")?;
    let host = listener
        .local_addr()
        .map_err(|_| "Cannot read local player address")?
        .to_string();
    let mut key = [0; 16];
    getrandom::fill(&mut key).map_err(|_| "Cannot initialize local player")?;
    let mut prefix = String::from("/player/");
    for byte in key {
        write!(prefix, "{byte:02x}").expect("writing to a string cannot fail");
    }
    prefix.push('/');
    let url = format!("http://{host}{prefix}player-host.html");
    let listener =
        tokio::net::TcpListener::from_std(listener).map_err(|_| "Cannot start local player")?;
    let app = window.app_handle().clone();
    let routes = Router::new().fallback(move |request| {
        let (app, host, prefix) = (app.clone(), host.clone(), prefix.clone());
        async move { serve(&app, &host, &prefix, request) }
    });
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, routes).await;
    });
    *started = Some(url.clone());
    Ok(url)
}
