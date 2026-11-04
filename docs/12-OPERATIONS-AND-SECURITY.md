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
