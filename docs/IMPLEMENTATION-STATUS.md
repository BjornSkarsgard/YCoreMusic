# Статус реализации Encore

## Актуальная сводка — 2026-11-05

Рабочий single-window prototype: Wave/жанры/поиск/медиатека/чарт/реакции/outbox/Smart History/favourites/history/mini/fullscreen/tray/recovery/autostart/диагностика, встроенный OAuth-вход, выбор трека очереди и её автоподгрузка. Пользователь подтвердил вход, отправку событий Wave и лайк Encore→Яндекс. Добавлен режим «Только управление» (REQ053): каталог и очередь одновременно, transport внизу; настоящий YouTube продолжает timeline при смене вида на Windows. Linux/macOS runtime, обратная ручная синхронизация реакций, physical sleep/lock, multi-monitor/visualizer/remote и clean install остаются открытыми. Последние CI mac jobs могут не стартовать из-за hosted runner capacity; это не успешная platform приёмка.

Далее идёт хронологический журнал. Ранние записи описывают прошлое состояние и не отменяют более поздние решения (в частности, выбор audioendpoint отменён пользователем).

## Этап 0 — историческая запись

- Подготовлены Tauri shell и TypeScript-экран S3 с одним YouTube IFrame.
- Только ручная загрузка/Play; авторизации, My Wave, очереди и backend пока нет.
- Это лаборатория: вывод на системное устройство, REQ-022 не реализован. Не считать полноценным плеером.
- Rust установлен; Windows native debug build проходит. Linux/macOS сборки запущены в CI, аппаратные проверки не выполнены.

| Проверка | Windows | Linux | macOS |
|---|---|---|---|
| S1 Яндекс/My Wave | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S2 Яндекс audio | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S3 YouTube desktop | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S4 endpoint | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S5 один звук/hidden | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S6 capture | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |

## Ручная проверка S3

На каждой ОС записать версию ОС, webview, Tauri, оборудование, video ID и результат:
1. Запуск не создаёт плеер и не начинает музыку.
2. Ссылка/ID + «Подготовить» загружает видео без воспроизведения.
3. Play, Pause, seek ±5 секунд, volume; проверить фактический звук и таймлайн.
4. Повторная загрузка другого видео не оставляет старый звук.
5. Недоступный embed и отключённая сеть дают видимую ошибку; проверить таймаут API.
6. Закрыть приложение, убедиться в остановке звука.

Следующее: установить toolchain, выполнить S3 в native shell, затем S1 и platform endpoint spikes. Токены не хранить в проекте.

## Автоматические проверки 2026-11-03

PASS: TypeScript strict check, тест trusted YouTube URL/ID (включая отклонение чужих доменов/протоколов/credentials), Vite production build. На момент первой проверки native build и реальное воспроизведение не были проверены; актуальные результаты ниже. npm install: 0 известных уязвимостей по результату текущего аудита.

### Продолжение Этапа 0

- Установлен Rust 1.99.1; запущена установка MSVC Build Tools + Windows SDK. Первая попытка native build остановилась на отсутствующем link.exe во время установки.
- Добавлен Cargo.lock и временная векторная иконка.
- CI собирает debug executable без инсталлятора на Windows, Ubuntu 24.04, macOS; результат сборки не означает прохождение аппаратных сценариев.
- PASS: Playwright/Chrome с подменённым YouTube API — отсутствие запроса к YouTube при старте, cue без autoplay, явный Play, удаление прежнего плеера перед новым. Реальный YouTube этим тестом не проверяется.


### Windows native build

PASS: `npx tauri build --debug --no-bundle`, Rust 1.99.1, Tauri 2.12.5. Создан `apps/desktop/src-tauri/target/debug/encore.exe`.
PASS (только process smoke): приложение не завершилось в первые 5 секунд, после проверки закрыто. Отрисовка окна, реальный embed и звук не проверены. S3 остаётся НЕ ПРОВЕРЕНО до ручного сценария.

Установка Visual Studio Build Tools (MSVC + Windows SDK) завершилась успешно. Требуется новый терминал, чтобы обновлённый PATH Rust подхватился автоматически.

### Реальный браузерный YouTube spike

PASS в Chrome на текущей Windows: реальный YouTube API, video ID M7lc1UVf-VE, cue без autoplay, явный Play при громкости 0, Pause и seek +5 с с проверкой фактической позиции. Исправлена гонка: Play доступен после CUED, а не только onReady.

Добавлен таймлайн (время видео, drag seek). Проверка реального API включается явно переменной ENCORE_LIVE_YOUTUBE=1; в обычном CI пропускается. Слышимость аудио не проверена. Chrome не заменяет WebView2/WKWebView/WebKitGTK: S3 native остаётся открытым.

CI коммита c0c7e9: native build + UI smoke прошли на macOS и Ubuntu; Windows ещё выполняется на момент записи. Это сборочные проверки, не аппаратная приёмка.

Подготовлен docs/S1-YANDEX-SPIKE.md; доступ к аккаунту и My Wave ещё не проверен.

### Яндекс probe и watchdog

Добавлен opt-in Rust `yandex-probe`: скрытый локальный ввод токена, два read-only HTTPS запроса, ограничение ответа/времени, запрет redirect, только безопасные категории ошибок. Порядок и повторы batch сохраняются. Реальный доступ НЕ ПРОВЕРЕН: требуется локальный ввод пользователем своего токена. 3 unit-теста PASS; бинарный файл Windows собран.

Исправлен timeout подготовки YouTube: отсчитывается до CUED, поздние события после timeout игнорируются. Playwright PASS для timeout и позднего callback, а также для замены одного плеера.

### S1: получено подтверждение пользователя

2026-11-03: пользователь запустил Windows legacy probe и сообщил Account request PASS, batch=5. Авторизация и первая legacy-порция подтверждены; S1 Windows = PARTIAL. Личные данные и IDs треков в статус не копируем.

Добавлен session probe по умолчанию: создание новой сессии и запрос следующих порций, queue в серверном порядке, без feedback/воспроизведения. Максимум 10 запросов порций, целевой объём 20 записей (не обязательно уникальных). Одинаковая подряд порция и ошибки завершают проверку. Старый сценарий доступен через --legacy. 5 unit-тестов, Clippy и сборка Windows PASS. Реальный session fetch ожидает локального запуска пользователем; credentials не сохранены.

CI коммита 90c5f06: Windows + Ubuntu + macOS завершились SUCCESS (сборка и автоматические UI-проверки). Аппаратные сценарии этих ОС этим не подтверждены.

### Новые требования: миниплеер и кроссплатформенный scope

В реестр добавлены REQ-049 (Windows/Linux/macOS, ранее зафиксировано ADR-001), REQ-050 (компактный миниплеер для одного монитора), REQ-051 (ручное topmost, сценарий PiP). Устранена устаревшая строка «кроссплатформенность вне scope». UI/мониторные сценарии и A25–A28 добавлены. Это требования и план; миниплеер пока НЕ РЕАЛИЗОВАН, точные кнопки/размеры — предложения.

### S1: session fetch подтверждён пользователем, 2026-11-03

Windows, локальный yandex-probe: account/status PASS, new session PASS без autoplay; 4 последовательные порции по 5 записей, суммарно 20, Session fetch PASS. Источник доказательства — присланный пользователем вывод утилиты, не самостоятельное наблюдение агента. Токен, session ID и список музыкальных предпочтений в репозиторий не копируются.

Подтверждены авторизация, создание session и продолжение выдачи с queue уже полученных ID. Сохранение серверного порядка в утилите проверено unit-тестами. Полный S1 остаётся PARTIAL: ещё нужны desktop lifecycle, очередь с асинхронным подбором, реальные feedback по действиям/прослушиванию и сетевые ошибки. S2 (аудио) не проверен этим запуском.

### Desktop вертикальный прототип: source + queue + миниплеер

- Общий Rust модуль yandex используется CLI и native source adapter; запросы/секреты не переходят в JS. Источник создаёт новую сессию при полном запуске без autoplay.
- Явное CLI --save-token после account PASS сохраняет секрет в OS store; --forget-token удаляет локально. Пользователь подтвердил успешное сохранение. Windows Credential Manager synthetic roundtrip PASS с удалением fixture; затем native source прочитал реальный credential без его вывода.
- Desktop получает названия/исполнителей и порции source; одна TS очередь, один cursor, порядок/повторы сохранены. Source API bookkeeping — только полученные ID. При сетевой ошибке существующая очередь остаётся. Автоподбор клипов пока отсутствует, URL задаётся вручную для текущего трека; нет автоматического перехода по завершению.
- Миниплеер в том же окне/плеере; topmost вручную. Добавлен single-instance guard. Persist window mode/settings, tray и remote пока отсутствуют.

Проверки на текущей Windows 11, WebView2 156.0.4314.58 и Edge WebDriver 156.0.4314.58:
- Native WebDriver PASS: startup без IFrame/autoplay, создание source session + следующая порция через OS store.
- Native реальный YouTube M7lc1UVf-VE PASS: cue, Play с volume=0, Pause, seek с проверкой позиции. Слышимость/качество аудио не проверены.
- Native PASS: mini resize/restore, из maximized в mini и обратно, topmost flag on/off, повторный запуск закрывает второй процесс.
- Unit/renderer PASS: queue order при позднем C, stale-generation, duplicate ordinal, metadata text escaping, failure сохраняет queue, тот же player при mini. Cargo tests и Clippy PASS до последнего rebuild; финальная проверка фиксируется ниже.

S3 Windows = PARTIAL (native управление видео подтверждено, слышимость/сбои/lifecycle ещё не полностью проверены). S4/S5/S6 и Linux/macOS runtime — НЕ ПРОВЕРЕНО. Вывод пока системный, REQ-022 не реализован. Новая CI-сборка с keyring/single-instance требует проверки на всех трёх ОС.

Финальная локальная проверка этого среза: cargo test (6 desktop + 5 probe PASS, OS store test opt-in отдельно ранее PASS), Clippy all-targets с -D warnings PASS, TS queue/URL unit PASS, 4 renderer smoke PASS. Native integration test после final rebuild PASS, включая single instance и maximized mini roundtrip.

Дополнение: 5 renderer smoke PASS после адаптации mini layout к широкому низкому окну; controls остаются в пределах viewport. Windows desktop пересобран. CI native/keyring/single-instance для новых изменений запущен; результаты Linux/macOS runtime по-прежнему не подтверждены.

### S10: автоподбор и автоматическое продолжение

Добавлен native matcher, консервативный ranking и bounded in-memory cache. Подробности/ограничения: S10-MATCHING-SPIKE.md. Три трека подготавливаются вперёд, источник/ordinal защищены от поздних результатов. Первый cue без autoplay; после Play natural end продвигает очередь, при исчерпании буфера подгружается source. Embed error/timeout меняет только candidate текущего трека. Pause/Next и pending-search intent покрыты renderer тестами. Ручная ссылка и «Подобрать заново» доступны.

Windows native integration PASS: источник → auto match → настоящий IFrame cue, отдельно известный search fixture → cue, sample video Play/Pause/seek на volume=0, mini/topmost/single-instance. В одном из более ранних запусков рекомендация не дала безопасного совпадения и потребовала ручной ссылки — покрытие неполное. Слышимость звука/все кандидаты не проверены.

Локально PASS: 10 desktop Rust unit + 5 probe unit (дубли общих parser tests в двух бинарниках); opt-in live metadata spike PASS; Clippy all-targets PASS; 8 renderer smoke PASS (live browser test по умолчанию skipped). S10 остаётся PARTIAL. Новые возможности пока ожидают CI. Предыдущий коммит 182250f собрался на Windows, Ubuntu и macOS.

### Обновление аудиотребований

Пользователь отменил endpoint selector/routing. Используется системная маршрутизация, REQ-022 superseded, S4 не блокер. Незакоммиченная аудиодиагностика удалена. Настройки Windows не менялись, audible probe не выполнялся. При volume=0 процессный audio-session owner не подтвердился (0 сессий), поэтому S6 остаётся НЕ ПРОВЕРЕНО. Далее — persistent manual video override/history.

### SQLite: ручные клипы и базовая история

Сделано: persistent manual override на track ID, приоритет перед поиском, отказ сохранённого клипа → временный автоподбор без удаления пользовательской привязки. История фактических PLAYING-start, без дублей при pause/resume; поиск по title/artist с кириллицей, воспроизведение записи, подтверждаемая очистка (manual overrides остаются). История не перезаписывается поздним source-init callback. OAuth не хранится в SQLite.

Локальные проверки PASS: 13 desktop Rust + 5 probe unit (общие parser tests дублируются в двух бинарниках), Clippy -D warnings, 11 renderer smoke + skipped opt-in live test. Миграция пустой схемы/идемпотентность/search/reopen override/refusal newer schema покрыты тестами.

Native Windows PASS: отдельная .tools/native-test-data SQLite, чтение/запись override, идемпотентная запись, clear history не удаляет override, removal override. После реального sample Play на volume=0 read-only проверка этой тестовой БД подтвердила запись M7lc1UVf-VE и отсутствие очищенного синтетического fixture. Source/YouTube/mini/topmost/single-instance smoke также PASS. Личная история и сохранённый OAuth не очищались; открытое пользователем окно не закрывали.

Ограничения: история пока только старты (нет listened duration/end_reason/date filter/pagination), одна ручная привязка вместо полного набора favourites, нет Play Next/Append из истории, native-runtime Linux/macOS для нового storage не проверен. Сборка Windows обновлена. Предыдущий d7e7610 прошёл CI всех 3 ОС; этот срез ждёт новой CI-проверки. Аудиовыход теперь системный по решению пользователя.

### User-reported matching correction

Living Dead Beat / Children Of Bodom воспроизведён в metadata search: канал Berar Emanuel с оригинальной группой в названии раньше отсеивался. Канал больше не hard gate. Добавлены title-based band/song matching, фильтрация playthrough/backing, просмотры как первый критерий среди подходящих кандидатов и ручной список неоднозначных результатов. Rust regression fixture + реальный metadata probe PASS. Непосредственная embed-проверка v-UX4hmUESg пока не прошла подготовку за 25 секунд; это не считается доказанным воспроизведением данного ролика. Подбор и фактическая доступность embed — отдельные проверки. Previous/repeat/volume persistence остаются следующим запланированным срезом; новая задача пользователя — каталоговый поиск Яндекса.

### Каталог Яндекса, Previous, repeat-one, volume

Сделано: search «исполнители/треки/альбомы/плейлисты», открытие коллекций, явный запуск списка/трека, дополнительные страницы поиска и коллекций. Просмотр не прерывает текущую музыку. Конечная playlist/album/artist queue сохраняет порядок, подгружает страницы, не уходит сама в Wave. Реальный запрос «рамштайн» вернул Rammstein, 4 исполнителя, 20 треков, 10 альбомов, 4 плейлиста; чтение первой коллекции каждого типа PASS через OS-store credentials без вывода токена.

Добавлены Previous (seek 0 / повтор за 3 с назад в текущей очереди), repeat-one, persistent volume/mute. Native restart-to-zero сохраняет паузу. Repeat-one/cross-track Previous и volume reload покрыты renderer/unit тестами, полное естественное завершение повторяемого ролика в native отдельно не проверялось. Volume prefs — только localStorage UI-настройка, не секреты. Полные favourites/repeat-queue/SMTC/межисточниковый playback stack остаются.

Windows native smoke PASS: кириллический запрос и 4 раздела, открытие artist/album/playlist списков, просмотр не меняет текущий title, явный запуск списка наполняет очередь. Также PASS: SQLite fixture isolation, source session/batch, sample real YouTube volume=0 Play/Pause/seek, Previous seek0 paused, history, mini resize/maximized restore/topmost, single instance. Локально: 18 desktop Rust unit + 5 probe unit, Clippy PASS; 17 renderer smoke + 1 opt-in live test skipped; 5 TS pure unit PASS. Новая Windows сборка собрана после закрытия пользовательского окна. Новый CI ещё не завершён; runtime Linux/macOS для поиска/контролов не проверен.

Living Dead Beat metadata search PASS и регрессионный fixture PASS; конкретный v-UX4hmUESg в отдельном live embed test не подготовился за таймаут. Не объявляем этот ролик воспроизводимым по одному поиску; alternative candidates/error path остаются обязательными.


### Трей, media controls, power lifecycle — 2026-11-04

Реализованы скрытие в трей без пересоздания сессии, Open/Play-Pause/Exit, восстановление минимизированного окна при повторном запуске. При отказе создания трея обычное закрытие остаётся доступным. Один coordinator/player; системные команды идут в него. Подключены Souvlaki SMTC/MPRIS/Now Playing, metadata/state/progress из реальных IFrame событий. На Windows WebView HardwareMediaKeyHandling отключён, обычных глобальных клавиш нет.

Sleep/wake events отменяют play intent и удерживают паузу до явного Play, сохраняют позицию/очередь. Поздний PLAYING и ENDED не возобновляют/не продвигают очередь после power pause. Windows SetThreadExecutionState удерживает automatic sleep/display off только при PLAYING, сбрасывается на паузе/power events/Exit. Linux/macOS idle inhibition пока отсутствует; отсутствие logind/OS listener не проверено.

PASS локально: TS check + 5 unit, Rust 18 desktop + 5 probe unit, Clippy all-targets -D warnings; 18 renderer smoke (1 live browser opt-in skipped), в том числе system Play -> suspend/resume -> поздний PLAYING -> ручной Play без новой source-сессии. Windows native: кириллический каталог/коллекции, isolated SQLite, source session/batch, real YouTube при volume=0, скрытие на 4 с с продолжающимся таймлайном, восстановление того же трека, tray-handler Pause, SMTC state playing/paused, имитированные power events, seek/Previous/history, mini/topmost/maximized restore, повторный запуск возвращает minimize. Exit завершает тестовый экземпляр.

Ограничения: shell-значок не кликался аппаратно; тест вызывает тот же production action handler. Физические медиаклавиши/звуковая слышимость/реальный сон/wake/Win+L не проверены. Native power events имитированы через Tauri event system, что не доказывает подписку OS listener. Linux/macOS runtime не проверен. Предыдущая CI afcdd1d: Windows/Ubuntu PASS; macOS job не получил arm64 hosted runner. Добавлен macos-15-intel параллельно с arm64; следующий CI проверит новый код.


### История: следующие треки и конец очереди

PASS: History Next/Append с сохранённым video ID не прерывают текущий Play/Pause, сохраняют Wave continuation, повторы и порядок. Manual video без source queue остаётся текущим при добавлении истории. Stable ordinal отделён от cursor, поздний resolve не переезжает после вставки. Локально 6 TS unit, 20 renderer smoke + 1 opt-in skipped. Native Windows PASS: две вставки из изолированной истории сохраняют current paused title, увеличивают очередь на 2; Next подготавливает сохранённое видео без autoplay. Остальной native tray/media/power/mini/catalogue smoke также PASS. Windows пересобран.

CI eff15db выявил macOS link failure _IOPSRelease в power-monitor 0.1.0. Внесён минимальный лицензированный vendor patch с CFType create-rule RAII (CFRelease); Windows cargo check PASS. Подтверждение macOS-сборки ожидается от нового CI. Это реальная ошибка зависимости, в отличие от прежних отказов выделения runner.


### Repeat queue, локальные клавиши и native test isolation

Сделано: finite queue repeat с догрузкой коллекции перед возвратом в начало, сохранением pause при ручном Next через конец; Wave ограничен off/one, при новом Wave сбрасывается queue-repeat. Локальные Space и стрелки +/-5 с пропускают поля ввода и интерактивные controls. PASS 21 renderer smoke + 1 opt-in skipped, 6 TS unit. Native Windows PASS: history queue из одного элемента оборачивается paused без autoplay; WebDriver keyboard Space запускает/ставит паузу настоящий IFrame на volume=0. Остальные tray/power/history/catalogue/mini проверки также PASS.

Native smoke теперь запускает отдельный Cargo native-test executable, debug-only test identifier, отдельный WebView profile и isolated SQLite. Проверен рядом с уже работающим пользовательским Encore: пользовательский PID сохранился, тестовый процесс завершился. User-facing debug executable может оставаться заблокирован открытым экземпляром; новая сборка готова в native-test output.

CI 0339af0: Ubuntu, macOS Intel и macOS Apple Silicon PASS, включая native link после vendor patch. Windows job ещё выполнялся при записи. Это сборка/автотесты, не доказательство аппаратного runtime на Linux/macOS. Новые repeat/local-key/test-isolation изменения ожидают следующего CI.


### Свои controls, hover/seek и субтитры

PASS Windows native с настоящим YouTube на volume=0: controls=0/pointer-events:none; перемещение указателя в центр видео и наша перемотка не показывают верхнюю/нижнюю chrome-панель YouTube. CC on/off проверен по фактическому состоянию тестового YouTube player, в том числе повторный Play после off. Это потребовало подавления автоматического включения CC при muted Play; одного track={} и чтения getOption(track) недостаточно. Свои доступные дорожки/размер текста и quality-event indicator под видео. Ручное разрешение остаётся в явной временной панели YouTube, не в фиктивном custom selector.

PASS native: открытие/скрытие YouTube controls сохраняет позицию и не дублирует SQLite history; свой fullscreen входит/выходит с тем же единственным IFrame. Screenshot .tools/native-custom-player.png просмотрен: на активном видео нет chrome overlays, свои controls видны под ним. Остальной native catalogue/tray/power/mini/history/repeat smoke PASS. Renderer: 22 PASS + 1 live opt-in skipped; после CC enforcement дополнительно целевой regression с auto-enabled caption mock PASS. 6 TS unit, strict check, Windows native-test build PASS.

Ограничения: branding/служебные заставки YouTube на pause/load полностью не отключаются; изменение качества через API no-op, закрытие native панели может сбросить ручной выбор. CC bridge использует обнаруженные runtime возможности, его совместимость с будущими изменениями YouTube не гарантируется. Native Linux/macOS для новой панели не проверен. CI f85cc64 полностью PASS: Windows, Ubuntu, macOS Intel, macOS Apple Silicon. Новая панель ожидает собственного CI.

## Ночной срез 2026-11-04 — постоянное видео и непрерывная волна

Реализован layout «Сцена», независимый скролл выдачи, фильтры каталога, реальные жанровые станции, предзагрузка рекомендаций/поиска и автоматический пропуск непригодных видео. Pause/сон отменяют продолжение; сетевые ошибки повторяются с backoff, устаревшие сессии обновляются с прежним seed и недавними ID. Ограничена память истории очереди.

Проверки: TS build + 7 unit PASS; renderer 26 PASS + 1 opt-in skipped; Rust 20 + 5 PASS, 6 ignored; Clippy PASS. Реальный Яндекс: 161 жанр, 5+5 рекомендаций выбранного жанра. Полный Windows native smoke PASS; отдельный live Wave — старт и два END-перехода без ручного выбора на одном IFrame (volume=0, ускоренная перемотка к концу). Windows debug executable обновлён. Многочасовой прогон и Linux/macOS runtime ещё не проверены. Актуальная передача контекста: SESSION-HANDOFF.md.

## 2026-11-04: центрирование управления и навигация каталога

По просьбе пользователя транспорт выровнен по центру. Fullscreen показывает видео на всю поверхность; существующие controls появляются нижним центральным оверлеем по движению мыши, скрываются через 3 секунды, остаются доступны при hover/drag/клавиатурном фокусе. Плеер не пересоздаётся. В каталоге отдельный просмотр коллекции с возвратом в выдачу, восстановлением scroll/focus и отменой поздних ответов; пустой фильтр показывает подсказку.

Проверено: TS build, 7 unit, renderer 28 PASS + 1 opt-in skipped; полный Windows native smoke с реальным Яндексом/каталогом/YouTube, fullscreen, mini/topmost PASS. Следующее по прямому запросу: REQ-002 личные плейлисты/любимые, REQ-008/009 реакции/outbox/Undo. Ночная версия f97bff5 прошла CI на всех четырёх платформах.

## 2026-11-04: личная музыка, реакции, обзор и альтернативные клипы

- «Моя музыка»: собственные/сохранённые плейлисты и «Мне нравится», просмотр без переключения, запуск списка/с выбранного места и пагинация. Реальный read-only probe: 43 плейлиста, 900 liked IDs, 100 метаданных страницы.
- «Обзор»: текущий чарт (100 треков) и редакционные подборки Яндекса (4 в пробном запросе), обновление, запуск и просмотр списков. Это данные сервиса, не статическая имитация.
- Like/unlike/dislike, Undo 5 секунд без rewind, SQLite v2 и account-scoped pending outbox, revision guard, сетевой retry. Реальная запись предпочтений в тестах блокируется; права текущего токена на успешный write ещё не подтверждены.
- Альтернативы рядом с видео: изображения, названия, просмотры, длительность; выбор того же трека с сохранением play/pause, одна ручная привязка. Реальный YouTube metadata probe: duration у 5/5 кандидатов. Реальный native switch и загрузка превью PASS, один IFrame, volume=0.
- Проверки: strict TS/Vite, 7 unit; renderer 32 PASS + 1 opt-in skipped; Rust 25 app + 5 probe PASS, 9 opt-in ignored; Clippy all-targets -D warnings PASS. Migration backup/preservation и durable outbox failure/coalescing/account isolation/late ACK проверены.
- Полный Windows native smoke: реальный Яндекс, каталог, медиатека/чарт, YouTube/CC/fullscreen/tray/media/power/mini/topmost/single instance PASS. Native driver после fullscreen теперь отводит указатель от HUD перед проверкой скрытия; наведение сохраняет управление по согласованному UX. При завершении убирается только PID изолированного тестового экземпляра.
- Linux/macOS runtime, реальная delivery реакций и многочасовая непрерывность остаются неподтверждёнными. CI запускается при push.

## REQ-037 и длительная проверка волны

Добавлены локальные Up/Down ±5% с clamp/persistence и F11 для того же fullscreen workspace. Поля ввода, кнопки, select, диалоги и modified keys не перехватываются; музыка от shortcuts настройки не запускается. Целевой renderer test PASS: границы 0–100, persistence, два F11 без пересоздания iframe, editing guard/no autoplay.

Добавлен опциональный ENCORE_WAVE_SOAK_MINUTES (до 120) и отдельная ENCORE_NATIVE_TEST_DATA_DIR. Идёт 20-минутный настоящий неускоренный прогон, hidden+volume0, с периодическим JSON прогрессом в .tools. Результат на момент записи ещё не получен. Native-test бинарник занят прогоном: не пересобирать этот профиль до завершения. Следующий срез — REQ-014 несколько избранных клипов/random/no-repeat.

## 2026-11-04: REQ-014 и длительный Wave прогон

Несколько избранных клипов, звезда, список/удаление в диалоге, random/no-immediate-repeat, repeat-one, фактический last-play в SQLite, unavailable без автоудаления. «Автоподбор на этот раз» сохраняет набор. Миграция v3 импортирует старую ручную ссылку, сохраняет pending reactions и создаёт backup исходной v1/v2.

Проверки: TS/build, 8 unit PASS; renderer 35 PASS + 1 opt-in skipped; Rust27 app +5 probe PASS,9 opt-in ignored; Clippy PASS. Полный Windows native с настоящей медиатекой/чартом/YouTube и отдельный native test нескольких favourites PASS. Два реальных видео чередуются по END, снятие звезды не прерывает плеер. Реальные feedback writes по-прежнему не выполнялись и не объявляются подтверждёнными.

Отдельный 20-минутный неускоренный прогон настоящей Wave: 5 автоматических смен трека, hidden, volume=0, один IFrame; максимальное замеченное ожидание около5сек при опросе5сек. Нет ручной перемотки/Next. Это ограниченная Windows проверка, не доказательство многочасовой/100% доступности. JSON результаты локально в .tools/wave-soak-result.json. CI26bb9ee целиком PASS на четырёх платформах; новый push запустит проверки текущего среза.

## 2026-11-04: fullscreen quality panel и поздний fullscreenchange

При явно открытой панели качества YouTube собственный HUD остаётся доступен: cross-origin iframe перехватывает движения мыши. После скрытия панели возвращается обычный idle timeout. Поздний fullscreenchange больше не отменяет уже произошедшее движение мыши. Regression имитирует задержанный event и проверяет видимость; обычное скрытие также проверено.

Renderer36 PASS+1opt-in skipped, точечные fullscreen/manual сценарии PASS; Windows native: реальная interactive quality panel в fullscreen после hover/idle оставляет наши кнопки доступными, затем закрытие/остальные smoke PASS. Заголовок окна — Encore; standalone manual clip сразу обновляет title/source. Native runner получает PID из desktop_status после testMode verification, а не из browser capabilities, поэтому cleanup относится к подтверждённому своему приложению. History queue assertion учитывает обёртку отдельно играющего manual clip.

CI d306f82: Windows/Linux/macOS ARM PASS; macOS Intel остановился на renderer таймауте Wave/fullscreen recovery. Следующий push включает защиту позднего fullscreenchange и её regression; окончательный результат CI ещё ожидается.

## 2026-11-04: стабильная высота обзора при смене клипа

По прямому замечанию пользователя область альтернатив получает постоянную адаптивную высоту, включая время загрузки/скрытое состояние. Scroll-область боковой панели занимает оставшееся место. При выборе трека обзор не растягивается и не меняет scrollTop. Отдельный renderer regression с 200 треками и управляемой задержкой YouTube matching PASS: размеры и прокрутка проверены до, во время и после загрузки.

## 2026-11-04: Smart History и snapshots реакций

Добавлен локальный бесконечный источник с весами по like/частоте/давности и исключением известных dislikes. При недоступности Wave сначала заканчивается загруженная очередь, затем включается история. Возврат к Wave — явный. Startup без autoplay, Pause отменяет pending start. Известные video IDs играют без зависимости от поиска; при исчерпании вариантов трек обходится, без музыкального negative feedback.

Реакции получают generations и полный подтверждённый snapshot исключений при пустом outbox. Старое чтение не отменяет новый Set; pending intents защищены; снятый в Яндексе dislike снова допускается. Личная медиатека обновляется после синхронизации и по TTL при открытии.

Проверки: TypeScript/build,9unit PASS; renderer44 PASS+1opt-in skipped; Rust28 app+5probe PASS,9ignored;Clippy PASS. Windows native local Smart source + известный клип + реальный END + sticky source +1iframe PASS. Полный native YouTube/CC/fullscreen/tray/media/simulated power/mini/topmost PASS. Реальный current-token feedback GET и exclusions snapshot PASS, реальные feedback writes остаются заблокированы в тестах и не объявляются проверенными. Native cleanup меняет/закрывает приложение только после подтверждения testMode.

Quick-skip threshold и listened-duration classification пока не реализованы (Q06 открыт). Linux/macOS runtime, физические media/sleep/lock hardware tests остаются неподтверждёнными.

## 2026-11-04: поиск без случайного запуска старой выдачи (REQ-002)

Кнопка очистки возвращает фокус в запрос, сбрасывает результаты, фильтры и пагинацию, отменяет pending responses. Пока новый запрос ожидает debounce/ответ, предыдущая выдача и фильтры inert, кнопка дозагрузки отключена. Ошибка объясняет, что остались предыдущие результаты. Убраны лабораторные подписи заголовка и пустого плеера; выбор жанра подписан «Жанр музыки».

TypeScript/build PASS; renderer 45 PASS +1 opt-in skipped, включая stale playback/clear/late response/reuse и стабильную высоту обзора. CI предыдущего Smart History среза целиком PASS. Пользовательский Encore открыт; обычная сборка блокируется Windows. Свежий embedded binary собран в native-test (testMode включается только окружением), скопирован в .tools/search-update-20261104. Hidden updater ждёт выхода обоих обычных executable paths, проверяет исходный/целевой hash, отменяет устаревшее обновление, не запускает/не закрывает приложение. Статус в локальном status.json; установка ещё ожидается.

Дополнение поиска: после неудачного нового запроса нельзя догружать страницы по чужому query/page. Предыдущая выдача явно подписана; повторный успешный поиск возвращает пагинацию. Дополнительный regression PASS, обе search проверки PASS, TypeScript/build/embedded native profile PASS. Подготовленное обновление пересобрано; helper ожидает выхода, hash manifest обновлён.

## 2026-11-04: REQ-006 полная пагинация истории

Нативный beforeId cursor (совместим с прежним history API) открывает записи старше100, сохраняя реальные повторы и порядок при новых событиях. Отдельный history-ui владеет только просмотром, очередь по-прежнему в coordinator. Поиск отменяет pending callbacks немедленно, дозагрузка повторяется после ошибки; clear защищён от двойного нажатия и late response, ошибка видна в диалоге. Подписи трека/исполнителя/даты читаются отдельно. ADR-021, без миграции БД.

Проверки: TypeScript/build PASS; полный renderer48PASS+1opt-in skipped, затем3целевых historyPASS (включая добавленный failure/retry);9TSunitPASS;Rust29app+5probePASS,9ignored;ClippyPASS. Настоящий Windows native:105исторических событий, новый event между страницами, cursor/порядок/очистка/no-autoplay PASS; полный настоящий YouTube/история now-next-append/repeat/fullscreen/CC/tray/media/mini/topmost PASS. Только testMode база. Стандартный debug/encore.exe успешно пересобран после выхода пользователя. Старый hidden search updater оказался blocked и ничего не установил; новая стандартная сборка заменяет его, ожидающего обновления больше не требуется. Не запускать старые apply.ps1.

## 2026-11-04: REQ-046 renderer recovery

Сохраняем track/position/history-record при confirmed browser offline; buffering восстанавливает тот же clip с backoff. Pause/wake/source/Next guards, END после reconnect учитывает repeat-one. Renderer56PASS+1opt-in skipped, TS/buildPASS.7новых regression включают15мин offline через clock, восстановление43с без duplicate history, Pause,Next,late callbacks,wake,finite retries иrepeat.

Настоящий60мин native Wave прогон идёт на baseline025ab78 (до нового recovery), hidden+volume0+fresh test directory, без seek/Next. Окончательный результат ещё не получен. Native-test profile занят: не пересобирать до завершения. Новый recovery требует отдельной native проверки после прогона; полный реальный сетевой outage пока не утверждать проверенным. CI025ab78: Windows/Linux/macIntel PASS; macARM canceled без failedstep, overallfailure; следующий push перепроверит.

## 2026-11-04: REQ-043 автозапуск — реализация, native проверка ожидается

В настройках checkbox реального OSautostart, по умолчанию ничего не регистрируется. Официальный plugin2.7.0, нативные main-only commands, отдельный --encore-autostart путь hidden+paused, tray-failure fallback, повторный background instance не крадёт фокус. Native testMode запрещает OS mutations. Rust31app+5probePASS,9ignored;ClippyPASS;2целевыхautostart rendererPASS; полный renderer прогон повторяется после исправления проверки немедленного rollback checkbox.

Подготовлен дополнительный native сценарий CDP outage только собственного WebView, без изменения системной сети. Он ещё не запускался; не объявлять PASS. Native profile занят60минWave baseline025ab78. После завершения пересобрать с новым recovery/autostart, выполнить ENCORE_AUTOSTART_SMOKE/ENCORE_LIVE_RECOVERY и обычный native YouTube smoke. Autostart enable/disable текущего пользователя и настоящий login не выполнялись.

Повторный полный renderer для autostart:58PASS+1opt-in skipped; TypeScript/buildPASS. Native runtime всё ещё ожидается после часового прогона.

## 2026-11-04: завершён часовой непрерывный Wave прогон; остановка по просьбе пользователя

Настоящий неускоренный Windows native Wave прогон завершился с exit0:60минут,16автоматических смен,712playingSamples,7waitingSamples,maxFrames1. Самая долгая замеченная пауза около5сек при дискретном опросе5сек. Окно скрыто,volume0, без seek/Next/ручной помощи. Результат .tools/wave-soak-result.json, тестовая база .tools/native-soak-60min-20261104. После прогона mini/restore/topmost/maximized/single-instance PASS; собственный тестовый экземпляр завершён. Проверялся baseline025ab78, до новых recovery/autostart/feedback изменений. Это ограниченная Windows проверка, не100% гарантия внешних сервисов и не Linux/macOS runtime.

По явной последней инструкции пользователя дальнейшая разработка и новые тесты остановлены. Recovery7634ff4 и autostartecfe73c: renderer58PASS+1skipped, native приёмка новых сценариев ещё НЕ выполнялась. Незакоммиченный refactor feedback.rs/feedback-ui.ts и новый feedback.spec.ts:4целевых Rust и2целевых rendererPASS, полного регрессионного/native прогона после него нет. Не объявлять срез полностью готовым. Настоящие preference writes и OSautostart enable не выполнялись. ПК не выключать: текущая инструкция — записать результат и остановиться.

## 2026-11-04: продолжение после команды «работай», реакции

Последняя команда пользователя возобновила работу. Завершён refactor реакций: network вне cache lock, отдельная последовательная доставка, generation guards, overlay всех pending (проверено60), доступные известные кнопки во время refresh, rollback ошибки. ADR-024. Полный renderer60PASS+1opt-in skipped; Rust35app+5probePASS,9ignored;Clippy иfrontendbuildPASS.

Native свежей сборки: запуск --encore-autostart в tray/без autoplay/Open PASS; OS setting read +testMode mutationguard PASS без записи startup; реальные personal library/chart/feedbackGET snapshot PASS. WebView CDP outage запустился, сохраняет track/history и уважает Pause, но проверка восстановленной позиции FAILED; расследуется, не объявлять этот recovery nativePASS. Системная сеть не менялась. CIecfe73c Windows/LinuxPASS, macIntel/macARMCANCELLED: annotations сообщают отсутствие hosted runner/capacity, failedsteps отсутствуют.

## 2026-11-04: native recovery/autostart подтверждены; диагностика

Новый Windows native WebViewCDP outage20сек PASS: seek940сек, буфер доиграл до958сек, восстановление959сек. Проверяется последняя фактическая buffered position, а не положение в начале outage. Track/cursor/history сохраняются, Pause запрещает reconnect autoplay; системная сеть не менялась. Первоначальное падение проверки было неверной точкой сравнения; код recovery менять не потребовалось.

Полный native YouTube/CC/hover/seek/quality/fullscreen/tray/media/history/repeat/localkeys/mini/topmost/maximized/singleinstance PASS. Background duplicate не фокусирует пользовательское окно, autostart аргумент стартует hidden+paused,OSmutationguardPASS. Maximize test теперь ждёт реального maximizedstate и получает новый rect вместо раннего ответа WebDriver. Физический sleep/lock и реальное включение autostart по-прежнему не выполнялись.

Настройки получили read-only health: версия/платформа/открытие хранилища, сохранённое подключение и отдельная явная проверка Яндекса. Различаются authorization/network/rate-limit/service errors. Native response содержит только фиксированные метаданные и статус, без accountUID/login/token; APIaccount/status вызывается только при кнопке проверки. Нативная настоящая проверка соединенияPASS. Полный renderer61PASS+1opt-in skipped,9unitPASS,Rust36app+5probePASS/9ignored,Clippy/buildPASS. Обычная debugсборка обновлена.

## 2026-11-04: упаковка в установочные файлы

Отдельная opt-in bundleconfig, npmкоманды NSIS/DEB+AppImage/APP+DMG и dispatch-only workflow для release artifacts без публикации. Локальный Windows debugNSIS успешно собран3.72MiB, SHA256 BB808E20E4ACA70FA7F46FE41214354D1765D642E902E1661EBA38CA218E2996. В установщик не включены токен/SQLite. Он не запускался, чистая установка/удаление не проверены; releaseупаковка вCI ещё ожидается. До этого полный UI/native/Rust срез428a444PASS по предыдущей записи. Mac hostedrunnercapacity по-прежнему внешнее ограничение.

## 2026-11-04: Windows release пакет и актуализация документации

Локальная оптимизированная Windows release сборка и NSIS завершились успешно:target/release/bundle/nsis/Encore_0.0.1_x64-setup.exe,3.28MiB. SHA256/signature записаны в .tools/windows-package-result.json, пакет не установлен и не опубликован, подписи нет. Во frontend/пакет не добавлены пользовательские credentials илиSQLite. Ручной packageworkflow появился в GitHub после задержки регистрации; Linux dispatch запрошен для проверки DEB/AppImage, итог ещё ожидается.

README приведён к текущему single-window prototype: удалены противоречащие актуальной реализации старые утверждения про отсутствие Wave/нескольких favourites/автообхода. docs00 теперь явно Windows/Linux/macOS и видеопоток Wave; начало журнала статуса маркирует ранние записи историческими. Готовность UIlogin, real preference writes,physical lifecycle,platformruntime не завышена.

## REQ-006: период истории (2026-11-04)

Свёрнутый блок «Период» задаёт локальные календарные дни «С»/«По». Последний день включён; следующий день рассчитывается календарно, включая DST, а не прибавлением24часов. Смена периода отменяет late responses и сбрасывает cursor, кнопка сброса не меняет текстовый запрос. Пустая выдача по фильтру не объявляется пустой историей. Диалог очистки явно предупреждает об удалении всей истории, включая записи вне периода.

storage/history принимает optional from/until в Unixseconds: from включён,until исключён,пагинацияbeforeId сохранена. Старые клиенты без периода совместимы. Все собственные started_at хранятся в UTC; фильтрация по UTCsecondprefix не округляет наносекунды на границе дня, миграция не требуется.

Проверки: UI62PASS+1opt-in skipped,Rust37app+5probePASS/9ignored,Clippy/buildPASS. Native Windows inclusive today+pagination+futureempty+clear+noautoplay+mini/topmost/maximized/instancePASS. Отдельно проверен25часовой день NewYork и поздний старый период. Linuxrelease DEB/AppImage workflow41867671860PASS, артефакты скачаны в.tools/linux-packages-41867671860; runtimeещё не проверялся. MacARM packaging41870661876запрошен, итог ожидается.

## 2026-11-04: стабильные renderer fixtures и реальный browser embed

Mock renderer scenarios используют общую thumbnail fixture вместо внешних i.ytimg.com запросов. Live spec остаётся без подмены, исправлен под текущий диалог и rangeinput: реальный Chrome YouTube cue/noautoplay/explicitmutedPlay/Pause/seekPASS (15.5сек). Полный mock suite62PASS+1opt-in skipped (28.7сек); это не замена native/runtimeприёмке. Productionкод этим срезом не менялся.

Linux DEB/AppImage release41867671860PASS; скачаны и проверены AR/ELFформаты, SHA256/controlmetadata в.tools/linux-package-result.json. Native Linux/X11 run41871384767 идёт; MacARMpackage41870661876вочереди.

## 2026-11-04: первый Linux X11 прогон и ожидание оконного менеджера

NativeLinux41871384767 дошёл до реального GTKокна/noautoplay/autostartargument/diagnostics/SQLite/historydates+cursor+clearPASS. Упал на немедленном чтении topmostfalse после запросаtrue. Проверена реализация TaoLinux: setter отправляет WindowRequest, getter читает ABOVE из последующего WindowStateevent. Runner теперь ждёт подтверждённое состояние с ограничением5сек, не подменяет getter/результат. Повторный Linux прогон ещё ожидается. Windows basic native с этим ожиданиемPASS.

CI получает cache Rustdependencies через rust-cache для уменьшения повторной компиляции (workspaces apps/desktop/src-tauri -> target,cache-on-failure). MacARMпакет пока вочереди, наличиеmacOS runtime не утверждается.

## 2026-11-04: клавиатура раскрывающихся блоков и финальная Windows сборка

Space/Enter на summary сохраняют стандартное раскрытие блока и не запускают/не приостанавливают музыку; guard распространяется также на rolebutton.3целевых keyboardrendererPASS,check/debugbuild/releaseNSISPASS. Windows installer пересобран с периодом истории и этим guard, актуальный hash в.tools/windows-package-result.json. Ранний NSIS из предыдущих записей — более старый snapshot той же версии0.0.1; установка/подпись по-прежнему не выполнялись.

LinuxNative41873691768: startup/autostart/health/SQLite/historyPASS, topmost после5сек остаётсяfalse. ReadinessOpenbox иDISPLAY дляDBus исправлены; ожидание само проблему не решило. Lookup пофиксированному заголовку не нашёл окно (возможна смена titleWebKit).41874314737 добавляет readonly _NET_CLIENT_LIST +PIDfilter только для своих окон и их EWMHstate; итог ожидается. Не считать Linuxmini/topmost/maximized полностью принятыми. MacARMpackage41870661876не получил hostedrunner иcancelled, без failedstep.

## 2026-11-04: остановка при9%лимита

Текущие Windowsdebug/releaseNSIS пересобраны с фильтром дат и клавиатурнымguard; manifest.tools/windows-package-result.json, packageSHA25608171F4801A5C1648FD571B291F1F9F6B26FF0F662B6E26BCD5BFF00216F7603. Установщик не запускался. LinuxDEB/AppImage41867671860собраны на более старомsnapshot; nativeLinuxstartup/storage/historyпрошли,topmostнепрошёл. Последнийdiagnosticrun41874314737застрялнаAPT,запрошеныcancel/forcecancel;EWMH/PIDдиагностикаещёнеполучена. MacARMpackagecancelledиз-заhostedrunnercapacity. Состояние,коммиты,проверкииблокеры подробно сохраненывSESSION-HANDOFF.md. Новыхзадачпринизкомлимитененачинать;невыдаватьпроектза полностьюготовый.

## Вход из настроек — 2026-11-05

Добавлены native auth.rs и auth-ui.ts: вход в отдельном окне Яндекса, отмена/таймаут/ошибки, readonly проверка доступа перед OS-store save, подтверждённый локальный disconnect. Token/identity не передаются в интерфейс. Успех обновляет Encore без autoplay. Feedback cache инвалидируется с generation, outbox прежнего аккаунта сохраняется. Подробнее ADR025.

PASS:40app+5probe Rust/9ignored;Clippy;TS/build;полный renderer67PASS+1opt-in skipped, после добавления сценария success/reload ещё5authPASS;9TSunit. Windows native auth popup open/cancel/actual destroy/noautoplay/testMode credential guard, затем autostart read/diagnostics/history dates/mini/topmost/maximized/single instance PASS. Обычный debugexe обновлён. Пользовательский release Encore не закрывался. Реальный вход после согласия пользователя НЕ ПРОВЕРЕН; проверка запрошена отдельно, работу по следующему пункту не блокирует. Linux/macOS отложены по новому приоритету пользователя.

### Исправление живого OAuth callback — 2026-11-05

Пользователь сообщил400 после push-кода. Причина: принудительный redirect_uri verification_code не зарегистрирован у текущего клиента. Публичная metadata https://oauth.yandex.ru/client/23cabbbdc6cd418abb4b39c32c41195d/info подтвердила callback https://music.yandex.ru/. Убрано переопределение redirect_uri, native callback принимает только этот точный origin/root path с прежней проверкой state. Сам токен/личность не читались и не выводились.2authRustPASS;WindowsnativeOAuthopen/cancel/testguard+basicPASS;ClippyPASS. После подтверждённого выхода пользователя debugexe успешно заменён исправленной сборкой. Повторный пользовательский login пока ожидается; не объявлять полный OAuthPASS.

## Состояние аккаунта и стартовое предложение входа — 2026-11-05

Пользователь сообщил успешный вход без прежней400. Исправлен неизменный текст кнопки: saved/connected → «Сменить аккаунт», missing → «Войти в Яндекс», authorization_denied → «Войти снова». Отдельный статус различает сохранённое подключение и проверенный доступ. Снимок OS-store читается локально при старте без network account-check; существующая диагностика отдаёт тот же результат accountUI без отдельного запроса.

Добавлен стартовый диалог только при missing: объяснение, Later/Login, постоянный opt-out и путь Settings→Яндекс Музыка. Напоминание не появляется у saved аккаунта или при opt-out; ручной вход остаётся. Проверены повторный запуск с/без opt-out, saved account после reload, явный вход из приглашения и отмена без autoplay. PASS:72renderer+1opt-in skipped, TS/build, WindowsnativeOAuthopen/cancel/guard+fullbasic. Обычный debugexe успешно обновлён, пользовательские credentials не менялись тестами.

## Исправление волны после выхода — 2026-11-05

Пользователь подтвердил disconnect именно в Encore. Нативная readonly диагностика OS-store показала missing; секрет не выводился и не изменялся проверкой. Найден sourceFetch catch, который одинаково включал Smart History при network и auth errors. Убрана автоматическая подстановка локальной истории при auth error. Свежая неавторизованная Wave очищает старый буфер, показывает «Моя волна · нужен вход» и путь Settings→Яндекс Музыка. Явная история без аккаунта и fallback при network failure сохранены.

PASS:3targetedrenderer (подтверждённый logout из играющей волны с reload/noiframe/emptyqueue/noautomaticSmartHistory, ручная история, orderednetworkfallback/offlinestart), TS/build, Windowsnative basic. Обычный debugexe успешно обновлён. Учётная запись тестами не отключалась: настоящий credential уже отсутствовал после действия пользователя; сценарий удаления в renderer использует фикстуру.

## Гостевой режим REQ-052 — 2026-11-05

По прямому указанию пользователя общедоступный каталог открыт без входа. Native optional credentials + whitelist public GET + anonymous retry при authdenied; search, artist tracks, album with-tracks и публичные плейлисты. Chart независим от optional editorial landing. Guest response содержит playlistsAvailablefalse и UI объяснение про поиск публичных плейлистов. Личная Wave/library/likes/feedback остаются strict; закрытые списки не обходят проверку доступа. Startup welcome теперь правильно объясняет, что поиск/чарт/публичные плейлисты работают без аккаунта.

Проверки:42app+6probe RustPASS/10ignored,ClippyPASS;явный anonymous live_guest_cataloguePASS без чтения credentials (search и3типа коллекций). ActualWindowsnative уже в состоянии missing: guestsearch/artists/albums/publicplaylist/chartPASS;Wave/libraryотклонены;basicnativePASS. Renderer74PASS+1opt-in skipped, включая гостевое воспроизведение из поиска/чарта через mockYT, отсутствие реакций без входа и отказ privateplaylist без смены музыки. TS/buildPASS. Ordinarydebugexe обновлён. Нативный реальный YouTube именно в гостевом сценарии отдельно не прогонялся; плеер/подбор не менялись. APIpersonalpreferences/tokenstore тестами не менялись.

## Учёт прослушивания и альтернативы — 2026-11-05

Реализован локальный listening lifecycle: observed PLAYING elapsed (безpause/buffer/seek), source, полная длительность YouTube, причина/время окончания. История показывает источник, прослушанное время и причину. Restore той же версии сохраняет event; repeat/newPlay создаёт отдельный. SQLitev4 с резервной копией v1/v2/v3, монотонным checkpoint/первой terminal reason, безопасным clear и interrupted/shutdown recovery. ADR027. Q06/quickskip не утверждался/не применялся, внешние Яндекс playback feedback пока не отправляются.

По последнему уточнению пользователя карточки альтернатив108px (вместо промежуточных120), шрифты11/10; место под список увеличено до clamp220px/36vh/320px. Слот сохраняет высоту при hidden/loading, обзор не прыгает.

Проверки PASS:44app+6probeRust/10ignored,Clippy,11TSunit;renderer76PASS+1opt-in skipped, затем finalCSSlayout1PASS. Windowsnative realYouTube muted playback накапливает listening; пауза+seek не добавляют время; quality reload сохранил историю, fullscreen/CC/tray/hidden timeline/media/simulatedpower/history/repeat/mini/topmost/instancePASS. Native storage bridge+historyUI/source/time/reason/lateprogressafterclearPASS. Native normalQuit закрывает synthetic незавершённую метрику в SQLite с shutdown (проверка readonlyNodeSQLite после выхода). Тесты изолированы, пользовательские credentials/preferences не менялись. После подтверждённого выхода пользователя normaldebugexe успешно обновлён. Физический sleep и аварийная точность полного аудиопотока этими тестами не доказаны.

## Session feedback и реальная синхронизация — 2026-11-05

Native WaveRefregistry привязывает каждую позицию, включаяповторы, к account/session/batch; новыйsession не переименовывает старыйбуфер. SourceIPC выдаёт opaque waveRef, UID/session/batch не выдаются. SQLitev5: отдельнаяперсистентная очередьWaveevents; radioStarted/trackStarted/trackFinished/явныйskip; фактические listenedseconds безперемотки/паузы. Технические окончания не отправляются какnegative skip/dislike; libraryreactionsотдельно. Локальнаядедупликация/сохранённыеACK, UIDфильтр, credentialcheckпередкаждойотправкой, TTL24ч/8attempts/backoff, testModeвнешниезаписиблокирует. GlobalhistoryWriter +clear barrier сохраняютпорядок и не восстанавливаюточистку. NativeExit сохраняетпозитивнонаблюдённыйlastwatermark. ADR028.

PASS:51app+6probeRust/10ignored,Clippy,11TSunit;renderer77PASS+1opt-in skipped. Native readonly настоящиеWavebatchrefsPASS, и новая/следующаяпорции безлоговUID/session. NativetestModewaveguard/source/history/metrics/clear/mini/topmost/maximized/instance/normalExitPASS. Ordinarydebugexe успешнообновлён после подтверждённоговыхода. Пользователь включилWave и подтвердил положительныйstatusбезошибки; readonlyагрегаты личнойSQLite (только schema/count/status/eventtype) показали schema5, sent radioStarted2/trackStarted5/skip3/trackFinished1, pending0. Рекомендации тестами не менялись: это реальные пользовательские действия. Пользователь подтвердил «ставлюлайквEncore→появляетсявприложенииЯндекса». Обратная ручнаясинхронизация и realdislike/Undo ещё не подтверждены, Q06 не согласован.

## Интерактивная очередь и подгрузка — 2026-11-05

Реализованы REQ054/055: кнопки в строках, ordinal/generation selection, текущая/предыдущие/следующие позиции, согласованное продолжение после выбранной, защита от поздних matching/Next/порций. Queue-scroll загружает следующую Waveпорцию у нижнего края, не запускает музыку и не смещает current/scroll; coalescing/retry/около500futurebuffer. Ранее существовавший rollingpast50 сохранён, render выполняется после trim. Debounced focus-read реакций обновляет внешний like/unlike без Set.

PASS:12TSunit,82renderer+1opt-in skipped,check/build;последний маленький переносrenderпослеtrim дополнительно4queuePASS и новыйbuildPASS. Native basic/metrics/storage/mini/topmost/maximized/instancePASS. ENCORE_QUEUE_SMOKE native click→выбраннаяпозиция→ручнойNext→назад→1cuediframePASS. Два прогона настоящего stream/END на M7lc1UVf-VE не завершились из-за buffering/recovery, JSerrorsпусты; НЕ считать native END-next проверенным. END-next и поздниеответы проверены renderer, настоящийYT/listening былPASS в предыдущемсрезе. После userexit normaldebugexe успешно обновлён. Native-testбинарник до последнего переносаrender, перед новымnativeсобрать заново. Usercredentials/предпочтения тестами не менялись.
