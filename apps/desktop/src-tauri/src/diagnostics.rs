use crate::{credentials, library, storage::StorageState, yandex};
use reqwest::{blocking::Client, redirect::Policy};
use serde::Serialize;
use std::time::Duration;
use tauri::Manager;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum YandexState {
    Saved,
    Connected,
    Missing,
    StoreUnavailable,
    AuthorizationDenied,
    NetworkUnavailable,
    RateLimited,
    ServiceUnavailable,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    version: String,
    platform: &'static str,
    architecture: &'static str,
    storage_available: bool,
    yandex: YandexState,
}
fn account_state(result: Result<serde_json::Value, &'static str>) -> YandexState {
    match result {
        Ok(value) => {
            let valid = value
                .pointer("/result/account/uid")
                .is_some_and(|uid| match uid {
                    serde_json::Value::String(id) => library::valid_id(id),
                    serde_json::Value::Number(id) => id.as_u64().is_some_and(|id| id > 0),
                    _ => false,
                });
            if valid {
                YandexState::Connected
            } else {
                YandexState::ServiceUnavailable
            }
        }
        Err("Authorization denied" | "Invalid token format") => YandexState::AuthorizationDenied,
        Err("Network/TLS error" | "Response read error") => YandexState::NetworkUnavailable,
        Err("Rate limited; retry later") => YandexState::RateLimited,
        Err(_) => YandexState::ServiceUnavailable,
    }
}
fn connection(check: bool) -> YandexState {
    let token = match credentials::load() {
        Ok(token) => token,
        Err(error) if error.starts_with("No saved token.") => return YandexState::Missing,
        Err(_) => return YandexState::StoreUnavailable,
    };
    if !check {
        return YandexState::Saved;
    }
    let auth = match yandex::authorization(&token) {
        Ok(auth) => auth,
        Err(_) => return YandexState::AuthorizationDenied,
    };
    let client = match Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return YandexState::NetworkUnavailable,
    };
    account_state(yandex::request(&client, "account/status", &auth, None))
}
#[tauri::command]
pub async fn diagnostics_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, StorageState>,
    check_yandex: bool,
) -> Result<Snapshot, String> {
    if window.label() != "main" {
        return Err("Untrusted window".into());
    }
    let version = window.app_handle().package_info().version.to_string();
    let storage_available = state.store.is_ok();
    tauri::async_runtime::spawn_blocking(move || Snapshot {
        version,
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        storage_available,
        yandex: connection(check_yandex),
    })
    .await
    .map_err(|_| "Diagnostics worker failed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_distinguish_auth_network_limits_and_malformed_accounts_without_returning_identity(
    ) {
        let actual = account_state(Ok(
            serde_json::json!({"result":{"account":{"uid":42,"login":"private-fixture","secret":"never-export"}}}),
        ));
        assert_eq!(actual, YandexState::Connected);
        assert_eq!(serde_json::to_string(&actual).unwrap(), "\"connected\"");
        assert_eq!(
            account_state(Ok(serde_json::json!({"result":{"account":{"uid":"123"}}}))),
            YandexState::Connected
        );
        assert_eq!(
            account_state(Ok(serde_json::json!({"result":{"account":{}}}))),
            YandexState::ServiceUnavailable
        );
        assert_eq!(
            account_state(Err("Authorization denied")),
            YandexState::AuthorizationDenied
        );
        assert_eq!(
            account_state(Err("Network/TLS error")),
            YandexState::NetworkUnavailable
        );
        assert_eq!(
            account_state(Err("Rate limited; retry later")),
            YandexState::RateLimited
        );
    }
}
