# Статус реализации Encore

## Этап 0

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
