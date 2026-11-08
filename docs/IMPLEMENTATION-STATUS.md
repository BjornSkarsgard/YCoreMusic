## 2026-11-08 — macOS: идентификация YouTube (REQ-049, REQ-056)

Ветка `codex/macos-media-preview`: упакованный WKWebView открывает локальную
HTTP-страницу единственного плеера. Статические ресурсы выдаются только на
127.0.0.1 по изолированному пути. Связь с контроллером через MessageChannel.
Прямой запрос с документированным Referer вместо 153 получил от YouTube
проверку «подтвердите, что вы не бот». У нового маршрута нативно подтверждено
отсутствие 153 на Intel и Apple Silicon и прохождение Play/Seek/Pause с тестовым
IFrame API на обеих архитектурах. Реальный клип в том же HTTP-плеере
запустился и остановился в Chromium. В Apple Silicon CI реальный клип
подготовился, но после Play таймлайн остался на нуле. Отдельное отключение
MediaCapabilities в тесте WKWebView не помогло и в рабочую схему не входит.
Воспроизведение на физическом Mac и совместимость экранов остаются открытыми.
Нативные проверки и сборки: [GitHub Actions](https://github.com/BjornSkarsgard/YCoreMusic/actions/runs/42482349876).

Локально: сборка, TypeScript 16 PASS, renderer 160 PASS/1 opt-in skip,
отдельный реальный YouTube renderer PASS. См. ADR-059.

## 2026-11-08 — macOS: нативная проверка пульта и эксперимент с экранами

REQ-044/056/057/062. Изолированная ветка `codex/macos-media-preview`.
Существующий пульт подтверждён в настоящем WKWebView на hosted macOS
Intel и Apple Silicon: выдача QR из настроек, HTTPS-сопряжение,
команда громкости и ответ контроллера, отсутствие autoplay и отклонение
повторного QR. Физический телефон и физический Mac не использовались.

В ветке добавлена идентификация дисплеев через CoreGraphics UUID.
Отладочный `macos-native-probe` ждёт один реально играющий YouTube iframe,
проверяет ID и PID окна перед ScreenCaptureKit и направляет кадры одного
потока на две нативные поверхности. Собирает только счётчики и пик PCM.
Пользователь сообщил, что физического Mac сейчас нет. Живые кадры/захват
своего звука, скрытый источник, HDMI и подключение существующего FFT
к сценам остаются открытыми. Методика: [24-MACOS-MEDIA-PROBE.md](24-MACOS-MEDIA-PROBE.md).

Windows: cargo check, Rust 79 PASS/13 ignored, TypeScript 16 PASS и tsc.
На обоих раннерах монитор обнаружен со стабильным UUID, а штатный WKWebView
получил YouTube 153 (нет идентификации клиента). Отдельный WKWebView с
`loadHTMLString:baseURL:` и bundle ID на Apple Silicon получил 150 для трёх
роликов подряд. Play/Pause реального клипа этим не подтверждены. Штатный
v0.0.5 остаётся экспериментальным. Оба диагностических приложения доступны
в [артефактах прогона](https://github.com/BjornSkarsgard/YCoreMusic/actions/runs/42479741229#artifacts).

## 2026-11-07 — v0.0.5 опубликован

Пользователь явно разрешил выпуск без переноса профиля. Заметки выпуска
описывают подбор клипов, повторный вход/сопряжение и отсутствие переноса локальных
настроек/истории. Другие внутренние работы в публичное описание не включались.
Source/tag532ddb76a46a1fce394a59f9036c913b7a6728ca.
https://github.com/BjornSkarsgard/YCoreMusic/releases/tag/v0.0.5

Все4 package runs SUCCESS:42395591495 Windows,42395594143 Linux,
42395596840 MacIntel,42395599508 MacARM. Desktop checks42395591246 SUCCESS
на Windows/Ubuntu/macOSIntel/macOSARM. Семь пакетов подписаны прежним updater
ключом локально; независимая проверка minisign и version0.0.5 PASS.
16 assets сверены SHA256/size с GitHub; latest.json анонимно совпал побайтно.
5 updater targets,7 package HEAD200. Оба Mac архива содержат0.0.5 и правильные
Mach-O архитектуры; физический Mac/DeveloperID/нотариализация не проверены.

Сайт обновлён: /opt/ycore-web/releases/phone-changelog-v005-20261107.
SQLite backup выполнен, прежний релиз сохранён. Пять download HEAD ведут на0.0.5
без увеличения счётчика. Changelog005->004/003/002->001 проверен, как и текущий
пульт, точные PNG и закрытые служебные пути. Chromium1280/390, раскрытие заметок,
скриншоты и выбор MacIntel/ARM PASS без ошибок JS. Локальные site проверки PASS.
Реальная установка обновления пользователем пока не подтверждена для0.0.5.
## 2026-11-07 — очистка исходников и служебных идентификаторов от прежнего имени

Текущие код, тесты, скрипты, документация и имя vendor patch используют YCore.
Идентификатор io.ycore.desktop, база ycore.sqlite, keyring io.ycore.desktop,
localStorage ycore.*, IPC ycore-*, тестовые ENV YCORE_*, --ycore-autostart.
Старый аргумент больше не поддерживается; дублирующая ветка удалена.
Прежнее исключение совместимости отменено по прямому запросу; ADR-057.

PASS: tsc, production UI build, Windows native-test build, Rust79/13ignored,
clippy all-targets и fmt. UI160PASS/1optional live skip. Изолированный нативный
Windows-прогон с новым namespace подтвердил SQLite/history/preferences,
настоящий YouTube и движение времени, паузу/seek/resume, controls-only,
hidden playback, миниплеер/topmost и single-instance/background autostart.
Пользовательские данные не трогали. Новый публичный релиз не создавали.

Смена namespace разрывает автоматический доступ к установленному профилю;
перед следующим публичным выпуском обязательна отдельная проверка переноса
аккаунта, истории, WebView-настроек и доверия телефона. Физическая папка проекта,
история Git и старые выпущенные пакеты не изменены. Полная платформенная
совместимость обновления этим чистым Windows-прогоном не подтверждена.
## 2026-11-07 — ПАКЕТ / SQWOZ BAB, свежий подбор перед пропуском (REQ-063, REQ-064)

Сообщение пользователя относится к ветке, где список найденных кандидатов
не содержал доступного уверенного совпадения. Исторический ответ YouTube не
записывался: конкретную причину неполной выдачи задним числом не подтверждаем.
Текущий read-only Rust probe уверенно находит официальный4P1s3MgIm1o,
OMV/artist metadata SQWOZ BAB,209сек. Локальные video exclusions/preferences
для148587426 отсутствуют. Изолированный native-прогон реального Yandex поиска
возвращает148587426/ПАКЕТ/SQWOZ BAB; видео успешно играет, позиция>2сек.
Это подтверждено до правки и повторено в новой локальной сборке.

Найдена воспроизводимая слабость обработки неоднозначного ответа: choices
хранил неудачный prefetch на всё время очереди, Rust кешировал его30сек.
Теперь текущий трек при активном Play один раз перепроверяет отсутствие
уверенного кандидата. Rust кеширует только ответы с уверенным совпадением.
Общий deadline подготовки и проверка исполнителя сохранены; после повторной
неудачи очередь продолжается, чужие видео не запускаются.

Проверки: tsc/build PASS; Rust78PASS/13ignored до добавления fixture,
после добавления — matcher11PASS/7ignored; clippy PASS. Renderer75 существующих
и новых сценариев PASS,2 новых playlist assertions сначала учитывали неверное
число стартовых prefetch (initial Wave+playlist), исправлен только fixture;
повтор всех4 новых recovery/bounded-skip сценариев PASS. Native Windows
реальный ПАКЕТ после rebuild PASS. Добавлены public metadata fixture и opt-in
live regression. Исправление локальное; опубликованный v0.0.4 не заменяли.

## 2026-11-07 — v0.0.4 опубликован; сайт обновлён (REQ-044, REQ-058, REQ-062)

GitHub Release v0.0.4 опубликован с source/tag b70f964. Windows NSIS,
Linux DEB/AppImage, macOS Intel/Apple Silicon DMG и два app.tar.gz для updater.
Семь пакетов подписаны прежним ключом обновлений; 16 GitHub assets сверены
по размеру и SHA256. Подписи проверены minisign_verify с закреплённым ключом.
Публичный latest.json побайтно совпал с локальным; HEAD всех семи пакетов200.
Секретный ключ оставался локальным. Все четыре package jobs и Desktop checks
для Windows/Ubuntu/macOS ARM/macOS Intel завершились успешно.

Локально: TypeScript16PASS, Rust78PASS/12ignored, clippyPASS,
renderer156PASS/1optional live skip (workers2). Первый холодный UI-прогон
с workers12 упёрся в page.goto timeouts; повторная полная проверка успешна.
Изолированный нативный Windows-прогон с публичным HTTPS-пультом PASS.
Пользователь перед выпуском подтвердил работу пульта на телефоне.
Mac runtime, Developer ID, нотариализация и macOS-адаптеры зеркал/звука
остаются открытыми; пакеты для Mac явно экспериментальные.

На ycore-music.ru опубликован блок пульта с двумя реальными скриншотами
очереди/поиска, увеличением по нажатию и объяснением QR/PWA. Внизу — история
версий: сначала0.0.4, старые003/002/001 загружаются по кнопке. В загрузках
есть выбор Apple Silicon/Intel. SQLite и Search Console verification сохранены;
перед переключением сайта выполнен SQLite backup, предыдущий релиз оставлен.
Сайт развёрнут в /opt/ycore-web/releases/phone-changelog-v004-20261107.
Публичные API, реальные ссылки пяти загрузок (HEAD, без накрутки счётчика),
чейнджлог, точные PNG и адаптивные размеры1280/390 проверены; ошибок JS нет.
Локально дополнительно проверен повтор загрузки истории после503.

## 2026-11-07 — управление при ошибке соединения (REQ-044, REQ-062)

На первоначальном экране ошибки и при потере связи во время работы
показываются «Переподключиться» и «Сканировать QR-код». При недоступном
ПК сообщение предлагает открыть YCore и включить пульт. В новой локальной
desktop-сборке включённое состояние пульта сохраняется, после запуска
восстанавливается с повтором при отсутствии интернета. Явное выключение
отключает восстановление. Нативный тест прошёл восстановление и повторное
подключение телефона без QR, показ кнопок на экране ошибки и смену ПК.
Веб-обновление опубликовано на HTTPS-сервисе.

## 2026-11-07 — переподключение из установленного пульта (REQ-044, REQ-062)

Кнопка сканирования QR доступна из меню и при истёкшем доступе или потере
связи. Камера запускается по нажатию и выключается после сканирования,
закрытия диалога и ухода в фон. Доступен выбор фото QR. При смене ПК
пульт сохраняет новую привязку и продолжает работу в своём окне.
Постоянный адрес запуска нового PWA — `/remote/app/`.
Обновление опубликовано. Локальный и публичный HTTPS-прогоны подтвердили
смену идентификатора ПК внутри прежнего окна, сохранение привязки после
перезагрузки и запуск по постоянному адресу. Декодирование настоящего QR
из изображения и имитированной камеры прошло, видеотрек завершён после
сканирования. Физическая камера телефона остаётся отдельной проверкой.

## 2026-11-07 — карточки других видео в пульте (REQ-062)

Пульт показывает варианты клипа с превью слева, названием, просмотрами,
длительностью и выделением текущего варианта. ПК передаёт метаданные из
существующего подбора. Когда данных нет, карточка показывает это явно.
Разметка опубликована на HTTPS-сервисе. Нативный тест проверяет карточки
с подставленными метаданными и загрузку тестового превью в Chromium.

## 2026-11-07 — музыкальные функции мобильного пульта (REQ-044, REQ-062)

Очередь прокручивается между поиском и плеером. Меню открывает жанры
«Моей волны», чарт, «Мою музыку», историю и варианты клипа. Полноэкранная
выдача поиска показывает треки, исполнителей, альбомы и плейлисты.
Реакции на трек и избранное клипа разделены. При первом открытии
предлагается установить PWA. Страница опубликована на действующем
HTTPS-сервисе. Нативный Windows-прогон через публичный адрес прошёл
поиск, запуск списка исполнителя, чарт, чтение личной медиатеки,
сопряжение, переподключение и отзыв доступа. Локальный HTTPS-прогон
подтвердил запуск жанровой волны, лайк, дизлайк и отмену в изолированном
профиле. Доставка реакций в Яндекс отключена в тестовом профиле.
Физическая установка PWA остаётся отдельной проверкой.

## 2026-11-07 — пульт по QR и 10 дней без использования (REQ-044, REQ-062)

Служба `ycore-remote.service` работает на VPS. Пульт открывается на HTTPS
с `www` по пути `/remote/p/<id>/`. Один клик на ПК выдаёт одноразовый QR.
При открытии ссылки пульт подключается сразу. Настройка телефона и сети
не требуется. Доступ истекает через 10 дней после последнего открытия или
успешной команды, поиска или просмотра истории.

PASS на локальном TLS и публичном HTTPS с нативным Windows-приложением и
двумя браузерными профилями. Проверены отсутствие формы, QR replay, cookie,
команды и состояние, переподключение, выборочный отзыв и истечение доступа
с сохранённым временем последнего использования. Физические телефоны
остаются отдельной проверкой. Сборка в `Downloads/YCoreMusic-QR-preview`.
[Инструкция и развёртывание](08-MOBILE-REMOTE.md).

## 2026-11-07 — macOS preview и экспериментальный пульт (REQ-049, REQ-062)

DMG Intel и Apple Silicon собраны в CI и проверены по Mach-O архитектуре.
Проверки на физическом Mac, подпись и адаптеры зеркал и аудио остаются открытыми.
Прежний прототип пульта с явным локальным HTTPS, QR и отзывом доступа включался флагом
`remote-probe`. Два мобильных браузерных профиля прошли синхронизацию и
переподключение к Windows. Реальные Android и iOS, упрощение TLS, реакции,
выбор источника и управление экранами остаются в работе.
Подробности в [08-MOBILE-REMOTE.md](08-MOBILE-REMOTE.md) и
[19-PLATFORM-READINESS.md](19-PLATFORM-READINESS.md).

## 2026-11-07 — подтверждение Search Console (REQ-058)

На VPS опубликованы предоставленный HTML-файл и метатег в head главной.
Материалы проверки лежат в /var/lib/ycore-web/search-verification вне Git
и каталога релиза. Публично проверены HTTP200, точное совпадение файла,
наличие метатега в HTML, доступность главной и счётчика. Локальная модерация PASS.
Подтверждение в аккаунте Google остаётся за владельцем ресурса.

## 2026-11-07 — подготовка сайта к индексации (REQ-058)

На ycore-music.ru главная доступна роботу как готовый HTML. Опубликованы
canonical, robots.txt и sitemap.xml. Сборка, tsc, браузерное переключение
платформ, модерация и публичные HTTPS-проверки прошли. Яндекс IndexNow
вернул 202, проверка ключа ожидается. Появление в выдаче пока не подтверждено.

## 2026-11-07 — счётчик скачиваний на ycore-music.ru

В VPS-версии рядом с кнопками загрузки опубликован счётчик переходов к файлам
(REQ-058). Агрегат хранится в SQLite, стартует с нуля и сохраняется при
перезапуске. Сборка, локальные проверки счётчика и модерации, публичные
JS/API и перенаправления загрузок прошли. Подробности в docs/23-WEBSITE.md.

## 2026-11-07: запуск обновления и напоминание о поддержке

REQ-066: фоновая проверка при запуске, предложение новой версии с отсрочкой
на сутки и тихая установка Windows с перезапуском. REQ-060: недельное
напоминание об отзыве или поддержке с возможностью отключения. UI 155 PASS,
1 опциональный тест пропущен. TS 16 PASS, Rust 78 PASS, Clippy и сборка PASS.
Изолированное обновление NSIS и нативная проверка подписи прошли отдельно.
Подробности и границы проверки в docs/20-APPLICATION-UPDATES.md и
docs/releases/UNRELEASED.md. Публикация отложена по просьбе пользователя.

## 2026-11-07: v0.0.2 опубликован

По явному запросу пользователя обновлён GitHub Release:
https://github.com/BjornSkarsgard/YCoreMusic/releases/tag/v0.0.2
Windows release NSIS, Linux DEB и AppImage, три .sig, latest.json и SHA256SUMS.
Runtime source9e54591, tag1c06a48 (только test PLAYING wait после build).
Версия0.0.2 согласована package/package-lock/Cargo/Cargo.lock/tauri.conf.
Source/fixes/version запушены в main; сайт и его docs23 остаются чужим WIP,
не добавляли в release commit и не откатывали.

Linux package run42301466188 SUCCESS. Пакеты лежат builds/YCoreMusic/v0.0.2.
Приватный ключ не покидал C:/Users/Skar/.tauri; подписи CLI app-version0.0.2,
все3 проверены minisign_verify закреплённым публичным ключом. Все8 remote asset
hashes совпали с local. Anonymous latest/download/latest.json вернул точный
manifest0.0.2; HEAD всех3 installation URLs200. Настоящая установка update не
выполнялась. Draft перед публикацией проверен, предыдущийv0.0.1 не меняли.

Основная CI42301394294: UbuntuPASS; macARM150PASS/1testfailed из-за тестового
END до PLAYING (не runtime failure). Исправлено1c06a48: ждать PLAYING у B/C.
Локальный targetedPASS. Новый Desktop run42302905345 queued на момент записи.
Не объявлять все4CIзелёными или macOS нативно принятым.

Пользователь спросил про публичность репозитория. Read-only проверка:
secret scanning и push protection enabled, open alerts0. Явные токены/приватные
ключи первичным поискoм в history/index не найдены; это НЕ полный security audit.
Сайт sites/ycore-music/app/api/releases/release-service.ts берёт public GitHub
latest без auth; приватизация этого repo сломает текущие anonymous downloads.
Ничего в настройках видимости/security не меняли.

## Публичный сайт: HTTPS работает — 2026-11-07

https://ycore-music.ru доступен публично. VPS watcher автоматически выпустил
Let's Encrypt, включил HTTPS и завершился со статусом ready. Повторная проверка
с компьютера владельца: главная/releases/reviews HTTP200; Windows/DEB/AppImage
HTTP302 прямо на бинарники актуальной v0.0.2; HTTP и www перенаправляют на HTTPS.
Публичные /api/inbox и /admin возвращают404. Backend5180 и admin5182 слушают
только127.0.0.1; панель владельца по SSH через desktop shortcut. Certbot timer enabled.
Отзывы требуют одобрения владельца и согласия; начальнаястраница6, далее12,
даты и cursor pagination. Вымышленные отзывы удалены. Daily SQLite backups.
Подробности и история проверок: docs/23-WEBSITE.md.
## 2026-11-07: реальная причина Absence/Catch-22 — native null metadata

Пользователь снова получил prep deadline для Absence / Xalv и дал ссылку
https://www.youtube.com/watch?v=bTB8_-BcuG8. Live Rust search нашёл bohtMtdGPx8,
views=None,duration285,needs_review=false. Нативный запуск ЧЕРЕЗ ПОИСК Яндекса
(числовойtrack ID -> savedVideos -> matching -> UI) воспроизвёл падение:
Uncaught TypeError: Cannot read properties of null (reading toLocaleString).
Обе renderCandidates/renderAlternatives проверяли только undefined, а Rust
Option<u64> сериализует отсутствие как null. Исключение происходило ДО loadVideo;
тайм-ауты предыдущих правок лишь пропускали этот сломанный renderer шаг.

Исправление de48727, branch codex/continuous-playback-20261107:
Candidate views/durationSeconds теперь явно number|null|undefined; null-safe guards
в обеих карточках и duration. Нет hardcoded video binding/ослабления matching.
Rust live Absence probe и native YCORE_TRACK_MATCH_PROBE добавлены. Последний
теперь проходит оба user fixtures через настоящий UI и проверяет position>2,
один player и nativeErrors.length0. До фикса этот же путь FAILED.

Проверки: renderer151 PASS/1 optional skipped; targeted native-null views/duration
Wave+playlist PASS; TS/build PASS. Реальный нативный UI Absence и What I Need
(включая storage/matching) PASS, затем mini/topmost/instance PASS. Не подменять
эту проверку старым ручным вводом найденного video ID: он обходил ошибочный шаг.
Windows debug NSIS собран и передан в commentary:
C:/Users/Skar/Downloads/YCoreMusic-null-metadata-fix-2026-11-07/YCoreMusic-Windows-test-setup.exe
Linux DEB run42298273064 SUCCESS наde48727, скачан и сверён с CI:
C:/Users/Skar/Downloads/YCoreMusic-null-metadata-fix-2026-11-07/Linux/deb/YCore Music_0.0.1_amd64.deb
SHA256 f4b8a4fd5a05cc1ad04c709381638feb8a34e0d762a72857241c1f01e5ac8fc3.
Windows NSIS SHA256 b66844458c3dec4b79382dea8d8aa456087323daa234ef65548f91c9da6145fd.
Пакеты переданы, установка не выполнялась. Для Linux0.0.1 нужен --reinstall. Релиз и установленный exe не заменяли.
DonationAlerts пользователя записан в PRODUCT-DECISIONS:
https://www.donationalerts.com/r/affor_1337
Только ссылка для будущей кнопки поддержки; платежей не совершали.

## Сайт на собственном VPS — 2026-11-07

Перенос закрытой версии на Ubuntu VPS владельца выполнен. ycore-web.service
под отдельным user, Node24.22.2, SQLite вне релизов; loopback127.0.0.1:5180.
Просмотр через SSH tunnel: http://127.0.0.1:5181 . Повторное открытие:
sites/ycore-music/scripts/open-vps-preview.ps1. Сам сайт работает независимо
от компьютера, локальный адрес требует открытого туннеля.
VPS build/tsc, remote API/формы/downloads, SQLite после restart PASS.
DonationAlerts владельца affor_1337 подключён. Реальный browser href проверен.
VPN не перенастраивался; UDP47821 и awg0 сохранились. Публичного запуска ещё нет:
домен не выбран/не куплен, DNS/HTTPS не подключены. Старый GPT Sitesv2 сохранён
как предыдущий снимок; его D1 не удалялась. Подробности: docs/23-WEBSITE.md.
## 2026-11-07: устранено зависание «Подбор клипа»

Пользователь сообщил о сохранении остановки после предыдущего progress-fix.
Воспроизведён отдельный дефект: unbounded ensureAlternatives запросы занимали
общий searching Set, после ошибки prefetch основной поиск нового трека не мог
стартовать. Новый regression до правки оставался на «Подбор клипа…», после PASS.

Commit8411502 (codex/continuous-playback-20261107): все metadata alternatives
ограничены20sec, максимум2 слота из3 для необязательных альтернатив. Есть отдельный
общий30sec prep deadline текущего ordinal, не зависящий от старта matching job.
Истечение -> техническая причина -> Next. Explicit Pause/Play, source/load и
network/power сбрасывают дедлайны. Source/history/page awaits ограничены30sec,
чтобы не удерживать advancing/sourceWork навсегда. Поздние ответы timed-out
requests не исполняют продолжение. Resolved current videoId без activeVideo
снова загружается вместо вечного continue. Repeat/end/source order сохранены.

Проверки текущего snapshot: renderer149 PASS/1 optional skipped; TS unit16 PASS;
native real Catch-22 dHXRzRxb5b4 Play/advancing position/Pause/seek/hidden/mini/
instance PASS. Предварительно33 targeted PASS; добавлены tests hung alternatives,
общий current preparation budget Wave/playlist и page hang/late original response.
Windows debug NSIS уже собран и скопирован:
C:/Users/Skar/Downloads/YCoreMusic-matching-fix-2026-11-07/YCoreMusic-Windows-test-setup.exe
DEB run42296103008 SUCCESS, runtime8411502. Готовый файл:
C:/Users/Skar/Downloads/YCoreMusic-matching-fix-2026-11-07/Linux/deb/YCore Music_0.0.1_amd64.deb
SHA256 0f68523b333646a412336119a07ee8418dcd6804c14f51913336e99982795551,
совпадает с CI. Windows NSIS hash647acde34269b69bd6b4a5b5d0c2217caa0af44a82e33f0aa137e493db3fee34. Публичный релиз не меняли, не устанавливали пакеты.
Тестовые версии всё ещё0.0.1: для DEB при обновлении нужен apt install --reinstall
с явным локальным файлом. Не утверждать, что apt обновил идентичный номер сам.

## 2026-11-07: ложный PLAYING и Catch-22

Дополнительный пользовательский дефект: What I Need / Catch-22 NZ, UI говорит
PLAYING, но клип не идёт и очередь не продолжается. Причина пропуска watchdog:
первый PLAYING обнулял loadStarted, а media position не проверялся.
Добавлен PlaybackProgress: монотонный15sec budget без продвижения media time,
не сбрасывается повторными PLAYING. Load/seek/explicit Pause/Play/offline/power
сбрасывают наблюдение. Зависший клип -> другой кандидат -> следующий трек всей
очереди. prepareAhead без активного видео теперь пишет «Подбор клипа…», чтобы
не оставлять статус PLAYING от предыдущего трека.

Проверки: TS/build/unit16 PASS; continuous17 PASS (включая false PLAYING и heartbeat
для Wave/playlist); recovery7 PASS. Полный renderer:144 PASS/1 optional skipped,
1 offline-test прерван HMR navigation во время правки файла; последующий отдельный
recovery7 PASS. Clippy all-targets/yandex-probe clean. Native metadata probe нашёл
подтверждённую официальную запись dHXRzRxb5b4,293s. Настоящий Windows YouTube этого
ID: advancing position, Pause/seek/resume, controls-only/hidden, mini/instance PASS.
В рамках этого прогона сторонние uploader/alias ограничения matching не меняли.
Нельзя обещать одинаковую сетевую/региональную доступность у пользователя.

Commit7557320 в codex/continuous-playback-20261107. Linux DEB run42292552306 SUCCESS, скачан:
C:/Users/Skar/Downloads/YCoreMusic-stall-fix-2026-11-07/Linux/deb/YCore Music_0.0.1_amd64.deb
SHA256 873c523913d0dc35144c4818b95c045bcc6d7f9257ecd3f39db56ac0fb7670d7,
совпадает с опубликованным CI hash. Новые тестовые пакеты переданы без установки
и без замены публичного релиза. Runtime7557320 включает все предыдущие правки.
Windows debug NSIS пересобран после последней строки статуса и сохранён:
C:/Users/Skar/Downloads/YCoreMusic-stall-fix-2026-11-07/YCoreMusic-Windows-test-setup.exe
Основной main по-прежнему dirty, содержит также чужие/параллельные изменения сайта;
не откатывать их и не копировать их в patch branch. Установку/релиз не выполняли.

## Лендинг YCore Music — 2026-11-07

Реализован и опубликован owner-private сайт для проверки владельцем:
https://ycore-music.bjornskarsgarddev.chatgpt.site
Sites v2, source commit 0020c71f9eedc7c906b21c8af384c1b64b870ef0.
Исходники: sites/ycore-music (отдельный Sites Git repository), docs/23-WEBSITE.md.
REQ-058–061: адаптивная страница, настоящие скриншоты, анимации, прямая загрузка
latest Windows/DEB/AppImage без страницы GitHub, macOS soon, D1 формы трёх типов.
DonationAlerts без URL — кнопка-заглушка. Три отзыва временные, вымышленные по
просьбе владельца для закрытой проверки; перед public заменить/удалить.
Многомониторная сцена — подписанная иллюстрация, настоящего фото рабочего места нет.
TypeScript/build, release mapping test, local D1 и browser form PASS; три реальных
бинарника GitHub HEAD200. Native Sites deployment succeeded. Hosted: / и /api/releases 200, download Windows/DEB/AppImage 302, macOS 404, feedback201. GitHub API403 устранён fallback latest tag + expanded assets. Desktop WIP сохранён.
## Непрерывное воспроизведение всех очередей — 2026-11-07

Пользователь уточнил: автопропуск отсутствующих/не загрузившихся клипов нужен
для любых очередей, включая плейлисты, альбомы, поиск, историю и «Мою волну»,
в обычном окне и fullscreen. Конечный список сохраняет свой конец/repeat;
явная Pause и offline не прокручивают очередь и не включают autoplay.

Исправлены main.ts: автоматическая обработка ошибок cached video IDs, гонка
пропуска пустого результата во время advance, watchdog без activeVideo/Ready,
AutoplayBlocked, bounded match20sec/2 attempts и retry страниц конечного списка.
Сетевой запрос matcher.rs больше не удерживает mutex всего кеша, независимые
prefetch-запросы не блокируют друг друга. Технические пропуски отмечены в очереди;
дизлайк и ложное прослушивание не создаются. Бесконечность Wave не означает
обход отсутствующей сети/авторизации или ограничений внешних сервисов.

Регрессии: полный renderer141 PASS/1 optional skipped; после изменения бюджета
с15 до20sec повторные13 continuous tests PASS. TS unit14 PASS; Rust matcher10 PASS,
4 live ignored. Windows native real YouTube pause/seek/hidden/mini/instance PASS
до последнего изменения только cache lock и match budget. Debug NSIS пересобран.
Реальная установка и длинный unattended прогон этой правки не выполнялись.

Patch branch codex/continuous-playback-20261107, commits e728795/99a9e3e в отдельном
CI worktree. Основной main остаётся с текущими правками в рабочем дереве.
DEB build42288714656 SUCCESS на99a9e3e, пакет скачан и хеш сверён с CI:
C:/Users/Skar/Downloads/YCoreMusic-continuous-playback-2026-11-07/Linux/deb/YCore Music_0.0.1_amd64.deb
SHA256 654eac217f1f60d05af7f036f1638277e81ce3e4c5ae09c23388c3e8c0637fc2.
Windows debug NSIS5.22MiB, собран из того же состояния исходников:
C:/Users/Skar/Downloads/YCoreMusic-continuous-playback-2026-11-07/YCoreMusic-Windows-test-setup.exe
Clippy all-targets/yandex-probe -D warnings PASS. Установку на ПК пользователя
не выполняли, работающий установленный экземпляр не закрывали.
Старый промежуточный42288427884 отменён.
Релиз v0.0.1 не заменять автоматически; подготовлены тестовые сборки без публикации.
Переименование старых технических ключей всё ещё отложено пользователем.

## Актуальное состояние — 2026-11-06, подготовка общего релиза

Пользователь поручил подготовить одинаковый набор функций Windows/Linux,
локальные установщики и затем публикацию GitHub Release. Длительный прогон,
физическое отключение экранов и sleep/wake отложены пользователем.

- Linux/X11: настоящее видео, локальные зеркала, четыре визуализатора, два
  физических монитора, MPRIS, мышь после начала playback, mini/topmost проверены.
- Личный вход Яндекса сохранён в GNOME Keyring и пережил перезапуск; пользователь
  подтвердил «Музыка играет, мышь работает». Новый vault надо создать/разблокировать
  средствами ОС; plaintext/session-only fallback отсутствует.
- Общий подбор исправлен для canonical OMV/ATV credits, коллабораций и сторонних
  концертных записей. Live-поиск и playback пользовательского примера PASS.
- Логотипы UI — прозрачные PNG, ICO/ICNS содержат прозрачный raster. Удалены
  тёмные подложки бренда, альбомные обложки сохраняют собственное оформление.
- Wayland: автоматический XWayland, read-only connector identity и два экрана
  прошли проверку в изолированном KWin, включая placement/fullscreen/topmost on/off. Чистый GTK/Wayland не имеет полной поддержки
  topmost/placement. См. ADR-050. Нельзя обещать поддержку всех compositor/distro.
- Итоговые Windows NSIS, Linux DEB и AppImage собраны из одного состояния runtime
  исходников и подписаны для updater. Code signing Windows нет.
- Окончательные проверки: renderer 128 PASS/1 optional skipped, Rust 81 PASS/12
  ignored, Clippy clean, TS unit PASS. Дополнительные прогоны прекращены по
  прямому указанию пользователя.
- Пакеты, latest.json и SHA256SUMS находятся в builds/YCoreMusic.
- Релиз v0.0.1 опубликован: https://github.com/BjornSkarsgard/YCoreMusic/releases/tag/v0.0.1
  Восемь assets, draft=false. Runtime source commit f60a717; исходники запушены в main.
  GitHub заменяет пробелы в именах assets точками; ссылки manifest соответствуют
  фактическим именам. Подписи версионные, приватный ключ не передавался на GitHub.
- GitHub connector отказал в записи (403), публикация выполнена официальным GitHub
  CLI после браузерной авторизации пользователя.
- Windows installation lifecycle текущего snapshot не принят: по указанию
  пользователя релиз опубликован без дополнительных Windows прогонов. Нельзя
  выдавать cross-compile за нативную приёмку. Длительный прогон и аппаратные
  disconnect/sleep/wake остаются отложенными.

Записи ниже — история предыдущих остановок, не актуальный список блокеров.

## Предыдущая точка остановки — 2026-11-06

Последний scope: закончить этап, подготовить Linux установщик для тестирования,
затем остановиться. Сайт и пульт исключены. Пользователь сообщил о близком лимите.
Linux установщик пока НЕ готов и НЕ передан.

Repo C:/Users/Skar/Documents/YCoreMusic main dirty — сохранить WIP. CI worktree:
C:/Users/Skar/Documents/YCoreMusic-ci-check, branch codex/stability-portability-20261106,
HEAD исходников 97a80c25441c6b055790303bf9c1866f20a1ba51.

Linux live playback run42214293331 FAILED. Базовые GTK/X11 SQLite/history/window/
autostart проверки PASS. embed identity loaded=true/applied=true, ошибка YouTube153
устранена, duration635 получена. Но Play остаётся «Видео загружено», position0;
iframe state=-1, paused=true, readyState0, mediaError=null, playingIntent=true.
Private PulseAudio null sink в CI НЕ решил проблему. Следующий шаг: изучить
артефакты native-basic-playback-diagnostic.json, screenshots, pulseaudio.log и
доставку playVideo/пользовательского жеста/сетевые media-запросы в WebKit iframe.
Не выдавать Linux playback за готовый и не маскировать провал теста.

linux-embed-referrer экспериментальная, НЕ default. embed_identity.rs,
linux/embed-identity.c/build.rs настраивают WebProcess extension ДО создания
исходного main WindowConfig через extensions_path. Нет terminate/reload.
Referer с настоящим app ID только для YouTube embed; один плеер сохраняется.

После playback PASS: включить feature в package:linux (сейчас НЕ включён),
проверить GStreamer runtime deps и AppImage bundleMediaFramework, собрать DEB и
AppImage через package.yml Ubuntu24.04 x86_64, скачать, проверить control/хеши,
дать пользователю файлы. Linux mirrors/audio visualizers отсутствуют; Wayland и
реальное оборудование не проверены. Не обещать полную Linux parity.

Windows latest combined native PASS: YouTube pause/seek/hidden,4 visualizers,
sleep timer, playback guard, signed update verify, mini/topmost/instance.
Main visualizer FPS165/180/240 и monitor refresh tracking готовы, preference
сохраняется при переносе на меньшую Hz.
Windows install lifecycle run42214292723 FAILED после сборки/установки NSIS:
Node fetch TimeoutError в installed native check. UTF16 Edge driver уже исправлен.
Install/upgrade/reinstall data preservation ещё НЕ PASS.
Desktop checks run42214292678 оставался in_progress — проверить результат.

Private updater key C:/Users/Skar/.tauri/YCoreMusic-updater.key НЕ печатать,
НЕ пересоздавать, НЕ копировать/пушить. Публичные релизы не публиковались.

# Статус реализации YCore Music

## Автономный desktop этап: soak, X11 и обновления — 2026-11-06

Сайт и пульт исключены из текущей работы пользователем. REQ066 повторно
подтверждён: кнопка проверки/обновления для доработок после релиза.

Windows YCORE_WAVE_SOAK_MINUTES=30 PASS: неускоренный скрытый запуск, 6 natural
переходов,357playing/2waiting samples, maxobservedgap5сек при polling5сек,
maxcontrolleriframes0/maxhostiframes1. Затем mini/topmost/instance PASS.
Артефакт .tools/wave-soak-result.json. Это реальный Яндекс/YouTube без ручного
seek во время30минут. Физический HDMI/Win+L/sleep остаются отдельными проверками.

Linux/X11: native run42207934319 SUCCESS после исправления чтения topmost
из EWMH собственного XID через x11rb. Getter GTK cache возвращал false при
реальном ABOVE. WebKit minimize может hide вместоiconify; smoke проверяет
сохранение background и реальный visible+unminimized после повторного запуска.
SQLite/history/preferences, mini/maximized/topmost, autostartargument/instance PASS.
На snapshot0ca7d07 Ubuntu debug+UI build PASS; наd4be2a8 Windows/macIntel/macARM
build+renderer PASS. Это не подтверждение Linux/macOS HDMI/audio/mirrors.
Медленная загрузка Azure archive устранена только в ephemeral CI: Ubuntu HTTPS
archive, network/lock timeout и8минутный предел шага. Остальные платформы не ждут
бесконечно Linux download; сайт/пульт не затрагиваются.

Updates: main-only updates.rs + updates.ts, официальный updater2.14.1, fixed feed,
закреплённый publickey, version-bound signature, отдельные Check/Download/Install,
дневное откладывание, native playback guard+revision. Установки/публикации нет.
Подписанный debugNSIS0.0.1 собран5.19MiB +.sig, local latest.json готов.
Native signature probe PASS: valid accepted; tamper/version/downgrade rejected;
testMode install disabled. Новый basic playback smoke на Windows PASS: actual
YouTube, pause/seek/resume, controls-only/hidden timeline, one engine, native
mini/topmost/instance. Скриншот просмотрен. На Linux этот live сценарий следующий.

Rust74PASS/9ignored, Clippy/fmt/frontend/debugbuild PASS. Renderer125PASS/1skip
до revision guard, затем4targetedPASS после финальных правок. Docs20 описывает
ключ/сборку/границы: приватный ключ только локально в .tauri владельца, не в Git
и не в GitHub Secrets. Последняя updates-ревизия ещё требует нового cross-OS CI.

## Стабильность окон/сети и ранняя переносимость — 2026-11-06

REQ049/056/059/067: добавлены native platform.rs + UI platform.ts; window-layout.ts
и scene-ui.ts отключают варианты без реально имеющихся adapters. На Linux/macOS
не предлагаются зеркала/реактивные визуализаторы; основное видео/управление доступны.
Сохранённый выбор Spectrum не теряется при временном fallback к Video.
Это подготовка переносимости, не завершённый порт. План/границы — docs19.

Native YCORE_STABILITY_SMOKE=1 дважды PASS: шесть simulated hotplug VIDEO/Particles,
настройки FPS/quality и monitor ID сохранены; timeline идёт, engine не заменяется.
Off во время detach не восстанавливается. Outage в main и source WebView,
Pause→reconnect остаётся паузой, explicit Play возобновляет один engine. Общие
mini/topmost/instance PASS. Реальные HDMI/TV/системная сеть не переключались.

Rust72PASS/9ignored, Clippy/fmt/check --no-default-features/build PASS, TSunit14PASS.
Renderer122PASS/1skip/1 failed: единственный отказ — matcher disabled для option;
проверка исправлена на DOM disabled, все8 scene-settings затем PASS.
Обычный debug exe обновлён. Текущую ревизию Linux/macOS здесь не запускали.
Исправлен wave soak: проверяется iframe count native host и отсутствие iframe
в coordinator; во время загрузки допустим ноль, но никогда два. Счётчик host
пишется отдельно от controllerFrames. YCORE_LIVE_WAVE=1 после этой правки PASS:
настоящая волна, два автоматических natural-END перехода, один native iframe,
ни одного controller iframe, mini/topmost/instance. Длительный soak ещё предстоит.

## Защита от случайного переключения — 2026-11-06

REQ-067: замок рядом с громкостью, доступен и в mini. В пределах текущего запуска
блокирует ручные Next/Previous, перемотку, выбор трека/клипа, перезапуск волны,
смену локального предпочтения/исключения и dislike до записи обратной связи.
Пауза/Play, громкость, просмотр списков, окна и таймер доступны; автоматический
переход после окончания и технического отказа сохраняется. Like доступен.
Открытая панель YouTube скрывается; внешние сцены получают locked в snapshot
и отключают navigation/seek. Main проверяет команды повторно, включая SMTC.
Блокировка не сохраняется после полного выхода.

Новый playback-guard.ts; main.ts/icons.ts/style.css, scenes.rs/scene-player.ts/
scene.css, host-player/scenes tests и native smoke. Frontend/debug build PASS;
Rust72/9ignored, Clippy PASS; полный renderer119PASS/1skip до новых проверок,
затем 4 targeted PASS (guard, external snapshot, compact layouts).
Native YCORE_PLAYBACK_GUARD_SMOKE=1 PASS на actual YouTube: ручные действия
не заменяют engine, pause/resume работают, unlock в mini возвращает seek.
Общие startup/history/mini/topmost/instance проверки этого прогона также PASS.
Реальное физическое нажатие SMTC и длительный просмотр отдельно не проверялись.
Обычный target/debug/YCoreMusic.exe обновлён.

## Таймер сна — 2026-11-06

Завершён согласованный срез: кнопка под плеером и Настройки → Таймер сна,
пресеты15/30/45/60/90/120мин, свой интервал1–720мин, countdown, замена/отмена.
По завершении толькоPause. Счётчик native UTC deadline, работает в трее;
expiry/reread ревизий не позволяет старому событию остановить новый таймер.
One-shot UI обработка позволяет явно возобновить музыку после срабатывания.
Существующий powerPause блокирует late autoplay. Полный restart сбрасываеттаймер;
закрытие диалога оставляет егоработать. Новые sleep_timer.rs/sleep-timer.ts,
main.rs/main.ts/style.css, host-player tests и native smoke. Защита управления
не реализована в этом срезе; следующий отдельный пункт.

Rust72PASS/9ignored, Clippy/frontend/native/debugbuildPASS. Renderer host/recovery
16PASS, затем исправлена проверка async статуса и timer targetedPASS.
Native YCORE_SLEEP_TIMER_SMOKE=1 PASS: реальный1сек deadline (без ускорения
часов) → actualYouTube state2 в трее → explicitPlay без повторнойпаузы → cancel;
одинengine/epochнеизменён, mini/topmost/instancePASS. Screenshot просмотрен.
Полный30мин/12часовой отсчёт и физический sleep отдельно не прогонялись.
Обычный target/debug/YCoreMusic.exe обновлён после финальной UIправки.

## Все четыре визуализатора + усиленные басовые атаки — 2026-11-06

По новому указанию закончены Ambient/Liquid/Particles и сохранён Spectrum.
Основной selector теперь «Визуализатор», рядом тип/FPS/quality. «Экраны» →
выбранный монитор → визуализатор → один из4типов. Main и каждый монитор хранят
выбор независимо. Старые настройки без preset означаютSpectrum.
Ambient: доступная обложка Яндекса, иначе YCore, масштабирование и световые
кольца на ударе; Liquid: яркие формы с деформацией/волнами от bass impact;
Particles: радиальные разлёты/гравитация/затухание, до420частиц; Spectrum:
ускоренная атака, усиленная чувствительность, пиковые отметки. Только реальный
FFT, никакого вымышленного ритма. После тишины эффекты затухают; скрытые окна
не рисуются. WebGL и функциональныйCanvas2D fallback. Аппаратное ускорение,
выбранные FPS/quality, звук/плеер/очередь не перестраивались.

Изменены spectrum.ts/visualizer-shaders.ts/audio-motion.ts, main-spectrum/
scene-ui/scene-player/main/queue/theme/scene.css; Rust scenes/options/metadata,
CSP для ограниченного image host. Новые тесты motion, shader/fallback, main
persist, per-monitorpreset и coverURL validation. Artwork из metadata не
подменяется выдуманной обложкой; история/manual без cover показывают бренд.

Проверки: полный renderer118PASS/1skip до последнего усиления; после него
24 targetedPASS и14 TSunitPASS (басовая атака/steady tone/silence/treble),
Rust71PASS/9ignored, Clippy/frontend/debug buildPASS. Native all4types в main
и внешнем окне PASS, real audio0.0004–0.0007 maximum bands, WebGL/0iframe вUI,
engine epoch не меняется/одинYouTube. Снимки native-visualizer-*.png просмотрены.
После проверки тестовый volume0. Обычный target/debug/YCoreMusic.exe обновлён.
S6 остаётсяPARTIAL из-за анализа приvolume0 и отсутствия native Linux/macOS;
полная физическая hardwareматрица не закрыта. Старые запреты на оставшиеся
3типа ниже отменены последним указанием пользователя.

## Подготовленный клип, состояние списков и очередь слева — 2026-11-06

Новые cue-brand.ts/playback-rows.ts: центральное YCore logo вместо видимой
кнопки YouTube только в cued/unstarted; buffering/playing скрывают, Spectrum
и interactive YouTube исключены. Накладка входит в DWM holes, есть в main и
внешних сценах. Playback state отправляется сценам сразу, не только500ms tick.

«Моя музыка»/любимое/плейлисты, поиск/коллекции, обзор, история и очередь теперь
подсвечивают текущий track и показывают Play/Pause. Текущая строка вызывает
существующий toggle, а не select/reset/load; кнопки основного плеера/медиаклавиши
обновляют все строки. В очереди identity содержит generation/ordinal; одинаковые
trackId не подсвечивают другие queue positions. Текст queue-play выровнен слева.
UI снимок не становится вторым coordinator; WeakMap не удерживает старые строки.

Frontend/debug build PASS; полный renderer113 PASS/1skip; после последних
изменений3 targeted PASS (cross-section toggles без замены player, main cue
brand, scene cue→buffering→playing). Native screenshot native-cued-brand.png
просмотрен: logo видно в реальном cued WebView2, после Play скрыто. Первый
общий native прогон обнаружил смену источника на чарт и расхождение listening
count; повтор также прервался при смене источника на коллекцию/буферизации.
Полный native smoke в этом срезе НЕ PASS; стартовая проверка logo/cue→Play
на реальном YouTube первого прогона прошла. UI-переключения всех списков
проверены renderer regression. Повторять весь smoke без выяснения внешних
действий/изменений источника не требуется для подтверждения CSS/row bindings.

## Восстановление после сбоя и отсутствие клипа до Play — 2026-11-06

REQ065 реализован: native checkpoint playback-recovery.json (каждые5с после
фактического старта), clean marker нормального выхода, предложение продолжить
после dirty restart. Подтверждение использует единственный coordinator/player,
восстанавливает позицию нового history-прослушивания без старого waveRef;
отказ/Escape не включают музыку. Сцены восстанавливаются прежним механизмом.
Checkpoint не содержит токенов/старых radio session; schema SQLite не менялась.
Повреждённый/будущий recovery-файл не перезаписывается. Ошибка видна в status.
Точность точки около5с, не обещаем power-loss durability или восстановление
всей старой очереди. После восстановленного клипа волна выбирается явно.

Дополнительно по уточнению пользователя: отсутствие подходящего клипа маркируется
в очереди немедленно, даже до Play, а не только после auto-advance. Ручные
переключения всё ещё не ошибки; невоспроизведённые треки не создают play-history.

Проверено: Rust70 PASS/9 ignored, Clippy/frontend/debug build PASS;
полный renderer112 PASS/1opt-in skip, затем4 targeted PASS после уточнения.
Native YCORE_CRASH_RECOVERY_SMOKE=1 PASS дважды: аварийно завершён только
изолированный process по подтверждённому PID/testMode → новое окно без autoplay
→ explicit Resume → настоящий YouTube с37с/одинplayer → реальный checkpoint
→ normal Quit/restart без recovery prompt. Снимок native-crash-recovery.png
просмотрен. Пользовательский экземпляр не завершался.
Новые файлы crash-recovery.ts, src-tauri/src/crash_recovery.rs; интеграция
main.ts/main.rs, host-player/playback tests и scripts/native-smoke.mjs.
Обычный target/debug/YCoreMusic.exe обновлён. Следующий пункт — длительный soak
и подготовка установщика/обновлений; остальные визуализаторы остаются в плане.

## Гибкая правая панель и технические ошибки — актуальное уточнение

Пользователь отменил прежнее резервирование высоты скрытого video-alternatives:
теперь hidden → display:none, верхний flex-scroll занимает освободившееся место
в обычной панели и controls-only queue rail; при возврате клипов размер снова
уменьшается. Scrollbar-color/width едины для panel-scroll/queue-scroll/alternatives.
Ручной Next/jump и dislike больше не получают rose/error полосу и значок;
historySkipReason возвращает пояснение только для persisted error. Исключение
дизлайкнутого трека из smart stream также не записывается как технический сбой.
Предыдущие записи про выделение обычных ручных пропусков отменены.
Frontend/debug build PASS; renderer playback/history/queue/layout61 PASS.

## Причины пропуска внутри строк — актуальный UI

По последнему уточнению пользователя отдельный раздел автопропусков удалён
полностью. В очереди и истории: приглушённый текст + тонкая rose/red полоса +
отдельная info-кнопка, открывающая popover с причиной. Просмотр не запускает
трек; метаданные вставляются textContent; Escape закрывает сообщение. Очередь
хранит причины по generation/ordinal только для остающихся строк; успешный
повторный запуск убирает старую отметку. Ручной Next/выбор другой позиции также
получает пояснение. В истории причина из persisted endReason: skip/dislike/error;
для старой ошибки честно сказано, что подробности не сохранены. Отсутствующие
прослушивания ради значка не создаются. Режим только управления больше не имеет
отдельного списка. Старые описания списка10 ниже отменены этим уточнением.

Frontend/debug build PASS;59 renderer playback/history/queue PASS;
3 targeted PASS после последних изменений, включая причины отдельных исторических
записей, отсутствие запуска при клике, защиту текстового вывода и непрерывность
волны/fullscreen. Screenshot auto-skip-reasons.png просмотрен. Бинарник обновлён.

Уточнение UI автопропусков: список доступен только в режиме «Только управление».
В видеорежиме, основном Spectrum и миниплеере скрыт без занятого места;
накопление и сохранение последних10 причин между сменами вида продолжаются.

## Проверка экранов и объяснения автопропусков — 2026-11-06

Пользователь подтвердил исправление сбросов внешнего Spectrum: «всё ок».
Расширенный native smoke PASS на3 подключённых мониторах с DPI scales1/1/2:
независимые VIDEO/Spectrum/FPS/quality, simulated disconnect/reconnect,
полный Quit→restart с восстановлением Spectrum без autoplay, targeted Off,
изоляция событий скрытой сцены, один engine/два зеркала, tray/mini/topmost.
Физический HDMI unplug и настоящий sleep/lock не выполнялись.

REQ064: в панели «Моя волна» появился раскрывающийся список последних10
автопропусков за запуск: название/артист и причина (нет клипа, неоднозначное
сопоставление, найденные видео не воспроизвелись). Очистка локальная, список
не пишет history/feedback, не помечает skip как dislike. Вставка метаданных
через textContent; ограничен размер/дедупликация. Не утверждать возрастное или
региональное ограничение по одному общему отказу YouTube. Network retry остаётся
ожиданием с текущим статусом, а не вымышленным пропуском. Запись добавляется
при действительном переходе с проверкой generation/ordinal/playIntent.

Frontend build и обычный debug build PASS. Renderer playback/queue/recovery62
PASS; дополнительно2 targeted PASS проверяют причины, сохранение fullscreen,
очистку без смены музыки, лимит10/дедупликацию/безопасный вывод метаданных.
UI просмотрен на screenshot auto-skip-reasons.png; настоящие внешние preference
writes ради теста не выполнялись. Новое: src/skip-notices.ts; остальное в
main.ts/style.css/tests/playback.spec.ts/scripts/native-smoke.mjs и документации.
Следующий незавершённый продуктовый пункт: REQ065 аварийное восстановление;
остальные визуализаторы по-прежнему вне текущего разрешённого объёма.

## Исправление сбросов Spectrum между окнами — 2026-11-06

Уточнение пользователя: полосы внешнего Spectrum периодически падают и резко
возвращаются, основной Spectrum нормальный. Обнаружена рассылка событий сцены
всем окнам: Emitter::emit глобален, listen без target подписывается на Any.
Чужой scene-snapshot visible=false сбрасывал target/values; scene-options также
менял содержимое чужой сцены. Исправлены обе стороны: emit_to(label) и подписки
WebviewWindow с собственным label для snapshot/options/hidden/audio-analysis.
Главный Spectrum слушает только main; аудиокадры больше не дублируются через
глобальные подписки продуктовых потребителей.

Native regression на прежнем бинарнике FAIL:4 чужих invisible и1 videoOptions,
Spectrum выключен. Тот же сценарий после исправления PASS:0 чужих сообщений,
Spectrum остаётся видимым при скрытом втором видеоокне. Проверены настоящий
YouTube, основной/внешний Spectrum, два зеркала, единственный engine.
11 renderer PASS, Rust68 PASS/9ignored, Clippy/frontend/native build PASS.
Обычный target/debug/YCoreMusic.exe обновлён. Предыдущее изменение FPS само по
себе этот дефект не исправляло; окончательная пользовательская проверка ожидается.

## Рывки отдельного Spectrum — проверка 2026-11-06

После сообщения пользователя проверен native renderer с фокусом в главном окне.
Исправлен FPS limiter: накопление остатка VSync вместо отбрасывания времени
между кадрами; при cap30 число draws за4с выросло с110 до121. Сглаживание
использует реальное время между draws. Размер canvas пересчитывается по
ResizeObserver/смене DPI/quality, без чтения layout на каждом кадре.
Пользовательские FPS/quality и аппаратное ускорение сохраняются.

Native fullscreen2560×1440/high/default FPS:666draws за~4с (165Hz), median6.1ms,
p95 6.2ms/max6.9ms; own analysis101frames,median40ms/max40.7ms.
GPU RTX4070Ti/D3D11. В данном сценарии сильный лаг не воспроизведён; причина
сообщённого пользователем сильного зависания пока не подтверждена. Запрошены
условия (полосы или весь UI/звук, тот же или другой монитор).
11 профильных renderer tests PASS; frontend/native/обычный debug build PASS.
YCORE_SPECTRUM_PERF=1 добавляет opt-in native замер. Результаты rAF/draws
не являются замером фактического scanout монитора.

## Spectrum в основном окне — 2026-11-06

Доведён первый визуализатор: «Содержимое окна» → Spectrum, собственные сохранённые
FPS/quality, общий анализ с внешними сценами. Графический контекст создаётся при
первом выборе Spectrum; скрытое окно прекращает рендер и освобождает lease.
Переключение Клип↔Spectrum не перезагружает единственный YouTube engine.
Открытая панель YouTube скрывается при выборе Spectrum без нового load;
явное открытие панели возвращает видеорежим. Исправлены повторные неактивные
подписки и освобождение event listener.

Проверено: frontend build, TS13 PASS, Rust68 PASS/9 ignored, Clippy PASS;
renderer108 PASS/1 opt-in skipped (4 workers). Первый запуск с12 workers дал
3 timeout на общем старте; повтор после ленивой инициализации GPU прошёл целиком.
Native Windows/реальный YouTube: главный Spectrum WebGL,14 frames/maxband0.002211;
внешний7 frames/maxband0.002271. В UI0 iframe, engine epoch сохраняется,
один реальный плеер; два зеркала, транспорт, tray/mini/topmost/instance PASS.
Источник временно1%, после проверки0. Обычный target/debug/YCoreMusic.exe обновлён.

Ограничение S6 сохраняется: при громкости0 анализ получает тишину. Остальные
визуализаторы не входят в текущую задачу; Linux/macOS и полная hardware-матрица
не объявлены проверенными. Старые записи ниже отражают предыдущие срезы.

## Spectrum и общий аудиоанализ — 2026-11-06

Windows: process-loopback только дерева dedicated player-host, Float32 stereo44100;
общий FFT2048/Hann,48 логарифмических полос, около30 updates/sec. Один capture
на все видимые сцены, leases3sec, нативная проверка видимости. Нет микрофона,
системного микса, PCM-файлов, смены endpoint или громкости в продуктовой логике.
«Экраны»: монитор → Клип/Spectrum → per-monitor FPS/quality. WebGL с Canvas2D
fallback при ошибке/context lost; скрытая сцена останавливает rAF. Настройки
сохраняются с совместимыми defaults старых scene-layouts.

PASS: Rust68/9ignored, TS13, renderer106/1opt-in skipped, Clippy debugprobe и
release, no-default-features check, frontend build, normal debug custom-protocol.
Native real YouTube: Spectrum WebGL,7frames/maxband0.001132,0iframe в сцене;
VIDEO↔Spectrum сохраняет engine epoch и один плеер. Два независимых реальных
зеркала, транспорт/tray/mini/topmost/instance тоже PASS. Тестовый источник
временно1%, finally0. Пользовательский процесс не закрывался.

Остаётся: Ambient/Liquid/Particles, основной visualizer layout, физическая
hardware matrix, отдельный тест звука другого процесса. Volume0 даёт0;
pre-volume анализ не решён, S6 PARTIAL. Linux/macOS audio analysis не реализован.
Новые файлы: audio_analysis.rs,audio_capture.rs,audio_probe.rs,audio_spectrum.rs,
spectrum.ts,S6-AUDIO-SPIKE.md. Изменены Cargo,main/scenes/scene_layout,
scene-player/scene-ui/scene.css,tests,native runner. Детали: S6-AUDIO-SPIKE.md.

## Предпочтительный и исключённые клипы — 2026-11-05

CI6d47336: Windows/Ubuntu/IntelMac PASS; AppleSilicon renderer выявил преждевременную проверку lastPlayed после обновления метаданных очереди. Проверка исправлена на ожидание фактического Play (не меняет coordinator), targeted5повторов PASS. Полный CI повторяется после commit исправления.

REQ-063: явный приоритет одного клипа, исключение/отмена конкретного видео для песни, фильтрация истории/поиска/альтернатив/подготовленной очереди, старый random favorites без явного предпочтения сохранён. Исключение не меняет музыкальные реакции. Schema6 с backup перед миграцией v1–v5; Rust64/TS13 и native IPC/single-host smoke PASS, подробности в docs18. После этого приоритет S6/визуализаторы, как обещано пользователю; не переключаться на новые лёгкие задачи.

## Восстановление сцен — 2026-11-05

Добавлены сохранение независимых окон по стабильному monitor ID, восстановление без autoplay, hidden/OFF/tray intent и ожидание отключённого экрана без переноса на другой. Native тест прошёл настоящее приложение Quit→новый запуск и симулированный disconnect/reconnect с реальными окнами/видео; настройки ОС не менялись. Физический HDMI hotplug ещё не проверен. Пределы, поля и команды — [17-SCENE-LAYOUT-RECOVERY.md](17-SCENE-LAYOUT-RECOVERY.md). Визуализаторы/S6 и остальные пункты backlog следующие; заявления старых разделов о незавершённой persistence относятся к предыдущему срезу.

## Один плеер и независимые зеркала экранов — 2026-11-05

REQ-056 реализован на Windows: единственный YouTube engine в прозрачном click-through окне, main и сцены — DWM-зеркала. REQ-057: заметная кнопка «Экраны», явный выбор монитора, независимые окна клипа по monitor ID, targeted Off без переноса остальных, CONTROLS в основном окне. Два дополнительных окна на реальных мониторах проверены с меняющимися пикселями, 0 дополнительных iframe и одним source; play/pause/seek, quality-panel→alpha0, HUD/dialog, tray/mini/topmost/singleinstance PASS. Renderer100PASS/1skip, Rust60PASS/9ignored, fmt/ClippyPASS. Подробности/границы и команды в [16-SINGLE-PLAYER-MIRRORS.md](16-SINGLE-PLAYER-MIRRORS.md). Sourcehost по умолчанию только Windows; Linux/macOS пока один встроенный плеер без дополнительных зеркал. Визуализаторы/S6, hotplug и persistence ещё не реализованы. Старые записи ниже — история промежуточных срезов; stash повторно не применять.

## REQ-057: обнаруживаемость управления экранами — 2026-11-05

Кнопка «Экраны» вынесена в основную верхнюю панель. Общий диалог доступен и из настроек: шаг1 явный выбор экрана, шаг2 содержимое; действия закреплены внизу, шаги прокручиваются. Отключённый/непроверенный экран блокирует показ, выбор сохраняется при обновлении списка, Esc/крестик возвращают фокус. Есть объяснение подключения ТВ и переход основного окна в CONTROLS без изменения плеера. Targeted renderer6PASS, затем3PASS после закрепления footer, TScheckPASS. Визуализаторы честно disabled (S6 не проверен), старый backend пока даёт лишь одно отдельное окно. Это промежуточный UX-срез, не завершение multi-mirror/REQ-057; normal binary ещё не обновлён. Далее адаптация сохранённого single-player-host WIP.

## Premium Neon Dark — 2026-11-05

Единая тема, SVG-иконки, логотип и Windows ICO внедрены без перестановки блоков или изменения playback/sync/audio. Windows debug YCoreMusic.exe собран. Native smoke прошёл на трёх мониторах (100%, 100%, 200%), Rust 54 PASS/9 ignored, Clippy/fmt PASS, TypeScript unit 12 PASS. Полный список ресурсов, затронутых файлов и границ проверки: [15-PREMIUM-NEON-DARK.md](15-PREMIUM-NEON-DARK.md). Single-player-host WIP остаётся отдельно в stash.

## Переименование — 2026-11-05

Актуальный продукт **YCore Music**, коротко **YCore**. Repo [BjornSkarsgard/YCoreMusic](https://github.com/BjornSkarsgard/YCoreMusic), Windows binary **YCoreMusic.exe**. UI, tray, SMTC, package/build/CI metadata обновлены, хранилища прежнего YCore Music сохранены. Rename проверки и сборка PASS (ADR034). Новое Premium Neon Dark оформление — следующий текущий запрос пользователя; расположение блоков и playback/sync/audio logic не менять. Single-player-host WIP в отдельном stash до завершения визуальной задачи.

## Последнее изменение направления — 2026-11-05, REQ056

Несколько YouTube iframe отменены пользователем: нужен один настоящий плеер, дополнительные картинки — локальные зеркала. Windows DWM spike подтвердил живые кадры при alpha0/clickthrough источнике:90 разных кадров/90samples за32.353с, timeline+33с; destination может содержать локальный WebView без второго YouTube. Нативный hide, напротив, замораживает зеркало. Это ещё не замена плеера в продукте и не полная приёмка hidden/lock/performance/platforms. Следующий шаг — единственный отдельный player host, видимые зеркала и обычное управляющее окно (ADR033). Новое имя приложения выбирает пользователь: YCore Music занято; до выбора ничего не переименовывать.

## Актуальная сводка — 2026-11-05

Рабочий single-window prototype: Wave/жанры/поиск/медиатека/чарт/реакции/outbox/Smart History/favourites/history/mini/fullscreen/tray/recovery/autostart/диагностика, встроенный OAuth-вход, выбор трека очереди и её автоподгрузка. Пользователь подтвердил вход, отправку событий Wave и лайк YCore Music→Яндекс. Добавлен режим «Только управление» (REQ053): каталог и очередь одновременно, transport внизу; настоящий YouTube продолжает timeline при смене вида на Windows. Linux/macOS runtime, обратная ручная синхронизация реакций, physical sleep/lock, multi-monitor/visualizer/remote и clean install остаются открытыми. Последние CI mac jobs могут не стартовать из-за hosted runner capacity; это не успешная platform приёмка.

Далее идёт хронологический журнал. Ранние записи описывают прошлое состояние и не отменяют более поздние решения (в частности, выбор audioendpoint отменён пользователем).

## Этап 0 — историческая запись

- Подготовлены Tauri shell и TypeScript-экран S3 с одним YouTube IFrame.
- Только ручная загрузка/Play; авторизации, My Wave, очереди и backend пока нет.
- Это лаборатория: вывод на системное устройство, REQ-022 не реализован. Не считать полноценным плеером.
- Rust установлен; Windows native debug build проходит. Linux/macOS сборки запущены в CI, аппаратные проверки не выполнены.

| Проверка | Windows | Linux | macOS |
|---|---|---|---|
| S1 Яндекс/My Wave | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S2 Яндекс audio | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S3 YouTube desktop | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S4 endpoint | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S5 один звук/hidden | PARTIAL: два реальных iframe, follower muted/volume0, main hidden6с; без физического echo/hotplug/длинного прогона | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |
| S6 capture | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО | НЕ ПРОВЕРЕНО |

## Ручная проверка S3

На каждой ОС записать версию ОС, webview, Tauri, оборудование, video ID и результат:
1. Запуск не создаёт плеер и не начинает музыку.
2. Ссылка/ID + «Подготовить» загружает видео без воспроизведения.
3. Play, Pause, seek ±5 секунд, volume; проверить фактический звук и таймлайн.
4. Повторная загрузка другого видео не оставляет старый звук.
5. Недоступный embed и отключённая сеть дают видимую ошибку; проверить таймаут API.
6. Закрыть приложение, убедиться в остановке звука.

Следующее: установить toolchain, выполнить S3 в native shell, затем S1 и platform endpoint spikes. Токены не хранить в проекте.

## Автоматические проверки 2026-11-03

PASS: TypeScript strict check, тест trusted YouTube URL/ID (включая отклонение чужих доменов/протоколов/credentials), Vite production build. На момент первой проверки native build и реальное воспроизведение не были проверены; актуальные результаты ниже. npm install: 0 известных уязвимостей по результату текущего аудита.

### Продолжение Этапа 0

- Установлен Rust 1.99.1; запущена установка MSVC Build Tools + Windows SDK. Первая попытка native build остановилась на отсутствующем link.exe во время установки.
- Добавлен Cargo.lock и временная векторная иконка.
- CI собирает debug executable без инсталлятора на Windows, Ubuntu 24.04, macOS; результат сборки не означает прохождение аппаратных сценариев.
- PASS: Playwright/Chrome с подменённым YouTube API — отсутствие запроса к YouTube при старте, cue без autoplay, явный Play, удаление прежнего плеера перед новым. Реальный YouTube этим тестом не проверяется.


### Windows native build

PASS: `npx tauri build --debug --no-bundle`, Rust 1.99.1, Tauri 2.12.5. Создан `apps/desktop/src-tauri/target/debug/YCoreMusic.exe`.
PASS (только process smoke): приложение не завершилось в первые 5 секунд, после проверки закрыто. Отрисовка окна, реальный embed и звук не проверены. S3 остаётся НЕ ПРОВЕРЕНО до ручного сценария.

Установка Visual Studio Build Tools (MSVC + Windows SDK) завершилась успешно. Требуется новый терминал, чтобы обновлённый PATH Rust подхватился автоматически.

### Реальный браузерный YouTube spike

PASS в Chrome на текущей Windows: реальный YouTube API, video ID M7lc1UVf-VE, cue без autoplay, явный Play при громкости 0, Pause и seek +5 с с проверкой фактической позиции. Исправлена гонка: Play доступен после CUED, а не только onReady.

Добавлен таймлайн (время видео, drag seek). Проверка реального API включается явно переменной YCORE_LIVE_YOUTUBE=1; в обычном CI пропускается. Слышимость аудио не проверена. Chrome не заменяет WebView2/WKWebView/WebKitGTK: S3 native остаётся открытым.

CI коммита c0c7e9: native build + UI smoke прошли на macOS и Ubuntu; Windows ещё выполняется на момент записи. Это сборочные проверки, не аппаратная приёмка.

Подготовлен docs/S1-YANDEX-SPIKE.md; доступ к аккаунту и My Wave ещё не проверен.

### Яндекс probe и watchdog

Добавлен opt-in Rust `yandex-probe`: скрытый локальный ввод токена, два read-only HTTPS запроса, ограничение ответа/времени, запрет redirect, только безопасные категории ошибок. Порядок и повторы batch сохраняются. Реальный доступ НЕ ПРОВЕРЕН: требуется локальный ввод пользователем своего токена. 3 unit-теста PASS; бинарный файл Windows собран.

Исправлен timeout подготовки YouTube: отсчитывается до CUED, поздние события после timeout игнорируются. Playwright PASS для timeout и позднего callback, а также для замены одного плеера.

### S1: получено подтверждение пользователя

2026-11-03: пользователь запустил Windows legacy probe и сообщил Account request PASS, batch=5. Авторизация и первая legacy-порция подтверждены; S1 Windows = PARTIAL. Личные данные и IDs треков в статус не копируем.

Добавлен session probe по умолчанию: создание новой сессии и запрос следующих порций, queue в серверном порядке, без feedback/воспроизведения. Максимум 10 запросов порций, целевой объём 20 записей (не обязательно уникальных). Одинаковая подряд порция и ошибки завершают проверку. Старый сценарий доступен через --legacy. 5 unit-тестов, Clippy и сборка Windows PASS. Реальный session fetch ожидает локального запуска пользователем; credentials не сохранены.

CI коммита 90c5f06: Windows + Ubuntu + macOS завершились SUCCESS (сборка и автоматические UI-проверки). Аппаратные сценарии этих ОС этим не подтверждены.

### Новые требования: миниплеер и кроссплатформенный scope

В реестр добавлены REQ-049 (Windows/Linux/macOS, ранее зафиксировано ADR-001), REQ-050 (компактный миниплеер для одного монитора), REQ-051 (ручное topmost, сценарий PiP). Устранена устаревшая строка «кроссплатформенность вне scope». UI/мониторные сценарии и A25–A28 добавлены. Это требования и план; миниплеер пока НЕ РЕАЛИЗОВАН, точные кнопки/размеры — предложения.

### S1: session fetch подтверждён пользователем, 2026-11-03

Windows, локальный yandex-probe: account/status PASS, new session PASS без autoplay; 4 последовательные порции по 5 записей, суммарно 20, Session fetch PASS. Источник доказательства — присланный пользователем вывод утилиты, не самостоятельное наблюдение агента. Токен, session ID и список музыкальных предпочтений в репозиторий не копируются.

Подтверждены авторизация, создание session и продолжение выдачи с queue уже полученных ID. Сохранение серверного порядка в утилите проверено unit-тестами. Полный S1 остаётся PARTIAL: ещё нужны desktop lifecycle, очередь с асинхронным подбором, реальные feedback по действиям/прослушиванию и сетевые ошибки. S2 (аудио) не проверен этим запуском.

### Desktop вертикальный прототип: source + queue + миниплеер

- Общий Rust модуль yandex используется CLI и native source adapter; запросы/секреты не переходят в JS. Источник создаёт новую сессию при полном запуске без autoplay.
- Явное CLI --save-token после account PASS сохраняет секрет в OS store; --forget-token удаляет локально. Пользователь подтвердил успешное сохранение. Windows Credential Manager synthetic roundtrip PASS с удалением fixture; затем native source прочитал реальный credential без его вывода.
- Desktop получает названия/исполнителей и порции source; одна TS очередь, один cursor, порядок/повторы сохранены. Source API bookkeeping — только полученные ID. При сетевой ошибке существующая очередь остаётся. Автоподбор клипов пока отсутствует, URL задаётся вручную для текущего трека; нет автоматического перехода по завершению.
- Миниплеер в том же окне/плеере; topmost вручную. Добавлен single-instance guard. Persist window mode/settings, tray и remote пока отсутствуют.

Проверки на текущей Windows 11, WebView2 156.0.4314.58 и Edge WebDriver 156.0.4314.58:
- Native WebDriver PASS: startup без IFrame/autoplay, создание source session + следующая порция через OS store.
- Native реальный YouTube M7lc1UVf-VE PASS: cue, Play с volume=0, Pause, seek с проверкой позиции. Слышимость/качество аудио не проверены.
- Native PASS: mini resize/restore, из maximized в mini и обратно, topmost flag on/off, повторный запуск закрывает второй процесс.
- Unit/renderer PASS: queue order при позднем C, stale-generation, duplicate ordinal, metadata text escaping, failure сохраняет queue, тот же player при mini. Cargo tests и Clippy PASS до последнего rebuild; финальная проверка фиксируется ниже.

S3 Windows = PARTIAL (native управление видео подтверждено, слышимость/сбои/lifecycle ещё не полностью проверены). S4/S5/S6 и Linux/macOS runtime — НЕ ПРОВЕРЕНО. Вывод пока системный, REQ-022 не реализован. Новая CI-сборка с keyring/single-instance требует проверки на всех трёх ОС.

Финальная локальная проверка этого среза: cargo test (6 desktop + 5 probe PASS, OS store test opt-in отдельно ранее PASS), Clippy all-targets с -D warnings PASS, TS queue/URL unit PASS, 4 renderer smoke PASS. Native integration test после final rebuild PASS, включая single instance и maximized mini roundtrip.

Дополнение: 5 renderer smoke PASS после адаптации mini layout к широкому низкому окну; controls остаются в пределах viewport. Windows desktop пересобран. CI native/keyring/single-instance для новых изменений запущен; результаты Linux/macOS runtime по-прежнему не подтверждены.

### S10: автоподбор и автоматическое продолжение

Добавлен native matcher, консервативный ranking и bounded in-memory cache. Подробности/ограничения: S10-MATCHING-SPIKE.md. Три трека подготавливаются вперёд, источник/ordinal защищены от поздних результатов. Первый cue без autoplay; после Play natural end продвигает очередь, при исчерпании буфера подгружается source. Embed error/timeout меняет только candidate текущего трека. Pause/Next и pending-search intent покрыты renderer тестами. Ручная ссылка и «Подобрать заново» доступны.

Windows native integration PASS: источник → auto match → настоящий IFrame cue, отдельно известный search fixture → cue, sample video Play/Pause/seek на volume=0, mini/topmost/single-instance. В одном из более ранних запусков рекомендация не дала безопасного совпадения и потребовала ручной ссылки — покрытие неполное. Слышимость звука/все кандидаты не проверены.

Локально PASS: 10 desktop Rust unit + 5 probe unit (дубли общих parser tests в двух бинарниках); opt-in live metadata spike PASS; Clippy all-targets PASS; 8 renderer smoke PASS (live browser test по умолчанию skipped). S10 остаётся PARTIAL. Новые возможности пока ожидают CI. Предыдущий коммит 182250f собрался на Windows, Ubuntu и macOS.

### Обновление аудиотребований

Пользователь отменил endpoint selector/routing. Используется системная маршрутизация, REQ-022 superseded, S4 не блокер. Незакоммиченная аудиодиагностика удалена. Настройки Windows не менялись, audible probe не выполнялся. При volume=0 процессный audio-session owner не подтвердился (0 сессий), поэтому S6 остаётся НЕ ПРОВЕРЕНО. Далее — persistent manual video override/history.

### SQLite: ручные клипы и базовая история

Сделано: persistent manual override на track ID, приоритет перед поиском, отказ сохранённого клипа → временный автоподбор без удаления пользовательской привязки. История фактических PLAYING-start, без дублей при pause/resume; поиск по title/artist с кириллицей, воспроизведение записи, подтверждаемая очистка (manual overrides остаются). История не перезаписывается поздним source-init callback. OAuth не хранится в SQLite.

Локальные проверки PASS: 13 desktop Rust + 5 probe unit (общие parser tests дублируются в двух бинарниках), Clippy -D warnings, 11 renderer smoke + skipped opt-in live test. Миграция пустой схемы/идемпотентность/search/reopen override/refusal newer schema покрыты тестами.

Native Windows PASS: отдельная .tools/native-test-data SQLite, чтение/запись override, идемпотентная запись, clear history не удаляет override, removal override. После реального sample Play на volume=0 read-only проверка этой тестовой БД подтвердила запись M7lc1UVf-VE и отсутствие очищенного синтетического fixture. Source/YouTube/mini/topmost/single-instance smoke также PASS. Личная история и сохранённый OAuth не очищались; открытое пользователем окно не закрывали.

Ограничения: история пока только старты (нет listened duration/end_reason/date filter/pagination), одна ручная привязка вместо полного набора favourites, нет Play Next/Append из истории, native-runtime Linux/macOS для нового storage не проверен. Сборка Windows обновлена. Предыдущий d7e7610 прошёл CI всех 3 ОС; этот срез ждёт новой CI-проверки. Аудиовыход теперь системный по решению пользователя.

### User-reported matching correction

Living Dead Beat / Children Of Bodom воспроизведён в metadata search: канал Berar Emanuel с оригинальной группой в названии раньше отсеивался. Канал больше не hard gate. Добавлены title-based band/song matching, фильтрация playthrough/backing, просмотры как первый критерий среди подходящих кандидатов и ручной список неоднозначных результатов. Rust regression fixture + реальный metadata probe PASS. Непосредственная embed-проверка v-UX4hmUESg пока не прошла подготовку за 25 секунд; это не считается доказанным воспроизведением данного ролика. Подбор и фактическая доступность embed — отдельные проверки. Previous/repeat/volume persistence остаются следующим запланированным срезом; новая задача пользователя — каталоговый поиск Яндекса.

### Каталог Яндекса, Previous, repeat-one, volume

Сделано: search «исполнители/треки/альбомы/плейлисты», открытие коллекций, явный запуск списка/трека, дополнительные страницы поиска и коллекций. Просмотр не прерывает текущую музыку. Конечная playlist/album/artist queue сохраняет порядок, подгружает страницы, не уходит сама в Wave. Реальный запрос «рамштайн» вернул Rammstein, 4 исполнителя, 20 треков, 10 альбомов, 4 плейлиста; чтение первой коллекции каждого типа PASS через OS-store credentials без вывода токена.

Добавлены Previous (seek 0 / повтор за 3 с назад в текущей очереди), repeat-one, persistent volume/mute. Native restart-to-zero сохраняет паузу. Repeat-one/cross-track Previous и volume reload покрыты renderer/unit тестами, полное естественное завершение повторяемого ролика в native отдельно не проверялось. Volume prefs — только localStorage UI-настройка, не секреты. Полные favourites/repeat-queue/SMTC/межисточниковый playback stack остаются.

Windows native smoke PASS: кириллический запрос и 4 раздела, открытие artist/album/playlist списков, просмотр не меняет текущий title, явный запуск списка наполняет очередь. Также PASS: SQLite fixture isolation, source session/batch, sample real YouTube volume=0 Play/Pause/seek, Previous seek0 paused, history, mini resize/maximized restore/topmost, single instance. Локально: 18 desktop Rust unit + 5 probe unit, Clippy PASS; 17 renderer smoke + 1 opt-in live test skipped; 5 TS pure unit PASS. Новая Windows сборка собрана после закрытия пользовательского окна. Новый CI ещё не завершён; runtime Linux/macOS для поиска/контролов не проверен.

Living Dead Beat metadata search PASS и регрессионный fixture PASS; конкретный v-UX4hmUESg в отдельном live embed test не подготовился за таймаут. Не объявляем этот ролик воспроизводимым по одному поиску; alternative candidates/error path остаются обязательными.


### Трей, media controls, power lifecycle — 2026-11-04

Реализованы скрытие в трей без пересоздания сессии, Open/Play-Pause/Exit, восстановление минимизированного окна при повторном запуске. При отказе создания трея обычное закрытие остаётся доступным. Один coordinator/player; системные команды идут в него. Подключены Souvlaki SMTC/MPRIS/Now Playing, metadata/state/progress из реальных IFrame событий. На Windows WebView HardwareMediaKeyHandling отключён, обычных глобальных клавиш нет.

Sleep/wake events отменяют play intent и удерживают паузу до явного Play, сохраняют позицию/очередь. Поздний PLAYING и ENDED не возобновляют/не продвигают очередь после power pause. Windows SetThreadExecutionState удерживает automatic sleep/display off только при PLAYING, сбрасывается на паузе/power events/Exit. Linux/macOS idle inhibition пока отсутствует; отсутствие logind/OS listener не проверено.

PASS локально: TS check + 5 unit, Rust 18 desktop + 5 probe unit, Clippy all-targets -D warnings; 18 renderer smoke (1 live browser opt-in skipped), в том числе system Play -> suspend/resume -> поздний PLAYING -> ручной Play без новой source-сессии. Windows native: кириллический каталог/коллекции, isolated SQLite, source session/batch, real YouTube при volume=0, скрытие на 4 с с продолжающимся таймлайном, восстановление того же трека, tray-handler Pause, SMTC state playing/paused, имитированные power events, seek/Previous/history, mini/topmost/maximized restore, повторный запуск возвращает minimize. Exit завершает тестовый экземпляр.

Ограничения: shell-значок не кликался аппаратно; тест вызывает тот же production action handler. Физические медиаклавиши/звуковая слышимость/реальный сон/wake/Win+L не проверены. Native power events имитированы через Tauri event system, что не доказывает подписку OS listener. Linux/macOS runtime не проверен. Предыдущая CI afcdd1d: Windows/Ubuntu PASS; macOS job не получил arm64 hosted runner. Добавлен macos-15-intel параллельно с arm64; следующий CI проверит новый код.


### История: следующие треки и конец очереди

PASS: History Next/Append с сохранённым video ID не прерывают текущий Play/Pause, сохраняют Wave continuation, повторы и порядок. Manual video без source queue остаётся текущим при добавлении истории. Stable ordinal отделён от cursor, поздний resolve не переезжает после вставки. Локально 6 TS unit, 20 renderer smoke + 1 opt-in skipped. Native Windows PASS: две вставки из изолированной истории сохраняют current paused title, увеличивают очередь на 2; Next подготавливает сохранённое видео без autoplay. Остальной native tray/media/power/mini/catalogue smoke также PASS. Windows пересобран.

CI eff15db выявил macOS link failure _IOPSRelease в power-monitor 0.1.0. Внесён минимальный лицензированный vendor patch с CFType create-rule RAII (CFRelease); Windows cargo check PASS. Подтверждение macOS-сборки ожидается от нового CI. Это реальная ошибка зависимости, в отличие от прежних отказов выделения runner.


### Repeat queue, локальные клавиши и native test isolation

Сделано: finite queue repeat с догрузкой коллекции перед возвратом в начало, сохранением pause при ручном Next через конец; Wave ограничен off/one, при новом Wave сбрасывается queue-repeat. Локальные Space и стрелки +/-5 с пропускают поля ввода и интерактивные controls. PASS 21 renderer smoke + 1 opt-in skipped, 6 TS unit. Native Windows PASS: history queue из одного элемента оборачивается paused без autoplay; WebDriver keyboard Space запускает/ставит паузу настоящий IFrame на volume=0. Остальные tray/power/history/catalogue/mini проверки также PASS.

Native smoke теперь запускает отдельный Cargo native-test executable, debug-only test identifier, отдельный WebView profile и isolated SQLite. Проверен рядом с уже работающим пользовательским YCore Music: пользовательский PID сохранился, тестовый процесс завершился. User-facing debug executable может оставаться заблокирован открытым экземпляром; новая сборка готова в native-test output.

CI 0339af0: Ubuntu, macOS Intel и macOS Apple Silicon PASS, включая native link после vendor patch. Windows job ещё выполнялся при записи. Это сборка/автотесты, не доказательство аппаратного runtime на Linux/macOS. Новые repeat/local-key/test-isolation изменения ожидают следующего CI.


### Свои controls, hover/seek и субтитры

PASS Windows native с настоящим YouTube на volume=0: controls=0/pointer-events:none; перемещение указателя в центр видео и наша перемотка не показывают верхнюю/нижнюю chrome-панель YouTube. CC on/off проверен по фактическому состоянию тестового YouTube player, в том числе повторный Play после off. Это потребовало подавления автоматического включения CC при muted Play; одного track={} и чтения getOption(track) недостаточно. Свои доступные дорожки/размер текста и quality-event indicator под видео. Ручное разрешение остаётся в явной временной панели YouTube, не в фиктивном custom selector.

PASS native: открытие/скрытие YouTube controls сохраняет позицию и не дублирует SQLite history; свой fullscreen входит/выходит с тем же единственным IFrame. Screenshot .tools/native-custom-player.png просмотрен: на активном видео нет chrome overlays, свои controls видны под ним. Остальной native catalogue/tray/power/mini/history/repeat smoke PASS. Renderer: 22 PASS + 1 live opt-in skipped; после CC enforcement дополнительно целевой regression с auto-enabled caption mock PASS. 6 TS unit, strict check, Windows native-test build PASS.

Ограничения: branding/служебные заставки YouTube на pause/load полностью не отключаются; изменение качества через API no-op, закрытие native панели может сбросить ручной выбор. CC bridge использует обнаруженные runtime возможности, его совместимость с будущими изменениями YouTube не гарантируется. Native Linux/macOS для новой панели не проверен. CI f85cc64 полностью PASS: Windows, Ubuntu, macOS Intel, macOS Apple Silicon. Новая панель ожидает собственного CI.

## Ночной срез 2026-11-04 — постоянное видео и непрерывная волна

Реализован layout «Сцена», независимый скролл выдачи, фильтры каталога, реальные жанровые станции, предзагрузка рекомендаций/поиска и автоматический пропуск непригодных видео. Pause/сон отменяют продолжение; сетевые ошибки повторяются с backoff, устаревшие сессии обновляются с прежним seed и недавними ID. Ограничена память истории очереди.

Проверки: TS build + 7 unit PASS; renderer 26 PASS + 1 opt-in skipped; Rust 20 + 5 PASS, 6 ignored; Clippy PASS. Реальный Яндекс: 161 жанр, 5+5 рекомендаций выбранного жанра. Полный Windows native smoke PASS; отдельный live Wave — старт и два END-перехода без ручного выбора на одном IFrame (volume=0, ускоренная перемотка к концу). Windows debug executable обновлён. Многочасовой прогон и Linux/macOS runtime ещё не проверены. Актуальная передача контекста: SESSION-HANDOFF.md.

## 2026-11-04: центрирование управления и навигация каталога

По просьбе пользователя транспорт выровнен по центру. Fullscreen показывает видео на всю поверхность; существующие controls появляются нижним центральным оверлеем по движению мыши, скрываются через 3 секунды, остаются доступны при hover/drag/клавиатурном фокусе. Плеер не пересоздаётся. В каталоге отдельный просмотр коллекции с возвратом в выдачу, восстановлением scroll/focus и отменой поздних ответов; пустой фильтр показывает подсказку.

Проверено: TS build, 7 unit, renderer 28 PASS + 1 opt-in skipped; полный Windows native smoke с реальным Яндексом/каталогом/YouTube, fullscreen, mini/topmost PASS. Следующее по прямому запросу: REQ-002 личные плейлисты/любимые, REQ-008/009 реакции/outbox/Undo. Ночная версия f97bff5 прошла CI на всех четырёх платформах.

## 2026-11-04: личная музыка, реакции, обзор и альтернативные клипы

- «Моя музыка»: собственные/сохранённые плейлисты и «Мне нравится», просмотр без переключения, запуск списка/с выбранного места и пагинация. Реальный read-only probe: 43 плейлиста, 900 liked IDs, 100 метаданных страницы.
- «Обзор»: текущий чарт (100 треков) и редакционные подборки Яндекса (4 в пробном запросе), обновление, запуск и просмотр списков. Это данные сервиса, не статическая имитация.
- Like/unlike/dislike, Undo 5 секунд без rewind, SQLite v2 и account-scoped pending outbox, revision guard, сетевой retry. Реальная запись предпочтений в тестах блокируется; права текущего токена на успешный write ещё не подтверждены.
- Альтернативы рядом с видео: изображения, названия, просмотры, длительность; выбор того же трека с сохранением play/pause, одна ручная привязка. Реальный YouTube metadata probe: duration у 5/5 кандидатов. Реальный native switch и загрузка превью PASS, один IFrame, volume=0.
- Проверки: strict TS/Vite, 7 unit; renderer 32 PASS + 1 opt-in skipped; Rust 25 app + 5 probe PASS, 9 opt-in ignored; Clippy all-targets -D warnings PASS. Migration backup/preservation и durable outbox failure/coalescing/account isolation/late ACK проверены.
- Полный Windows native smoke: реальный Яндекс, каталог, медиатека/чарт, YouTube/CC/fullscreen/tray/media/power/mini/topmost/single instance PASS. Native driver после fullscreen теперь отводит указатель от HUD перед проверкой скрытия; наведение сохраняет управление по согласованному UX. При завершении убирается только PID изолированного тестового экземпляра.
- Linux/macOS runtime, реальная delivery реакций и многочасовая непрерывность остаются неподтверждёнными. CI запускается при push.

## REQ-037 и длительная проверка волны

Добавлены локальные Up/Down ±5% с clamp/persistence и F11 для того же fullscreen workspace. Поля ввода, кнопки, select, диалоги и modified keys не перехватываются; музыка от shortcuts настройки не запускается. Целевой renderer test PASS: границы 0–100, persistence, два F11 без пересоздания iframe, editing guard/no autoplay.

Добавлен опциональный YCORE_WAVE_SOAK_MINUTES (до 120) и отдельная YCORE_NATIVE_TEST_DATA_DIR. Идёт 20-минутный настоящий неускоренный прогон, hidden+volume0, с периодическим JSON прогрессом в .tools. Результат на момент записи ещё не получен. Native-test бинарник занят прогоном: не пересобирать этот профиль до завершения. Следующий срез — REQ-014 несколько избранных клипов/random/no-repeat.

## 2026-11-04: REQ-014 и длительный Wave прогон

Несколько избранных клипов, звезда, список/удаление в диалоге, random/no-immediate-repeat, repeat-one, фактический last-play в SQLite, unavailable без автоудаления. «Автоподбор на этот раз» сохраняет набор. Миграция v3 импортирует старую ручную ссылку, сохраняет pending reactions и создаёт backup исходной v1/v2.

Проверки: TS/build, 8 unit PASS; renderer 35 PASS + 1 opt-in skipped; Rust27 app +5 probe PASS,9 opt-in ignored; Clippy PASS. Полный Windows native с настоящей медиатекой/чартом/YouTube и отдельный native test нескольких favourites PASS. Два реальных видео чередуются по END, снятие звезды не прерывает плеер. Реальные feedback writes по-прежнему не выполнялись и не объявляются подтверждёнными.

Отдельный 20-минутный неускоренный прогон настоящей Wave: 5 автоматических смен трека, hidden, volume=0, один IFrame; максимальное замеченное ожидание около5сек при опросе5сек. Нет ручной перемотки/Next. Это ограниченная Windows проверка, не доказательство многочасовой/100% доступности. JSON результаты локально в .tools/wave-soak-result.json. CI26bb9ee целиком PASS на четырёх платформах; новый push запустит проверки текущего среза.

## 2026-11-04: fullscreen quality panel и поздний fullscreenchange

При явно открытой панели качества YouTube собственный HUD остаётся доступен: cross-origin iframe перехватывает движения мыши. После скрытия панели возвращается обычный idle timeout. Поздний fullscreenchange больше не отменяет уже произошедшее движение мыши. Regression имитирует задержанный event и проверяет видимость; обычное скрытие также проверено.

Renderer36 PASS+1opt-in skipped, точечные fullscreen/manual сценарии PASS; Windows native: реальная interactive quality panel в fullscreen после hover/idle оставляет наши кнопки доступными, затем закрытие/остальные smoke PASS. Заголовок окна — YCore Music; standalone manual clip сразу обновляет title/source. Native runner получает PID из desktop_status после testMode verification, а не из browser capabilities, поэтому cleanup относится к подтверждённому своему приложению. History queue assertion учитывает обёртку отдельно играющего manual clip.

CI d306f82: Windows/Linux/macOS ARM PASS; macOS Intel остановился на renderer таймауте Wave/fullscreen recovery. Следующий push включает защиту позднего fullscreenchange и её regression; окончательный результат CI ещё ожидается.

## 2026-11-04: стабильная высота обзора при смене клипа

По прямому замечанию пользователя область альтернатив получает постоянную адаптивную высоту, включая время загрузки/скрытое состояние. Scroll-область боковой панели занимает оставшееся место. При выборе трека обзор не растягивается и не меняет scrollTop. Отдельный renderer regression с 200 треками и управляемой задержкой YouTube matching PASS: размеры и прокрутка проверены до, во время и после загрузки.

## 2026-11-04: Smart History и snapshots реакций

Добавлен локальный бесконечный источник с весами по like/частоте/давности и исключением известных dislikes. При недоступности Wave сначала заканчивается загруженная очередь, затем включается история. Возврат к Wave — явный. Startup без autoplay, Pause отменяет pending start. Известные video IDs играют без зависимости от поиска; при исчерпании вариантов трек обходится, без музыкального negative feedback.

Реакции получают generations и полный подтверждённый snapshot исключений при пустом outbox. Старое чтение не отменяет новый Set; pending intents защищены; снятый в Яндексе dislike снова допускается. Личная медиатека обновляется после синхронизации и по TTL при открытии.

Проверки: TypeScript/build,9unit PASS; renderer44 PASS+1opt-in skipped; Rust28 app+5probe PASS,9ignored;Clippy PASS. Windows native local Smart source + известный клип + реальный END + sticky source +1iframe PASS. Полный native YouTube/CC/fullscreen/tray/media/simulated power/mini/topmost PASS. Реальный current-token feedback GET и exclusions snapshot PASS, реальные feedback writes остаются заблокированы в тестах и не объявляются проверенными. Native cleanup меняет/закрывает приложение только после подтверждения testMode.

Quick-skip threshold и listened-duration classification пока не реализованы (Q06 открыт). Linux/macOS runtime, физические media/sleep/lock hardware tests остаются неподтверждёнными.

## 2026-11-04: поиск без случайного запуска старой выдачи (REQ-002)

Кнопка очистки возвращает фокус в запрос, сбрасывает результаты, фильтры и пагинацию, отменяет pending responses. Пока новый запрос ожидает debounce/ответ, предыдущая выдача и фильтры inert, кнопка дозагрузки отключена. Ошибка объясняет, что остались предыдущие результаты. Убраны лабораторные подписи заголовка и пустого плеера; выбор жанра подписан «Жанр музыки».

TypeScript/build PASS; renderer 45 PASS +1 opt-in skipped, включая stale playback/clear/late response/reuse и стабильную высоту обзора. CI предыдущего Smart History среза целиком PASS. Пользовательский YCore Music открыт; обычная сборка блокируется Windows. Свежий embedded binary собран в native-test (testMode включается только окружением), скопирован в .tools/search-update-20261104. Hidden updater ждёт выхода обоих обычных executable paths, проверяет исходный/целевой hash, отменяет устаревшее обновление, не запускает/не закрывает приложение. Статус в локальном status.json; установка ещё ожидается.

Дополнение поиска: после неудачного нового запроса нельзя догружать страницы по чужому query/page. Предыдущая выдача явно подписана; повторный успешный поиск возвращает пагинацию. Дополнительный regression PASS, обе search проверки PASS, TypeScript/build/embedded native profile PASS. Подготовленное обновление пересобрано; helper ожидает выхода, hash manifest обновлён.

## 2026-11-04: REQ-006 полная пагинация истории

Нативный beforeId cursor (совместим с прежним history API) открывает записи старше100, сохраняя реальные повторы и порядок при новых событиях. Отдельный history-ui владеет только просмотром, очередь по-прежнему в coordinator. Поиск отменяет pending callbacks немедленно, дозагрузка повторяется после ошибки; clear защищён от двойного нажатия и late response, ошибка видна в диалоге. Подписи трека/исполнителя/даты читаются отдельно. ADR-021, без миграции БД.

Проверки: TypeScript/build PASS; полный renderer48PASS+1opt-in skipped, затем3целевых historyPASS (включая добавленный failure/retry);9TSunitPASS;Rust29app+5probePASS,9ignored;ClippyPASS. Настоящий Windows native:105исторических событий, новый event между страницами, cursor/порядок/очистка/no-autoplay PASS; полный настоящий YouTube/история now-next-append/repeat/fullscreen/CC/tray/media/mini/topmost PASS. Только testMode база. Стандартный debug/YCoreMusic.exe успешно пересобран после выхода пользователя. Старый hidden search updater оказался blocked и ничего не установил; новая стандартная сборка заменяет его, ожидающего обновления больше не требуется. Не запускать старые apply.ps1.

## 2026-11-04: REQ-046 renderer recovery

Сохраняем track/position/history-record при confirmed browser offline; buffering восстанавливает тот же clip с backoff. Pause/wake/source/Next guards, END после reconnect учитывает repeat-one. Renderer56PASS+1opt-in skipped, TS/buildPASS.7новых regression включают15мин offline через clock, восстановление43с без duplicate history, Pause,Next,late callbacks,wake,finite retries иrepeat.

Настоящий60мин native Wave прогон идёт на baseline025ab78 (до нового recovery), hidden+volume0+fresh test directory, без seek/Next. Окончательный результат ещё не получен. Native-test profile занят: не пересобирать до завершения. Новый recovery требует отдельной native проверки после прогона; полный реальный сетевой outage пока не утверждать проверенным. CI025ab78: Windows/Linux/macIntel PASS; macARM canceled без failedstep, overallfailure; следующий push перепроверит.

## 2026-11-04: REQ-043 автозапуск — реализация, native проверка ожидается

В настройках checkbox реального OSautostart, по умолчанию ничего не регистрируется. Официальный plugin2.7.0, нативные main-only commands, отдельный --ycore-autostart путь hidden+paused, tray-failure fallback, повторный background instance не крадёт фокус. Native testMode запрещает OS mutations. Rust31app+5probePASS,9ignored;ClippyPASS;2целевыхautostart rendererPASS; полный renderer прогон повторяется после исправления проверки немедленного rollback checkbox.

Подготовлен дополнительный native сценарий CDP outage только собственного WebView, без изменения системной сети. Он ещё не запускался; не объявлять PASS. Native profile занят60минWave baseline025ab78. После завершения пересобрать с новым recovery/autostart, выполнить YCORE_AUTOSTART_SMOKE/YCORE_LIVE_RECOVERY и обычный native YouTube smoke. Autostart enable/disable текущего пользователя и настоящий login не выполнялись.

Повторный полный renderer для autostart:58PASS+1opt-in skipped; TypeScript/buildPASS. Native runtime всё ещё ожидается после часового прогона.

## 2026-11-04: завершён часовой непрерывный Wave прогон; остановка по просьбе пользователя

Настоящий неускоренный Windows native Wave прогон завершился с exit0:60минут,16автоматических смен,712playingSamples,7waitingSamples,maxFrames1. Самая долгая замеченная пауза около5сек при дискретном опросе5сек. Окно скрыто,volume0, без seek/Next/ручной помощи. Результат .tools/wave-soak-result.json, тестовая база .tools/native-soak-60min-20261104. После прогона mini/restore/topmost/maximized/single-instance PASS; собственный тестовый экземпляр завершён. Проверялся baseline025ab78, до новых recovery/autostart/feedback изменений. Это ограниченная Windows проверка, не100% гарантия внешних сервисов и не Linux/macOS runtime.

По явной последней инструкции пользователя дальнейшая разработка и новые тесты остановлены. Recovery7634ff4 и autostartecfe73c: renderer58PASS+1skipped, native приёмка новых сценариев ещё НЕ выполнялась. Незакоммиченный refactor feedback.rs/feedback-ui.ts и новый feedback.spec.ts:4целевых Rust и2целевых rendererPASS, полного регрессионного/native прогона после него нет. Не объявлять срез полностью готовым. Настоящие preference writes и OSautostart enable не выполнялись. ПК не выключать: текущая инструкция — записать результат и остановиться.

## 2026-11-04: продолжение после команды «работай», реакции

Последняя команда пользователя возобновила работу. Завершён refactor реакций: network вне cache lock, отдельная последовательная доставка, generation guards, overlay всех pending (проверено60), доступные известные кнопки во время refresh, rollback ошибки. ADR-024. Полный renderer60PASS+1opt-in skipped; Rust35app+5probePASS,9ignored;Clippy иfrontendbuildPASS.

Native свежей сборки: запуск --ycore-autostart в tray/без autoplay/Open PASS; OS setting read +testMode mutationguard PASS без записи startup; реальные personal library/chart/feedbackGET snapshot PASS. WebView CDP outage запустился, сохраняет track/history и уважает Pause, но проверка восстановленной позиции FAILED; расследуется, не объявлять этот recovery nativePASS. Системная сеть не менялась. CIecfe73c Windows/LinuxPASS, macIntel/macARMCANCELLED: annotations сообщают отсутствие hosted runner/capacity, failedsteps отсутствуют.

## 2026-11-04: native recovery/autostart подтверждены; диагностика

Новый Windows native WebViewCDP outage20сек PASS: seek940сек, буфер доиграл до958сек, восстановление959сек. Проверяется последняя фактическая buffered position, а не положение в начале outage. Track/cursor/history сохраняются, Pause запрещает reconnect autoplay; системная сеть не менялась. Первоначальное падение проверки было неверной точкой сравнения; код recovery менять не потребовалось.

Полный native YouTube/CC/hover/seek/quality/fullscreen/tray/media/history/repeat/localkeys/mini/topmost/maximized/singleinstance PASS. Background duplicate не фокусирует пользовательское окно, autostart аргумент стартует hidden+paused,OSmutationguardPASS. Maximize test теперь ждёт реального maximizedstate и получает новый rect вместо раннего ответа WebDriver. Физический sleep/lock и реальное включение autostart по-прежнему не выполнялись.

Настройки получили read-only health: версия/платформа/открытие хранилища, сохранённое подключение и отдельная явная проверка Яндекса. Различаются authorization/network/rate-limit/service errors. Native response содержит только фиксированные метаданные и статус, без accountUID/login/token; APIaccount/status вызывается только при кнопке проверки. Нативная настоящая проверка соединенияPASS. Полный renderer61PASS+1opt-in skipped,9unitPASS,Rust36app+5probePASS/9ignored,Clippy/buildPASS. Обычная debugсборка обновлена.

## 2026-11-04: упаковка в установочные файлы

Отдельная opt-in bundleconfig, npmкоманды NSIS/DEB+AppImage/APP+DMG и dispatch-only workflow для release artifacts без публикации. Локальный Windows debugNSIS успешно собран3.72MiB, SHA256 BB808E20E4ACA70FA7F46FE41214354D1765D642E902E1661EBA38CA218E2996. В установщик не включены токен/SQLite. Он не запускался, чистая установка/удаление не проверены; releaseупаковка вCI ещё ожидается. До этого полный UI/native/Rust срез428a444PASS по предыдущей записи. Mac hostedrunnercapacity по-прежнему внешнее ограничение.

## 2026-11-04: Windows release пакет и актуализация документации

Локальная оптимизированная Windows release сборка и NSIS завершились успешно:target/release/bundle/nsis/YCore Music_0.0.1_x64-setup.exe,3.28MiB. SHA256/signature записаны в .tools/windows-package-result.json, пакет не установлен и не опубликован, подписи нет. Во frontend/пакет не добавлены пользовательские credentials илиSQLite. Ручной packageworkflow появился в GitHub после задержки регистрации; Linux dispatch запрошен для проверки DEB/AppImage, итог ещё ожидается.

README приведён к текущему single-window prototype: удалены противоречащие актуальной реализации старые утверждения про отсутствие Wave/нескольких favourites/автообхода. docs00 теперь явно Windows/Linux/macOS и видеопоток Wave; начало журнала статуса маркирует ранние записи историческими. Готовность UIlogin, real preference writes,physical lifecycle,platformruntime не завышена.

## REQ-006: период истории (2026-11-04)

Свёрнутый блок «Период» задаёт локальные календарные дни «С»/«По». Последний день включён; следующий день рассчитывается календарно, включая DST, а не прибавлением24часов. Смена периода отменяет late responses и сбрасывает cursor, кнопка сброса не меняет текстовый запрос. Пустая выдача по фильтру не объявляется пустой историей. Диалог очистки явно предупреждает об удалении всей истории, включая записи вне периода.

storage/history принимает optional from/until в Unixseconds: from включён,until исключён,пагинацияbeforeId сохранена. Старые клиенты без периода совместимы. Все собственные started_at хранятся в UTC; фильтрация по UTCsecondprefix не округляет наносекунды на границе дня, миграция не требуется.

Проверки: UI62PASS+1opt-in skipped,Rust37app+5probePASS/9ignored,Clippy/buildPASS. Native Windows inclusive today+pagination+futureempty+clear+noautoplay+mini/topmost/maximized/instancePASS. Отдельно проверен25часовой день NewYork и поздний старый период. Linuxrelease DEB/AppImage workflow41867671860PASS, артефакты скачаны в.tools/linux-packages-41867671860; runtimeещё не проверялся. MacARM packaging41870661876запрошен, итог ожидается.

## 2026-11-04: стабильные renderer fixtures и реальный browser embed

Mock renderer scenarios используют общую thumbnail fixture вместо внешних i.ytimg.com запросов. Live spec остаётся без подмены, исправлен под текущий диалог и rangeinput: реальный Chrome YouTube cue/noautoplay/explicitmutedPlay/Pause/seekPASS (15.5сек). Полный mock suite62PASS+1opt-in skipped (28.7сек); это не замена native/runtimeприёмке. Productionкод этим срезом не менялся.

Linux DEB/AppImage release41867671860PASS; скачаны и проверены AR/ELFформаты, SHA256/controlmetadata в.tools/linux-package-result.json. Native Linux/X11 run41871384767 идёт; MacARMpackage41870661876вочереди.

## 2026-11-04: первый Linux X11 прогон и ожидание оконного менеджера

NativeLinux41871384767 дошёл до реального GTKокна/noautoplay/autostartargument/diagnostics/SQLite/historydates+cursor+clearPASS. Упал на немедленном чтении topmostfalse после запросаtrue. Проверена реализация TaoLinux: setter отправляет WindowRequest, getter читает ABOVE из последующего WindowStateevent. Runner теперь ждёт подтверждённое состояние с ограничением5сек, не подменяет getter/результат. Повторный Linux прогон ещё ожидается. Windows basic native с этим ожиданиемPASS.

CI получает cache Rustdependencies через rust-cache для уменьшения повторной компиляции (workspaces apps/desktop/src-tauri -> target,cache-on-failure). MacARMпакет пока вочереди, наличиеmacOS runtime не утверждается.

## 2026-11-04: клавиатура раскрывающихся блоков и финальная Windows сборка

Space/Enter на summary сохраняют стандартное раскрытие блока и не запускают/не приостанавливают музыку; guard распространяется также на rolebutton.3целевых keyboardrendererPASS,check/debugbuild/releaseNSISPASS. Windows installer пересобран с периодом истории и этим guard, актуальный hash в.tools/windows-package-result.json. Ранний NSIS из предыдущих записей — более старый snapshot той же версии0.0.1; установка/подпись по-прежнему не выполнялись.

LinuxNative41873691768: startup/autostart/health/SQLite/historyPASS, topmost после5сек остаётсяfalse. ReadinessOpenbox иDISPLAY дляDBus исправлены; ожидание само проблему не решило. Lookup пофиксированному заголовку не нашёл окно (возможна смена titleWebKit).41874314737 добавляет readonly _NET_CLIENT_LIST +PIDfilter только для своих окон и их EWMHstate; итог ожидается. Не считать Linuxmini/topmost/maximized полностью принятыми. MacARMpackage41870661876не получил hostedrunner иcancelled, без failedstep.

## 2026-11-04: остановка при9%лимита

Текущие Windowsdebug/releaseNSIS пересобраны с фильтром дат и клавиатурнымguard; manifest.tools/windows-package-result.json, packageSHA25608171F4801A5C1648FD571B291F1F9F6B26FF0F662B6E26BCD5BFF00216F7603. Установщик не запускался. LinuxDEB/AppImage41867671860собраны на более старомsnapshot; nativeLinuxstartup/storage/historyпрошли,topmostнепрошёл. Последнийdiagnosticrun41874314737застрялнаAPT,запрошеныcancel/forcecancel;EWMH/PIDдиагностикаещёнеполучена. MacARMpackagecancelledиз-заhostedrunnercapacity. Состояние,коммиты,проверкииблокеры подробно сохраненывSESSION-HANDOFF.md. Новыхзадачпринизкомлимитененачинать;невыдаватьпроектза полностьюготовый.

## Вход из настроек — 2026-11-05

Добавлены native auth.rs и auth-ui.ts: вход в отдельном окне Яндекса, отмена/таймаут/ошибки, readonly проверка доступа перед OS-store save, подтверждённый локальный disconnect. Token/identity не передаются в интерфейс. Успех обновляет YCore Music без autoplay. Feedback cache инвалидируется с generation, outbox прежнего аккаунта сохраняется. Подробнее ADR025.

PASS:40app+5probe Rust/9ignored;Clippy;TS/build;полный renderer67PASS+1opt-in skipped, после добавления сценария success/reload ещё5authPASS;9TSunit. Windows native auth popup open/cancel/actual destroy/noautoplay/testMode credential guard, затем autostart read/diagnostics/history dates/mini/topmost/maximized/single instance PASS. Обычный debugexe обновлён. Пользовательский release YCore Music не закрывался. Реальный вход после согласия пользователя НЕ ПРОВЕРЕН; проверка запрошена отдельно, работу по следующему пункту не блокирует. Linux/macOS отложены по новому приоритету пользователя.

### Исправление живого OAuth callback — 2026-11-05

Пользователь сообщил400 после push-кода. Причина: принудительный redirect_uri verification_code не зарегистрирован у текущего клиента. Публичная metadata https://oauth.yandex.ru/client/23cabbbdc6cd418abb4b39c32c41195d/info подтвердила callback https://music.yandex.ru/. Убрано переопределение redirect_uri, native callback принимает только этот точный origin/root path с прежней проверкой state. Сам токен/личность не читались и не выводились.2authRustPASS;WindowsnativeOAuthopen/cancel/testguard+basicPASS;ClippyPASS. После подтверждённого выхода пользователя debugexe успешно заменён исправленной сборкой. Повторный пользовательский login пока ожидается; не объявлять полный OAuthPASS.

## Состояние аккаунта и стартовое предложение входа — 2026-11-05

Пользователь сообщил успешный вход без прежней400. Исправлен неизменный текст кнопки: saved/connected → «Сменить аккаунт», missing → «Войти в Яндекс», authorization_denied → «Войти снова». Отдельный статус различает сохранённое подключение и проверенный доступ. Снимок OS-store читается локально при старте без network account-check; существующая диагностика отдаёт тот же результат accountUI без отдельного запроса.

Добавлен стартовый диалог только при missing: объяснение, Later/Login, постоянный opt-out и путь Settings→Яндекс Музыка. Напоминание не появляется у saved аккаунта или при opt-out; ручной вход остаётся. Проверены повторный запуск с/без opt-out, saved account после reload, явный вход из приглашения и отмена без autoplay. PASS:72renderer+1opt-in skipped, TS/build, WindowsnativeOAuthopen/cancel/guard+fullbasic. Обычный debugexe успешно обновлён, пользовательские credentials не менялись тестами.

## Исправление волны после выхода — 2026-11-05

Пользователь подтвердил disconnect именно в YCore Music. Нативная readonly диагностика OS-store показала missing; секрет не выводился и не изменялся проверкой. Найден sourceFetch catch, который одинаково включал Smart History при network и auth errors. Убрана автоматическая подстановка локальной истории при auth error. Свежая неавторизованная Wave очищает старый буфер, показывает «Моя волна · нужен вход» и путь Settings→Яндекс Музыка. Явная история без аккаунта и fallback при network failure сохранены.

PASS:3targetedrenderer (подтверждённый logout из играющей волны с reload/noiframe/emptyqueue/noautomaticSmartHistory, ручная история, orderednetworkfallback/offlinestart), TS/build, Windowsnative basic. Обычный debugexe успешно обновлён. Учётная запись тестами не отключалась: настоящий credential уже отсутствовал после действия пользователя; сценарий удаления в renderer использует фикстуру.

## Гостевой режим REQ-052 — 2026-11-05

По прямому указанию пользователя общедоступный каталог открыт без входа. Native optional credentials + whitelist public GET + anonymous retry при authdenied; search, artist tracks, album with-tracks и публичные плейлисты. Chart независим от optional editorial landing. Guest response содержит playlistsAvailablefalse и UI объяснение про поиск публичных плейлистов. Личная Wave/library/likes/feedback остаются strict; закрытые списки не обходят проверку доступа. Startup welcome теперь правильно объясняет, что поиск/чарт/публичные плейлисты работают без аккаунта.

Проверки:42app+6probe RustPASS/10ignored,ClippyPASS;явный anonymous live_guest_cataloguePASS без чтения credentials (search и3типа коллекций). ActualWindowsnative уже в состоянии missing: guestsearch/artists/albums/publicplaylist/chartPASS;Wave/libraryотклонены;basicnativePASS. Renderer74PASS+1opt-in skipped, включая гостевое воспроизведение из поиска/чарта через mockYT, отсутствие реакций без входа и отказ privateplaylist без смены музыки. TS/buildPASS. Ordinarydebugexe обновлён. Нативный реальный YouTube именно в гостевом сценарии отдельно не прогонялся; плеер/подбор не менялись. APIpersonalpreferences/tokenstore тестами не менялись.

## Учёт прослушивания и альтернативы — 2026-11-05

Реализован локальный listening lifecycle: observed PLAYING elapsed (безpause/buffer/seek), source, полная длительность YouTube, причина/время окончания. История показывает источник, прослушанное время и причину. Restore той же версии сохраняет event; repeat/newPlay создаёт отдельный. SQLitev4 с резервной копией v1/v2/v3, монотонным checkpoint/первой terminal reason, безопасным clear и interrupted/shutdown recovery. ADR027. Q06/quickskip не утверждался/не применялся, внешние Яндекс playback feedback пока не отправляются.

По последнему уточнению пользователя карточки альтернатив108px (вместо промежуточных120), шрифты11/10; место под список увеличено до clamp220px/36vh/320px. Слот сохраняет высоту при hidden/loading, обзор не прыгает.

Проверки PASS:44app+6probeRust/10ignored,Clippy,11TSunit;renderer76PASS+1opt-in skipped, затем finalCSSlayout1PASS. Windowsnative realYouTube muted playback накапливает listening; пауза+seek не добавляют время; quality reload сохранил историю, fullscreen/CC/tray/hidden timeline/media/simulatedpower/history/repeat/mini/topmost/instancePASS. Native storage bridge+historyUI/source/time/reason/lateprogressafterclearPASS. Native normalQuit закрывает synthetic незавершённую метрику в SQLite с shutdown (проверка readonlyNodeSQLite после выхода). Тесты изолированы, пользовательские credentials/preferences не менялись. После подтверждённого выхода пользователя normaldebugexe успешно обновлён. Физический sleep и аварийная точность полного аудиопотока этими тестами не доказаны.

## Session feedback и реальная синхронизация — 2026-11-05

Native WaveRefregistry привязывает каждую позицию, включаяповторы, к account/session/batch; новыйsession не переименовывает старыйбуфер. SourceIPC выдаёт opaque waveRef, UID/session/batch не выдаются. SQLitev5: отдельнаяперсистентная очередьWaveevents; radioStarted/trackStarted/trackFinished/явныйskip; фактические listenedseconds безперемотки/паузы. Технические окончания не отправляются какnegative skip/dislike; libraryreactionsотдельно. Локальнаядедупликация/сохранённыеACK, UIDфильтр, credentialcheckпередкаждойотправкой, TTL24ч/8attempts/backoff, testModeвнешниезаписиблокирует. GlobalhistoryWriter +clear barrier сохраняютпорядок и не восстанавливаюточистку. NativeExit сохраняетпозитивнонаблюдённыйlastwatermark. ADR028.

PASS:51app+6probeRust/10ignored,Clippy,11TSunit;renderer77PASS+1opt-in skipped. Native readonly настоящиеWavebatchrefsPASS, и новая/следующаяпорции безлоговUID/session. NativetestModewaveguard/source/history/metrics/clear/mini/topmost/maximized/instance/normalExitPASS. Ordinarydebugexe успешнообновлён после подтверждённоговыхода. Пользователь включилWave и подтвердил положительныйstatusбезошибки; readonlyагрегаты личнойSQLite (только schema/count/status/eventtype) показали schema5, sent radioStarted2/trackStarted5/skip3/trackFinished1, pending0. Рекомендации тестами не менялись: это реальные пользовательские действия. Пользователь подтвердил «ставлюлайквYCore Music→появляетсявприложенииЯндекса». Обратная ручнаясинхронизация и realdislike/Undo ещё не подтверждены, Q06 не согласован.

## Интерактивная очередь и подгрузка — 2026-11-05

Реализованы REQ054/055: кнопки в строках, ordinal/generation selection, текущая/предыдущие/следующие позиции, согласованное продолжение после выбранной, защита от поздних matching/Next/порций. Queue-scroll загружает следующую Waveпорцию у нижнего края, не запускает музыку и не смещает current/scroll; coalescing/retry/около500futurebuffer. Ранее существовавший rollingpast50 сохранён, render выполняется после trim. Debounced focus-read реакций обновляет внешний like/unlike без Set.

PASS:12TSunit,82renderer+1opt-in skipped,check/build;последний маленький переносrenderпослеtrim дополнительно4queuePASS и новыйbuildPASS. Native basic/metrics/storage/mini/topmost/maximized/instancePASS. YCORE_QUEUE_SMOKE native click→выбраннаяпозиция→ручнойNext→назад→1cuediframePASS. Два прогона настоящего stream/END на M7lc1UVf-VE не завершились из-за buffering/recovery, JSerrorsпусты; НЕ считать native END-next проверенным. END-next и поздниеответы проверены renderer, настоящийYT/listening былPASS в предыдущемсрезе. После userexit normaldebugexe успешно обновлён. Native-testбинарник до последнего переносаrender, перед новымnativeсобрать заново. Usercredentials/предпочтения тестами не менялись.





2026-11-07: по подтверждению владельца уточнён текст Windows-загрузки:
«WebView2 установится автоматически при необходимости — для этого нужен интернет».
Основание: generated release NSIS INSTALLWEBVIEW2MODE=downloadBootstrapper,
проверка runtime и download Microsoft bootstrapper при отсутствии. Clean Windows
без runtime этим изменением не тестировался; desktop/installer не менялись.
VPS build PASS, release webview-copy-20261107 развёрнут, текст в отдаваемом JS
проверен. Предупреждение об отсутствии Authenticode сохранено.

2026-11-07: по прямому поручению владельца исходники сайта загружены в приватный
https://github.com/BjornSkarsgard/YCoreMusic-site , ветка main. Видимость PRIVATE
сохранена. Включены frontend, VPS server/moderation, миграции, проверки и scripts;
добавлен README с командами запуска. Проверены tracked154файла: базы/секретные
ключи/токены не найдены; .gitignore усилен для SQLite и приватных сертификатов.
Сборки/node_modules/.sites-runtime/обращения/серверные бэкапы не загружались.
GitHub HEAD и локальный HEAD совпадают; хостинг и доступность домена этим push
не менялись. Remote origin отдельного website checkout теперь GitHub-сайт.
