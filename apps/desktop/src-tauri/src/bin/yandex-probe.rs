//! Read-only legacy rotor probe; not a production My Wave adapter.
use reqwest::{blocking::Client, header::HeaderValue, redirect::Policy};
use serde_json::Value;
use std::{
    io::{self, IsTerminal, Read, Write},
    time::Duration,
};
use zeroize::Zeroizing;

fn authorization(token: &str) -> Result<HeaderValue, &'static str> {
    if token.is_empty() || token.len() > 4096 || !token.bytes().all(|c| c.is_ascii_graphic()) {
        return Err("Invalid token format");
    }
    let text = Zeroizing::new(format!("OAuth {token}"));
    let mut value = HeaderValue::from_str(&text).map_err(|_| "Invalid token format")?;
    value.set_sensitive(true);
    Ok(value)
}
fn get(client: &Client, path: &str, auth: &HeaderValue) -> Result<Value, &'static str> {
    let response = client
        .get(format!("https://api.music.yandex.net/{path}"))
        .header("Authorization", auth.clone())
        .send()
        .map_err(|_| "Network/TLS error")?;
    match response.status().as_u16() {
        200 => {}
        401 | 403 => return Err("Authorization denied"),
        429 => return Err("Rate limited; retry later"),
        _ => return Err("Unexpected API HTTP status"),
    }
    let mut bytes = Vec::new();
    response
        .take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Response read error")?;
    if bytes.len() > 2_000_000 {
        return Err("Response too large");
    }
    let json: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid API JSON")?;
    if json.get("error").is_some() {
        return Err("API returned an error");
    }
    Ok(json)
}
fn ordered_ids(json: &Value) -> Result<Vec<String>, &'static str> {
    let sequence = json
        .pointer("/result/sequence")
        .and_then(Value::as_array)
        .ok_or("Unexpected rotor schema")?;
    sequence
        .iter()
        .map(|item| {
            let id = item.pointer("/track/id").ok_or("Missing track ID")?;
            let text = match id {
                Value::String(text) => text.clone(),
                Value::Number(n) => n.to_string(),
                _ => return Err("Invalid track ID"),
            };
            if text.is_empty() || text.len() > 64 || !text.bytes().all(|c| c.is_ascii_digit()) {
                return Err("Invalid track ID");
            }
            Ok(text)
        })
        .collect()
}
fn run() -> Result<(), &'static str> {
    if std::env::args_os().len() != 1 {
        return Err("No arguments accepted; token must be entered at the hidden prompt");
    }
    if !io::stdin().is_terminal() {
        return Err("Interactive terminal required; do not pipe tokens");
    }
    println!("Encore S1: read-only LEGACY rotor probe. No playback or feedback. No files written.");
    print!("Yandex OAuth token (hidden; enter locally, never in chat): ");
    io::stdout().flush().map_err(|_| "Terminal error")?;
    let token = Zeroizing::new(rpassword::read_password().map_err(|_| "Cannot read hidden input")?);
    let auth = authorization(&token)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .https_only(true)
        .build()
        .map_err(|_| "Cannot initialize HTTPS client")?;
    let status = get(&client, "account/status", &auth)?;
    if status.pointer("/result/account/uid").is_none() {
        return Err("Account not confirmed by API");
    }
    println!("Account request: PASS (identity withheld)");
    let batch = get(
        &client,
        "rotor/station/user:onyourwave/tracks?settings2=True",
        &auth,
    )?;
    let ids = ordered_ids(&batch)?;
    if ids.is_empty() {
        return Err("Empty rotor batch");
    }
    println!(
        "First batch: {} tracks. Server order preserved, including duplicates.",
        ids.len()
    );
    for (ordinal, id) in ids.iter().enumerate() {
        println!("{}: {}", ordinal + 1, id);
    }
    println!(
        "S1: PARTIAL only. Session creation, 20+ recommendations and next batch remain unverified."
    );
    Ok(())
}
fn main() {
    if let Err(message) = run() {
        eprintln!("Probe failed: {message}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn keeps_server_order_and_duplicates() {
        let fixture = json!({"result":{"sequence":[{"track":{"id":"3"}},{"track":{"id":1}},{"track":{"id":"3"}}]}});
        assert_eq!(ordered_ids(&fixture).unwrap(), ["3", "1", "3"]);
    }
    #[test]
    fn rejects_partial_or_untrusted_schema() {
        for fixture in [
            json!({}),
            json!({"result":{"sequence":[{"track":{"id":"<script>"}}]}}),
            json!({"result":{"sequence":[{}]}}),
        ] {
            assert!(ordered_ids(&fixture).is_err());
        }
    }
    #[test]
    fn secrets_are_sensitive_and_invalid_headers_rejected() {
        assert!(authorization("local-fixture").unwrap().is_sensitive());
        for token in ["", "abc\r\nX-Test: value", "with space"] {
            assert!(authorization(token).is_err());
        }
    }
}
