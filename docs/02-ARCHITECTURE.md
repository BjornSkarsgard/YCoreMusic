# Архитектура и ответственность компонентов

**Уточнение 2026-11-05 (REQ056):** описанная ниже исходная модель нескольких YouTube IFrame отменена пользователем. Целевая схема: единственный настоящий плеер + общая очередь/coordinator, дополнительные окна могут получать только локальное зеркало изображения без повторной загрузки видео. Сначала проверяется Windows DWM spike; не считать переносимость/hidden-window render доказанными. Muted-follower код ADR031/032 — прежний промежуточный срез, не образец дальнейшего развития.

## Предлагаемый стек (не гарантированный выбор)
- **Shell:** Tauri 2 (Windows 11), WebView2, TypeScript/Vite; окна на дисплеях, трей, жизненный цикл.
- **Backend sidecar:** Python 3.11+, FastAPI, WebSocket, SQLite, httpx; `yandex-music` (неофициальный), `ytmusicapi` (неофициальный).
- **Playback:** YouTube IFrame API в отдельных WebView2; общий playback coordinator с одним audio authority.
- **Windows native bridge:** SMTC, device enumeration/routing, Power Requests, WASAPI loopback. Для сложных API допустим небольшой Rust/C# native helper, если Python/TS недостаточны.
- **Fallback:** Electron только по ADR после spike, если Tauri/WebView2 принципиально не выполняет требования.

## Логические сервисы
```text
Windows Shell (Tauri)
 ├─ Window/Monitor Manager ── WebView2 Scene[monitor-id] × N
 │                            ├─ Video IFrame (mute except audio authority)
 │                            └─ Visualizer (WebGL/Canvas2D)
 ├─ Tray + SMTC + Power Manager + Audio Device Manager
 └─ Desktop UI ─┐
                ├── Commands / State / Events ── Playback Coordinator
Phone browser ─┘      (FastAPI HTTP + WebSocket)  ├─ Yandex Source Adapter
                                                  ├─ Queue/History/Feedback
                                                  ├─ YouTube Matcher/Overrides
                                                  ├─ Audio/Video Recovery
                                                  ├─ Monitor Scene State
                                                  └─ SQLite Repository
Windows audio process loopback ─ FFT ─ Audio Analysis Broadcaster ─ Scene × N
```

## Главные инварианты
1. **Один authoritative playback state** и один queue cursor; ни одно окно не выбирает следующий трек самостоятельно.
2. **Один audible player**; остальные IFrame должны быть muted, и это регулярно проверяется.
3. Каждая команда имеет уникальный `command_id`, ответ/ошибка; все клиенты получают authoritative state.
4. Каждый переход композиции увеличивает `playback_generation`; все поздние callback от старого поколения игнорируются.
5. Позиция времени относится к **YouTube video timeline**, а не длительности записи Яндекса.
6. Monitor ID — стабильная идентичность дисплея, не просто индекс Windows (индексы меняются).
7. Никакой API/UI клиент не получает Yandex OAuth token.

## State machine
```text
APP: BOOTING → READY_PAUSED → ACTIVE ↔ PAUSED → STOPPING
SOURCE: MY_WAVE | LIKES | PLAYLIST | ALBUM | ARTIST | SEARCH | MANUAL | SMART_HISTORY
TRACK: RESOLVING → VIDEO_READY | AUDIO_FALLBACK_READY | UNAVAILABLE
PLAYER: IDLE → LOADING → PLAYING ↔ PAUSED → BUFFERING → RECOVERING → FAILED
DEVICE: системная маршрутизация ОС; отдельное закрепление endpoint не требуется
MONITOR: VIDEO | VISUALIZER | OFF; plus DETACHED (temporary, no reassignment)
```
Не объединять `source_mode`, `repeat_mode`, `player_status`, `scene_mode` в один enum: это независимые измерения.

## Startup/shutdown
1. Tauri single-instance guard, splash.
2. Поднять backend sidecar, открыть SQLite/migrations, загрузить настройки, проверить native integrations.
3. Инициализировать токен/Яндекс (при наличии), новую My Wave-сессию на полном старте; не играть.
4. Найти мониторы, восстановить оконные конфигурации без переноса отключённых сцен.
5. Показать READY_PAUSED и актуальные состояния; начать фоновые prefetch.
6. Закрытие окна — hide; закрытие последнего — трей; Exit из трея — корректная остановка sidecar и освобождение power requests.

## IPC / threading
- UI↔backend: локальный loopback HTTP/WS с токеном сессии и проверкой Origin; телефон через отдельный LAN endpoint с авторизацией.
- Native helpers: минимальные типизированные команды; никаких shell-команд из пользовательского ввода.
- Времязависимые операции playback должны исполняться последовательно (single coordinator actor / async lock), с отменой предыдущего поколения.
- Долгие поиск/рекомендации/FFT/SQLite — вне UI thread.
- Не рассчитывать на гарантированный фоновой rAF для скрытых WebView2: видимость сцен и воспроизведение разделены.

## Модули (предложение)
`auth`, `yandex_adapter`, `source_session`, `queue`, `history`, `feedback`, `matcher`, `overrides`, `playback`, `youtube_bridge`, `audio_device`, `audio_analysis`, `monitor_manager`, `visualizers`, `remote_auth`, `remote_ws`, `settings`, `recovery`, `telemetry_local`.

## Код-качество
- Строгие TS-типы, Pydantic для API, миграции SQLite, тестируемые pure functions для очереди/ранжирования.
- Для интеграций внешних API: adapter interfaces + mock fixtures, без привязки доменной модели к сторонним объектам.
- Логи с `correlation_id`, `playback_generation`, `monitor_id`; редактирование секретов.
- При недостижимом требовании: ADR с доказательством, вариантами, влиянием на UX, без молчаливой замены.
