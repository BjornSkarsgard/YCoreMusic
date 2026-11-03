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
