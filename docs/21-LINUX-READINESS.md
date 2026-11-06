# Linux — срез 2026-11-06

Поручение пользователя: довести Linux до уровня Windows. Работа сохранена при предупреждении об оставшихся 3% лимита. Полную готовность всех Linux-сценариев НЕ объявлять.

Реализовано: Linux single-player-host (default), локальные GTK/Cairo зеркала одного WebKit snapshot без дополнительных iframe/декодеров/загрузок; отключение проблемного MediaCapabilities официальным WebKit feature API; PulseAudio/PipeWire-Pulse анализ единственного собственного sink input с проверкой дерева PID и запретом переноса записи на другой источник; четыре визуализатора; XRandR/EDID идентичность и частота дисплеев; idle inhibition через ScreenSaver или portal (только Idle); подтверждение GTK resize перед завершением mini-перехода. Исправлена публикация состояния восстановленным/нативно открытым сценам. Namespace io.encore.desktop сохранён.

Проверено:
- 128 renderer PASS, 1 optional skipped; TypeScript/build и 14 TS unit ранее PASS.
- Rust 78 app + 6 probe PASS; 10 app ignored на том прогоне (после добавления второго portal test число ignored выросло на один).
- Отдельно 2 настоящих D-Bus lease tests PASS на частных шинах.
- Настоящий GNOME Keyring: synthetic entry write/read/delete в одноразовом зашифрованном vault PASS. Личные credentials не использовались.
- Совмещённый Xvfb/Openbox native PASS: OAuth open/cancel/credential mutation guard, YouTube Play/Pause/seek/hidden, видимые меняющиеся пиксели зеркал, две дополнительные сцены/один iframe, четыре визуализатора main+scene, MPRIS, simulated reconnect, sleep timer, playback guard, mini/topmost/single instance и проверка подписи обновления.
- Реальный текущий KDE/X11, два монитора DP-0 2560x1440 и DP-2 1080x1920, обычный GPU (без software/DMABUF overrides): те же видео/зеркала/визуализаторы/MPRIS/reconnect/mini/topmost/instance PASS. Звук тестов шёл в частный null sink; настройки дисплеев и default audio ОС не менялись.
- C capture spike: собственные 440 Гц ~0.20, чужие 1000 Гц ~0.00001; при volume=0 тишина. Анализ ДО громкости не реализован, не обещать его.
- DEB filesystem lifecycle через fakeroot/private dpkg root: старый экспериментальный DEB -> новый -> reinstall -> remove/purge, пользовательский sentinel сохранён, desktop-file validation PASS. Это не привилегированная установка в систему.

Осталось:
- Личный реальный вход Яндекса/Моя волна на Linux не проверен. В текущем KDE нет настроенного org.freedesktop.secrets (KWallet5 activatable, Secret Service не настроен). DEB теперь зависит от gnome-keyring | keepassxc; диагностика объясняет требование защищённого хранилища. Не переносить токены из Windows вручную/в файлы.
- Wayland, физические HDMI hotplug/lock/sleep и длительный unattended Linux Wave ещё не проверены. Не переносить PASS X11 на Wayland.
- AppImage НЕ готов: linuxdeploy требует patchelf и корректных runtime pkg-config путей. В scripts/install-linux-deps.sh package dependencies исправлены; локальная повторная упаковка дошла до GStreamer deployment, затем остановлена для сохранения лимита. Использовать отдельный build с sysroot и bundle БЕЗ PKG_CONFIG_SYSROOT_DIR; GTK helper directory должен быть в PATH.
- Финальный DEB пересобирается отдельно после последних исправлений. Публичного релиза/публикации не было.

Артефакты/логи сессии: .tools/linux-ready-20261106, /tmp/ycore-native-linux-combined4.log, /tmp/ycore-native-real-monitors.log, /tmp/ycore-linux-keyring-test.log, /tmp/ycore-linux-power-final.log. /tmp временный. Rust toolchain: CARGO_HOME=/tmp/ycore-cargo, RUSTUP_HOME=/tmp/ycore-rustup, target=/tmp/ycore-linux-target; dev sysroot=/tmp/ycore-linux-sysroot. Исходный рабочий каталог был dirty: WIP сохранён, коммитов/пушей не делали. Приватный updater key не печатать, не пересоздавать и не коммитить.
