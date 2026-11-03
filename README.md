# Encore

Личный музыкальный телеканал. Целевые платформы: Windows, Linux, macOS.

Сейчас: прототип Этапа 0, не готовый музыкальный сервис.

## Запуск

Node.js 22.12+:

```powershell
cd apps/desktop
npm ci
npm run dev
```

Открыть http://localhost:1420. Это браузерная проверка, не проверка desktop.

Для desktop дополнительно нужны Rust и системные зависимости Tauri:
https://v2.tauri.app/start/prerequisites/

```powershell
npm run desktop
```

Проверки: `npm run check`, `npm test`, `npm run build`.

Документация: [ТЗ](docs/00-README.md), [решения](docs/DECISIONS.md), [статус](docs/IMPLEMENTATION-STATUS.md).

Windows debug executable после сборки: `apps/desktop/src-tauri/target/debug/encore.exe`.
UI smoke test (с подменённым YouTube API): `npm run test:ui`. Локально использует установленный Chrome; в CI — Playwright Chromium. Для CI браузер устанавливается через `npx playwright install chromium --with-deps`.

## Подключение аккаунта в текущем прототипе

В PowerShell один раз выполните:

```powershell
& 'C:\Users\Skar\Documents\Encore\apps\desktop\src-tauri\target\debug\yandex-probe.exe' --save-token
```

Ввод токена скрыт; после проверки аккаунта он сохраняется в системном хранилище (Windows Credential Manager / macOS Keychain / Linux Secret Service). На Windows сохранение и чтение из desktop проверены. На Linux/macOS эти операции ещё требуют проверки. Нет fallback в открытый файл. Удаление сохранённого доступа: та же утилита с `--forget-token` (это локальное удаление, не отзыв на стороне Яндекса).

При запуске Encore создаёт новую сессию без autoplay. Есть очередь, загрузка следующей порции, ручной переход к следующему треку и привязка YouTube-ссылки к текущему треку. Автоподбор, автоматическое продолжение эфира, история и синхронизация playback feedback пока отсутствуют.

«Миниплеер» меняет вид и размер того же окна/плеера, «Поверх окон» включает topmost явно. Из развёрнутого окна можно перейти в минирежим и обратно. Размер и topmost пока не сохраняются между полными запусками.

## Native smoke test (Windows, opt-in)

Нужны `tauri-driver` в PATH (`cargo install tauri-driver --locked`) и Edge WebDriver той же версии, что установленный WebView2. Путь драйвера задаётся ENCORE_EDGE_DRIVER, либо `.tools/edgedriver/msedgedriver.exe`. Собрать desktop перед проверкой.

```powershell
$env:ENCORE_LIVE_YANDEX='1' # Только если пользователь уже подключил аккаунт
$env:ENCORE_LIVE_YOUTUBE='1' # Реальный YouTube, громкость 0
node scripts/native-smoke.mjs
```

Тест запускает отдельное native-окно, проверяет source session/следующую порцию, Play/Pause/seek, mini/topmost и single instance, затем закрывает окно. Токен и ответы API не выводятся. Авторизованный тест создаёт рекомендационную сессию, но не отправляет feedback о прослушивании. Уже открытый Encore нужно закрыть перед тестом.
