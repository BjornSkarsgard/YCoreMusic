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
