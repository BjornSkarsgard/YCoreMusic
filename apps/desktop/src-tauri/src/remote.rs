use crate::remote_auth::{DeviceInfo, Pairing};
use crate::{
    catalogue::{self, Entity, Kind},
    source::Track,
};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};
use tokio::{
    sync::{watch, Semaphore},
    task::JoinHandle,
};

#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Playback {
    title: String,
    artist: String,
    playing: bool,
    position: f64,
    duration: f64,
    volume: u8,
    queue_generation: u64,
    queue: Vec<QueueItem>,
    repeat: String,
    clips: Vec<Clip>,
    #[serde(default)]
    music: Option<MusicState>,
    #[serde(default, skip_serializing)]
    lyrics_track_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct MusicState {
    stations: Vec<Station>,
    station: String,
    source: String,
    wave_status: String,
    wave_busy: bool,
    more: bool,
    muted: bool,
    track_like: Option<bool>,
    track_dislike: Option<bool>,
    clip_like: Option<bool>,
    video_id: Option<String>,
    undo_key: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct Station {
    id: String,
    title: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Clip {
    id: String,
    title: String,
    current: bool,
    views: Option<u64>,
    #[serde(rename = "durationSeconds")]
    duration_seconds: Option<u32>,
    #[serde(default, rename = "needsReview")]
    needs_review: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct QueueItem {
    ordinal: u64,
    title: String,
    artist: String,
    current: bool,
}

#[derive(Clone, Default, Serialize)]
struct Frame {
    revision: u64,
    lyrics_supported: bool,
    #[serde(flatten)]
    playback: Playback,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Control {
    Play,
    Pause,
    Next,
    Previous,
    Mute,
    Repeat,
    Queue {
        generation: u64,
        ordinal: u64,
    },
    Clip {
        generation: u64,
        ordinal: u64,
        id: String,
    },
    PlayResult {
        ticket: String,
        index: Option<usize>,
    },
    Wave {
        station: String,
    },
    More,
    UndoDislike {
        key: String,
    },
    Reaction {
        generation: u64,
        ordinal: u64,
        target: ReactionTarget,
        active: bool,
        video_id: Option<String>,
    },
    Seek {
        seconds: f64,
    },
    Volume {
        level: u8,
    },
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReactionTarget {
    Like,
    Dislike,
    Clip,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    id: String,
    action: Control,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Selection {
    Catalogue {
        id: String,
        title: String,
        artist: String,
    },
    History {
        id: String,
        title: String,
        artist: String,
        video_id: String,
    },
    Track {
        track: Track,
    },
    Browse {
        entity: Entity,
    },
    List {
        tracks: Vec<Track>,
        title: String,
        entity: Option<Entity>,
        page: u32,
        has_more: bool,
    },
}

impl Selection {
    fn display(&self) -> (&str, &str) {
        match self {
            Self::Catalogue { title, artist, .. } | Self::History { title, artist, .. } => {
                (title, artist)
            }
            Self::Track { track } => (&track.title, &track.artist),
            Self::Browse { entity } => (&entity.title, &entity.subtitle),
            Self::List { title, .. } => (title, ""),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum MusicRequest {
    Search { query: String, page: u32 },
    Library,
    Chart,
    Collection { ticket: String, page: u32 },
}

struct MusicResults {
    title: String,
    groups: Vec<(&'static str, Vec<Selection>)>,
    list: Option<Selection>,
    has_more: bool,
}

fn browse(entities: Vec<Entity>) -> Vec<Selection> {
    entities
        .into_iter()
        .map(|entity| Selection::Browse { entity })
        .collect()
}

fn music_results(
    request: MusicRequest,
    entity: Option<Entity>,
) -> Result<MusicResults, &'static str> {
    match request {
        MusicRequest::Search { query, page } => {
            let result = catalogue::search(query.trim(), page)?;
            let has_more = !result.tracks.is_empty()
                || !result.artists.is_empty()
                || !result.albums.is_empty()
                || !result.playlists.is_empty();
            Ok(MusicResults {
                title: result.corrected.unwrap_or(query),
                groups: vec![
                    ("Исполнители", browse(result.artists)),
                    (
                        "Треки",
                        result
                            .tracks
                            .into_iter()
                            .map(|track| Selection::Track { track })
                            .collect(),
                    ),
                    ("Альбомы", browse(result.albums)),
                    ("Плейлисты", browse(result.playlists)),
                ],
                list: None,
                has_more,
            })
        }
        MusicRequest::Library => {
            let library = crate::library::overview()?;
            let likes = Entity {
                kind: Kind::Likes,
                id: "0".into(),
                owner: None,
                title: "Мне нравится".into(),
                subtitle: format!("Треков: {}", library.liked_count),
            };
            Ok(MusicResults {
                title: "Моя музыка".into(),
                groups: vec![
                    ("", browse(vec![likes])),
                    ("Мои плейлисты", browse(library.playlists)),
                ],
                list: None,
                has_more: false,
            })
        }
        MusicRequest::Chart => {
            let chart = crate::discovery::fetch()?;
            Ok(MusicResults {
                title: chart.title.clone(),
                groups: vec![("Подборки Яндекс Музыки", browse(chart.playlists))],
                list: Some(Selection::List {
                    tracks: chart.tracks,
                    title: chart.title,
                    entity: None,
                    page: 0,
                    has_more: false,
                }),
                has_more: false,
            })
        }
        MusicRequest::Collection { page, .. } => {
            let entity = entity.ok_or("Invalid catalogue entity")?;
            let result =
                catalogue::collection(entity.kind, &entity.id, entity.owner.as_deref(), page)?;
            Ok(MusicResults {
                title: entity.title.clone(),
                groups: Vec::new(),
                has_more: result.has_more,
                list: Some(Selection::List {
                    tracks: result.tracks,
                    title: entity.title.clone(),
                    entity: Some(entity),
                    page,
                    has_more: result.has_more,
                }),
            })
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
enum Dispatch {
    Control(Control),
    Selection(Selection),
}

struct Ticket {
    id: String,
    device_id: String,
    deadline: Instant,
    selection: Selection,
}

struct Gate {
    pairing: Pairing,
    recent: HashMap<String, VecDeque<String>>,
    tickets: VecDeque<Ticket>,
    next_offer: Instant,
}

struct Service {
    origin: String,
    gate: Mutex<Gate>,
    playback: watch::Sender<Frame>,
    lookup_slots: Arc<Semaphore>,
    history: Option<crate::storage::Store>,
    command: Box<dyn Fn(Dispatch) -> bool + Send + Sync>,
}

struct Running {
    service: Arc<Service>,
    task: JoinHandle<()>,
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Ok(mut gate) = self.service.gate.lock() {
            gate.pairing.stop();
        }
        self.task.abort();
    }
}

#[derive(Default)]
pub struct Remote(Mutex<Option<Running>>);

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Read,
    Start,
    Stop,
    Pair,
    Revoke { id: String },
}

#[derive(Default, Serialize)]
pub struct View {
    origin: Option<String>,
    qr_active: bool,
    devices: Vec<DeviceInfo>,
    qr_svg: Option<String>,
    pair_url: Option<String>,
}

fn token(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()
}

fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(serde_json::json!({"error": code}))).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pair {
    code: String,
}

async fn pair(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    Json(pair): Json<Pair>,
) -> Response {
    let Ok(mut gate) = service.gate.lock() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    if token(&headers).is_some_and(|token| gate.pairing.authorize(token).is_some()) {
        return error(StatusCode::CONFLICT, "already_paired");
    }
    if Instant::now() < gate.next_offer {
        return error(StatusCode::TOO_MANY_REQUESTS, "try_later");
    }
    gate.next_offer = Instant::now() + Duration::from_millis(350);
    match gate.pairing.redeem(&pair.code) {
        Ok(token) => ([(header::SET_COOKIE, token)], StatusCode::NO_CONTENT).into_response(),
        Err(code) => error(StatusCode::FORBIDDEN, code),
    }
}

fn authorized(service: &Service, token: &str) -> bool {
    service
        .gate
        .lock()
        .is_ok_and(|gate| gate.pairing.authorize(token).is_some())
}

async fn snapshot(State(service): State<Arc<Service>>, headers: HeaderMap) -> Response {
    if !token(&headers).is_some_and(|token| authorized(&service, token)) {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    }
    Json(service.playback.borrow().clone()).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LyricsRequest {
    generation: u64,
    ordinal: u64,
}

async fn current_lyrics(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    Json(request): Json<LyricsRequest>,
) -> Response {
    let Some(token) = token(&headers).filter(|token| authorized(&service, token)) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    let current = || {
        let frame = service.playback.borrow();
        let playback = &frame.playback;
        let id = playback.lyrics_track_id.as_ref()?;
        let track = playback.queue.iter().find(|item| item.current)?;
        (playback.queue_generation == request.generation && track.ordinal == request.ordinal)
            .then(|| (id.clone(), track.title.clone(), track.artist.clone()))
    };
    let Some(track) = current() else {
        return error(StatusCode::CONFLICT, "track_changed");
    };
    let Ok(slot) = service.lookup_slots.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "try_later");
    };
    let (id, title, artist) = track.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _slot = slot;
        crate::lyrics::search(Some(&id), &title, &artist)
    })
    .await;
    if !authorized(&service, token) {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    }
    if current().as_ref() != Some(&track) {
        return error(StatusCode::CONFLICT, "track_changed");
    }
    match result {
        Ok(Ok(lyrics)) => Json(lyrics).into_response(),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "lyrics_unavailable"),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Query {
    query: String,
}

fn publish_results(service: &Service, token: &str, selections: Vec<Selection>) -> Response {
    let Ok(mut gate) = service.gate.lock() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let Some(device) = gate.pairing.authorize(token) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    let device_id = device.id.clone();
    let mut rows = Vec::new();
    for selection in selections.into_iter().take(20) {
        let (title, artist) = selection.display();
        let mut row = serde_json::json!({"title":title,"artist":artist});
        let Ok(id) = gate.issue(&device_id, selection) else {
            return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
        };
        row["ticket"] = id.into();
        rows.push(row);
    }
    Json(rows).into_response()
}

impl Gate {
    fn issue(&mut self, device_id: &str, selection: Selection) -> Result<String, &'static str> {
        let id = crate::remote_auth::secret()?;
        let now = Instant::now();
        self.tickets.retain(|ticket| ticket.deadline > now);
        self.tickets.push_back(Ticket {
            id: id.clone(),
            device_id: device_id.to_owned(),
            deadline: now + Duration::from_secs(300),
            selection,
        });
        while self.tickets.len() > 640 {
            self.tickets.pop_front();
        }
        Ok(id)
    }

    fn selection(&self, device: &str, id: &str) -> Option<&Selection> {
        self.tickets
            .iter()
            .find(|ticket| {
                ticket.id == id && ticket.device_id == device && ticket.deadline > Instant::now()
            })
            .map(|ticket| &ticket.selection)
    }
}

fn publish_music(
    gate: &mut Gate,
    device: &str,
    result: MusicResults,
) -> Result<serde_json::Value, &'static str> {
    let mut groups = Vec::new();
    for (label, selections) in result.groups {
        let mut rows = Vec::new();
        for selection in selections {
            let (title, artist) = selection.display();
            let mut row = serde_json::json!({
                "title": title, "artist": artist,
                "browse": matches!(selection, Selection::Browse { .. }),
            });
            row["ticket"] = gate.issue(device, selection)?.into();
            rows.push(row);
        }
        if !rows.is_empty() {
            groups.push(serde_json::json!({"label": label, "rows": rows}));
        }
    }
    let mut list = None;
    if let Some(selection @ Selection::List { .. }) = result.list {
        if let Selection::List { tracks, .. } = &selection {
            let rows: Vec<_> = tracks
                .iter()
                .map(|track| serde_json::json!({"title": track.title, "artist": track.artist}))
                .collect();
            list =
                Some(serde_json::json!({"rows": rows, "ticket": gate.issue(device, selection)?}));
        }
    }
    Ok(
        serde_json::json!({"title": result.title, "groups": groups, "list": list, "has_more": result.has_more}),
    )
}

async fn music(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    Json(request): Json<MusicRequest>,
) -> Response {
    let Some(token) = token(&headers).filter(|token| authorized(&service, token)) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    if matches!(&request, MusicRequest::Search { query, page } if !(2..=100).contains(&query.trim().chars().count()) || *page > 1000)
    {
        return error(StatusCode::BAD_REQUEST, "invalid_query");
    }
    let entity = if let MusicRequest::Collection { ticket, .. } = &request {
        let Ok(gate) = service.gate.lock() else {
            return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
        };
        let entity = gate
            .pairing
            .authorize(token)
            .and_then(|device| gate.selection(&device.id, ticket));
        let Some(Selection::Browse { entity }) = entity else {
            return error(StatusCode::BAD_REQUEST, "result_expired");
        };
        Some(entity.clone())
    } else {
        None
    };
    let Ok(_slot) = service.lookup_slots.try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "try_later");
    };
    let result =
        match tauri::async_runtime::spawn_blocking(move || music_results(request, entity)).await {
            Ok(Ok(result)) => result,
            Ok(Err(reason))
                if reason.to_ascii_lowercase().contains("authorization")
                    || reason.to_ascii_lowercase().contains("credential") =>
            {
                return error(StatusCode::FORBIDDEN, "yandex_access_required");
            }
            _ => return error(StatusCode::SERVICE_UNAVAILABLE, "music_unavailable"),
        };
    let Ok(mut gate) = service.gate.lock() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let Some(device) = gate
        .pairing
        .authorize(token)
        .map(|device| device.id.clone())
    else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    match publish_music(&mut gate, &device, result) {
        Ok(value) => Json(value).into_response(),
        Err(code) => error(StatusCode::SERVICE_UNAVAILABLE, code),
    }
}

async fn search(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    Json(query): Json<Query>,
) -> Response {
    let Some(token) = token(&headers).filter(|token| authorized(&service, token)) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    let query = query.query.trim().to_owned();
    if !(2..=100).contains(&query.chars().count()) {
        return error(StatusCode::BAD_REQUEST, "invalid_query");
    }
    let Ok(_slot) = service.lookup_slots.try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "try_later");
    };
    match tauri::async_runtime::spawn_blocking(move || crate::catalogue::search(&query, 0)).await {
        Ok(Ok(results)) => publish_results(
            &service,
            token,
            results
                .tracks
                .into_iter()
                .take(20)
                .map(|track| Selection::Catalogue {
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                })
                .collect(),
        ),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "search_unavailable"),
    }
}

async fn history(State(service): State<Arc<Service>>, headers: HeaderMap) -> Response {
    let Some(token) = token(&headers).filter(|token| authorized(&service, token)) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    let Some(store) = service.history.clone() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "history_unavailable");
    };
    let Ok(_slot) = service.lookup_slots.try_acquire() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "try_later");
    };
    match tauri::async_runtime::spawn_blocking(move || store.history("", None)).await {
        Ok(Ok(entries)) => publish_results(
            &service,
            token,
            entries
                .into_iter()
                .take(20)
                .map(|entry| Selection::History {
                    id: entry.track_id,
                    title: entry.title,
                    artist: entry.artist,
                    video_id: entry.video_id,
                })
                .collect(),
        ),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "history_unavailable"),
    }
}

async fn control(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    Json(command): Json<Command>,
) -> Response {
    let Ok(mut gate) = service.gate.lock() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "unavailable");
    };
    let Some(device) = token(&headers).and_then(|token| gate.pairing.authorize(token)) else {
        return error(StatusCode::UNAUTHORIZED, "pair_required");
    };
    let device_id = device.id.clone();
    if gate
        .recent
        .get(&device_id)
        .is_some_and(|recent| recent.contains(&command.id))
    {
        return StatusCode::NO_CONTENT.into_response();
    }
    let valid = command.id.len() == 36
        && command
            .id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        && match command.action {
            Control::Seek { seconds } => seconds.is_finite() && (0.0..=86400.0).contains(&seconds),
            Control::Volume { level } => level <= 100,
            Control::PlayResult { ref ticket, .. } => {
                ticket.len() == 64 && ticket.bytes().all(|byte| byte.is_ascii_hexdigit())
            }
            Control::Queue {
                generation,
                ordinal,
            } => {
                let state = service.playback.borrow();
                generation == state.playback.queue_generation
                    && state
                        .playback
                        .queue
                        .iter()
                        .any(|entry| entry.ordinal == ordinal)
            }
            Control::Clip {
                generation,
                ordinal,
                ref id,
            } => {
                let frame = service.playback.borrow();
                generation == frame.playback.queue_generation
                    && frame
                        .playback
                        .queue
                        .iter()
                        .any(|entry| entry.current && entry.ordinal == ordinal)
                    && frame.playback.clips.iter().any(|clip| clip.id == *id)
            }
            Control::Wave { ref station } => service
                .playback
                .borrow()
                .playback
                .music
                .as_ref()
                .is_some_and(|music| {
                    !music.wave_busy && music.stations.iter().any(|item| item.id == *station)
                }),
            Control::More => service
                .playback
                .borrow()
                .playback
                .music
                .as_ref()
                .is_some_and(|music| music.more),
            Control::UndoDislike { ref key } => service
                .playback
                .borrow()
                .playback
                .music
                .as_ref()
                .is_some_and(|music| music.undo_key.as_ref() == Some(key)),
            Control::Reaction {
                generation,
                ordinal,
                target,
                ref video_id,
                ..
            } => {
                let frame = service.playback.borrow();
                generation == frame.playback.queue_generation
                    && frame
                        .playback
                        .queue
                        .iter()
                        .any(|entry| entry.current && entry.ordinal == ordinal)
                    && frame
                        .playback
                        .music
                        .as_ref()
                        .is_some_and(|music| match target {
                            ReactionTarget::Like => music.track_like.is_some(),
                            ReactionTarget::Dislike => music.track_dislike.is_some(),
                            ReactionTarget::Clip => {
                                music.clip_like.is_some()
                                    && video_id.is_some()
                                    && *video_id == music.video_id
                            }
                        })
            }
            _ => true,
        };
    if !valid {
        return error(StatusCode::BAD_REQUEST, "invalid_command");
    }
    let dispatch = match command.action {
        Control::PlayResult { ticket, index } => {
            let Some(selection) = gate.selection(&device_id, &ticket) else {
                return error(StatusCode::BAD_REQUEST, "result_expired");
            };
            let selection = match selection {
                Selection::Browse { .. } => {
                    return error(StatusCode::BAD_REQUEST, "invalid_command")
                }
                Selection::List {
                    tracks,
                    title,
                    entity,
                    page,
                    has_more,
                } => {
                    let index = index.unwrap_or(0);
                    if index >= tracks.len() {
                        return error(StatusCode::BAD_REQUEST, "invalid_command");
                    }
                    Selection::List {
                        tracks: tracks[index..].to_vec(),
                        title: title.clone(),
                        entity: entity.clone(),
                        page: *page,
                        has_more: *has_more,
                    }
                }
                _ => selection.clone(),
            };
            Dispatch::Selection(selection)
        }
        control => Dispatch::Control(control),
    };
    if !(service.command)(dispatch) {
        return error(StatusCode::SERVICE_UNAVAILABLE, "player_unavailable");
    }
    let recent = gate.recent.entry(device_id).or_default();
    recent.push_back(command.id);
    if recent.len() > 32 {
        recent.pop_front();
    }
    StatusCode::NO_CONTENT.into_response()
}

fn routes(service: Arc<Service>) -> Router {
    Router::new()
        .route("/api/pair", post(pair))
        .route("/api/session", post(session))
        .route("/api/state", get(snapshot))
        .route("/api/lyrics", post(current_lyrics))
        .route("/api/search", post(search))
        .route("/api/music", post(music))
        .route("/api/history", get(history))
        .route("/api/command", post(control))
        .layer(DefaultBodyLimit::max(4096))
        .layer(middleware::from_fn_with_state(
            service.clone(),
            renew_after_use,
        ))
        .with_state(service)
}

async fn session(State(service): State<Arc<Service>>, headers: HeaderMap) -> Response {
    if token(&headers).is_some_and(|token| authorized(&service, token)) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        error(StatusCode::UNAUTHORIZED, "pair_required")
    }
}

async fn renew_after_use(
    State(service): State<Arc<Service>>,
    request: Request,
    next: Next,
) -> Response {
    let token = match request.uri().path() {
        "/api/session" | "/api/command" | "/api/history" | "/api/search" | "/api/music"
        | "/api/lyrics" => token(request.headers()).map(str::to_owned),
        _ => None,
    };
    let mut response = next.run(request).await;
    let Some(token) = token.filter(|_| response.status().is_success()) else {
        return response;
    };
    let renewed = service
        .gate
        .lock()
        .is_ok_and(|mut gate| gate.pairing.renew(&token).unwrap_or(false));
    if let Ok(value) = token.parse() {
        if renewed {
            response.headers_mut().insert(header::SET_COOKIE, value);
        }
    }
    response
}

fn view(server: Option<&Running>) -> Result<View, String> {
    let Some(server) = server else {
        return Ok(View::default());
    };
    let gate = server.service.gate.lock().map_err(|_| "unavailable")?;
    Ok(View {
        origin: Some(server.service.origin.clone()),
        qr_active: gate.pairing.offer_active(),
        devices: gate.pairing.devices(),
        ..View::default()
    })
}

#[tauri::command]
pub async fn remote_command(window: WebviewWindow, action: Action) -> Result<View, String> {
    if window.label() != "main" {
        return Err("untrusted_window".into());
    }
    let app = window.app_handle().clone();
    let remote = app.state::<Remote>();
    if matches!(action, Action::Start) {
        if remote.0.lock().map_err(|_| "unavailable")?.is_some() {
            return Err("already_running".into());
        }
        let test_mode = app.state::<crate::storage::StorageState>().test_mode;
        let directory = if test_mode {
            std::env::var_os("YCORE_TEST_DATA_DIR")
                .map(PathBuf::from)
                .ok_or("device_store_unavailable")?
        } else {
            app.path()
                .app_data_dir()
                .map_err(|_| "device_store_unavailable")?
        };
        let (relay, origin) = crate::remote_relay::Relay::open(&directory, test_mode)?;
        relay.online().await?;
        let command_app = app.clone();
        let service = Arc::new(Service {
            origin,
            gate: Mutex::new(Gate {
                pairing: Pairing::open(directory.join("remote-devices.json"))?,
                recent: HashMap::new(),
                tickets: VecDeque::new(),
                next_offer: Instant::now(),
            }),
            playback: watch::channel(Frame::default()).0,
            lookup_slots: Arc::new(Semaphore::new(2)),
            history: app
                .state::<crate::storage::StorageState>()
                .store
                .as_ref()
                .ok()
                .cloned(),
            command: Box::new(move |action| {
                command_app
                    .emit_to("main", "remote-control", action)
                    .is_ok()
            }),
        });
        let mut guard = remote.0.lock().map_err(|_| "unavailable")?;
        if guard.is_some() {
            return Err("already_running".into());
        }
        let qr = offer(&service)?;
        let task = tokio::spawn(relay.run(routes(service.clone())));
        *guard = Some(Running { service, task });
        let mut result = view(guard.as_ref())?;
        result.qr_active = true;
        result.qr_svg = Some(qr.0);
        result.pair_url = Some(qr.1);
        return Ok(result);
    }
    let mut guard = remote.0.lock().map_err(|_| "unavailable")?;
    if matches!(action, Action::Stop) {
        *guard = None;
    }
    if matches!(action, Action::Read | Action::Stop) {
        return view(guard.as_ref());
    }
    let server = guard.as_ref().ok_or("not_running")?;
    let qr = match action {
        Action::Pair => Some(offer(&server.service)?),
        Action::Revoke { id } => {
            let mut gate = server.service.gate.lock().map_err(|_| "unavailable")?;
            gate.pairing.revoke(&id)?;
            gate.recent.remove(&id);
            gate.tickets.retain(|ticket| ticket.device_id != id);
            None
        }
        _ => unreachable!(),
    };
    let mut response = view(guard.as_ref())?;
    if let Some((svg, url)) = qr {
        response.qr_svg = Some(svg);
        response.pair_url = Some(url);
    }
    Ok(response)
}

fn offer(service: &Service) -> Result<(String, String), String> {
    let mut gate = service.gate.lock().map_err(|_| "unavailable")?;
    let url = format!("{}#pair={}", service.origin, gate.pairing.offer()?);
    let code = qrcode::QrCode::new(url.as_bytes()).map_err(|_| "qr_unavailable")?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(224, 224)
        .build();
    Ok((svg, url))
}

#[tauri::command]
pub fn remote_publish(window: WebviewWindow, playback: Playback) -> Result<(), String> {
    if window.label() != "main"
        || !playback.position.is_finite()
        || !playback.duration.is_finite()
        || playback.title.len() > 2048
        || playback.artist.len() > 2048
        || playback.volume > 100
        || playback.queue.len() > 120
        || playback
            .lyrics_track_id
            .as_ref()
            .is_some_and(|id| id.len() > 128)
        || playback
            .music
            .as_ref()
            .is_some_and(|music| music.stations.len() > 256 || music.wave_status.len() > 2048)
        || playback.clips.len() > 6
        || playback.clips.iter().any(|clip| {
            clip.title.len() > 2048
                || clip.id.len() != 11
                || !clip
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        || playback
            .queue
            .iter()
            .any(|item| item.title.len() > 2048 || item.artist.len() > 2048)
        || !matches!(playback.repeat.as_str(), "off" | "one" | "queue")
    {
        return Err("invalid_state".into());
    }
    if let Some(server) = window
        .state::<Remote>()
        .0
        .lock()
        .map_err(|_| "unavailable")?
        .as_ref()
    {
        server.service.playback.send_if_modified(|frame| {
            if frame.playback == playback {
                return false;
            }
            frame.playback = playback;
            frame.revision += 1;
            frame.lyrics_supported = true;
            true
        });
    }
    Ok(())
}
