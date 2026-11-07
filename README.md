# YCore Music

**YCore** · Юкор Мьюзик  
**Your Music. Your Core, Your World.**

Актуальный выпуск — [YCore Music 0.0.4 для Windows x64, Linux x86_64 и экспериментальный macOS Intel/Apple Silicon](https://github.com/BjornSkarsgard/YCoreMusic/releases/tag/v0.0.4). [Изменения](docs/releases/v0.0.4.md).

Пульт для телефона подключается через «Настройки → Пульт» по QR-коду и может
устанавливаться как PWA. [Подключение и скриншоты](https://ycore-music.ru/#remote),
[история версий](https://ycore-music.ru/#changelog). Нативная приёмка macOS,
Developer ID и нотариализация пока не выполнены.

Исполняемый файл Windows — `YCoreMusic.exe`, репозиторий — [BjornSkarsgard/YCoreMusic](https://github.com/BjornSkarsgard/YCoreMusic).

Личный музыкальный телеканал для Windows, Linux и macOS. На Windows работает один YouTube engine с локальными зеркалами на дополнительных мониторах. Полный продукт и платформенная приёмка ещё не завершены; одинаковые многомониторные возможности Linux/macOS пока не реализованы.

**Вывод на телевизор:** кнопка «Экраны» в верхней панели → выбрать подключённый монитор → показать клип. Несколько экранов могут показывать один клип без повторной загрузки. Подробности, воспроизводимая native-проверка и ограничения: [один плеер и зеркала](docs/16-SINGLE-PLAYER-MIRRORS.md). Визуализаторы, hotplug и сохранение сцен ещё в работе.

## Что работает

- «Моя волна» и жанры Яндекс Музыки: подготовка клипов вперёд, автоматический обход неподходящих/недоступных видео, пополнение очереди. Порядок пригодных рекомендаций сохраняется.
- Поиск исполнителей, треков, альбомов и плейлистов; свои/сохранённые плейлисты, любимые треки, актуальный чарт и подборки.
- Альтернативные клипы с превью, просмотрами и длительностью. Несколько избранных видео для песни, случайный выбор без немедленного повтора.
- Лайки/дизлайки, Undo5сек, постоянная очередь синхронизации. Отсутствие клипа не становится дизлайком.
- Постоянная история с поиском и дозагрузкой старых записей; «сейчас», «следом», «в конец». Умная история продолжает загруженную очередь при отказе Яндекса и не возвращается в волну сама.
- Свои play/pause/seek/volume/repeat/субтитры; транспорт по центру, fullscreen HUD снизу с idle timeout. Один YouTube IFrame и один источник звука.
- Миниплеер и явное «поверх окон», трей, системные медиаклавиши, громкость/mute с сохранением. Аудиовыход выбирает ОС.
- Опциональный автозапуск в трей без музыки; диагностика подключения и хранилища в настройках.

Полный запуск создаёт новую Wave-сессию без autoplay. Закрытие окна скрывает его в трей; полный выход — в меню значка. После уведомления о пробуждении остаётся пауза до Play. Браузерный offline сохраняет трек/позицию, восстановление уважает Pause. YouTube может сбрасывать выбранное качество при пересоздании: ручная шестерёнка доступна через явную «Панель YouTube». Настройки встраивания не гарантируют удаления всех служебных заставок/брендинга.

В настройках добавлен вход в Яндекс через отдельное окно и отключение аккаунта. Завершение живой авторизации ещё проверяется; прежняя локальная утилита остаётся запасным способом.

Без входа доступны поиск, публичные исполнители/альбомы/плейлисты и чарт; их можно воспроизводить как клипы YouTube. Для персональной волны, своей музыки и реакций нужно подключение аккаунта.

## Разработка

Нужны Node.js24, актуальный stable Rust и [системные зависимости Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci --prefix apps/desktop
npm run desktop --prefix apps/desktop
```

`npm run dev --prefix apps/desktop` открывает браузерный preview на http://localhost:1420; реальные интеграции доступны в desktop. Debug build: `npm exec --prefix apps/desktop -- tauri build --debug --no-bundle`, executable — `apps/desktop/src-tauri/target/debug/YCoreMusic.exe`.

## Подключение Яндекс Музыки

Вход непосредственно из приложения ещё не реализован. Текущий способ — локальная утилита:

```powershell
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --features yandex-probe --bin yandex-probe
& './apps/desktop/src-tauri/target/debug/yandex-probe.exe' --save-token
```

Linux/macOS: `./apps/desktop/src-tauri/target/debug/yandex-probe --save-token`. Токен вводится только в скрытый prompt и хранится в Windows Credential Manager / macOS Keychain / Linux Secret Service. Токен не передаётся через чат, аргументы, файл или frontend. `--forget-token` удаляет локальный доступ, без отзыва на стороне Яндекса. Windows roundtrip проверен; платформенная проверка Linux/macOS остаётся открытой.

## Проверки

```powershell
npm run check --prefix apps/desktop
npm test --prefix apps/desktop
npm run test:ui --prefix apps/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features yandex-probe
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --features yandex-probe -- -D warnings
```

Для renderer тестов нужен Chrome или Playwright Chromium (`npx playwright install chromium --with-deps` из apps/desktop). Windows native smoke требует tauri-driver и Edge WebDriver версии установленного WebView2:

```powershell
npm run build --prefix apps/desktop
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --profile native-test --features tauri/custom-protocol --bin YCoreMusic
$env:YCORE_LIVE_YOUTUBE='1'
$env:YCORE_LIVE_LIBRARY='1'
node scripts/native-smoke.mjs
```

Используется отдельный instance/profile/SQLite в `.tools`, реальный звук выключен. Настоящие preference writes и OSautostart mutations запрещены тестовым режимом. `YCORE_AUTOSTART_SMOKE=1` проверяет запуск аргументом в трей, не регистрируя автозапуск; `YCORE_LIVE_RECOVERY=1` проверяет outage только собственного WebView через CDP. `YCORE_WAVE_SOAK_MINUTES=60` запускает настоящий неускоренный прогон, отдельный каталог задаёт YCORE_NATIVE_TEST_DATA_DIR. Тест не завершает пользовательский YCore Music.

## Установочные пакеты

| ОС | Команда | Форматы |
|---|---|---|
| Windows | `npm run package:windows --prefix apps/desktop` | NSIS, currentUser |
| Linux | `npm run package:linux --prefix apps/desktop` | DEB, AppImage |
| macOS | `npm run package:macos --prefix apps/desktop` | APP, DMG |

Отдельная bundle-конфигурация сохраняет привычную dev-сборку. После debug build доступна `npm run bundle:windows:debug --prefix apps/desktop`. Пакеты — в `apps/desktop/src-tauri/target/{debug,release}/bundle`. Workflow «Installation packages» сохраняет выбранный пакет как artifact, без публикации Release. Пакеты пока без подписи; чистая установка/удаление и platform runtime не объявляются проверенными по одному успешному bundler build.

## Фактические границы

Windows: настоящий час Wave без ручной помощи —16переходов, один IFrame; максимальная замеченная пауза около5сек при опросе5сек. Проверены реальный YouTube/CC/fullscreen/tray/mini, WebView network outage20сек и возвращение к последней буферизованной позиции. Это не гарантия100% доступности внешних сервисов. Физические sleep/lock и hardware media keys ещё требуют приёмки.

Вход из приложения, запись лайков и отправка прослушиваний подтверждены пользователем; обратная синхронизация и отдельные реакции требуют дальнейшей приёмки. Остаются порог quick-skip Q06, hotplug/persistence сцен, визуализаторы, мобильный пульт и полная приёмка Linux/macOS. Yandex audio fallback не реализован; в волне неподходящие клипы обходятся.

[ТЗ](docs/00-README.md) · [Принятые решения](docs/DECISIONS.md) · [Статус и журнал проверок](docs/IMPLEMENTATION-STATUS.md) · [Открытые вопросы](docs/13-OPEN-QUESTIONS.md)
