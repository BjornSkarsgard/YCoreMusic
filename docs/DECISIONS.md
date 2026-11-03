# ADR-001 — Переносимое приложение

Дата: 2026-11-03. Решение пользователя: Windows, Linux и macOS — целевые платформы.

Tauri 2 + TypeScript — экспериментальный shell. Общая музыкальная логика и контракты не зависят от ОС. Будущий backend — Python; в текущем каркасе отсутствует.

Платформенные адаптеры: endpoint routing/lifecycle, audio capture, media session, power management, secure credential storage, monitor identity. WASAPI/SMTC применимы только к Windows; Linux и macOS требуют отдельных исследований. Не подменять выбор endpoint системным default.

WebView2 (Windows), WebKitGTK (Linux), WKWebView (macOS) проверяются отдельно. Один успешный embed не доказывает другие платформы. Если Tauri не удовлетворяет обязательным требованиям, решение пересматривается после spike.

Исходное ТЗ описывает Windows 11. Новое требование пользователя расширяет платформы; остальные продуктовые инварианты сохраняются. Статус каждой ОС фиксируется отдельно.
