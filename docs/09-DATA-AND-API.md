# Данные, схема SQLite и API-контракты

Все таблицы и имена эндпоинтов ниже — **предлагаемый контракт v1**, согласовать в коде и миграциях. Не считать это готовой реализацией.

## SQLite
```sql
CREATE TABLE tracks (
  track_key TEXT PRIMARY KEY, yandex_id TEXT, title TEXT NOT NULL,
  artist TEXT NOT NULL, album TEXT, duration_ms INTEGER,
  cover_url TEXT, metadata_json TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE source_sessions (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, external_id TEXT,
  created_at TEXT NOT NULL, state_json TEXT
);
CREATE TABLE queue_items (
  id TEXT PRIMARY KEY, session_id TEXT, track_key TEXT NOT NULL,
  source_type TEXT NOT NULL, source_ordinal INTEGER, insertion_kind TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE play_events (
  id TEXT PRIMARY KEY, track_key TEXT NOT NULL, video_id TEXT,
  source_type TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
  listened_ms INTEGER NOT NULL DEFAULT 0, end_reason TEXT
);
CREATE TABLE track_feedback (
  track_key TEXT PRIMARY KEY, liked INTEGER, disliked INTEGER,
  quick_skip_count INTEGER NOT NULL DEFAULT 0, excluded_smart_history INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE feedback_outbox (
  id TEXT PRIMARY KEY, track_key TEXT NOT NULL, action TEXT NOT NULL,
  payload_json TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE video_candidates (
  track_key TEXT NOT NULL, video_id TEXT NOT NULL, score REAL,
  status TEXT, reason TEXT, checked_at TEXT,
  PRIMARY KEY (track_key, video_id)
);
CREATE TABLE video_favorites (
  track_key TEXT NOT NULL, video_id TEXT NOT NULL, added_at TEXT NOT NULL,
  last_used_at TEXT, PRIMARY KEY (track_key, video_id)
);
CREATE TABLE monitor_settings (
  monitor_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, credential_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT
);
```
- Добавить миграции и индексы на `play_events(track_key, started_at)`, `queue_items(session_id, source_ordinal)`.
- `track_key` — нормализованный стабильный ID, предпочтительно Yandex track ID + album/version при необходимости; не использовать только title+artist для уникальности.
- `app_settings` содержит volume, mute, repeat, selected_audio_endpoint_id, autostart, last UI state; **не хранить OAuth token открытым текстом**.
- История и видео-избранное постоянные; source session и текущая очередь восстанавливаются только в пределах согласованного lifecycle.

## REST (предложение)
| Method | Path | Назначение |
|---|---|---|
| GET | `/api/v1/state` | Полный snapshot |
| POST | `/api/v1/playback/commands` | play/pause/next/previous/seek/volume/mute/repeat |
| GET | `/api/v1/sources` | Доступные источники |
| POST | `/api/v1/sources/select` | Выбрать источник |
| GET | `/api/v1/queue` | Очередь |
| POST | `/api/v1/queue/actions` | now/next/append |
| GET | `/api/v1/history` | Фильтр/поиск/пагинация |
| DELETE | `/api/v1/history` | Очистка с подтверждением UI |
| POST | `/api/v1/tracks/{track_key}/feedback` | like/unlike/dislike/undo |
| GET | `/api/v1/tracks/{track_key}/videos` | Кандидаты и избранные |
| POST | `/api/v1/tracks/{track_key}/videos` | Добавить video ID |
| DELETE | `/api/v1/tracks/{track_key}/videos/{video_id}` | Удалить избранное |
| GET | `/api/v1/monitors` | Сцены и конфигурации |
| PATCH | `/api/v1/monitors/{monitor_id}` | Изменить настройки сцены |
| GET | `/api/v1/audio/devices` | Output endpoints |
| POST | `/api/v1/remote/pairing` | Начать pairing (локальный ПК) |
| POST | `/api/v1/remote/pairing/approve` | Одобрить запрос (локальный ПК) |
| GET | `/api/v1/remote/devices` | Доверенные устройства |
| DELETE | `/api/v1/remote/devices/{id}` | Отзыв доступа |
| WS | `/api/v1/events` | События/патчи состояния |
```

## Команда и событие
```json
{
  "command_id": "uuid", "type": "seek_absolute", "payload": {"position_ms": 72000},
  "expected_revision": 104
}
```
```json
{
  "event_id": "uuid", "revision": 105, "type": "playback_state_changed",
  "playback_generation": 19, "timestamp": "2026-11-03T12:00:00Z",
  "payload": {"status": "paused", "position_ms": 72000}
}
```
- У команд idempotency по `command_id`, валидация payload, structured errors, auth.
- WS `snapshot` при connect и `patch` при изменениях; versioning schema.
- Для seek/volume/queue использовать единую бизнес-логику вне транспорта.

## Хранение секретов
- Yandex OAuth token — Windows Credential Manager/DPAPI, доступ только backend/native bridge.
- Pairing credential — hash/защищённое хранилище, не в query string.
- Логи без токенов, URL с секретами, cookies и приватных данных.
