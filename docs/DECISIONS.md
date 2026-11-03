# ADR-001 — Переносимое приложение

Дата: 2026-11-03. Решение пользователя: Windows, Linux и macOS — целевые платформы.

Tauri 2 + TypeScript — экспериментальный shell. Общая музыкальная логика и контракты не зависят от ОС. Будущий backend — Python; в текущем каркасе отсутствует.

Платформенные адаптеры: endpoint routing/lifecycle, audio capture, media session, power management, secure credential storage, monitor identity. WASAPI/SMTC применимы только к Windows; Linux и macOS требуют отдельных исследований. Не подменять выбор endpoint системным default.

WebView2 (Windows), WebKitGTK (Linux), WKWebView (macOS) проверяются отдельно. Один успешный embed не доказывает другие платформы. Если Tauri не удовлетворяет обязательным требованиям, решение пересматривается после spike.

Исходное ТЗ описывает Windows 11. Новое требование пользователя расширяет платформы; остальные продуктовые инварианты сохраняются. Статус каждой ОС фиксируется отдельно.

## ADR-002 — Изолированный read-only probe Яндекса

Для S1 используем отдельную opt-in Rust CLI-утилиту с токеном только в памяти. Это позволяет проверить внешний API до реализации Python sidecar и защищённого постоянного хранилища. Утилита не является production source adapter, не принимает HTTP-команды от UI и не имеет общей playback state. Токен не попадает в frontend. Наличие legacy rotor не доказывает полный My Wave. Решение о production backend остаётся открытым до результатов spike.

### Уточнение ADR-002

Probe расширен до session API. Создание server session — отдельное действие на стороне сервиса; утилита больше не называется строго read-only в режиме по умолчанию. Не отправляет playback feedback. --legacy сохраняет первоначальный GET-only сценарий. Production-архитектура не изменена.

## ADR-003 — Вертикальный desktop-прототип без Python sidecar

Для проверяемого среза source → очередь → ручной клип используем Rust native source adapter и один TS PlaybackQueue. Native session.received хранит только список уже полученных ID для API prefetch, а не второй playback cursor. UI — один клиент/один плеер; мобильный пульт ещё отсутствует. Единственный cursor сейчас в TS, при добавлении нескольких окон/пульта его потребуется перенести в общий coordinator до выпуска этих функций.

Python sidecar остаётся архитектурным предложением, не реализованным компонентом. На этапе spike не добавляем второй транспорт и процессы ради простых source-запросов; тяжёлый синхронный HTTP/credential store выполняется через spawn_blocking, source операции сериализуются mutex. UI получает только метаданные, без token/session ID.

## ADR-004 — Постоянный секрет через хранилище ОС

CLI сохраняет токен только при явном --save-token после успешной авторизации. Desktop читает его из хранилища; Windows Credential Manager, macOS Keychain, Linux Secret Service выбраны явно через keyring 3.6.3 features. При недоступности хранилища — ошибка, без mock/plaintext fallback на поддерживаемых ОС. --forget-token удаляет только локальную запись. Windows OS store roundtrip проверен синтетическим credential с удалением, затем пользователь сохранил реальный token, native source fetch успешно его использовал. Linux/macOS пока не проверены аппаратно. Автоматическое получение/обновление токена и Device Flow остаются отдельной задачей.

## ADR-005 — Миниплеер в существующем окне

Меняем только layout и размер существующего native-окна. Тот же IFrame, тот же source/queue/cursor, без пересоздания и второго звука. Явный topmost через Tauri, без автофокуса; исходное положение/размер/maximized/fullscreen хранятся в памяти до выхода из mini. Нет сохранения этих параметров между полными запусками. Windows resize/restore, maximized roundtrip, системный topmost flag и single-instance guard подтверждены native WebDriver. Linux/macOS требуют проверки оконного менеджера.

## ADR-006 — Экспериментальный metadata search без отдельного Python процесса

S10 реализован небольшим Rust adapter по наблюдаемой публичной search-схеме YouTube Music. Перед интеграцией выполнен metadata spike; форма ответа проверяется и результаты консервативно фильтруются. Это эксперимент, не обещание стабильности неофициального API. Альтернатива — официальный YouTube Data API с отдельным ключом/квотами. Не добавляем Python interpreter только ради этого запроса; provider можно заменить за native command search_videos. Не запрашиваем медиа, авторизацию или обход ограничений. Ошибки и отсутствие безопасного совпадения оставляют трек текущим и ручной URL доступным.

## ADR-007 — Системная маршрутизация звука

Явное решение пользователя 2026-11-03: отдельный выбор выхода не нужен, управляет Windows. Используем системную маршрутизацию на desktop-платформах, без selector/sticky endpoint. REQ-022 superseded, S4 снят с обязательных gates. Незакоммиченный диагностический эксперимент удалён из кода; настройки Windows не изменялись. Один источник/громкость приложения/no-autoplay на запуске и wake сохраняются.

## ADR-008 — SQLite для ручных привязок и истории стартов

Сохраняем одну ручную video-привязку на трек и историю фактических стартов в нативном SQLite (rusqlite bundled), без нового sidecar. DB path задаётся через Tauri app_data_dir, данные отдельно от credential store. Полная история listened duration, source/reason, несколько избранных/random/no-repeat и действия Play Next/Append из истории ещё не реализованы. Это не завершение REQ-006/014 целиком.

playback_id идемпотентен на pause/resume. UI использует immutable metadata текущей загрузки, поздний результат запуска source не заменяет выбранную историю. Unknown/newer schema fail-closed без удаления. Тесты native UI запускаются с ENCORE_TEST_DATA_DIR только в debug-сборке, status.testMode проверяется перед записью/очисткой fixture. Личную БД тесты не меняют. Реальный пользовательский startup всегда создаёт новую My Wave-сессию без autoplay, история автоматически не возобновляется.

## ADR-009 — Канал не равен исполнителю; популярность подходящих кандидатов

Пользователь сообщил Living Dead Beat / Children Of Bodom и указал на ошибку сравнения канала с исполнителем. Убрано обязательное совпадение byline; UGC по заголовку группа+песня проходит независимо от канала. Playthrough/backing/instrumental, каверы и реакции фильтруются по названию, а не имени канала. Подходящие уверенные кандидаты сортируются по числу просмотров, score остаётся tie-break; нет обещания найти максимум по всему YouTube, сравниваем только полученную выдачу. Сомнительные варианты показаны отдельными кнопками для выбора. Регрессия по обезличенной публичной выдаче конкретного запроса сохранена fixture.

## ADR-010 — Каталог Яндекса и конечные очереди

Native catalogue adapter повторно использует защищённый API transport. UI получает только нормализованные metadata, IDs и owner UID для адресации публичного плейлиста. Search type=all, server correction включён; нет собственного словаря транслитерации. Просмотр отделён от выбора источника. Коллекции создают конечную очередь с контекстом pagination, источник Wave не подставляется по достижении её конца. Поздние source-init/search/collection результаты не могут заменить явно выбранную пользователем очередь.

## ADR-011 — Previous/repeat-one и несекретные volume preferences

У Previous монотонные часы performance.now и отдельный gesture state (3 секунды). Сейчас движение назад ограничено текущей очередью; cross-source playback stack ещё отсутствует. Repeat-one пересоздаёт цикл того же клипа, пишет отдельный history event после фактического Play. Несколько favourite-вариантов/random/no-repeat и repeat-queue ещё не реализованы.

Volume/mute — JSON под ключом encore.volume.v1 в origin-localStorage WebView. Это UI-предпочтения без credentials; OAuth туда не попадает. Некорректные/недоступные preferences не препятствуют запуску, ошибка записи видима. Default 50%, full launch не запускает музыку независимо от сохранённых настроек. Native smoke сохраняет/восстанавливает исходную volume preference, чтобы временный volume=0 не оставался у пользователя.


## ADR-012 — Трей, системные media controls и sleep/wake

CloseRequested скрывает окно только при успешно созданном трее; без трея остаётся обычное закрытие. Open/повторный запуск показывают прежнее окно, снимают minimize и сохраняют сессию. Выход — отдельное действие app.exit, без перехвата OS shutdown. Tray Play/Pause, SMTC/MPRIS/Now Playing отправляют команды существующему TS-координатору, без global keyboard hook или второй очереди.

Souvlaki 0.9.3 владеет native media controls на Tauri event-loop thread (thread_local, важно для macOS). Метаданные/состояние публикуются из реальных IFrame событий; progress обновляется раз в 2 секунды, revision отсекает поздние сообщения. На Windows Chromium HardwareMediaKeyHandling выключен, чтобы собственный обработчик WebView не дублировал SMTC. См. [API Souvlaki](https://docs.rs/souvlaki/0.9.3/souvlaki/).

Sleep/wake наблюдает tauri-plugin-power-monitor 0.1.0 ([API](https://docs.rs/tauri-plugin-power-monitor/0.1.0/tauri_plugin_power_monitor/)). Suspend/resume отменяют play intent, сохраняют очередь и позицию без новой Wave-сессии. До явного Play поздний PLAYING снова ставится на паузу. Возможен отказ OS listener; реальный sleep и аппаратные медиаклавиши требуют ручной проверки. Linux зависит от logind, альтернативные окружения ещё не проверены.

На Windows во время фактического PLAYING применяется thread-local SetThreadExecutionState SYSTEM_REQUIRED + DISPLAY_REQUIRED; пауза, suspend/resume и полный Exit снимают запрос. Ручной сон/lock не блокируются. Linux/macOS idle inhibition ещё не реализован. Native smoke имитирует события suspend/resume, не усыпляет компьютер и не выдаёт этот результат за аппаратную проверку.

Две macOS arm64 CI jobs не получили hosted runner из-за capacity constraints, без запуска шагов. Добавлен независимый macos-15-intel; arm64 job сохранён. [Доступные стандартные labels GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).


## ADR-013 — Вставка истории без смены источника

History Next/Append добавляют сохранённый video ID, не меняют текущий player/play intent и сохраняют исходный режим Wave/конечной коллекции. Без source queue активный manual video становится первым элементом конечной очереди; без активного видео история подготавливается paused. ordinal теперь стабильный ID элемента внутри generation, а позиция хранится cursor отдельно: вставка не переназначает поздний match на другой трек. Для ahead/end используются явные методы очереди, не арифметика ordinal.

Дополнительно revision-фильтр media update вынесен перед power request, чтобы отсутствие media backend не позволяло старому PLAYING задержать снятие idle inhibition.

## ADR-014 — Локальная macOS-поправка power-monitor 0.1.0

CI выявил native link failure _IOPSRelease в зависимости. Минимальный vendor patch сохраняет upstream 0.1.0 и лицензии, удаляет отсутствующую FFI-функцию и использует CFType create-rule RAII для CFRelease snapshot. [Apple указывает CFRelease для результата IOPSCopyPowerSourcesInfo](https://developer.apple.com/documentation/iokit/1523839-iopscopypowersourcesinfo). Cargo patch лежит в src-tauri/Cargo.toml; происхождение и условие удаления описаны в vendor/tauri-plugin-power-monitor/ENCORE-PATCH.md. Это не отключение sleep/wake на macOS.
