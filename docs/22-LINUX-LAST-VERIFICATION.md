# Передача следующему Codex: последние Linux-проверки

Дата: 2026-11-06. Пользователь предупредил об оставшихся 3% лимита и отдельно попросил сохранить результаты, чтобы следующая сессия не повторяла завершённое.

## Сначала прочитай

- docs/21-LINUX-READINESS.md — реализация, границы и оставшиеся задачи.
- Этот документ — журнал последних доказательств.
- docs/IMPLEMENTATION-STATUS.md и верх SESSION-HANDOFF.md. Нижние старые записи про отсутствие Linux mirrors/audio и неработающий Play относятся к прошлому срезу.

## Что уже доказано — не запускать заново без причины

1. **Причина Linux playback blocker.** Один Referer не исправлял старт. Пробы autoplay policy, другого origin, loadVideoById, User-Agent и отключения ManagedMediaSource не решили его. Отключение MediaCapabilities официальным WebKit API дало настоящий Play. В production нет LD_PRELOAD/UA spoofing: временные диагностические helpers остались только в /tmp. Не возвращаться к перебору этих гипотез.
2. **Независимый источник.** Прозрачный mapped GTK player-host продолжает настоящий YouTube после скрытия main. Режим CONTROLS, Pause, seek и resume проверены. Истинное hide встроенного iframe раньше останавливало видео; это уже решено отдельным host.
3. **Локальные зеркала.** Изменяющиеся source snapshots 1920x1080 и меняющиеся пиксели видимого Cairo-зеркала проверены отдельно, PNG просмотрен. Затем проверены две дополнительные сцены: в main/сценах 0 iframe, у источника 1. Не подменять проверку кадров одним успешным вызовом snapshot.
4. **Четыре визуализатора.** Spectrum, Ambient, Liquid, Particles получали реальные FFT-кадры YouTube в main и отдельной сцене. Epoch источника не менялся, один настоящий player сохранялся.
5. **Изоляция звука.** Тот же C capture код проверен на частном PulseAudio null sink: свой сигнал 440 Гц amplitude ~0.19999, чужой 1000 Гц ~0.00001. При volume=0 RMS=0. Анализ до громкости НЕ сделан; не выдавать тишину при volume=0 за такой анализ. Никаких system mix/mic/default endpoint изменений.
6. **Оконный lifecycle.** Совмещённый native прогон подтвердил MPRIS Play/Pause, mini/restore, topmost on/off, maximized->mini->restore, single instance, autostart argument без регистрации в ОС, hidden background. GTK resize теперь подтверждается перед возвратом из команды; тесты также ждут обеих mini-анимаций/переходов. После seek тест ждёт фактического возобновления PLAYING.
7. **Сцены.** Независимое VIDEO/VISUALIZER, сохранение опций и simulated disconnect/reconnect без замены engine PASS. Исправлена публикация состояния при native restore/open: событие scene-windows-changed обновляет main. Renderer regression на позднее восстановление добавлен и пройден.
8. **Дополнительные native сценарии.** OAuth popup open/cancel, запрет credential mutation в testMode, sleep timer с настоящей Pause в трее, playback guard, проверка updater signature (valid/tamper/version/downgrade) PASS. Установка обновления тестами намеренно заблокирована.
9. **Защищённое хранилище.** Реальный GNOME Keyring в отдельной D-Bus с одноразовым зашифрованным vault: synthetic entry write/read/delete PASS. Это не личный OAuth пользователя. Два отдельных D-Bus теста ScreenSaver/portal idle lease и освобождения PASS.
10. **Не только Xvfb.** Последний прогон на текущем KDE/X11 с обычным GPU, без software/DMABUF overrides, прошёл на двух физических дисплеях: DP-0 2560x1440 и DP-2 1080x1920. Видео, зеркала, обе сцены, 4 визуализатора, MPRIS, simulated reconnect, mini/topmost/instance PASS. Открывались только свои тестовые окна, звук шёл в частный null sink.
11. **DEB filesystem lifecycle.** В fakeroot/private dpkg root установлен старый экспериментальный DEB, поверх новый, затем reinstall/remove/purge. Пользовательский sentinel сохранён, executable удалён, desktop-file validation PASS. Maintainer scripts проверены: их нет. Это НЕ установка в реальную ОС с разрешением зависимостей.

## Конкретные сохранённые доказательства

В .tools/linux-ready-20261106/ скопированы:
- ycore-native-linux-combined4.log — полный успешный совмещённый Xvfb native прогон;
- ycore-native-real-monitors.log — успешный прогон на настоящих двух мониторах;
- ycore-linux-keyring-test.log — настоящий защищённый Secret Service;
- ycore-linux-power-final.log — два изолированных D-Bus теста;
- ycore-deb-lifecycle.log — private-root install/reinstall/remove.

Renderer: 128 PASS / 1 optional skipped после scene lifecycle fix. Rust: 78 app + 6 probe PASS; часть OS/live тестов ignored по дизайну, отдельно перечисленные keyring/power выполнены явно. Последний диагностический текст про Linux Secret Service добавлен после полного renderer прогона; не приписывать ему полный повторный прогон. Финальная Clippy/DEB пересборка выполнялась перед остановкой; проверить итоговые строки, указанные в docs/21 и каталоге артефактов.

## Что я НЕ успел закончить

- **AppImage.** Упаковка не завершена. Исправлены package dependencies (patchelf, медиаплагины). Локальная сборка с sysroot ломала GTK resource paths: компилировать с PKG_CONFIG_SYSROOT_DIR, но bundle выполнять без него; PATH должен содержать gtk-query-immodules-3.0 и patchelf. Последний linuxdeploy дошёл до GStreamer dependency deployment и был остановлен ради лимита. Не сообщать, что AppImage готов.
- **Личный вход и My Wave на Linux.** Реальные OAuth success, персональная волна и реакции в пользовательском Linux-аккаунте не проверены. В текущем KDE org.freedesktop.secrets не настроен; есть activatable KWallet5, который здесь не предоставляет этот сервис. DEB зависит от gnome-keyring | keepassxc, UI объясняет требование разблокированного Secret Service. Нельзя класть токен в файл/код/чат или переносить его вручную ради теста.
- **Wayland.** Не проверен, не приравнивать к X11. Постоянная EDID-идентичность и placement сейчас доказаны на X11.
- **Физические hotplug, lock/suspend/resume и длинная unattended Linux Wave.** Есть симуляция reconnect и реальные оконные прогоны, но физические события/длительная личная Wave не приняты. Не выключать/не усыплять ПК по старым инструкциям.
- **Настоящая установка/обновление пакета с правами администратора.** Проверен private root; системная установка и реальный signed upgrade не выполнялись. Публичных релизов не было.
- **Windows/macOS после новых общих исправлений.** Renderer прошёл; нового Windows/macOS native прогона в этой сессии не было.

## Как продолжать

Сначала проверить наличие итогового DEB и .sig в .tools/linux-ready-20261106 и их SHA256SUMS. Дальше — недоделанные пункты выше. Не повторять весь многоступенчатый прогон просто ради восстановления контекста; повторять относящиеся проверки после новых изменений/падений. Не считать ограничения согласованным отказом пользователя от функций. Исходный репозиторий был dirty до начала работы: сохранить чужой/предыдущий WIP. Коммитов и push не делали. Приватный updater key нельзя печатать, копировать в репозиторий или пересоздавать.
