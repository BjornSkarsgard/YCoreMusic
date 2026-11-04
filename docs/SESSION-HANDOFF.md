# Активная работа Encore — 2026-11-04

Проект C:\Users\Skar\Documents\Encore, remote BjornSkarsgard/encore, main.

Пользователь вернулся после ночи и разрешил работать самостоятельно без участия, следуя документации. Выбран макет «Сцена». Ранее разрешено следить за пятичасовым лимитом: если после этапа остаётся >10%, сделать ещё несколько лёгких задач; при очень малом остатке завершить безопасный срез, сохранить контекст и выключить ПК. Сбросы лимита без запроса не расходовать. Ночью shutdown /s /t 0 уже был успешно принят ОС; сейчас идёт новая рабочая сессия.

## Последние завершённые этапы

- f97bff5: «Сцена», жанры, непрерывная Wave, bounded prefetch/skip/backoff/session renewal. CI всех четырёх платформ PASS.
- 1354fde: транспорт по центру; fullscreen HUD при движении мыши, скрытие через 3 секунды, hover/drag/клавиатурный фокус сохраняют видимость. Каталог: отдельная коллекция, Back/scroll/focus, пустые фильтры. Полный Windows native PASS.
- Текущий этап: личная медиатека, реакции/outbox/Undo, актуальные чарт/подборки, видимые альтернативные видео. Подробности в ADR-017/018 и IMPLEMENTATION-STATUS.md.

## Поведение текущего этапа

Моя музыка: свои + сохранённые плейлисты, любимые ID и metadata по 100, запуск списка/с места. Обзор: текущий чарт 100, редакционные подборки, Refresh; не выдавать редакционные подборки за ранжированный popular list. Просмотр не меняет плеер.

Like/unlike/dislike: account-scoped SQLite v2 с pending outbox, последнее желаемое состояние, revision guard на ACK/Undo; retry и refresh внешних состояний. Дизлайк немедленно Next; Undo 5 секунд не возвращает композицию. Перед миграцией v1 — VACUUM INTO snapshot backup рядом с БД. Токен только нативно OS store. Реальные feedback-записи в native-test запрещены; доставка реальным токеном в сервис ещё не проверена. Не менять предпочтения пользователя тестами.

Другие видео: постоянно внизу боковой панели, превью i.ytimg.com, исходное название, просмотры, durationSeconds; неизвестные поля подписаны. Выбор меняет клип той же песни, сохраняет pause/play и cursor, один IFrame. Сохраняется пока одна manual override. Сохранённый клип не ждёт фонового поиска альтернатив. Следующее из REQ-014: несколько favourites/random/no-repeat, включая repeat-one.

## Проверки текущего этапа

- TS/Vite, 7 unit PASS; renderer 32 PASS + 1 opt-in skipped. Последний точечный regression после текста реакций — проверить вывод текущей команды.
- Rust 25 app + 5 probe PASS, 9 opt-in ignored; Clippy all-targets -D warnings PASS.
- Live read-only: 43 плейлиста, 900 likes, metadata первой страницы 100; chart 100 + 4 editorial playlists; duration 5/5 video candidates.
- Full Windows native PASS с реальным Яндексом/каталогом/медиатекой/чартом/YouTube, CC/fullscreen/tray/media/simulated power/mini/topmost/single instance. После входа в fullscreen тест отводит мышь от HUD перед ожиданием скрытия: hover согласованно удерживает кнопки.
- Отдельный live native alternative switch PASS: настоящие Oasis Wonderwall варианты/превью, сохранён текущий трек и play intent, один IFrame, volume=0.
- Текущий normal debug executable собран; после последнего небольшого изменения текста reaction UI запущена повторная сборка.
- Native helper завершает только свой PID после доказанного testMode; однажды предыдущий isolated binary остался жить и блокировал линковку, он убран по проверенному пути native-test. Обычный пользовательский экземпляр не закрывался принудительно.

## Оставшееся по документации

1. Проверить статус нового CI после push и субъективный UX, когда пользователь вернётся. Работа не требует ждать его.
2. REQ-014 несколько favourites, миграция с сохранением старых manual links, random/no-repeat/repeat-one.
3. Длительный Wave soak, скрытое окно/fullscreen/сетевые сбои; два ускоренных реальных END-перехода ночного smoke не доказывают многочасовую устойчивость.
4. Недостающие локальные shortcuts из REQ-037 (Up/Down volume, F11) — небольшой следующий срез; текстовые поля/элементы управления сохраняют ввод, глобальных keyboard hooks нет.
5. Smart History/listened_ms, liked/disliked weighting, fallback; затем другие этапы roadmap. Не имитировать Yandex audio/FFT/mobile/multimonitor.

Linux/macOS runtime, физический sleep/wake, аппаратные media keys, слышимость и реальные feedback writes ещё не подтверждены. YouTube mandatory branding/load/pause overlays остаются; программное quality API no-op, ручное качество через временную панель YouTube.

## Воспроизведение

npm.cmd run build --prefix apps/desktop
npm.cmd test --prefix apps/desktop
npm.cmd run test:ui --prefix apps/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features yandex-probe
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --features yandex-probe -- -D warnings

Native-test: cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --profile native-test --features tauri/custom-protocol --bin encore; node scripts/native-smoke.mjs. Флаги ENCORE_LIVE_YANDEX/CATALOGUE/YOUTUBE/LIBRARY=1 для полного read-only набора; ENCORE_LIVE_ALTERNATIVES=1 — реальное переключение, ENCORE_LIVE_WAVE=1 — 2 END-перехода. Перед сборкой дождаться завершения своего native теста. Скриншоты .tools/native-alternatives.png, native-discovery.png, fullscreen-controls.png (ignored). Не запускать старый pending-update/apply.ps1: там pinned предыдущий executable.
