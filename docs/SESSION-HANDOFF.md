# Encore — активный контекст, 2026-11-04

Проект C:\Users\Skar\Documents\Encore, remote https://github.com/BjornSkarsgard/encore.git, main. Пользователь разрешил работать самостоятельно без участия и следовать документации. Не ждать очередного «дальше» после законченного этапа. Не использовать subagents без отдельного разрешения. Токен сохранён в OS credential store; никогда не читать/выводить в чат.

Пользователь просил следить за 5-часовым лимитом (tool get_usage_limits). Если осталось >10% после этапа — ещё несколько лёгких задач; при очень малом остатке закончить безопасный срез, сохранить контекст и выключить ПК обычным shutdown без /f. Reset credits без запроса не расходовать. Ночной shutdown /s /t0 уже выполнялся; сейчас новая рабочая сессия, пользователь задаёт дополнительные задачи. Последний лимит:72%used/28%remaining, weekly65%used. Перед завершением снова проверить. Новых вопросов/подтверждений не требуется.

## Последнее замечание пользователя

В Обзоре Play трека скрывал альтернативные видео на время загрузки и увеличивал высоту списка. Исправлено c516ff3: постоянный адаптивный слот160–220px (26vh), visibility:hidden при отсутствии вариантов, panel-scroll flex1. Regression с200 треками проверяет высоту/scrollTop до, во время и после delayed matching. Normal debug exe уже собран с этим исправлением и текущей SmartHistory.

## История готовых этапов

- f97bff5: Scene layout, жанры, unattended Wave/prefetch/skip/backoff/renewal. CI4OS PASS.
- 1354fde: транспорт по центру; fullscreen mouse HUD/idle; отдельная коллекция/Back. CI4OS PASS.
- 26bb9ee: личные собственные/сохранённые плейлисты, liked tracks, reactions/outbox/Undo, живой chart и editorial playlists, альтернативные клипы. CI4OS PASS.
- 3e39b5f: локальные Up/Down volume и F11; runner длинного hidden Wave soak.
- d306f82: SQLitev3 несколько favourites, actual last video, random/no-immediate-repeat/repeat-one, unavailable без удаления. Windows/Linux/macARM CI PASS; macIntel renderer timeout в fullscreen recovery.
- 6a64a3b: late fullscreenchange guard, quality-panel HUD stays accessible, manual clip heading, native PID cleanup. CI всех4OS PASS, исправлен вышеупомянутый timeout.
- c516ff3: фикс высоты Обзора, CI ещё шёл на последней проверке.
- Текущий рабочий этап SmartHistory завершает commit/push сейчас.

## Что реализовано

«Сцена» выбрана пользователем: большое видео слева, отдельная прокрутка справа; поиск сверху, фильтры результатов, коллекции с возвратом/scroll/focus, история. Видео/транспорт всегда видны. Полноэкранные controls снизу по центру по движению мыши, hide3s; hover/drag/keyboard focus удерживают. При явно открытой interactive YouTube quality panel HUD остаётся доступным (iframe захватывает mousemove). Controls=0 по умолчанию, свои CC/font/seek/volume; manual quality только через временную панель, setPlaybackQuality no-op. Mandatory pause/load branding не обещать убрать.

Wave: реальные жанры (161 в probe), новые сессии без autoplay; явная CTA запускает. Metadata ahead8, максимум3 поиска, duplicates/order/stale guards. Нет уверенного видео/ошибка/таймаут — bounded alternatives then skip. Network retry backoff. Pause/wake отменяют автоматическое продолжение. Очередь хранит ограниченный past; server received queue500, expired/empty/repeated sessions renew once. ОС управляет audio output.

Моя музыка: own+saved playlists, liked IDs/metadata по100, порядок сохраняется. Обзор: current chart100 и editorial playlists4 в live probe, Refresh, запуск/просмотр без смены текущей музыки до явного Play. Не называть editorial playlists ранжированным popular list.

Реакции: state -1/0/1, account-scoped persistent pending outbox SQLitev2, coalescing/revision ACK, Undo5s не возвращает старый клип. Native v3 добавляет favourites и actual last video. Backup через VACUUM INTO перед v1/v2 upgrade; данные сохранены. Несколько favourites выбираются случайно без immediate repeat, включая repeat-one. Удаление текущего не прерывает звук. Метка unavailable снимается после успешного PLAYING/явного retry. Автоподбор на этот раз не удаляет набор. Альтернативы рядом: thumbnail/title/views/duration, клик сохраняет play/pause и cursor, один IFrame.

## Текущий Smart History срез

Локальные500 уникальных кандидатов, последние clip IDs, likes/frequency/age weights, известные dislikes/pending intents исключаются. Единственный TS queue coordinator выбирает взвешенно без предыдущего track при>=2. Wave доигрывает буфер при API failure, затем SmartHistory; не переключается обратно сам. Есть явная кнопка в истории. Startup без autoplay, pending start имеет Pause, intent/generation guards. Известный history video не ждёт public metadata. Unsearchable manual clip после ошибки пропускается. Исчерпанные варианты локально исключаются до нового ручного запуска/успешной проверки, не пишут negative feedback.

Native feedback GET передаёт generation и полный snapshot exclusions только когда pending outbox пуст. Старое чтение не отменяет новый Set; frontend pending overlay и snapshot восстанавливают внешнее снятие dislikes. Личная медиатека refreshed при sync/TTL открытии. Никаких реальных feedback writes в тестах; testMode блокирует доставку. Реальный токен GET likes/dislikes + confirmed snapshot проверен.

Ограничения: cold-offline новая реакция требует identity аккаунта, ранее определённой в текущем запуске; старый outbox переживает restart и доставляется после соединения. Listened_ms/end_reason/quick-skip classification пока нет, Q06 threshold не утверждён, не вводить молча. Технические skips Wave не являются dislike. Linux/macOS runtime и физические sleep/lock/media keys не доказаны CI. Полноценный S1 provider feedback lifecycle и Yandex audio/FFT/mobile/multimonitor не объявлялись готовыми.

## Проверки

Текущий срез: TS/build,9unit PASS; полный renderer44PASS+1opt-in skipped (45 tests), .last-run.json status passed. Rust28 app+5probe PASS,9ignored;Clippy all-targets -D warnings PASS.

Windows native SmartHistory actual clip/END/sticky source/1iframe + full YouTube/CC/fullscreen/interactive-quality/tray/media/simulated power/mini/topmost/single instance PASS. Native real personal library/current chart/feedback read snapshot PASS. Предыдущий native favourites real Oasis END alternating + deletion-without-stop PASS.

20-minute unaccelerated hidden Wave soak (pre-Smart binary):5 transitions, max sampled wait5sec at5sec polling, volume0,1iframe, no manual seek/Next. Result .tools/wave-soak-result.json completed:true. Это не1час и не гарантия100% external availability. Новый soak после Smart engine изменений имеет смысл, но не начинать новый большой код при малом лимите.

Normal debug executable apps/desktop/src-tauri/target/debug/encore.exe уже обновлён с layoutfix и SmartHistory. Native test sessions завершены, профиль свободен. Последний Get-Cim encore процессов не обнаружил. Не закрывать пользовательский экземпляр принудительно; тестовый PID получаем из native desktop_status после testMode verification. Cleanup mutates/quits только подтверждённый test profile.

## Следующие небольшие задачи / перед завершением

1. Commit/push текущего SmartHistory этапа и проверить CI. Не завершать с грязной рабочей папкой.
2. Небольшая полировка: HTML title всё ещё Encore · лаборатория (config уже Encore), label жанров ошибочно «Настроение музыки». Можно поправить без отдельного теста. Поиск: ясная кнопка очистки/защита старых карточек во время нового запроса — полезный лёгкий срез.
3. Не начинать новую большую migration/telemetry при низком лимите. Будущий приоритет: listened_ms/end_reason, cold offline account identity keyed by safe credential fingerprint, дальнейший roadmap. Реальные feedback write только по явным пользовательским нажатиям, тестами не менять вкус аккаунта.
4. Проверить лимит, сохранить фактическое состояние/CI/сборку и завершить по инструкции пользователя.

## Команды

npm.cmd run build --prefix apps/desktop
npm.cmd test --prefix apps/desktop
npm.cmd run test:ui --prefix apps/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features yandex-probe
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --features yandex-probe -- -D warnings

Native: cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --profile native-test --features tauri/custom-protocol --bin encore; node scripts/native-smoke.mjs. ENCORE_LIVE_LIBRARY/YOUTUBE/CATALOGUE/YANDEX/SMART_HISTORY/FAVORITES=1 по нужным сценариям; все на volume0, isolated DB/profile. ENCORE_WAVE_SOAK_MINUTES и ENCORE_NATIVE_TEST_DATA_DIR — длинный прогон с чистым test data dir. Дождаться завершения своего теста перед пересборкой native-test.

Rust PATH C:\Users\Skar\.cargo\bin. Shell PowerShell. Рабочий cwd всегда Encore (старый VideoYandexTube не существует). Не запускать старый .tools/pending-update/apply.ps1: там pinned старый executable. Скриншоты .tools/native-favorites.png, native-alternatives.png, native-discovery.png, fullscreen-controls.png, ignored. Токен не печатать и не читать файлами.

## Последний срез: поиск, 2026-11-04
REQ-002: clear query, inert stale results/filters during debounce+request, full model reset, late responses ignored. Renderer45 PASS+1opt-in skipped, check/build PASS. CI1b20c10 4OS PASS. Native embedded profile собран. Пользовательский PID17280 открыт (debug/deps); не закрывать. Hidden updater .tools/search-update-20261104/apply.ps1 ждёт естественного полного выхода (закрытие окна лишь трей), проверяет hashes и не затирает другую сборку. Состояние .tools/search-update-20261104/status.json. Если будет superseded/expired — обновить обычной сборкой после выхода. Ничего не запускает. Старый .tools/pending-update/apply.ps1 не использовать. Реальный feedback write не проверялся, Linux/macOS runtime и Q06 остаются открыты.
