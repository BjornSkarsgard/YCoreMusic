# Сборка, установка, диагностика и безопасность

## Windows lifecycle
- Single instance; installer + Start Menu shortcut; tray icon с Open, Play/Pause, Exit (предлагаемое меню).
- Autostart OFF по умолчанию; при включении старт в tray и READY_PAUSED.
- Закрытие окон — hide, Exit — полное завершение всех дочерних процессов и power requests.
- Локальные пользовательские данные в AppData с бэкапом/миграциями, а не в каталоге установки.

## Build / development
- Зафиксировать версии Node, Rust, Python, WebView2 runtime, lockfiles, backend packaging.
- Dev mode: frontend + backend + native helper с логированием; prod mode: sidecar packaged, без необходимости глобально установленного Python.
- CI (или локальные скрипты): TS lint/typecheck, Python lint/typecheck, unit tests, migration tests, packaging smoke test.
- Не включать пользовательский Yandex token в тестовые fixtures.

## Диагностика
- Локальные структурированные логи, ротация и лимит размера.
- Разделить ошибки: auth, network, YouTube embed, queue, output device, WASAPI, monitor, pairing.
- Диагностический экран: версии компонентов, доступность backend, состояние API, выбранный endpoint, monitor IDs, состояние player generation.
- Экспорт логов только после явного действия, с удалением секретов.

## Security checklist
- OAuth token в Windows protected storage, не в JS localStorage/SQLite plaintext.
- Phone API: TLS strategy, approval pairing, credential revocation, rate limit, Origin checks, no Internet bind.
- HTTP endpoints на localhost и LAN разделены по правам, не доверять `localhost` автоматически без session auth.
- CORS deny-by-default; CSP и sandbox ограничения WebView2.
- Входные YouTube URL валидировать; запрещать arbitrary protocol/file URLs и команды оболочки.
- SQLite параметризованные запросы; никакого SQL из query string.
- Не внедрять прокси, adblock, download/DRM обход.

## Recovery / backups
- Автоматические SQLite migrations с проверкой схемы и безопасным backup перед изменениями.
- Повреждённая БД: информировать пользователя, не стирать историю без подтверждения.
- При обновлении приложения не сбрасывать избранные видео, историю, настройки дисплеев и доверенные устройства.
- При отключении аудиоустройства немедленно PAUSED, а после возврата не autoplay.

Реализована настройка автозапуска (REQ-043): собственный native API поверх официального Tauri plugin, defaultOFF без регистрации на init, запуск с --encore-autostart в трей/без autoplay. Подтверждение реального OSstate, retry/error внутри settings. В testMode запись OSautostart запрещена. Системная регистрация проверяется только по явному checkbox пользователя; тестовые прогоны её не включают.

Диагностика в настройках: версия/платформа, открыто ли хранилище, сохранено ли подключение. Кнопка проверки делает один readonly account/status; UI получает только enum состояния (connected/authdenied/network/ratelimited/service), без личности пользователя и токена. Начальный просмотр не утверждает, что сохранённый токен действителен. Экспорт структурированных логов ещё не реализован.

## Установочные пакеты (подготовка)

Обычная разработка использует прежнюю конфигурацию без упаковки. Отдельный src-tauri/tauri.bundle.conf.json включает bundler, существующие иконки и NSIS currentUser с Russian/English. Команды из корня репозитория:

- npm run package:windows --prefix apps/desktop — release NSIS.
- npm run package:linux --prefix apps/desktop — release DEB/AppImage.
- npm run package:macos --prefix apps/desktop — release APP/DMG.
- После обычной debug сборки: npm run bundle:windows:debug --prefix apps/desktop — пакет для тестирования.

GitHub Actions «Installation packages» запускается вручную для выбранной ОС и сохраняет артефакты на14дней, без публикации GitHubRelease. Идентификатор io.encore.desktop сохраняется: старое хранилище и OScredentials не меняют namespace. На Linux текущий runnerUbuntu24.04 определяет базовую ABI; совместимость с более старыми дистрибутивами ещё не проверена. macOS пакет пока без подписи/notarization, Windows без code signing. Это подготовка доставки, не завершённая приёмка чистой установки/удаления.

Локальный Windows debug NSIS0.0.1 собран успешно (3.72MiB); installer не запускался. Проверен сгенерированный NSIS: currentUser/userexecutionlevel; пользовательские AppData удаляются только отдельным явным checkbox при удалении, updateMode их сохраняет; startup entry сохраняется при update. Токен и пользовательская SQLite в пакет не включаются. Первоначальная настройка доступа пока использует локальный yandex-probe --save-token; полноценный вход из приложения ещё остаётся задачей.
