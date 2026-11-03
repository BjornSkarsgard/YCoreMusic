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
