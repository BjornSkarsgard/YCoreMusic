# Encore — активный контекст, 2026-11-04

Проект C:\Users\Skar\Documents\Encore, remote https://github.com/BjornSkarsgard/encore.git, main. Пользователь разрешил работать самостоятельно без участия и следовать документации. Не ждать очередного «дальше» после законченного этапа. Не использовать subagents без отдельного разрешения. Токен сохранён в OS credential store; никогда не читать/выводить в чат.

Пользователь просил следить за 5-часовым лимитом (tool get_usage_limits). Если осталось >10% после этапа — ещё несколько лёгких задач; при очень малом остатке закончить безопасный срез, сохранить контекст и выключить ПК обычным shutdown без /f. Reset credits без запроса не расходовать. Ночной shutdown /s /t0 уже выполнялся; сейчас новая рабочая сессия, пользователь задаёт дополнительные задачи. Последний лимит:72%used/28%remaining, weekly65%used. Перед завершением снова проверить. Новых вопросов/подтверждений не требуется.

## Последнее замечание пользователя

В Обзоре Play трека скрывал альтернативные видео на время загрузки и увеличивал высоту списка. Исправлено c516ff3: постоянный адаптивный слот160–220px (26vh), visibility:hidden при отсутствии вариантов, panel-scroll flex1. Regression с200 треками проверяет высоту/scrollTop до, во время и после delayed matching. Normal debug exe уже собран с этим исправлением и текущей SmartHistory.

## История готовых этапов

- f97bff5: Scene layout, жанры, unattended Wave/prefetch/skip/backoff/renewal. CI4OS PASS.
- 1354fde: транспорт по центру; fullscreen mouse HUD/idle; отдельная коллекция/Back. CI4OS PASS.
- 26bb9ee: личные собственные/сохранённые плейлисты, liked tracks, reactions/outbox/Undo, живой chart и editorial playlists, альтернативные клипы. CI4OS PASS.
- 3e39b5f: локальные Up/Down volume и F11; runner длинного hidden Wave soak.
- d306f82: SQLitev3 несколько favourites, actual last video, random/no-immediate-repeat/repeat-one, unavailable без удаления. Windows/Linux/macARM CI PASS; macIntel renderer timeout в fullscreen recovery.
- 6a64a3b: late fullscreenchange guard, quality-panel HUD stays accessible, manual clip heading, native PID cleanup. CI всех4OS PASS, исправлен вышеупомянутый timeout.
- c516ff3: фикс высоты Обзора, CI ещё шёл на последней проверке.
- Текущий рабочий этап SmartHistory завершает commit/push сейчас.

## Что реализовано

«Сцена» выбрана пользователем: большое видео слева, отдельная прокрутка справа; поиск сверху, фильтры результатов, коллекции с возвратом/scroll/focus, история. Видео/транспорт всегда видны. Полноэкранные controls снизу по центру по движению мыши, hide3s; hover/drag/keyboard focus удерживают. При явно открытой interactive YouTube quality panel HUD остаётся доступным (iframe захватывает mousemove). Controls=0 по умолчанию, свои CC/font/seek/volume; manual quality только через временную панель, setPlaybackQuality no-op. Mandatory pause/load branding не обещать убрать.

Wave: реальные жанры (161 в probe), новые сессии без autoplay; явная CTA запускает. Metadata ahead8, максимум3 поиска, duplicates/order/stale guards. Нет уверенного видео/ошибка/таймаут — bounded alternatives then skip. Network retry backoff. Pause/wake отменяют автоматическое продолжение. Очередь хранит ограниченный past; server received queue500, expired/empty/repeated sessions renew once. ОС управляет audio output.

Моя музыка: own+saved playlists, liked IDs/metadata по100, порядок сохраняется. Обзор: current chart100 и editorial playlists4 в live probe, Refresh, запуск/просмотр без смены текущей музыки до явного Play. Не называть editorial playlists ранжированным popular list.

Реакции: state -1/0/1, account-scoped persistent pending outbox SQLitev2, coalescing/revision ACK, Undo5s не возвращает старый клип. Native v3 добавляет favourites и actual last video. Backup через VACUUM INTO перед v1/v2 upgrade; данные сохранены. Несколько favourites выбираются случайно без immediate repeat, включая repeat-one. Удаление текущего не прерывает звук. Метка unavailable снимается после успешного PLAYING/явного retry. Автоподбор на этот раз не удаляет набор. Альтернативы рядом: thumbnail/title/views/duration, клик сохраняет play/pause и cursor, один IFrame.

## Текущий Smart History срез

Локальные500 уникальных кандидатов, последние clip IDs, likes/frequency/age weights, известные dislikes/pending intents исключаются. Единственный TS queue coordinator выбирает взвешенно без предыдущего track при>=2. Wave доигрывает буфер при API failure, затем SmartHistory; не переключается обратно сам. Есть явная кнопка в истории. Startup без autoplay, pending start имеет Pause, intent/generation guards. Известный history video не ждёт public metadata. Unsearchable manual clip после ошибки пропускается. Исчерпанные варианты локально исключаются до нового ручного запуска/успешной проверки, не пишут negative feedback.

Native feedback GET передаёт generation и полный snapshot exclusions только когда pending outbox пуст. Старое чтение не отменяет новый Set; frontend pending overlay и snapshot восстанавливают внешнее снятие dislikes. Личная медиатека refreshed при sync/TTL открытии. Никаких реальных feedback writes в тестах; testMode блокирует доставку. Реальный токен GET likes/dislikes + confirmed snapshot проверен.

Ограничения: cold-offline новая реакция требует identity аккаунта, ранее определённой в текущем запуске; старый outbox переживает restart и доставляется после соединения. Listened_ms/end_reason/quick-skip classification пока нет, Q06 threshold не утверждён, не вводить молча. Технические skips Wave не являются dislike. Linux/macOS runtime и физические sleep/lock/media keys не доказаны CI. Полноценный S1 provider feedback lifecycle и Yandex audio/FFT/mobile/multimonitor не объявлялись готовыми.

## Проверки

Текущий срез: TS/build,9unit PASS; полный renderer44PASS+1opt-in skipped (45 tests), .last-run.json status passed. Rust28 app+5probe PASS,9ignored;Clippy all-targets -D warnings PASS.

Windows native SmartHistory actual clip/END/sticky source/1iframe + full YouTube/CC/fullscreen/interactive-quality/tray/media/simulated power/mini/topmost/single instance PASS. Native real personal library/current chart/feedback read snapshot PASS. Предыдущий native favourites real Oasis END alternating + deletion-without-stop PASS.

20-minute unaccelerated hidden Wave soak (pre-Smart binary):5 transitions, max sampled wait5sec at5sec polling, volume0,1iframe, no manual seek/Next. Result .tools/wave-soak-result.json completed:true. Это не1час и не гарантия100% external availability. Новый soak после Smart engine изменений имеет смысл, но не начинать новый большой код при малом лимите.

Normal debug executable apps/desktop/src-tauri/target/debug/encore.exe уже обновлён с layoutfix и SmartHistory. Native test sessions завершены, профиль свободен. Последний Get-Cim encore процессов не обнаружил. Не закрывать пользовательский экземпляр принудительно; тестовый PID получаем из native desktop_status после testMode verification. Cleanup mutates/quits только подтверждённый test profile.

## Следующие небольшие задачи / перед завершением

1. Commit/push текущего SmartHistory этапа и проверить CI. Не завершать с грязной рабочей папкой.
2. Небольшая полировка: HTML title всё ещё Encore · лаборатория (config уже Encore), label жанров ошибочно «Настроение музыки». Можно поправить без отдельного теста. Поиск: ясная кнопка очистки/защита старых карточек во время нового запроса — полезный лёгкий срез.
3. Не начинать новую большую migration/telemetry при низком лимите. Будущий приоритет: listened_ms/end_reason, cold offline account identity keyed by safe credential fingerprint, дальнейший roadmap. Реальные feedback write только по явным пользовательским нажатиям, тестами не менять вкус аккаунта.
4. Проверить лимит, сохранить фактическое состояние/CI/сборку и завершить по инструкции пользователя.

## Команды

npm.cmd run build --prefix apps/desktop
npm.cmd test --prefix apps/desktop
npm.cmd run test:ui --prefix apps/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features yandex-probe
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --features yandex-probe -- -D warnings

Native: cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --profile native-test --features tauri/custom-protocol --bin encore; node scripts/native-smoke.mjs. ENCORE_LIVE_LIBRARY/YOUTUBE/CATALOGUE/YANDEX/SMART_HISTORY/FAVORITES=1 по нужным сценариям; все на volume0, isolated DB/profile. ENCORE_WAVE_SOAK_MINUTES и ENCORE_NATIVE_TEST_DATA_DIR — длинный прогон с чистым test data dir. Дождаться завершения своего теста перед пересборкой native-test.

Rust PATH C:\Users\Skar\.cargo\bin. Shell PowerShell. Рабочий cwd всегда Encore (старый VideoYandexTube не существует). Не запускать старый .tools/pending-update/apply.ps1: там pinned старый executable. Скриншоты .tools/native-favorites.png, native-alternatives.png, native-discovery.png, fullscreen-controls.png, ignored. Токен не печатать и не читать файлами.

## Последний срез: поиск, 2026-11-04
REQ-002: clear query, inert stale results/filters during debounce+request, full model reset, late responses ignored. Renderer45 PASS+1opt-in skipped, check/build PASS. CI1b20c10 4OS PASS. Native embedded profile собран. Пользовательский PID17280 открыт (debug/deps); не закрывать. Hidden updater .tools/search-update-20261104/apply.ps1 ждёт естественного полного выхода (закрытие окна лишь трей), проверяет hashes и не затирает другую сборку. Состояние .tools/search-update-20261104/status.json. Если будет superseded/expired — обновить обычной сборкой после выхода. Ничего не запускает. Старый .tools/pending-update/apply.ps1 не использовать. Реальный feedback write не проверялся, Linux/macOS runtime и Q06 остаются открыты.

## Последний срез: история, 2026-11-04
REQ-006: native history accepts optional beforeId and returns100 ordered events, repeated plays preserved; history-ui separate, pagination/search/stale/clear-error/retry. ADR021. Renderer full48PASS+1skipped, then3historyPASS;9unit;Rust29+5PASS,ClippyPASS. Native105entries+new record betweenpages+clear PASS; actualYouTube history/repeat/fullscreen/CC/tray/mini PASS. Debug executable successfully rebuilt with latest source, no user Encore process at build. Search pending updater is blocked, superseded by normal build; do not run old apply.ps1. Native test profile is free after completed tests; needs rebuild to include last clear-dialog error text before next run. Next priorities remain longer real Wave acceptance (prior20min only), real user feedback-write validation, lifecycle and platform runtime; Q06 unapproved, avoid inventing threshold. No shutdown performed in this daytime continuation.

## ОСТАНОВЛЕНО ПО ПРОСЬБЕ ПОЛЬЗОВАТЕЛЯ — после часового теста, 2026-11-04

Последняя инструкция: «экономь токены, ничего не делай, просто жди когда тесты кончатся, потом запиши результат и остановись». Прежнее автономное продолжение отменено этой инструкцией; не продолжать без новой команды. Не выключать ПК по старой ночной инструкции.

60минут реальной Wave на baseline025ab78 завершились успешно:16переходов,712playing/7waiting samples,maxFrames1,maxobservedwait5сек при опросе5сек,hidden+volume0,безseek/Next. .tools/wave-soak-result.json, isolated .tools/native-soak-60min-20261104. Exit0, финальные mini/topmost/maximized/singleinstancePASS; testprofile свободен. Не путать этот baseline с новыми изменениями.

Пуши:7634ff4 recovery того же клипа/позиции/offline/Pause/wake guards;ecfe73c автозапуск defaultOFF, --encore-autostart hidden+paused, main-only commands, testMode OS mutationsblocked. Перед dirtyfeedback полный renderer58PASS+1skipped, Rust31app+5probePASS/9ignored/ClippyPASS. Native профиль ещё содержит старый baseline: перед следующим запуском нужны build frontend и cargo build --profile native-test --features tauri/custom-protocol. Новый native runner добавляет AUTOSTART_SMOKE и LIVE_RECOVERY (WebView CDP outage), но эти сценарии ещё НЕ запускались. Обычный debugexe пока до этих новых срезов (история025ab78).

Незакоммиченная работа на момент остановки: feedback.rs отдельные cache/refresh/sync locks, сетевые операции вне cache lock, поколения против late fetch, ordered delivery; feedback-ui.ts сохраняет известные доступные кнопки при pending remoteGet; tests/feedback.spec.ts.4целевых Rustfeedback и2rendererfeedbackPASS, полного regression/Clippy/native после refactor нет. Один JS edit не добавил Rusttests из-за const reassignment, затем исправлен и4теста прошли. Следующая выявленная тонкость: profile overlay берёт pending_reactions с LIMIT25 (доставка батчами), поэтому для полного overlay всех pending стоит отдельное чтение; это только план, не реализовано. UI/native actual preferences writes по-прежнему не тестировать синтетическими действиями на реальном аккаунте. Системный autostart не включён. Новых работ после команды остановиться не выполнялось, только ожидание и запись результата.

## Возобновлено по команде «работай», 2026-11-04

Реакции сохранены в40c3702:35app+5probeRust,60UIpass+1skipped,Clippy,allpending60+parallelSet/refresh/syncPASS. Новая диагностика и nativeexpectationfix завершены:36app+5probe,61UIpass+1skipped,9TSunit,Clippy/buildPASS. Настоящие native autostart argument/duplicate guard, library/readfeedbackGET, fullYT/CC/fullscreen/quality/tray/media/history/repeat/mini/topmost/maximizedPASS. OSautostart enable не выполнялся. WebViewCDP20сoutagePASS, target940held958after959, latestbufferposition preserved,record/cursorstable,Pause respected. Старое native failure было сравнением с940 вместо958; исправлен testoracle. Native-test свободен, обычныйdebugexeобновлён. MacCI cancellations объяснены нехваткой hostedrunner, не failedstep. Далее подготовка installer artifacts, без установки на пользовательский ПК.

## Остановка по лимиту — 2026-11-04, источник истины для следующего продолжения

Последняя команда пользователя «работай» возобновила самостоятельную работу. Сейчас осталось9%пятичасового лимита; новые функции не начинать. ПК не выключать по старой ночной инструкции. Последний commitc4b5c88, mainпушнут, рабочее дерево до этой записи чистое.

Что закончено в этом продолжении:
-40c3702:network-free cachecriticalsection реакций, отдельные refresh/syncguards, generation, allpending60, UIknownreaction usability. Реальные preferenceswrites в тестах запрещены.
-428a444:диагностика version/platform/storage/Yandexenum без token/UID/login; explicitreadonlyaccountcheck. RealWindowsRecoveryCDP20секPASS:target940,bufferheld958,after959,record/cursorstable,Pause respected. FullnativeYT/CC/fullscreen/quality/tray/media/history/repeat/keys/mini/topmost/maximized/instancePASS.
-d9b2f0d и5e97b75:opt-in packagingconfig/commands/workflow, актуальныйREADME вместо старого«Этап0нетфункций». WindowsreleaseNSISсобран,не установлен/неподписан/не опубликован. Текущийфайл target/release/bundle/nsis/Encore_0.0.1_x64-setup.exe;SHA25608171F4801A5C1648FD571B291F1F9F6B26FF0F662B6E26BCD5BFF00216F7603,manifest.tools/windows-package-result.json sourcec4b5c88. Debugexe тожеобновлён. Linuxpackage41867671860PASS:DEB/AppImageв.tools/linux-packages-41867671860,hash/controlmetadata.tools/linux-package-result.json. ЭтиLinuxпакетыстарее1460115(нетновогофильтрадат);не считать их текущимполнымsnapshot.
-1460115:historydatescollapsed/inclusivelocalcalendar/DST25h/nativeUTCsecondbounds+keyset,cleardialogвсяистория.37app+5probeRustPASS/9ignored,Clippy/check/buildPASS;62rendererPASS+1skipped;Windowsnativebasicдаты/пагинация/очистка/миниPASS.
-014bd55:общаяthumbnailfixtureвmocktests,livebrowserYouTubeпочиненподdialog/rangeinputиPASS (cue/explicitmutePlay/Pause/seek). Productionmockсетьнеиспользуеткартинки.
-c4b5c88:summary/rolebuttonSpaceguard;3targetedkeyboardPASS,debug+releasepackagePASS. Native-testбинарникещёдоэтогооднострочногоguard;передновымnativeпрогономпересобратьfront+native-test.

Linux runtime расследование (НЕ объявлять готовым):
-41871384767 и41872740067:настоящийGTKstartup/noautoplay/autostartarg/diag/SQLite/history/datesPASS;topmostfalseдажепосле5сек.
-TaoLinuxsetterотправляетWindowRequest;getterчитаетABOVEпоWindowStateevent. Простоожиданиенеисправилопроблему.
-8758ad0: XvfbпередDBus,Openboxreadycheck,xpropдиагностика;41873691768тожеtopmostfalse. Fixedtitle«Encore·нативнаяпроверка»не найден;возможноWebKitменяетtitle. Root_NET_SUPPORTING_WM_CHECKесть,processstatusvisibletrue.
-9ff16da:newdiagnosticenumerates_NET_CLIENT_LISTиоставляеттолькоPIDappPid;читаетсяEWMHstateсвоихокон. Это должно показатьреальныйmanagedwindow/ABOVEбезлоговчужихокон. Run41874314737зависнаAPT/WebKitGTKустановке>18мин,доappнедошёл. Обычныйcancelзапрошен,затемforcecancelпередэтойзаписью. Проверитьитог/логи;покарезультатPIDдиагностикиНЕполучен.
-Workflow.native-linux.ymlиспользуетDBus+Xvfb+Openbox,WEBKIT_DISABLE_DMABUF_RENDERER/LIBGL_ALWAYS_SOFTWAREтольковCI. НЕWayland/неplayback/неSecretServiceреальногоаккаунта. Rustcacheдобавлен397f887в3workflow,cache-on-failuretrue.
-MacARMpackage41870661876cancelled:hostedrunnercapacity/неполученrunner,неcodefailedstep. Macruntime не проверен. Не тратитьresetcredits,2свободныхне использовались.

Следующее после явного продолжения: проверить завершение/логи41874314737,при необходимостиограничитьAPTconnecttimeoutsиDEBIAN_FRONTENDnoninteractive,получитьPID/EWMHдиагностикуLinuxиразобратьсясtopmost/WM. ЕслиABOVEреальноесть,аTaogetterfalse —исследоватьGTKcachedstate;еслинет —проверитьmapped/managedwindowиWebKitautomation. Не подменятьрезультатфальшивымPASS. ЗатемноваяLinuxупаковкатекущегокода,Macпри доступностиrunner. ОстаютсяUIOAuthвход,liveuserfeedbackwrites,listen-duration/quickskip(Q06неодобрен),physicalsleep/lock,multi-monitor/visualizer/remote. Ни installer,ниOSautostart на пользовательском ПК не запускались; пользовательские данные не удалялись.

## Продолжение 2026-11-05 — UI OAuth

Пользователь утвердил порядок2→3→5; Linux/macOS в конце. Реализован native implicit OAuth popup + UI вход/отмена/disconnect, ADR025. Debugexe обновлён; пользовательский release PID23080 не трогали. Запрошена необязательная живая проверка через Settings→Войти в Яндекс после выхода из старой версии. Токен не просить. Новые credentials не сохранялись и не удалялись тестами.40app+5probeRust,Clippy,9TSunit,67renderer+1skipped и5targetedauth, native basic+OAuthopen/cancel/testguard PASS. Следующий срез — реальное время прослушивания/источник/способ завершения, без выдуманного Q06 и без отправки фиктивных прослушиваний Яндексу.

### Важно: UI OAuth callback исправлен после пользовательского400

Публичный client/info установил реальный registeredcallback https://music.yandex.ru/. redirect_uri удалён из authorizeURL, точный native intercept перенесён на music.yandex.ru/root, nonce/once/expiry/cancelguards сохранены. Auth unit2PASS, nativeOAuth/basicsPASS,ClippyPASS. Пользователь вышел; normaldebugexe успешно пересобран и заменён. Вопрос «нужно ли регистрировать» отвечен: для текущего известного Musicclient нет; собственныйclient и MusicAPIpermissions отдельная тема. Нового пользовательского loginPASS пока нет. Продолжение музыкальных lifecycle/metadata ещё НЕ начато; никакой schema4/meter не создавался. Последнее «погоди» сменилось запросом исправить повторнуюошибку; после hotfix не считать молчание разрешением на новые крупные этапы, ориентироваться на последующие указания.

## Последний срез — welcome/account UI, 2026-11-05

Пользователь подтвердил «вошел, ошибки нет», заметил неизменную кнопку. Добавлены состояние подключения и «Сменить аккаунт»/«Войти снова»/«Войти в Яндекс». По его следующей просьбе — стартовый login welcome при missing, объяснение/позже/больше не предлагать/путь настроек. suppression хранится в localStorage encore.loginPrompt.dismissed.v1, не содержит токен. Diagnostics запускается с checkYandexfalse (толькоOS-store) и обновляет accountUI; проверка API по-прежнему явная. Fullrenderer72PASS+1skipped, nativeOAuth+basicPASS, debugexe заменён (Encore не был запущен). Код музыки/очереди/schema не менялся. Новые lifecycle/мультимониторные этапы не начинались после «погоди»; текущий объём — исправления входа и welcome. Для следующего продолжения следовать новым указаниям пользователя.

### Последнее исправление: Wave после подтверждённого logout

Пользователь сообщил Wave без входа и уточнил disconnect+confirm в Encore. Native readonly enum missing подтвердил удаление credentials. Причина видимого продолжения: автоматический sourceFetch autherror→SmartHistory. Этот fallback ограничен не-auth ошибками; свежая Wave без доступа очищает очередь, требует вход в Settings. Explicit SmartHistory без токена остаётся.3targetedrenderer + TS/build + nativebasicPASS. Normaldebugexe обновлён. Изменены только main.ts/test/docs, не credential/source native API. Полный72UI был до этого маленькогоfix; не приписывать ему полный новый прогон. Дальнейший первоначальный план2→3→5 остаётся, но после «погоди» текущие команды были про исправления входа, без запуска новых больших подсистем.

## Последний срез — гостевой доступ, REQ052, 2026-11-05

Пользователь после вопроса о гостях явно поручил открывать всё доступное без входа. Добавлен public_request в yandex.rs (optionalAuthorization, ограниченный whitelist GET, retryanonпри401/403), каталог использует его. PersonalnativeAPI не менялись. Discovery больше не требуетlibrary::context/account; chart доступен гостю, optionaleditoriallanding не ломаетчарт, playlistsAvailableflag/UI. Search/collection/library/welcome тексты обновлены. ADR026+REQ052+docs03/README.

PASS:42app+6probeRust/10ignored,Clippy,explicitliveguestRust безOScredentialread, actualnativeENCORE_LIVE_GUEST=1 при diagnosticsmissing (search3publiccollectiontypes/chart;Wave/librarydenied)+fullbasic,74renderer+1skipped,TS/build. Nativeguest не удаляеттокенрадипроверки, требуетужеmissing; текущийпользовательужеотключилего. Debugexe успешнообновлён. Native-testтожеобновлён,сессийне осталось. Персональныеpreferencesне менялись. Завершён текущийguestrequest; lifecycle/listeningmetadata/schema4/мультимониторныебольшиеэтапыпо-прежнемуне начинались после«погоди». Следовать новым командам пользователя.

## Текущий срез — локальное прослушивание/крупный блок альтернатив, 2026-11-05

Пользователь возобновил работу по плану: listening→Yandex integration→scenes/visualizers/remote. Реализованы ListeningMeter, PlayRecord lifecycle, source/end reasons, SQLitev4 backup/migration/checkpoints/finishOpen/interrupted recovery, историяUI. ADR027. QueueInput имеет optionalplaybackSource для вставок из истории; source по Wave/SmartHistory/finitecatalogue/manual. Не отправлять напрямую durationMs Яндексу как длительность трека: это полная длина YouTube. QuickskipQ06 по-прежнему не согласован.

По двум уточнениям пользователя: alternatives slot теперьclamp220px/36vh/320px (больше), карточки108px preview и11/10fonts (меньше промежуточных120). Stable layout1PASS. Пользователь вышел из Encore по запросу, normaldebugexe успешно заменён на текущий. Native-testтожеактуален. RealnativeYT слушание/Pause/seek/quality сохранение/всёосновноеPASS.44app+6probeRust,Clippy,11TSunit,76UI+1skipped (+finalCSSlayout1), native storage/showmetrics/clear и normalQuitSQLfinalizationPASS. Новые файлы listening.ts/test.ts,tests/listening.spec.ts. Не приписывать remote feedback этому срезу: отсутствует.

Следующий шаг: Yandex session feedback. Исследованы primary implementation MarshalX repo `_client/rotor_sessions.py`, `rotor/session_event.py`, `rotor/session_feedback.py`. EndpointPOST rotor/session/{session}/feedback, JSON event(type,timestamp,trackId,totalPlayedSeconds) и optionalbatchId/from. ЕстьradioStarted/trackStarted/trackFinished/skip; негативные события влияют на рекомендации, отдельно от librarylikes. Нужна корректная nativeпривязка каждой реально выданной записи (с duplicates) к account/session/batch и opaque ref в очереди: текущий Source храниттолькоid/seed/received/last, Trackбезref, нельзя использовать один latestsession для старого буфера послеrenew. Technicalskip нельзя отправлять как негатив. Реальные внешниеwritesне тестироватьфиктивными событиями; testModeguard обязательный. Токен может бытьmissing после пользовательскогоlogout; гостевые функцииработают, не удалять/не менятьcredentialsрадипроверки.

Пользователь также спросил про YouTubeвозрастные/embeddingограничения: отвечено со ссылкамиGoogle, OAuthне снимаетзапретавтора и не гарантируетage-restrictedembed. Новую YouTubeавторизацию/обходы не добавляли. Нужнаяв будущем «ОткрытьнаYouTube» может быть отдельным UIсрезом, сейчасне сделана.

### Дополнение пользователя REQ053 — независимые окна

Пользователь хочет выбирать отдельно окно сVIDEO, окно сVISUALIZER и окноCONTROLSбезобоих. Обязательныйпример ТВклип+основнойтолькоуправление. Зафиксировано REQ053/docs06/docs07/приёмка11. Это явноеисключениеизстарого «видео всегдавидно» SceneUI, не поводзадаватьповторныйвопрос. OFFнеравенCONTROLS. Нуженодинaudioauthority/queue; platform/S5привзаимодействиисменрежимовещёнепроверены. Новыесценывкодене реализованы, текущаяработапоYandexlifecycleне отменена.

REQ053 дополнительно уточнён: controls-only заполняет площадь полезными списками/дополнительным управлением, а не оставляетпустойэкранвместоклипа. Docs07: основнаяобластькаталога/плейлиста+постояннаяочередь+нижнийtransport, альтернативы/другиесценыдоступны. Никакойреализацииcontrolsonlyпока, обычныйSceneUIне заменяли; работаsource lifecycleпродолжается.

## Последнее завершение — feedback S1 и live подтверждение, 2026-11-05

Реализованы source.rs Recommendation{flattenTrack,waveRef}; nativeWaveOrigin(uid/session/batch/track)registry4096; accountcheck приfetch; старыйбуферсохраняетoriginпослеrenew. Track вTS имеет optionalwaveRef. WaveRefпередаётсячерезPlayRecord→Progress, nativeStorage.enqueue проверяетsource/historyID/trackID. wave_feedback.rs:SQLitev5outbox, type mapping,25batchdeliveryoutsideDBlock,UID/context/credentialrecheck,локальныедедупkeys+sentledger,24hTTL/8attempts,normalExitfinalmarker. wave_syncmainonly и testMode раннийdisabled. Clientbackoff/status и globalhistoryWriter, clearbarrier. ДокументацияADR028.

Проверки:51app+6probeRust,Clippy,11TSunit,77renderer+1skipped; actualnativeWaveRefsREADONLY +wavewriteguard/metrics/history/clear/normalQuit/basicPASS. Debugexe был заменён послеuserexit, сейчас содержитv5. ПользовательзапустилWave: «да,появиласьстрока,ошибкинет». ReadonlySQLiteагрегат AppDataio.encore.desktopпоказалsent radioStarted2,start5,skip3,finish1, pending0. Ввыводтолькосхема/enum/count,безUID/tracks/sessions/token. Затемподтверждёнреальныйлайк Encore→приложениеЯндекса. ОбратноизЯндекса/realdislikeUndoпокаНЕПРОВЕРЕНЫ. Ничегоне ставить/не сниматьискусственнодлятестов.

UserREQ053 сохранён: отдельно выбираются VIDEO/VISUALIZER/CONTROLS/OFF; ТВклип+основнойтолькоуправление; CONTROLSиспользуетвсюплощадьподсписки/очередь/transport,никакойпустойвидеозоны. Docs06/07/11. Реализациисценещёнет. Latestcards108px/11/10fonts,slot220/36vh/320,выполненуточнённыйзапросувеличитьместоауменьшитькарточки. НормальныйdebugexeсэтимUI.

Последняяпроверкалимитов:primary59%used,weekly90%used (free resets2не использовались). Неприменятьстаруюночнуюкомандуshutdown. Mainновыйсрезнужнозакоммитить/пушнутьпослеэтойзаписи. Дальше: реальныеобратныереакциипонастоящимдействиям;Q06отдельно; затемсогласованныймультимониторныйэтап/визуализаторы/пульт; Linux/macOSвконце. Можно начинать следующийограниченныйсрез автономно,новыеогромныемиграциипрималомweeklyне начинать. Userнепросилчистить32ГБcache,толькооценилвесрелиза(ответWindowsinstaller3–5MB/app10–20MBбезобщегоWebView2).
