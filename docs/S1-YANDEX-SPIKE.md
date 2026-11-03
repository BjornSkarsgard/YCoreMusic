# S1 — Яндекс: проверка интеграции

## Подтверждено пользователем, 2026-11-03

Windows: account/status PASS; legacy rotor user:onyourwave вернул 5 треков. Порядок сохранён. Это PARTIAL S1, не готовая «Моя волна». Секреты не передавались в чат.

## Текущая утилита

В PowerShell:

```powershell
& 'C:\Users\Skar\Documents\Encore\apps\desktop\src-tauri\target\debug\yandex-probe.exe'
```

Токен вводится только в локальный скрытый prompt. Не передавать через аргументы, чат, CI, файл или URL. Утилита не сохраняет credentials и не читает браузерные cookies. При новом запуске токен потребуется снова.

Без аргументов: проверка аккаунта, POST rotor/session/new с seed user:onyourwave и includeTracksInResponse=true, затем POST rotor/session/{id}/tracks. В queue передаются уже полученные IDs в их порядке; feedback не передаётся. Новая сессия создаётся на сервере, без autoplay и без каких-либо сообщений о прослушивании. Настройки рекомендаций/explicit/child не переопределяются.

Цель — минимум 20 полученных записей и хотя бы один запрос следующей порции. Порядок и повторы внутри ответов сохраняются; записи не называются уникальными треками. Максимум 10 порций. Одинаковая подряд порция, пустая выдача, unknownSession, terminated или ошибка прекращают проверку. Бюджет не пополняется фиктивными skips/прослушиваниями. Истинность session ID и server order оцениваются по контракту API, а не путём сравнения с веб-плеером.

С аргументом --legacy: только исходная проверка account/status + GET первой порции legacy rotor; этот режим уже проверен пользователем.

Сборка из исходников:

```powershell
cd C:\Users\Skar\Documents\Encore\apps\desktop\src-tauri
cargo build --features yandex-probe --bin yandex-probe
```

HTTPS с проверкой TLS, редиректы запрещены, сетевые таймауты 10/20 секунд, ограничение ответа 2 МБ. В stdout — категории результата и track IDs с ordinal. Личность аккаунта, session ID, полные тела ответа и credentials не выводятся. Token buffer очищается при освобождении; HTTP-библиотеки могут создавать собственные копии в памяти.

## Проверки и ограничения

5 Rust unit-тестов PASS: порядок/повторы, неправильная схема, секретный заголовок, session ID без подмены пути, завершённая/неизвестная/пустая сессия. Clippy PASS, Windows binary собран.

Новый session-сценарий подтверждён пользователем 2026-11-03 на Windows: авторизация PASS, создание сессии PASS без autoplay, 20 записей через 4 порции по 5, Session fetch PASS. Это результат присланного вывода утилиты; агент не наблюдал запуск напрямую. Даже получение 20+ записей означает успех fetch-проверки, а не полную готовность S1: lifecycle desktop, реальные playback feedback, сетевые ошибки и сохранение порядка при асинхронном подборе видео проверяются отдельно.

## Следующие проверки

- Новая desktop-сессия на полном запуске, сохранение при скрытии окон, отсутствие autoplay.
- Поведение при offline, expired token, rate limit; не терять очередь и не переключать источник самовольно.
- Перед production-интеграцией: системное защищённое хранилище и вход через браузер/Device Flow. Audio fallback S2 — отдельная проверка доступа и условий использования.

## Источники наблюдаемого контракта

- https://github.com/MarshalX/yandex-music-api/blob/main/yandex_music/_client/rotor_sessions.py
- https://github.com/MarshalX/yandex-music-api/blob/main/yandex_music/rotor/rotor_session.py
- https://github.com/MarshalX/yandex-music-api/blob/main/yandex_music/rotor/rotor_session_tracks.py

Это неофициальный API. Изменения контракта должны давать явную ошибку, а не фиктивный успех.

