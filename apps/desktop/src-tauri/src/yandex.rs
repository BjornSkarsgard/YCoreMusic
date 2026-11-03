//! Isolated session probe; no playback feedback or persistent credentials.
use reqwest::{blocking::Client, header::HeaderValue};
use serde_json::Value;
use std::io::Read;
use zeroize::Zeroizing;

pub fn authorization(token: &str) -> Result<HeaderValue, &'static str> {
    if token.is_empty() || token.len() > 4096 || !token.bytes().all(|c| c.is_ascii_graphic()) {
        return Err("Invalid token format");
    }
    let text = Zeroizing::new(format!("OAuth {token}"));
    let mut value = HeaderValue::from_str(&text).map_err(|_| "Invalid token format")?;
    value.set_sensitive(true);
    Ok(value)
}
pub fn request(
    client: &Client,
    path: &str,
    auth: &HeaderValue,
    body: Option<&Value>,
) -> Result<Value, &'static str> {
    let url = format!("https://api.music.yandex.net/{path}");
    let builder = match body {
        Some(body) => client.post(&url).json(body),
        None => client.get(&url),
    };
    let response = builder
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
pub fn ordered_ids(json: &Value) -> Result<Vec<String>, &'static str> {
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
pub fn session_id(json: &Value) -> Result<&str, &'static str> {
    let id = json
        .pointer("/result/radioSessionId")
        .and_then(Value::as_str)
        .ok_or("Missing session ID")?;
    if id.is_empty()
        || id.len() > 256
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err("Unexpected session ID format");
    }
    Ok(id)
}
pub fn session_batch(json: &Value) -> Result<Vec<String>, &'static str> {
    if json
        .pointer("/result/unknownSession")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return Err("Server no longer recognizes session");
    }
    if json.pointer("/result/terminated").and_then(Value::as_bool) == Some(true) {
        return Err("Server terminated session");
    }
    let ids = ordered_ids(json)?;
    if ids.is_empty() {
        return Err("Empty session batch");
    }
    Ok(ids)
}
pub fn print_batch(batch: usize, ids: &[String], offset: usize) {
    println!(
        "Batch {batch}: {} tracks, server order (duplicates retained)",
        ids.len()
    );
    for (index, id) in ids.iter().enumerate() {
        println!("{}: {}", offset + index + 1, id);
    }
}
pub fn session_probe(client: &Client, auth: &HeaderValue) -> Result<(), &'static str> {
    let first = request(
        client,
        "rotor/session/new",
        auth,
        Some(&serde_json::json!({
            "seeds": ["user:onyourwave"], "includeTracksInResponse": true
        })),
    )?;
    let id = session_id(&first)?;
    let mut batch = session_batch(&first)?;
    println!("New session: PASS (ID withheld); no autoplay");
    let mut received = batch.clone();
    print_batch(1, &batch, 0);
    for number in 2..=10 {
        let next = request(
            client,
            &format!("rotor/session/{id}/tracks"),
            auth,
            Some(&serde_json::json!({"queue": received})),
        )?;
        let ids = session_batch(&next)?;
        if ids == batch {
            return Err("Identical batch repeated; stopped without simulating playback");
        }
        print_batch(number, &ids, received.len());
        received.extend(ids.iter().cloned());
        batch = ids;
        if received.len() >= 20 {
            println!("Session fetch: PASS ({} ordered entries across {number} batches). S1 remains PARTIAL pending playback/lifecycle integration.", received.len());
            return Ok(());
        }
    }
    Err("Request budget reached before 20 entries; stopped")
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

    #[test]
    fn session_ids_cannot_modify_request_path() {
        assert_eq!(
            session_id(&json!({"result":{"radioSessionId":"session-123_abc"}})).unwrap(),
            "session-123_abc"
        );
        for id in ["", "../feedback", "abc?x=1", "abc/def", "abc%2Fdef"] {
            assert!(session_id(&json!({"result":{"radioSessionId":id}})).is_err());
        }
        assert!(session_id(&json!({"result":{}})).is_err());
    }
    #[test]
    fn unusable_session_is_not_treated_as_an_empty_valid_queue() {
        for fixture in [
            json!({"result":{"unknownSession":true,"sequence":[]}}),
            json!({"result":{"terminated":true,"sequence":[]}}),
            json!({"result":{"sequence":[]}}),
            json!({"result":{}}),
        ] {
            assert!(session_batch(&fixture).is_err());
        }
        assert_eq!(
            session_batch(&json!({"result":{"sequence":[{"track":{"id":"42"}}]}})).unwrap(),
            ["42"]
        );
    }
}
