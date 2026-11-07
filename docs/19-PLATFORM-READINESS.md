# macOS preview — 2026-11-07

Пакетные CI-прогоны на `8ddc89e` прошли для [Intel](https://github.com/BjornSkarsgard/YCoreMusic/actions/runs/42381308979)
и [Apple Silicon](https://github.com/BjornSkarsgard/YCoreMusic/actions/runs/42381311116).
В обоих DMG отдельно проверены CPU-архитектуры исполняемого Mach-O.
Локальные артефакты владельца лежат в `Downloads/YCoreMusic-macOS-preview-0.0.3`.
Это базовая версия 0.0.3 без экспериментального пульта. Нативная приёмка
на Mac, Developer ID и нотариализация остаются открытыми. Оконные зеркала
и захват аудио процесса для визуализаторов требуют отдельных macOS-адаптеров.

# Актуализация Linux — 2026-11-06

Новый X11-срез реализует single host, Cairo mirrors, PulseAudio/PipeWire-Pulse FFT и XRandR/EDID. Настоящая проверка двух мониторов с обычным GPU PASS. Подробная матрица и оставшиеся проверки: [21-LINUX-READINESS.md](21-LINUX-READINESS.md). Таблица ниже описывает предыдущее состояние; отсутствие Linux adapters в ней уже историческое. Wayland и macOS этим срезом не подтверждены.

# Проверка переносимости — 2026-11-06

Порядок согласован пользователем: стабилизировать текущий Windows-срез, рано
проверить переносимость, продолжать общие функции с проверкой сборок трёх ОС.
Это не обязательство немедленного паритета всех платформ и не публичный релиз.

## Что уже общее

TypeScript/Vite UI, очередь/coordinator, каталог/подбор, история SQLite,
отложенные реакции, таймер сна и crash checkpoint не требуют второго приложения.
OAuth, keyring, media controls, tray, fullscreen, power lifecycle имеют native
зависимости и требуют проверки на каждой ОС даже при успешной компиляции.
Стабильные identifiers/keyring/формат настроек сохраняются.

| Подсистема | Windows | Linux / macOS |
|---|---|---|
| Основное видео | Один dedicated WebView2 host | Один встроенный iframe; runtime ещё проверить |
| Дополнительные видеоокна | DWM mirrors, native PASS | Адаптер отсутствует; второй iframe не допускается |
| Реакция визуализаторов на звук | WASAPI process loopback | Адаптер отсутствует; не заменять общим миксом/микрофоном |
| Идентичность монитора | Native стабильный ID при однозначной конфигурации | Временный fallback; постоянный ID ещё не реализован |
| Per-monitor восстановление | Проверено на имитации отключения | Пока зависит от отсутствующего mirror adapter |
| Общий интерфейс и данные | Работают | Компиляция/renderer CI существуют; живую приёмку повторить |

`platform_capabilities` сообщает реализованные videoMirrors/audioAnalysis с учётом
feature flags. UI отключает недоступные варианты, объясняет ограничение.
Сохранённый основной Spectrum временно отображается как видео, предпочтение
сохраняется для будущей сборки с адаптером. Windows без audio-analysis может
показывать зеркала видео, но не предлагает визуализатор. Backend продолжает
проверять поддержку независимо от disabled UI. Никакой OS spoofing.

## Следующий технический этап

1. На Linux X11 запустить существующий native-linux workflow и затем обычный
   пользовательский сеанс: YouTube Play/Pause/seek, OAuth, keyring, миниплеер,
   tray, фон. Изолированный профиль, без записи реакций ради проверки.
2. Проверить тот же минимум на Wayland отдельно. Успех Xvfb/X11 не переносить
   на Wayland, GPU/video/fullscreen и реальную маршрутизацию звука.
3. Сборки macOS Intel/Apple Silicon в CI; запуск на настоящем Mac и ручной
   checklist. До этого статус experimental, не hardware-supported.
4. Отдельный spike локального показа единственного видео на нескольких экранах
   и захвата только своего audio на каждой ОС. Проверять действующие кадры,
   hidden/tray/controls-only, отсутствие повторного потока, системные разрешения.
   Не обещать выбор конкретного механизма до доказательства.
5. Только после результатов определить продуктовые ограничения и полноценные
   платформенные adapters, затем пакеты и расширение архитектур.

Существующая `.github/workflows/desktop.yml` собирает Windows, Ubuntu24.04,
macOS Intel и Apple Silicon. Это четыре сборочные цели, а не шесть-восемь
проверенных сочетаний. Новые ARM/Linux/Windows цели требуют отдельной приёмки.
`native-linux.yml` — opt-in headless GTK/X11 smoke; `package.yml` — только
артефакты без публикации. Они не подтверждают работу с реальным HDMI/аудио.

## Проверенный текущий срез

Windows native `YCORE_STABILITY_SMOKE=1` дважды PASS: шесть disconnect/reconnect
через test-only фильтр manager; VIDEO и Particles/FPS30/low восстановлены на том
же ID, timeline продолжался, engine epoch не менялся. Off отсутствующего экрана
не воскресает. Отключение сети только в тестовых main и source WebView: Pause
сохраняется после reconnect, explicit Play возобновляет timeline одного engine.
ОС/сетевые адаптеры/физические дисплеи не переключались.

Локально Linux/macOS runtime нет. Через CI snapshotd4be2a8 прошёл Windows,
macOSIntel/macOSARM; snapshot0ca7d07 — Ubuntu build+renderer. Настоящий GTK/X11
native run42207934319 SUCCESS после X11 topmost fix и проверки background
restore. LiveYouTube/LinuxAudio/Wayland ещё не проверены. Текущие новые updates
требуют отдельной новой cross-platform проверки. Физический HDMI остаётся отдельно.

После правки topology-проверки YCORE_LIVE_WAVE=1 PASS: настоящий Яндекс/YouTube,
два автоматических перехода по реальному END (seek близко к концу для ускорения),
один native iframe и ноль iframe в controller. Не выдавать за 30-минутный soak.

Последующий неускоренный30минутный Windows soak PASS:6переходов,
357playing/2waiting samples, maxobservedgap5сек приpoll5сек, одинhost/0UIiframe.
Предыдущий ускоренный сценарий выше остаётся отдельной проверкой.
