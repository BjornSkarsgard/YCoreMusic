use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path, time::Duration};
use tokio::task::JoinSet;
use tower::ServiceExt;

const ORIGIN: &str = "https://www.ycore-music.ru";

pub(crate) struct Relay {
    client: reqwest::Client,
    origin: String,
    credential: String,
}

#[derive(Deserialize)]
struct Job {
    id: String,
    action: String,
    token: Option<String>,
    body: Option<Value>,
}

#[derive(Serialize)]
struct Reply {
    id: String,
    status: u16,
    token: Option<String>,
    data: Option<Value>,
}

impl Relay {
    pub(crate) fn open(directory: &Path, test_mode: bool) -> Result<(Self, String), String> {
        let mut origin = ORIGIN.to_owned();
        let mut client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(6))
            .timeout(Duration::from_secs(30));
        if test_mode {
            origin = std::env::var("YCORE_REMOTE_TEST_ORIGIN").map_err(|_| "relay_unavailable")?;
        }
        if origin != ORIGIN {
            let url = url::Url::parse(&origin).map_err(|_| "relay_unavailable")?;
            if url.scheme() != "https"
                || url.host_str() != Some("127.0.0.1")
                || url.origin().ascii_serialization() != origin
            {
                return Err("relay_unavailable".into());
            }
            let pem =
                fs::read(directory.join("relay-test.pem")).map_err(|_| "relay_unavailable")?;
            let cert = reqwest::Certificate::from_pem(&pem).map_err(|_| "relay_unavailable")?;
            client = client.add_root_certificate(cert);
        }
        let client = client.build().map_err(|_| "relay_unavailable")?;
        let credential = installation_credential(directory)?;
        let id = Sha256::digest(credential.as_bytes());
        let page = format!("{origin}/remote/p/{id:x}/");
        Ok((
            Self {
                client,
                origin,
                credential,
            },
            page,
        ))
    }

    fn post(&self, action: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}/remote/v1/desktop/{action}", self.origin))
            .bearer_auth(&self.credential)
    }

    pub(crate) async fn online(&self) -> Result<(), String> {
        let result = self
            .post("online")
            .timeout(Duration::from_secs(8))
            .send()
            .await;
        if result.is_ok_and(|response| response.status() == StatusCode::NO_CONTENT) {
            Ok(())
        } else {
            Err("relay_unavailable".into())
        }
    }

    pub(crate) async fn run(self, router: Router) {
        let mut lookups = JoinSet::new();
        loop {
            while lookups.try_join_next().is_some() {}
            let response = self.post("poll").send().await;
            let job = match response {
                Ok(response) if response.status() == StatusCode::NO_CONTENT => continue,
                Ok(response)
                    if response.status() == StatusCode::OK
                        && response.content_length().is_some_and(|size| size <= 8192) =>
                {
                    response.json::<Job>().await.ok()
                }
                _ => None,
            };
            let Some(job) = job else {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            };
            let request = self.post("reply").timeout(Duration::from_secs(5));
            if matches!(
                job.action.as_str(),
                "search" | "history" | "music" | "lyrics"
            ) {
                if lookups.len() < 4 {
                    lookups.spawn(respond(router.clone(), job, request));
                } else {
                    let _ = request
                        .json(&Reply {
                            id: job.id,
                            status: 429,
                            token: None,
                            data: None,
                        })
                        .send()
                        .await;
                }
            } else {
                respond(router.clone(), job, request).await;
            }
        }
    }
}

async fn respond(router: Router, job: Job, request: reqwest::RequestBuilder) {
    let mut reply = Reply {
        id: job.id,
        status: 400,
        token: None,
        data: None,
    };
    if let Some(input) = relay_request(job.action.as_str(), job.token, job.body) {
        let response = router.oneshot(input).await.expect("Router is infallible");
        let (parts, body) = response.into_parts();
        reply.status = parts.status.as_u16();
        reply.token = parts
            .headers
            .get(header::SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        reply.data = to_bytes(body, 300 * 1024)
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    }
    let _ = request.json(&reply).send().await;
}

fn relay_request(
    action: &str,
    token: Option<String>,
    body: Option<Value>,
) -> Option<Request<Body>> {
    let method = match action {
        "pair" | "session" | "search" | "command" | "music" | "lyrics" => "POST",
        "state" | "history" => "GET",
        _ => return None,
    };
    let mut request = Request::builder()
        .method(method)
        .uri(format!("/api/{action}"));
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, token);
    }
    let body = if let Some(value) = body {
        request = request.header(header::CONTENT_TYPE, "application/json");
        Body::from(value.to_string())
    } else {
        Body::empty()
    };
    request.body(body).ok()
}

fn installation_credential(directory: &Path) -> Result<String, &'static str> {
    let path = directory.join("remote-relay-key");
    fs::create_dir_all(directory).map_err(|_| "device_store_unavailable")?;
    match fs::read_to_string(&path) {
        Ok(value) if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            return Ok(value)
        }
        Ok(_) => return Err("device_store_invalid"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("device_store_unavailable"),
    }
    let credential = crate::remote_auth::secret()?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "device_store_unavailable")?;
    if file
        .write_all(credential.as_bytes())
        .and_then(|_| file.sync_all())
        .is_err()
    {
        drop(file);
        let _ = fs::remove_file(path);
        return Err("device_store_unavailable");
    }
    Ok(credential)
}
