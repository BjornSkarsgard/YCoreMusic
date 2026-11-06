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
DEB build42288714656 запущен на99a9e3e. Старый промежуточный42288427884 отменён.
Релиз v0.0.1 не заменять автоматически; подготовлены тестовые сборки без публикации.
Переименование старых технических ключей всё ещё отложено пользователем.

## Последние проверки и незавершённое

Для следующего Codex: [22-LINUX-LAST-VERIFICATION.md](22-LINUX-LAST-VERIFICATION.md). Прочитать прежде повторных проверок; там явно отмечено, что не успели завершить.

## Актуальная точка остановки — 2026-11-06

Последний scope: закончить этап, подготовить Linux установщик для тестирования,
затем остановиться. Сайт и пульт исключены. Пользователь сообщил о близком лимите.
Linux установщик пока НЕ готов и НЕ передан.

Repo C:/Users/Skar/Documents/Encore main dirty — сохранить WIP. CI worktree:
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

# YCore Music — активный контекст, 2026-11-06

АКТУАЛЬНО: пользователь требует автономно довести desktop, не останавливать ход
после каждого пункта. Сайт и пульт НЕ ТРОГАТЬ. Последний запрос — записать кнопку
обновления и проверку версий: уже реализуются в текущем updates-срезе.
Завершён Windows native30minsoak:6naturaltransitions,357playing/2waiting,
maxobservedgap5sec приpoll5sec,0controlleriframes/1host; мини/topmost/instancePASS.
Длинный прогон окончен, собственный тестовый процесс закрыт.

CI вынесен в отдельный worktree C:/Users/Skar/Documents/YCoreMusic-ci-check,
branch codex/stability-portability-20261106, push уже авторизован рабочим контекстом.
Коммиты890399d (весь предыдущий WIP),8576759(X11),d4be2a8(background),0ca7d07(CIapt).
Основной Encore worktree всё ещё main/dirty — не терять его изменения и новые
файлы. После новых правок копировать только текущие repo sources в CI worktree,
не private .tauri/.tools/target, затем commit/push для проверки. GHCLI авторизован.

Linux native run42207934319 SUCCESS: true GTK/X11 SQLite/history/mini/topmost/
autostart/instance. X11 topmost fix в window_mode.rs + Linux-only x11rb/rawhandle
deps; собственный XID property read, без shell в product, Wayland отдельно.
WebKit minimize=hidden возможен; test теперь гарантирует restoration visibletrue.
Azure archive был~30KB/s, заменён только GHrunner на Ubuntu HTTPS archive,
scripts/install-linux-deps.sh, bounded8minaptstep; productionне меняли.
Desktop run42207935072: UbuntuPASS, остальные на момент записи ещёrunning;
раньшеd4be2a8 Windows/macIntel/macARM PASS. Не путать сборки сhardware/videoPASS.

Updates новое: src-tauri/src/updates.rs + src/updates.ts, plugin2.14.1, publickey
updater-public.key/config; private C:/Users/Skar/.tauri/YCoreMusic-updater.key
создан один раз, НЕПЕРЕСОЗДАВАТЬ/НЕПУШИТЬ. Ownerbackup позже до distribution.
Check automaticdaily+manual, fixedGitHubfeed404→unpublished, notesplainText,
defer1day, signedDownload отдельноотInstall, nativeMediaBusy+JSPlay/loadguard,
revision отбрасывает stale, prepare_exit общий. Media playback status теперь и безSMTC.
Native signature probe PASS (using debugexe), tamper/version/downgrade rejected,
testMode installdisabled. Fullrenderer125/1skip доrevision,4targetedпослеPASS;
Rust74/9ignored/Clippy/fmt/buildPASS. SigneddebugNSIS5.19MiB+.sig/localmanifest
собраны, НЕУСТАНАВЛИВАЛИ/НЕПУБЛИКОВАЛИ. Docs20. Newupdates ещёнепушенвCI.
scripts/build-update-manifest.mjs localonly. Native basic playback Windows PASS
(actualYT/seek/pause/controls-only/hidden, oneengine), screenshot просмотрен.
Следом pushupdates+новый native-linux live_playback input (толькоpublicYouTube,
безcredentials), исправить найденные отказы. Latestdebugexeобновлён.

ПОСЛЕДНЕЕ: пользователь одобрил Windows stability → ранний portability spike.
Реализован native platform_capabilities (main-only) + platform.ts shared promise;
window-layout/scene-ui отключают unsupported mirror/audio UI, Spectrum preference
остаётся в storage при fallback Video. Linux/macOS adapters ещё отсутствуют.
Native ENCORE_STABILITY_SMOKE=1 дважды PASS: 6 simulated hotplug VIDEO/Particles,
Off при detach, timeline/epoch, network outage обоих WebView, Pause/reconnect/Play,
mini/topmost/instance. Физические HDMI/OS network не менять без отдельного сценария.
Rust72/9ignored/Clippy/fmt/no-default-features/check/buildPASS; TSunit14PASS.
Renderer122PASS/1skip/1failed (option matcher) затем исправлен matcher,
8 scene-settingsPASS. Обычный exe обновлён. Wave soak теперь native-host-aware,
hostPlayers отдельно; LIVE_WAVE на настоящем Яндексе/YouTube PASS: 2 natural-END
перехода, один engine/0controlleriframes, mini/topmost/instance. Это ускоренный
seekкконцу→реальныйEND, не длительный30минsoak; последний ещё предстоит.
docs19 содержит платформенный план. Новую ревизию Linux/macOS здесь не запускали;
локально нет WSL/Docker/Mac. Не считать старый CI проверкой текущего worktree.
Пользователь спросил про Spotify: ответили по официальным текущим docs об API/
recommendations/dev5users/Premium/policy; реализации не просил, не начинать вместо
Windows/платформ. Рекомендованный будущий отдельный API access spike.

ПОСЛЕДНЕЕ: по команде «делай» завершена защита от случайных переключений REQ067.
playback-guard.ts: session-only замок возле volume, доступен в mini; ручные
navigation/seek/source/track/clip и dislike/preference writes блокируются.
Пауза, Play, volume, like, окна/таймер доступны. Автоматический Next/error fallback
не блокируется. Открытая YouTube panel скрывается без reload. Scene snapshot
locked отключает seek/next/previous; main повторно проверяет SMTC/scene команды.
Rust72/9ignored/Clippy/frontend/debugbuildPASS, renderer119PASS/1skip перед новыми
тестами +4targetedPASS. Native guard actualYT/engineunchanged/pause/resume/
miniunlock/seekпослеunlockPASS, общие history/topmost/instancePASS, exit0.
Обычный target/debug/YCoreMusic.exe обновлён. Следующее — длительный прогон,
реальный unplug телевизора и UX восстановления; не объявлять это уже проверенным.
Ниже исторический срез до защиты, его «не начинал» больше не актуально.

СЕЙЧАС: завершён таймер сна по явному согласованию пользователя (actionPause).
Native sleep_timer.rs: UTCdeadline/worker250ms/main-onlyIPC/revision/one-shot.
UI sleep-timer.ts: presets/custom1–720мин/countdown/replace/cancel; playerbutton
и settings. Закрыть диалог неcancel, полныйexitсбрасывает. Expire→powerPause
существующего coordinator, explicitPlayразрешёнпослеexpiry. НикакогоPCshutdown.
72Rust/9ignored/Clippy/buildPASS; host+recovery16PASS иtimer targetedPASS после
поправкиасинхронногоstatus. Nativeactual1сек таймер втрее→YTstate2, explicitPlay,
cancel/engineunchanged/mini/trayPASS. Защитууправления не начинал — nexttask.

АКТУАЛЬНО: все4визуализатора завершены по новому указанию пользователя.
Spectrum/Ambient/Liquid/Particles selectable per-window+persist; mainlayoutkey
"spectrum" сохранён длясовместимости, видимаянадпись «Визуализатор».
Последнее пожелание: сильныйfireworks/bass отклик. Реализованы adaptive visual
gain/attack14ms/release130ms/positivebassflux/impact decay, Spectrumpeaks,
Ambientrings+artpulse, Liquidripples, Particlesboundedpoolдо420поquality.
НетsyntheticBPM/отдельногоaudio. Volume0 даёттишину — S6partialостаётся.
Ambient coverUrl изsource/cataloguemetadata, safeHTTPSavatars, fallbackSVG.
Новые visualizer-shaders.ts/audio-motion.ts(+unit). Обычный exe обновлён.
118 rendererPASS/1skip доусиления, после24targeted+14TSunitPASS,
Rust71/9ignored/Clippy/buildPASS. ENCORE_VISUALIZERS_SMOKE=1 realYT all4 в
main+external PASS несколькораз (последний profile native-all-visualizers-1106-bass),
0UIiframes/1engine/epochunchanged. Нативные screenshots просмотрены.
Не возобновлять старую установочную подготовку вместо функциональных задач:
публичныйрелиз пользователь не заказывал. Продолжение только по актуальному плану.

ПОСЛЕДНИЕ3запроса: cue-brand.ts накрывает YTcenterPlay фирменнымSVG приstate5/-1,
скрывается3/1; main+scene, DWMholes, Spectrum/YouTubeinteractive исключены.
playback-rows.ts общий UIcurrenttrack+Play/Pause дляlibrary/catalogue/discovery/
history/queue; текущий трекtoggle существующего coordinator безreload/reset.
Queue identitygeneration/ordinal защищает duplicates; queue textflex-start.
Frontend/debugbuildPASS, renderer113/1skip +3 targetedPASS; nativelogo screenshot
просмотрен. Полныеnative прогоны НЕPASS: первый увидел фактическую сменуsource
наchart/failhistorycount, второй сменуsourceнаcollection/bufferingtimeout.
Стартовый realcue→logo→Play первого прогона PASS, полныйsmoke не выдавать заPASS.
Не путать с пользовательским экземпляром; тестовые
директории native-cued-brand-1106 и native-cued-brand-1106-verify.

АКТУАЛЬНЫЙ СРЕЗ: REQ065 готов. Native crash_recovery.rs + UI crash-recovery.ts:
checkpoint раз5с послеactualstart, clean normalExit, dirty startup предлагает
Resume37с/Discard без autoplay, новое history-прослушивание без старого waveRef.
Окна — прежний scene_layout. Native forcekill только own isolated PID/testMode
→ restart → actualYT37с → savecheckpoint → normalQuit → noPrompt PASS дважды.
Rust70/9ignored, Clippy/buildPASS, renderer112/1skip +4targetedPASS после правки.
Бинарник target/debug/YCoreMusic.exe обновлён. Snapshot atomicJSON appdata,
testMode отдельный .tools, без schema SQLite/credentials/PCM. Corrupt/futurefile
blocked и не перезаписывается. Восстанавливается1клип, не стараяserverqueue.

Последнее уточнение: «Подходящий клип не найден» должно быть error-mark в очереди
даже до Play. Исправлено в skipUnavailable до проверкиcanSkip, новыйtestPASS.
Ручные Next/jump/dislike не errors; ложные listeningevents не создавать.
Следующее по плану: длительная проверка/релизные пакеты/обновления.

ПОСЛЕДНЕЕ: правая панель гибкая, hidden alternatives больше НЕ резервируют место;
верхний scroll занимает всю высоту (обычный вид и controls-only). Scrollbars у
клипов/очереди/панели едины. Ошибочное оформление только техническим отказам:
Next/jump/dislike не маркировать; в истории только endReason=error. User отменил
старые решения фиксированного слота и предупреждений о ручных переключениях.
61 renderer PASS, frontend/debug buildPASS, обычный exe обновлён.

АКТУАЛЬНО: пользователь отменил отдельный раздел автопропусков (включая
controls-only). Теперь markSkipped в skip-notices.ts добавляет только значок
info/popover и оформление строки в очереди/истории: приглушение+тонкая rose/red
полоса. Queue reasons по generation/ordinal, очищаются с trim/reset и при
успешном повторном старте. History uses persisted endReason (точных старых
ошибок нет — не выдумывать; не приписывать причину по одному trackId).
59 renderer PASS, затем3 targetedPASS, frontend/debugbuildPASS, exe обновлён.
Следующие старые заметки про отдельный раздел/10элементов отменены.

Последнее уточнение пользователя: auto-skip-notices показывать ТОЛЬКО в
«Только управление», скрывать без места в видео/Spectrum/mini. Сделано CSS,
проверки переключения добавлены в существующий playback regression.

## Последний автономный срез завершён

Пользователь подтвердил внешний Spectrum исправленным. Native combined
SINGLE_HOST_SMOKE+SPECTRUM_SMOKE+SCENE_LAYOUT_SMOKE+THEME_DPI PASS:3монитора,
DPI1/1/2, независимые сохранённые VIDEO/Spectrum/FPS/quality, simulatedhotplug,
реальный Quit/restart Spectrum без autoplay, targetedOff, одинengine/2зеркала,
tray/mini/topmost. Test profile .tools/native-monitor-acceptance-1106.
Physicalunplug/sleep/lock пока не проверены.

Сделан REQ064: src/skip-notices.ts, последние10 автопропусков в раскрывающейся
панели «Моя волна», причина/трек/артист, dedup/clear, никакого history/feedback
write. Network waits не считаются пропуском. Реальный переход проверяет
playIntent/generation/ordinal. Frontend/debug build PASS;62 targeted renderer
PASS и2 дополнительных targetedPASS. Screenshot .tools/auto-skip-reasons.png
просмотрен. Обычный target/debug/YCoreMusic.exe обновлён.
Следующая задача по принятому плану: REQ065 — восстановление после аварии,
с предложением продолжить, без autoplay и без переноса старой wave session.
Незакоммиченный рабочий срез со Spectrum/фиксом событий ещё существует;
не терять изменения. Остальные3визуализатора без нового указания не делать.

## Последнее исправление: чужие события обнуляли отдельный Spectrum

Уточнённый баг воспроизведён native: скрытая вторая сцена давала первому окну
4 invisible/1 videoOptions и выключала визуализатор. Причина: глобальные emit
и listen(Any). Теперь scene snapshot/options/hidden и audio-analysis используют
emit_to(label) + клиентский WebviewWindow target с собственным label.
Native red→green PASS:0 чужих событий, визуализатор остаётся активен; реальный
YouTube/оба Spectrum/2 зеркала/одинengine PASS.11 renderer,Rust68/9ignored,
Clippy/build PASS. Обычный target/debug/YCoreMusic.exe обновлён. Пользователь
ещё должен проверить свою конфигурацию. Предыдущий FPS fix не закрывал этот баг.

## Последнее: сообщение о лагах отдельного Spectrum

Исправлены FPS pacing (cap30:110→121draws/4с) и per-frame layout read (теперь
ResizeObserver/DPI/quality). Сборка target/debug/YCoreMusic.exe обновлена.
Native fullscreen1440p/high/default165Hz: median6.1ms,p95 6.2ms,max6.9ms,
analysis median40ms; severe lag не воспроизведён. У пользователя запрошены
условия через async question; не считать его проблему окончательно решённой
без ответа/проверки.11 renderer PASS. Native perf включается
ENCORE_SPECTRUM_PERF=1 вместе с SINGLE_HOST_SMOKE/SPECTRUM_SMOKE.

## Последняя задача завершена: только первый Spectrum

Проверены и завершены незакоммиченные изменения Terra: основной selector
Spectrum, отдельные FPS/quality/preferences, общий анализ с внешними сценами.
GPU создаётся лениво, неактивные leases не опрашиваются бесконечно, listener
освобождается. Видео↔Spectrum сохраняет engine; панель YouTube скрывается без
load. Native main14frames/max0.002211 и external7frames/max0.002271 PASS,
WebGL/0iframe/одинengine; transport/tray/mini/два зеркала PASS.
Renderer108PASS/1skip, TS13, Rust68/9ignored, Clippy, build PASS.
Обычная сборка apps/desktop/src-tauri/target/debug/YCoreMusic.exe обновлена.
Пользователю: «Содержимое окна» → Spectrum; внешний — «Экраны» → монитор →
визуализатор. При volume0 — тишина (ограничение S6). Остальные3типа сейчас
не делать: пользователь явно ограничил задачу первым визуализатором.
Нижние записи исторические.

## Актуально: Spectrum готов; далее остальные визуализаторы

Нижние записи исторические. Windows Spectrum: own player-host loopback → общий
FFT → WebGL/Canvas2D; Экраны → монитор → визуализатор; per-monitor FPS/quality,
persistence и остановка скрытых сцен. Volume0 даёт0, pre-volume не решён.
Следующие Ambient/Liquid/Particles и основной visualizer layout, затем hardware
приёмка. Не уходить на посторонние лёгкие задачи.

PASS: Rust68/9ignored, TS13, renderer106/1skip, Clippy debugprobe/release,
no-default check, build. Native55625 завершён exit0: реальный Spectrum,
VIDEO↔Spectrum без нового engine, два зеркала/transport/tray/mini/instance.
Normal debug YCoreMusic.exe пересобран с custom-protocol/defaults, без probe.
Все exec sessions завершены. Пользовательский native-test/deps/YCoreMusic.exe
PID3296 запущен из Explorer: не закрывать. Stash не pop.

Лимит при последнем чтении96% использовано. До обновления не начинать новый
крупный этап. Reset самому не включать; старое ночное выключение ПК не актуально.
CI bd94aa9/42085242519: Windows/Ubuntu/IntelMac PASS, AppleSilicon cancelled
без failedstep. Новую CI после push проверить отдельно.

## Сейчас: REQ063 завершён; дальше СТРОГО визуализаторы/S6

Окончательно: fullrenderer103PASS/1skip, Rust64PASS/9ignored, TS13PASS, fmt/Clippy/native smoke PASS. Обычный YCoreMusic.exe пересобран с последней подписью 2026-11-05. Сохраняется в commit сейчас. Все прежние test sessions завершены, не poll. Следующее действие — отдельный opt-in S6 audio probe, не другие функции.

Финальный fullrenderer41120 завершён:103PASS/1skip, всё исправлено. Frontendподписьготова, обычная debugпересборка сейчасидёт, дождатьсяпоследнеговывода. Stashнеpop. Далееcommit/pushREQ063 и S6. Никакихстарыхsessionpoll.

b1061c8 persistence/hotplug сохранён/pushed, его CI42078517667 ВСЕ4jobsPASS (Windows/Ubuntu/IntelMac/ARMMac). User попросил план, он расписан commentary12пунктов: текущийclippreferences→визуализаторы→physicalscreenchecks→reasons→crashrecovery→sleep/lockcontrols→updater→platforms→beta→site→donate→PWA. Userспросил«когдавизуализатор»; обещано СЛЕДУЮЩИЙкрупныйэтаппослетекущегонебольшогоблока, неоткладыватьдругимипунктами. По-прежнемуавтономно,«меня нежди».

WorkingtreeREQ063: schema6video_preferences/video_exclusions, backupv1–v5, scopedprefsingle(приоритетнадrandomтолькоявный), excludedvideoчистолокальнонеYandexdislike. UIвvideo-dialogprefer/exclude/undo; текущийblockedvideoзаменяетсянасамойпеснечерезvideo_change ссохранениемintent,можноundoкогданетклипа. Кешpolicies1024,revisionguardsoldsearch/reads; filterfavorites/history/search/alternatives/prefetchedqueue. Native64RustPASS/9ignored,TS13PASS,fmtClippyPASS. Native96201полностьюPASSвключаяновыеstoragecommandsплюсреальныезеркала/transport. Normaldebugexeужеуспешнособран, но ПОСЛЕ маленькой UIподписи «исключён из подбора» нужнофинальныйfrontendbuildвexe. Fullrendererпервыйrun102PASS/1fail/1skip: mocksearchundefinedсломалfilter; allowedVideosисправленArray.isArrayguard иtargeted3PASS. Сейчасfullrendererповтор session3256старыйНЕpoll(онfailed); АКТУАЛЬНЫЙsession изпоследнегоtoolпоследобавленияподписи(см.предыдущиевыводы), дождаться. Docs18/statusдобавлены. НужноfullUIpass,normalbuild,commit/push/docsуточнитьзавершение.

S6researchпервичныедоки: https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/ (говоритbuild20348+), https://obsproject.com/kb/application-audio-capture-guide (поддерживаетWin10version2004+). НашWin10build19045, поэтомуНЕблокироватьпоbuildбезфактическогоActivateAudioInterfaceAsync. Sampleисходникhttps://raw.githubusercontent.com/microsoft/Windows-classic-samples/main/Samples/ApplicationLoopback/cpp/LoopbackCapture.cpp : activationparams PROCESS_LOOPBACK INCLUDE_TARGET_PROCESS_TREE, PROPVARIANTVT_BLOB, completioncallbackMTA, IAudioClientSharedPCM16stereo44100, STREAMFLAGS_LOOPBACK|EVENTCALLBACK|AUTOCONVERTPCM. ВRustwindows0.62.2доступнытипыполностью; CargoWindowsfeaturesсейчастолькоPower/Gdi/Dwm/WindowsAndMessaging, дляспайканужныMediaAudio/Com/StructuredStorage/Variant иimplementmacro. СпайкпокаНЕнаписан. CaptureТОЛЬКОprocess::id()+children(ownEncore), никакихсистемныхзвуков/чужихпроцессов/микрофона/виртуальныхдрайверов. Толькоdebugfeature+testModeиагрегаты/FFT, безаудиофайлов. СначалапроверитьAPIactivationнаWin10, потомvolume0; YTsetVolume0можетобнулитьпотокдоWASAPI. ВозможныйбеззвучныйспайкнаYTvolume100толькопослепроверенногомьютаСВОЕЙOSaudiosession, неsystemmaster иневторойplayer. Непереустраиватьproductionaudioпоканетдоказательства. Lastusage55%primary/24%weekly,следить. ПКневыключать. Subagentsнет.

## Следующий готовый срез: persistence и simulated hotplug

Новый scene_layout.rs + интеграция main/scenes/desktop готовы: scene-layouts.json per stableID, размер/позиция logical относительно workarea, mode/topmost/hidden, atomicwrite, future/corrupt blocked, 1s reconcile, no reassignment on unplug, revisionguard позднегоrestore противOff. UI offlineoption+выключение+ошибка сохранения. Нормальная debug сборка успешно обновлена по прежнему пути. Rust62PASS/9ignored,fmtClippyPASS, renderer101PASS/1skip (102total). Native ENCORE_SINGLE_HOST_SMOKE=1 + ENCORE_SCENE_LAYOUT_SMOKE=1 ПОЛНОСТЬЮ PASS: simulateddisconnectreconnectбезOSchanges, realQuit→relaunch→windowrestoredнапрежнеммониторе,noautoplay,targetedOff,mini/topmost/singleinstance. Все sessions37807/83348/65109/82405 завершены, не poll. Физический HDMI unplug НЕпроверен. Docs17/ADR037/status добавлены. Сохранять этотсрезcommit/pushсейчас.

5f459a6 (singleengine) CI42075812252: Windows/обаmacjobsPASS, Ubuntuещёinprogress. Macнеобъявлятьruntimeготовым. Старыйstash@{0}историческийНЕpop. Userпо-прежнемуавтономно«меня нежди».

Далее по списку: realS6 audio capture spike длявизуализаторов (ничегофейкового) или REQ063предпочтения/исключенияклипов. УжеисследованMicrosoftofficialprocessloopback sample https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/ пишетbuild20348+, наштестWin10build19045. Это НЕдоказанныйблокер: OBSможетподдерживатьbackportна19041+, нужнофактическипроверитьActivateAudioInterfaceAsync, анеотключатьпоодномуномеруbuild. Volume0вYTможетобнулитьloopbackдоOSmixer—реальныйспайкобязателен, отдельныйпрототипнепереустраиватьзвукрабочегопродуктабезрезультата. Пока UIvisualizerdisabledчестно.

## Возобновлена автономная работа: REQ-056/057 Windows mirrors

Обновление: повторный native session10978 завершился PASS целиком, затем readScenes refresh прошёл targeted4PASS. Normal debug YCoreMusic.exe успешно собран на прежнем пути. Ничего не poll по старым session IDs. Следующий этап — hotplug/persistence; stash НЕ применять. Подробности в docs16.

Пользователь «работай самостоятельно по списку, меня не жди». Сначала 90e4084 добавлена кнопка Экраны/main-modal с шагами monitor→content, фокус/Esc/stickyfooter и блокировка disconnected. Затем выборочно восстановлены host WIP файлы из stash (НЕ pop), адаптированы к YCore/theme. Windows теперь один технический player-host (source) + DWM mirrors main и независимых video-scene-monitor-{hash}; никакого sceneYT. Default Cargofeature single-player-host поддерживаетWindows, наLinux/macOS остаётсяодинвстроенныйплеер, сцены не подменять2iframe. Служебное окноOS-visiblealpha0/clickthrough/noactivate/skipTaskbar. ПорядокTaurisetters→UIthreadnativealpha исправил реальныйrace. HosttransportserializedPromise, nativeepoch/sequenceguards. Sourcecapтолькоeventlisten, nativeguards не дают аккаунты/storage/source. Nativepixelprobe теперь проверяет принадлежность области перед GetDC, отказывается от перекрытых областей.

Уже прошёл полный nativeENCORE_SINGLE_HOST_SMOKE: реальныйaqzvolume0,1sourceiframe,0main/scene,2дополнительныхмонитора,движущиесяпикселивторогозеркала,targetedOffсохраняетпервое,sourceepochнепересоздаётсяотокон/CONTROLS/tray,реальныеpause/seek,qualitypanelalpha255→0,HTMLdialog/fullHUDнеперекрыты,mini/maximized/topmost/singleinstance. Windows10build19045, неWin11. CCнетуэтогоклипа—неутверждатьliveCCpass. После добавления Promise сериализации идёт повторный native session10978; poll. Fullrenderer100PASS/1skip, Rust60PASS/9ignored,fmtClippyPASS; затем readScenes refresh добавлен (нужноtargetedrerun). Normalbinary ещё не пересобран после host. Документы16/ADR036/status обновлены. Следующий шаг: дождаться native, normalbuild,push,проверитьCI; затемhotplug/persistenceсцен и S6realcapture длявизуализаторов. Stashисторическийнеприменятьповторно.

Новая поддержка Mac обсуждалась: userпошутил«пустьэкспериментальной» и сразуотменилшутку. ПриоритетыНЕменять, macOS остаётсявплане, реальнуюготовностьопределятьпроверками. GitHub ужеимеетIntel/ARMmacjobs; свояMacмашинапоканенужнадлясборок, физическиесцены/звукпозжетестироватьнаудалённом/уbetausers. ПКневыключать, нормальныйuserпроцесснеубивать, subagentsнеразрешены.

## Последнее уточнение: вывод на телевизор трудно найти

Пользователь: функция спрятана в настройках. Требуется заметный вход из основного окна в управление экранами, далее шаги REQ-057 «экран → клип/визуализатор → тип». Зафиксировано в docs01/docs11. Конкретное расположение ещё выбрать; существующую сетку без необходимости не перестраивать. Это про доступные мониторы/телевизоры, не согласование Chromecast/AirPlay/сетевого casting. Сейчас запись задачи, не реализация.

## Последний выбор пользователя: улучшения 1, 2, 4, 5, 6

Одобрены и записаны как REQ-063–067 в docs01/docs11: предпочитать клип/исключать конкретное видео; объяснять пропуски; предлагать восстановление после аварии без autoplay и без нарушения новой Wave-сессии; удобные безопасные обновления с откладыванием и сохранением данных; таймер сна/защита от случайных переключений/отключение телевизора. Пункт 3 (сохранённые схемы экранов) НЕ выбран. Точные настройки таймера, блокировки, обновлений и исключений ещё проектировать. Никакого разрешения выключать ПК нет. Сейчас только фиксация backlog, не реализация.

## Последнее согласование: REQ-062 — сначала мобильный веб-пульт

Последнее уточнение принято («Окей»): первый пульт — устанавливаемая **PWA** с мобильным интерфейсом, значком на главном экране и браузерным доступом без установки. Отдельный Android/iOS пульт — позже, если возможностей PWA не хватит. Установку/повторное подключение проверять по платформам, не обещать одинаковое поведение. Сейчас только запись согласования.

Пользователь одобрил и попросил записать: desktop → сайт → браузерный пульт для телефона → самостоятельные веб/Android/iOS только по спросу. Пульт в домашней сети: QR-код + подтверждение, без обязательного аккаунта YCore; поиск/очередь/выбор клипа/реакции/громкость приложения/экраны. Настоящий плеер и звук остаются на компьютере. Pairing/HTTPS/отзыв доступа ещё проектировать (Q05); это не уже готовая функция и не новый публичный сервер. Самостоятельные мобильные версии не добавлять автоматически в матрицу 6–8 desktop целей. REQ-062 и очередность сохранены в docs01/docs11. Сейчас только запись, без реализации.

## Последнее дополнение к будущему плану: REQ-058–061

Пользователь просил ЗАПИСАТЬ, не начинать сейчас: официальный сайт, хостинг, раздача приложения оттуда; около 6–8 поддерживаемых сочетаний ОС/архитектур, Windows и Linux/Ubuntu обязательны, ранее запрошенный macOS остаётся. Точные цели не выбраны; Ubuntu не отдельная ОС от Linux для подсчёта, установщики не отдельные архитектуры. Кнопка доната + небольшое окно раз в несколько дней «Если вам нравится приложение, оставьте отзыв или поддержите разработчика». Точные дни/правила не утверждены; неперебивающий показ — предложение. DonationAlerts лишь кандидат, нет финальной платёжной ссылки. На сайте три отдельных потока: общие отзывы, баги, запросы новых функций. Hosting/domain/budget/backend/privacy/moderation требуют выбора позднее. Требования в docs01 и roadmap docs11. Ничего не покупать/не публиковать сейчас. Предыдущая задача на завтра REQ-057 сохраняется ниже.

## На завтра, 2026-11-06: REQ-057 — управление мониторами

Последний запрос пользователя — только запомнить, сейчас не реализовывать. Нужен понятный порядок: (1) выбрать монитор, (2) выбрать «Клип» / «Визуализатор», (3) для визуализатора выбрать его тип независимо на этом мониторе. Клипы и визуализаторы можно дублировать на любом числе мониторов без искусственного ограничения; один клип одновременно на нескольких экранах. Сохраняется один настоящий YouTube-плеер/одна загрузка/один звук, дополнительные показы клипа — локальные зеркала (REQ-056). Основное окно может быть только управлением/списками. Требование и приёмка добавлены в docs01 и docs11. Не смешивать эту будущую задачу с завершённым оформлением ниже.

## Актуально: Premium Neon Dark завершён

Эта запись заменяет устаревшие планы ниже. Тема, SVG-иконки и векторная адаптация логотипа по пользовательскому референсу готовы. Сетка/расположение сохранены; player/sync/audio/GPU/FPS не менялись. Windows debug `C:\Users\Skar\Documents\Encore\apps\desktop\src-tauri\target\debug\YCoreMusic.exe` собран 2026-11-05. Нормальный экземпляр не запускали автоматически. Папку проекта в рамках визуальной задачи не перемещали. Remote уже https://github.com/BjornSkarsgard/YCoreMusic.git.

Проверки: Playwright 93 PASS/1 skipped, TypeScript unit 12 PASS, Rust 54 PASS/9 ignored, fmt/Clippy PASS. Native smoke PASS, включая реальные три монитора с DPI 100/100/200%, mini/topmost/maximized/single-instance. Логотип в native CSP исправлен отдельным Vite asset вместо data URL, без ослабления CSP. ICO семь размеров 16..256. Подробности и список файлов: docs/15-PREMIUM-NEON-DARK.md. Локальные снимки .tools/ycore-theme-*.png, .tools/ycore-native-dpi-*.png, контактный лист в .tools/brand-build.

Не проверяли живой значок в пользовательском трее/Explorer после перезапуска и новый runtime на Linux/macOS/Windows11. Нельзя объявлять эти пункты PASS. Отсутствующие визуализаторы/extensions/downloads не добавляли. Следующая независимая задача при необходимости — вернуть и адаптировать single-player-host WIP из stash@{0} `WIP single player host before YCore Music rename`; НЕ pop автоматически, там конфликты с переименованием и новыми view helper. Ночной shutdown больше не актуален. Subagents запрещены без запроса. Секреты не читать и не выводить.

## Сейчас: YCore Music rename готов, Premium Neon Dark начинается

User затем УТВЕРДИЛ имя: YCore Music, shortYCore, «Юкор Мьюзик», слоган `Your Music. Your Core, Your World.`, executableYCoreMusic.exe, GitHubrepoYCoreMusic. Renameкодготов/проверен; GitHubremote реальнопереименован в https://github.com/BjornSkarsgard/YCoreMusic.git, git originобновлён. Корневаяпапкапока C:\Users\Skar\Documents\Encore (userстарыйencore.exePID20140не закрывать; renameпапкивYCoreMusicпозжееслинеblocked). Config.productNameYCore Music, mainBinaryNameYCoreMusic, Cargo packageycore-music/default-runYCoreMusic, explicitbinYCoreMusic src/main.rs, autobinsfalse (yandex-probeexplicitостался). npmnameycore-music-desktop. UIвсяcapitalEncoreзамена, headerYCore, settingssloganточный, PE FileDescription/ProductNameYCore Musicпроверены. Nativeoutputs/.github/READMEbuildpathsновые. CoreIDs/io.encore.desktop/keyring/encore.sqlite/localStorageencore.*/IPCencore-*/ENVENCORE_*оставленыдлясовместимости, tokenнечитался. Autostartappnameновый, ARGUMENT--ycore-autostart, legacy--encore-autostartпринят. OS Run legacyEncore entry readonlyпроверкаfalse, реальныхOSwritesнебыло.

Renameverification:54Rustapp PASS/9ignored,ClippyPASS,12targetedrenderer(auth/welcome/autostart/branding)PASS,nativeisolated startup/storage/history/metrics/mini/topmost/maximized/singleinstancePASS. Normaldebugbuild **C:\Users\Skar\Documents\Encore\apps\desktop\src-tauri\target\debug\YCoreMusic.exe** ready,неautoзапускали(userстарыйinstanceработает). Native-testYCoreMusic.exebuiltbaselineбезhostoptin. Репереименованиеготовосохранятьвcommitпередновойстилизацией.

**Последнийuser запрос: большойPremium Neon Dark редизайнпоattachedреференсу** C:\Temp\codex-clipboard-4c96fafa-94ba-4cd6-86c6-5f762d549652.png (1536×1024доска, виделивчате). Требует **расположение/структуруоставить**, neменятьplayer/sync/audio/GPU/индивидуальныеFPS. Нужныцентральныетокены9HEX bg#0B0B14,panel#141225,surface#1F143A,accent#6D28FF,secondaryaccent#A855FF,pink#FF4FD8,cyan#00E5FF,text#E6E8FF,secondarytext#A3A6C2. Спокойныеградиентыviolet→pink/blue→cyan,безheavyblur/бесконечныханимаций. Всеexistingcomponents/states, единыеSVGiconsбезemoji;непридумыватьновыеразделы. Logo—переплетённыенеоновыеобъёмныелентыPlaytriangle,cyan→violet→pink,wordmarkYCORE/MUSICtrackedbelow. Источникреференсдоступен,SVGвекторможносоздатьнативнопостроивкривые/градиенты(неimagegen/rasterупскейл); старыйapp-icon.svgпростойplay+dotgeneric. ПользовательпроситtransparentPNG/SVG иICO16/24/32/48/64/128/256,проверитьtaskbar/tray/explorerDPI. Tauri CLI iconподдерживаетSVGи --png16 etc,можносгенерироватьPNGвсехразмеров,затемNodeICOpackPNGframesбезновыхdeps. Вnode_modulesнетsharp/resvg,естьPlaywright, CLItauri icon самрастрируетSVG. Менятьsrc-tauri/iconsродныеPNG/icns/ico. Готовностьпроверитьbuild/mainviews/dialogs/hover/focus/disabled/DPI идатьсписокфайлов/ограничений.

Analysisуже: vanillaTS+Vite/Tauri2, :rootтолькобазоваятипографика, всецветавstyle.css~22KB >90разныхHEX, отдельныйscene.css~1.8KB, текущиеSVGpathsвshell.ts iconhelper (неполныйнабор),многоUnicodePlay/♥/👎/☆ вshell/main/catalogue/discovery/library/history/favorites. Можноцентрализоватьtheme.cssтокеныисемантическиеderivedцвета,icons.tsединыйstroke1.8/24px+defsgradientactive; сохранятьhandlers/IDs/DOMструктуру. Динамические.textContent repeat/mute/mini/fullscreen/like/favoriteперетираютSVG—нужноviewhelperбезизменениялогики. НеиспользоватьобщийMutationObserverиконоквоизбежаниеperframeDOMнагрузки. ВставлятьSVGвконкретныеточкирендера. Primaryfillтемнеевиолетдлячитаемости,розовыйвградиентбордер/selection. Keepstageblackдлявидео. LogoSVGиwordmarkвшапкенадосущественновписать встарые68pxheader/sidebarразмеры,неперекраиватьlayout. Existingheaderbrandlinkaria YCore Music textYCorecurrently,branding.specexpectcontainsYCoreислоган. Сохранятьaccessibilitylabels/textуicon-onlybuttons.

**Single-player-host WIP безопасноотложен** git stash@{0}: `WIP single player host before YCore Music rename` (include-untracked). Неpopсейчас, userявнозапретилменятьплеерлогикуввизуальнойзадаче. ПередвосстановлениембудетrenameконфликтыCargo/main.ts/main.rs/scene-player/vite/scripts/handoff; надоадаптироватьноубратьEncoreизновыхusercopy. ВstashдостаточныйWIPhandoffизследующеготурна. Actualbasicnativehostpassedonce; расширенныйтестживыхcaptions/quality/HUDещёнеготов. Старыйscene_layoutdraft в.tools/scene-layout-draft-before-mirror.rs. ПКневыключать/subagentsнеразрешены. Userхочетавтономноинеостанавливатьсябезрешения. Budgetбыл49%primary/8%weekly—проверитьсейчас, resetтолькоuser.

## Самое новое: 2026-11-05, один плеер / зеркало / ожидается новое имя

Последний user: Encore занято, надо переименовать. В request_user_input_async предложены Ripresa/Рипреза и Ritornel/Ритурнель либо свой вариант; ответа пока нет. Предварительный web search не выявил явного одноимённого music player, но уникальность не обещана. Rondio уже занят реальным iOS music player, Ritova другим iOSapp, их не предлагали. Ничего пока не переименовывать без выбранного имени. После выбора менять брендинг/repo/folder в пределах авторизации, сохранить OS credential namespace/старые данные через совместимость/миграцию, не заменять секреты/IDs вслепую. Локальный cwdстарыйVideoYandexTube, реальныйrootEncore.

User отменил несколько iframe (REQ056). Сначала хотел один плеер внутри/снаружи, затем предложил локальное зеркало вместо повторной YouTube загрузки. **Затем сам предложил alpha0+clickthrough** вместо hide. Этот вариант реально работает в spike! Native DWM mirror_probe.rs, debugfeature mirror-probe (=tauri/unstable), толькоtestMode/main. Destnativewindow безWebView и destс локальнымHTMLWebView оба показывают зеркало. Настоящий источник один mainiframe; никакого дополнительногоYoutube/аудио. Source alpha0 + layered/transparent/noactivate; WindowsAPI alpha0verified, WindowFromPoint/GetAncestor hit testpassed. Красный/синий calibrationpassed. Реальныйaqz-KE-bpKQ muted test: visible10/10unique2.7s; настоящимhide втрее1/8unique timeline+2с frozen; **alpha0 90/90unique за32.353s, timeline+33s, nonblackratio.9255**. Source style/alpha восстановлены и сверены; последующие mini/topmost/singleinstance passed. Это короткаяsamplingпроверка, НЕfpsbenchmark/hour/hotplug/lock/mac/linuxPASS. ActualOSqueryVersion10.0.19045 — Windows10build19045, не11! Docs ADR033/status/architecture/requirements updated. Stats .tools/dwm-mirror-probe.json, ownedvideocrop BMP .tools/native-test-data/mirror-probe-last.bmp, никаких аккаунтов/токенов в артефактах.

Workingtree: новый mirror_probe.rs, mirror-probe.html локальнаяпустаязелёнаяdestinationtestpage, Viteinputдобавлен, CargoWinDwm/UIfeatures+mirror-probe optin, mainmanage+command guarded. Native runner ENCORE_MIRROR_PROBE/WEBVIEW/STRESS options. Полныйпрогон среальнымYouTube и90samplespassed. Cargo test mirror_probe::tests passed; Clippy -Dwarnings иdefaultиfeaturemirror-probe passed. Нужно сохранить этотсрез commit/push, нормальнуюсборку пока не обновляли новымprobe (оннедоступенвnormaltestMode anyway). Нормальныйexe остаётсясf596aa4 (oldmutedfollowers), inventory739d0bbsourcecommitted/pushed. Все тестовыепроцессы закончены, пользовательскихEncoreпроцессов впоследнемчтениинебыло.

Ещё untracked scene_layout.rs — наш незавершённый draft прежнего persistence (неподключёнmodникак). Онне userfile; можно архивироватьв.tools, переделатьилиудалить, некоммититькакготовуюpersistence. Последнийlimitread25%primary/4%weeklyused, userresetсам, инструментаактивациинет. ПКневыключать, subagentsнельзя.

Продолжение архитектуры: вместо второгоplayer вscene-player.ts нужен одинengine в техническомsourcehost (WebviewWindowalpha0/clickthrough/noactivate/skipTaskbar, оставлятьOS-visible, неhide), UIглавного/доп.окон — DWMmirrorsnativecrop. Проба уже доказалаDWMповерхdestinationWebView. ОтделениеYGPlayerотmainTS требует bridge/proxy callbacks/cachecaptionoptions/position междуengineиединственнымcoordinator. Нельзя оставлятьстарыйYTiframeвmainпараллельноghostplayer. Sourceepochguards дляload/destroy/events обязательны, queue/history/listening/waveодни. Quality/YouTubeinteractivepanel вbitmapmirrorнужно спроектировать (автоматическойforwardinputнет). Ни рефакторингhostниreparentprototypeещёне начаты. РеальныйTauriWebview.reparent/add_child существуют черезunstableи могутбытьальтернативой; читали локальнуюAPIдокументацию, но не проверяли. Userпоследнимвыбралпроверкуalpha0 ионаpassed, не возвращатьсясамовольно к2iframe.

## Возобновление 2026-11-05: пользователь сбросил лимиты, работа продолжается

Пользователь подтвердил «сбросил лимиты, работай», затем автономно без остановок, спрашивать только решения пользователя. Старое сообщение о низкой квоте ниже не действует. Read-only get_usage_limits показал primary11%used/weekly2%used после первого среза; reset активирует только пользователь. ПК не выключать. Subagents запрещены без явного запроса.

Сохранён/pushed59b5272: CONTROLS layout основного окна (select window-layout, keyencore.mainLayout.v1), каталог и закреплённая очередь одновременно, транспорт снизу; единственный iframe вне видимой области320×200 сохраняется. Мини/fullscreen снова показывают его. Native реальный aqz-KE-bpKQ: timeline продолжает идти6с, тот же iframe/history, pause+return.85UI+1skip/12unitPASS. Исправлен flaky listening test: теперь ожидает новую YT instance/PLAYING после async reload панели перед изменением position, а не уже истинный records.length1.

Следующий срез в рабочем дереве: отдельное окно video-scene (scene.html/scene-player.ts/scene-ui.ts, native scenes.rs и capability только eventlisten/unlisten), snapshot от main каждые500ms, main единственный audible player/coordinator, follower mute:1+mute/volume0 наReady/каждомStateChange, ENDED не двигает очередь. Scenecontrols→main encorе-control/media, fullscreen/topmost только своей сцены. Крестик hide, скрытый/минимизированный follower уничтожает iframe, trayOpen восстанавливает; OFFdestroy. Native scene_window **async**, иначе build WebView2 deadlock; OFF ждёт удаления registry до2с, иначе старыйStatusenabledtrue. Не создавать native окна в sync IPC Windows.

Проверки нового среза:89UI PASS+1optin skip,52Rustapp PASS/9ignored,Clippy PASS. Native ENCORE_CONTROLS_SMOKE=1 ENCORE_SCENE_SMOKE=1 реально подтвердил дваYouTube, follower isMutedtrue/getVolume0, sharedpause, main hidden втрее6с timelineadvance, followerhide удаляетiframe, fullscreen/topmost/off, labelguards(main неviewer; viewer неstorage/config), обычные mini/maximized/singleinstance checks. Все тесты volume0, физическое эхо не измерялось. Native-test binary актуален кроме последнего renderer-only seekdragfix/CSS; перед новым нативным прогоном build frontend+native-test. Нормальную сборку надо обновить сейчас (пользовательского Encoreпроцесса в последнем чтении не было), затем commit/pushсрез. Автозапуска normalapp нет.

Далее: monitor inventory/stableWindowsIDs, выбор экрана и сохранение размещения/режимов, hotplug и больше сцен; visualizer только после реального audioS6. Пока дополнительное окно одно, перенос вручную, безmonitorpersistence/hotplug, полноценныйaudioauthoritytransfer неготов. S5PARTIAL. Docs ADR030/031,06 иstatus обновлены. Изучен Microsoft EnumDisplayDevicesW(EDD_GET_DEVICE_INTERFACE_NAME): возвращает per-monitor interface name DeviceID, нужно не брать индекс DISPLAYx за стабильный ID; источник https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaydevicesw . Windowsbindings0.62.2 доступны локально; Tauri2.12.5Monitorдаётname,size,position,work_area,scale_factor, неrefreshHz. ПутьrootтотжеEncore, cwduserустаревшийVideoYandexTube.

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

## ОСТАНОВКА ПО МАЛОМУ ЛИМИТУ — 2026-11-05 (последний источник истины)

На последней проверке primary95%used (5%remain),weekly96%used (4%remain); resetcredits2нетронуты. Закончить commit/push этого среза и остановиться. ПК НЕ выключать по старой ночной инструкции; пользователь сейчас активно тестирует приложение.

Последняя завершённая работа: REQ054/055 интерактивная очередь+автоподгрузка при нижнем scroll. Пользователь подтвердил порядок A→B→C→D, jumpA→C, потомD. Предыдущие видимые записи оставлены, курсорordinal/generation; source/batchorder иduplicatesсохраняются. queueNavigation/advanceOwner блокируют старыйNext после нового выбора, данные фоновой порции не теряются. queue-scroll.ts работает через sourceWork тольковWave, сохраняетscroll/current/noautoplay, ошибки→retry, futurecapоколо500. Прежнийpast50 не убирали; последнийfix переноситrenderпослеtrim, исключаяghostbuttons. Native-test надо пересобрать после этого маленькогоfix; normaldebugexe пересобран успешно послеuserexit. Никаких автозапусков normalapp.

Также сделан focus-refresh текущейреакции с250msdebounce/min3s; externalmocklike/unlikeбезwritesPASS. Реальнаяобратнаясинхронизацияещёнеподтверждена, а Encore→Yandexlike пользователь подтвердил. Это не меняет Q06 (не согласован). Пока работа по сценам/визуализаторам/пульту не начата; REQ053 CONTROLSполнаякомпоновка/независимыеокна зафиксирован.

Проверки:12unitTS,82fullrenderer+1skipped,послеfinalrenderfix4queuePASS+check/build. Native generalPASS и Queueclick/manualNext/back/1cuediframePASS. Два liveM7 streamtestзавислиBuffering/recovery, JSerrors[]; не приписывать им PASS/не считать actualNativeEND-nextдоказанным. RendererдоказываетEND-next,разныеclips/прошлые/lateMatch/pendingNext/scroll/retry; реальныйnativeYT/listening PASS был в предыдущемсрезе. Нативные тестыизолированы,volume0, wave_syncdisabled; ложныеplayback/preferenceswritesнепосылались. Своитестовыепроцессы закончены.

До этого завершён и pushed7f53c51: SQLitev5 Waveeventsdelivery сnativeWaveOriginregistry4096,epochaccountsessionbatchrefs,51app+6probeRust,Clippy,77UI+1skip. Реальныйnative readonlyWavebatchrefsPASS. UserWaveотправкаподтверждена, AppDatareadonlyenum/count receipt sentradio2/start5/skip3/finish1,pending0; UID/tracks/sessions/tokenввыводнепопадали. Historywriter/clearbarrier/nativeExitclosures. ПользовательскийlikeEncore→Yandexподтверждён. НоваяочередьнеизменяланативныйRust/providerсрез.

Следующее при явном продолжении: проверить currentgit/доки, завершить ручнуюприёмку очереди на естественноиграющемпользовательскомклипе (nativeспециальныйдемоM7буферился), реальныйreversefeedbackпоестественнымдействиям. Затем согласованныйscenes→visualizers(реальныйappaudioS6передобещаниями)→remote. Linux/macOSвконце, старыйLinux topmostдефектсохранён, Macrunnercapacityнеpassed. Не чистить32ГБкэшсамовольно: userтолькоузналрелизныйвес. Не запускать старые.tools/*/apply.ps1. Новыйбюджетreset/действияпользователянепредполагатьмолча.

### Запрошенная тестовая DEB-сборка
Пользователь явно попросил собрать DEB сейчас, несмотря на известный playback blocker.
Запущен workflow42215038612, commit6a96f79, Ubuntu24.04 x86_64, deb_only=true.
В сборку включён linux-embed-referrer; DEB объявляет GStreamer base/good/libav.
Это тестовая сборка, не подтверждение исправления зависания YouTube перед стартом.

Уточнение пользователя: полное удаление старого бренда пока ОТЛОЖЕНО
(ответ «пока забей, не трогаем нечего» на вопрос о миграции). Никаких rename не делать.
Первый DEB run42215038612 failed: npm run desktop добавлял tauri dev, запуская
приложение с аргументами build вместо упаковки. Исправлено на npx tauri build.
Повторный DEB workflow42215748525, commit89b9240, запущен.

DEB ГОТОВ: workflow42215748525 SUCCESS, commit89b9240. Скачан локально:
C:/Users/Skar/Downloads/YCoreMusic-Linux-0.0.1/deb/YCore Music_0.0.1_amd64.deb
9188786 bytes. Ubuntu24.04 x86_64 experimental. Check/tests/build/dpkg inspection
PASS. Linux YouTube start зависание НЕ исправлено: сборка передаётся по явному
запросу пользователя для тестирования. Переименование пока отложено.


## Последний Linux-срез, 2026-11-06 — предупреждение 3% лимита

Точка продолжения: docs/21-LINUX-READINESS.md. Новый Linux single-host/Cairo/PulseAudio/XRandR срез реально проверен на Xvfb и двух физических X11-мониторах. Не возвращаться к старому playback blocker: MediaCapabilities workaround и отдельный source решили его. Не объявлять Wayland/личную Wave/AppImage готовыми. Изменения не коммитились; сохранять весь исходный dirty WIP. Новых больших работ не начинать до нового продолжения.
