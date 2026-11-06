# Обновления приложения — REQ-066

Реализация 2026-11-06: официальный tauri-plugin-updater, собственный main-only
координатор updates.rs, UI updates.ts в существующих настройках. Без второго
плеера, отдельного приложения, сайта или LAN-пульта.

## Поведение

- Проверка при запуске не чаще раза в сутки после успешной проверки; ручная
  кнопка доступна в настройках. Проверка не останавливает клип и не открывает
  модальное окно. Новая версия отмечается на кнопке настроек.
- Подробнее: версия, текст изменений, скачивание, «Напомнить завтра».
  Откладывание привязано к версии и сохраняется локально между запусками.
- Скачивание и установка разделены. Скачивание может идти во время музыки.
  Установка требует отдельного нажатия после паузы, native повторно проверяет
  playback state. Во время установки coordinator не принимает новый Play/load.
- Пакет проверяется до Ready и повторно перед установкой. Некорректная подпись
  не позволяет перейти к установке. Ошибка оставляет прежнюю версию, доступен
  повтор скачивания. Никакой автоматической установки посреди клипа.
- Прогресс опрашивается раз в секунду; монотонная revision защищает от старого
  Read/event, способного отменить состояние Installing. Release notes — только
  textContent, не HTML/Markdown с исполняемыми элементами.
- Для isolated debug profile любые реальные Check/Download/Install отключены;
  отдельный probe только проверяет безвредную подпись без сети/установки.

## Доверие и данные

Публичный ключ закреплён в updater-public.key и tauri.conf.json, unit проверяет
совпадение. requireSignedVersion=true: подпись связывает байты и объявленную
версию. Feed — фиксированный HTTPS GitHub latest.json; разрешены только release
assets BjornSkarsgard/YCoreMusic без стороннего host/credentials/query/fragment.
TLS validation не отключена, downgrade не разрешён.

HEAD отличает отсутствие первого release (404) от сетевого/серверного отказа;
не называть любой отказ отсутствием обновлений. Затем официальный updater
выбирает пакет ОС/архитектуры. Старые сохранённые credentials/account/history
не передаются серверу обновлений. Stable app identifier остаётся прежним.

Перед выходом installer/restart вызывается тот же prepare_exit, что и при
обычном Quit: clean crash marker и завершение открытых метрик SQLite. Медиа
состояние сохраняется и без работоспособного SMTC, чтобы install guard не
зависел от availability системных кнопок.

## Ключ и сборка

Создан локальный приватный ключ владельца:
`C:\Users\Skar\.tauri\YCoreMusic-updater.key`.
Он не находится в репозитории, не отправлен в GitHub Secrets и не опубликован.
Не генерировать его повторно и не перезаписывать. До публичной доставки владелец
должен сохранить защищённую резервную копию: потеря ключа нарушит цепочку
обновлений уже установленных версий. В репозитории только публичный ключ и
подпись безвредной текстовой test fixture, не исполняемый пакет.

Обычные dev/unsigned package команды не требуют приватного ключа. Подписанная
тестовая Windows упаковка (не запускает установщик):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Join-Path $env:USERPROFILE '.tauri/YCoreMusic-updater.key'
npx tauri bundle --debug --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.updater.conf.json --bundles nsis
```

Запуск из apps/desktop. Для подписанной release сборки использовать tauri build
с теми же config, ключом и версией. Отдельный updater overlay включает
createUpdaterArtifacts. Сначала обновить application version согласованно,
не подменять версию только в manifest.

`scripts/build-update-manifest.mjs` создаёт локальный latest.json из готовых
пакетов/.sig, проверяет platform/формат/дубликаты и наличие текущей версии в
trusted comment. Пример из корня:

```powershell
node scripts/build-update-manifest.mjs --entry 'windows-x86_64=apps/desktop/src-tauri/target/debug/bundle/nsis/YCore Music_0.0.1_x64-setup.exe' --output .tools/latest.json
```

Для других готовых целей повторять --entry. Скрипт ничего не публикует и не
читает приватный ключ. Собран signed debug NSIS0.0.1, 5.19MiB, рядом .sig;
локальный manifest создан. Установщик не запускался. Public releases отсутствуют,
поэтому фактическую доставку новой версии и замену установленного приложения
ещё надо проверить отдельно в VM/тестовой установке после решения о выпуске.

## Проверки

Rust74PASS/9ignored, Clippy/fmt/build PASS. Renderer125PASS/1skip перед revision
guard, затем4 targeted PASS (updates/error/defer/signature UI/stale/lock).
Native ENCORE_UPDATES_SIGNATURE_SMOKE=1 PASS: настоящая подпись принимается,
изменённые байты, другая объявленная версия и downgrade отклоняются;
install в testMode отключён. Общие SQLite/mini/topmost/instance PASS.
Нет имитации успешной установки на пользовательский компьютер.

Основание: [официальный Tauri updater](https://v2.tauri.app/plugin/updater/),
проверенный исходный код tauri-plugin-updater2.14.1 в Cargo registry.
