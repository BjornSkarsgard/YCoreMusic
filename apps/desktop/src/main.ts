import {setIconLabel} from './icons';
import {mountVisualControls,paintRange} from './visual-controls';
import {mountDiagnostics} from './diagnostics-ui';
import {mountAuth} from './auth-ui';
import {mountQueueScroll} from './queue-scroll';
import {mountWindowLayout} from './window-layout';
import {mountMainSpectrum} from './main-spectrum';
import {markSkipped} from './skip-notices';
import {mountCrashRecovery} from './crash-recovery';
import {mountCueBrand} from './cue-brand';
import {mountSleepTimer} from './sleep-timer';
import {allowPlaybackChange,mountPlaybackGuard,playbackLocked} from './playback-guard';
import {mountUpdates,updatesInstalling} from './updates';
import {mountSupport} from './support-ui';
import {bindPlaybackRow,setRowPlayback} from './playback-rows';
import {mountScenes} from './scene-ui';
import {hostAvailable,createPlayer} from './player-host';
import {mountVideoMirror} from './video-mirror';
import {ListeningMeter,type EndReason,type PlaybackSource} from './listening';
import {PlaybackProgress} from './playback-progress';
import {mountAutostart} from './autostart-ui';
import {mountHistory} from './history-ui';
import {mountDiscovery} from './discovery-ui';
import {mountVideoFavorites} from './favorite-ui';
import {savedVideos,allowedVideos,videoExcluded,invalidateVideoPolicy,videoPolicyVersion} from './favorite-store';
import {favoriteOrder,type SavedVideos} from './video-favorites';
import {historyBatch,type SmartCandidate} from './smart-history';
import {mountFeedback} from './feedback-ui';
import './style.css';
import './select.css';
import {appShell,mountShellNavigation,showPanel} from './shell';
import {mountLibrary} from './library-ui';
import {mountFullscreenControls} from './fullscreen-controls';
import { videoId } from './video-id';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import { PlaybackQueue, type Track, type QueueInput } from './queue';
import { storage, type HistoryEntry } from './storage';
import {mountCatalogue,collectionPage,type CollectionContext} from './catalogue-ui';
import {PreviousGesture,VolumeState} from './playback-controls';
import {CaptionControls,qualityLabel} from './player-options';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = appShell;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queue = new PlaybackQueue();
const cueBrand=mountCueBrand(document.querySelector<HTMLElement>('.screen')!);
const skipReasons=new Map<string,string>();
let updateQueueScroll=()=>{};
let refreshFeedback=()=>{};
let refreshVideoFavorites=()=>{};
const lastPlayedVideos=new Map<string,string>();
let player: YT.Player | undefined;
let generation = 0;
let playerReady = false;
let scenePlayback=-1;
let activeVideo:QueueInput|undefined;
interface PlayRecord {event:{playbackId:string;trackId:string;title:string;artist:string;videoId:string;waveRef?:string};recorded:boolean;started:boolean;meter:ListeningMeter;source:PlaybackSource;endReason?:EndReason;durationMs?:number;lastWrite:number;signature?:string;writer?:Promise<void>}
let activeRecord:PlayRecord|undefined;
let crashRecoveryUI:ReturnType<typeof mountCrashRecovery>|undefined;
let historyWriter:Promise<void>=Promise.resolve();
let waveSyncTimer:ReturnType<typeof setTimeout>|undefined,waveSyncBusy=false,waveSyncPending=false,waveSyncAttempt=0;
const waveStatus=document.createElement('p');waveStatus.id='wave-sync-status';waveStatus.setAttribute('role','status');element('source-status').after(waveStatus);
function scheduleWaveSync(delay=300){
 waveSyncPending=true;if(waveSyncTimer||waveSyncBusy)return;
 waveSyncTimer=setTimeout(()=>{
  waveSyncTimer=undefined;waveSyncBusy=true;waveSyncPending=false;
  void invoke<{disabled:boolean;pending:number;sent?:number}>('wave_sync').then(value=>{
   if(!value||typeof value.pending!=='number')throw Error('Invalid Wave acknowledgement');
   waveSyncAttempt=0;waveSyncPending=value.pending>0;waveStatus.textContent=value.sent&&value.sent>0?'Данные прослушивания отправлены в Яндекс Музыку.':'';
  }).catch(error=>{
   waveSyncPending=true;++waveSyncAttempt;
   waveStatus.textContent=/Authorization|token|credential/i.test(String(error))?'Для синхронизации прослушиваний обновите вход в настройках.':'Прослушивание сохранено на устройстве. Синхронизируем с Яндексом позже.';
  }).finally(()=>{waveSyncBusy=false;if(waveSyncPending)scheduleWaveSync(Math.min(60000,1000*2**Math.min(waveSyncAttempt,6)));});
 },delay);
}
window.addEventListener('online',()=>{if(waveSyncPending)scheduleWaveSync(0);});
window.addEventListener('beforeunload',()=>clearTimeout(waveSyncTimer));
function playbackId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');}
function observeRecord(playing?:boolean){
 const record=activeRecord;if(!record)return;const position=playerReady?player?.getCurrentTime():undefined;
 if(playing===undefined)record.meter.sample(position);else record.meter.state(playing,position);
 const duration=playerReady?player?.getDuration():undefined;if(duration&&Number.isFinite(duration)&&duration>0)record.durationMs=Math.round(duration*1000);
}
function persistRecord(record:PlayRecord,force=false){
 if(!isTauri()||!record.started||(!force&&performance.now()-record.lastWrite<5000))return;
 record.lastWrite=performance.now();
 const event={playbackId:record.event.playbackId,source:record.source,listenedMs:record.meter.listenedMs,durationMs:record.durationMs??null,endReason:record.endReason??null,waveRef:record.event.waveRef??null};
 const signature=JSON.stringify(event);if(record.signature===signature)return;record.signature=signature;
 record.writer=historyWriter=historyWriter.then(async()=>{
  if(!record.recorded){await storage({type:'record',event:record.event});record.recorded=true;historyExhausted=false;}
  await storage({type:'progress',event});
  if(record.event.waveRef)scheduleWaveSync();
 }).catch(()=>{if(record.signature===signature)record.signature=undefined;element('storage-status').textContent='Не удалось сохранить данные прослушивания.';});
}
function finishRecord(reason:EndReason){
 const record=activeRecord;if(!record||record.endReason)return;observeRecord(false);record.endReason=reason;persistRecord(record,true);if(record.started)crashRecoveryUI?.clear();
}
function seekPlayer(position:number){
 playbackProgress.reset();
 observeRecord();activeRecord?.meter.seek(position);lastKnownPosition=position;if(playbackRecovery)playbackRecovery.position=position;player?.seekTo(position,true);
}
let lastKnownPosition=0,networkOffline=!navigator.onLine;
const playbackProgress=new PlaybackProgress();
const preparationProgress=new PlaybackProgress(30000);
let playbackRecovery: {id:string;position:number;record?:PlayRecord;attempts:number;ended:boolean}|undefined;
let playbackRetry:ReturnType<typeof setTimeout>|undefined;
function cancelPlaybackRecovery(reset=true){clearTimeout(playbackRetry);playbackRetry=undefined;if(reset)playbackRecovery=undefined;}
function holdPlayback(ended=false){
  if(!activeVideo?.videoId)return;
  const position=playerReady?player?.getCurrentTime():undefined;if(position!==undefined&&Number.isFinite(position)&&position>0)lastKnownPosition=position;
  playbackRecovery??={id:activeVideo.videoId,position:lastKnownPosition,record:activeRecord,attempts:0,ended:false};
  playbackRecovery.ended ||= ended;
}
function recoverPlayback(immediate=false){
  if(!playIntent||powerPaused||!activeVideo?.videoId)return;
  holdPlayback();const recovery=playbackRecovery!;
  if(networkOffline){report('Нет сети · сохраняем трек и позицию, ждём подключения.');return;}
  if(playbackRetry)return;
  if(recovery.attempts>=2&&canSkip()){
    cancelPlaybackRecovery();trackDeadline=Date.now()+24000;tryAlternative(queue.generation,queue.current?.ordinal);return;
  }
  const current=generation,epoch=queue.generation,revision=sourceRevision,intent=intentRevision;
  const delay=immediate?0:Math.min(30000,2000*2**Math.min(recovery.attempts,4));
  report('Восстанавливаем текущий клип'+(delay?' · повтор через '+delay/1000+' с':''));
  playbackRetry=setTimeout(()=>{
    playbackRetry=undefined;
    if(!playIntent||powerPaused||networkOffline||current!==generation||epoch!==queue.generation||revision!==sourceRevision||intent!==intentRevision||playbackRecovery!==recovery)return;
    if(recovery.ended){cancelPlaybackRecovery();if(repeatMode==='one')void repeatVideo(recovery.id,activeAutomatic);else void advance(playIntent);return;}
    recovery.attempts++;
    void loadVideo(recovery.id,true,activeAutomatic,{position:recovery.position,record:recovery.record,recovery:true});
  },delay);
}
let activeAutomatic=false;
let youtubeControls=false;
const captionControls=new CaptionControls(element<HTMLSelectElement>('captions'),element<HTMLSelectElement>('caption-size'),element('player-options-status'));
let apiPromise: Promise<void> | undefined;
let playIntent=false;
let powerPaused=false;
let suspendPosition:number|undefined;
let mediaRevision=Date.now()*1000;
let mediaPlayback:'stopped'|'paused'|'playing'='stopped';
let mediaTitle='YCore Music',mediaArtist='';
let lastMediaPublish=0;
function publishMedia(){
  if(!isTauri())return;
  lastMediaPublish=Date.now();
  void invoke('media_update',{update:{revision:++mediaRevision,title:mediaTitle,artist:mediaArtist,playback:mediaPlayback,position:playerReady?player?.getCurrentTime()??0:0,duration:playerReady?player?.getDuration()??0:0,volume:volume.output/100}}).catch(()=>{});
}
let finiteSource=false;
let historySource=false,intentRevision=0,historyExhausted=false,historyStarting=false;
let historyWork:Promise<boolean>|undefined;
const excludedTracks=new Set<string>();
const pendingReactionStates=new Map<string,number>();
const unavailableHistoryTracks=new Set<string>();
let activeCollection:CollectionContext|undefined;
interface Candidate {id:string;title:string;byline?:string;artist?:string;score:number;views?:number|null;durationSeconds?:number|null;reason:string;saved?:boolean;preferred?:boolean;historical?:boolean;needsReview?:boolean}
const choices=new Map<string,{items:Candidate[];index:number;alternativesLoaded?:boolean;favoriteChosen?:boolean}>();
const searching=new Set<string>();
const bypassSaved=new Set<string>();
let sourceRevision=0;
const previousGesture=new PreviousGesture();
const volumeKey='encore.volume.v1';
let volume:VolumeState;
try{volume=VolumeState.restore(localStorage.getItem(volumeKey));}catch{volume=new VolumeState();}
element<HTMLInputElement>('volume').value=String(volume.level);
element('mute').setAttribute('aria-pressed',String(volume.muted));
setIconLabel(element('mute'),volume.muted?'muted':'volume',volume.muted?'Без звука':'Звук',true);
let repeatMode:'off'|'one'|'queue'='off';
function report(message: string) {
  element('status').textContent = message;
  const log = element('log');
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 6000);
}
function intentUI(){document.body.classList.toggle('is-playing',playIntent||historyStarting);element<HTMLButtonElement>('pause').disabled=!(playIntent||historyStarting);cueBrand.update(playerReady&&!!activeVideo&&!youtubeControls,scenePlayback);setRowPlayback({trackId:playerReady?activeVideo?.id??null:null,playing:playIntent&&!powerPaused,queueKey:queue.generation+':'+queue.current?.ordinal},()=>systemControl('toggle'));}
function enabled(value: boolean) {
  if(!value)cueBrand.update(false,-1);
  for (const id of ['play', 'pause', 'back', 'forward','youtube-settings']) element<HTMLButtonElement>(id).disabled = !value;
  if(playIntent||historyStarting)element<HTMLButtonElement>('pause').disabled=false;
}
async function api(): Promise<void> {
  if(await hostAvailable())return;
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    function fail() { clearTimeout(timer); script.remove(); apiPromise = undefined; reject(new Error('YouTube API недоступен. Проверьте сеть и повторите.')); }
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
    script.onerror = fail;
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  });
  return apiPromise;
}
element<HTMLFormElement>('load').addEventListener('submit', event=>{
  event.preventDefault();
  if(!allowPlaybackChange())return;
  const id=videoId(element<HTMLInputElement>('url').value);
  if(!id){report('Нужна HTTPS-ссылка YouTube или video ID из 11 символов.');return;}
  clearRetry();sourceNeedsFresh=false;historyStarting=false;++sourceRevision;
  if(!queue.current){finiteSource=true;historySource=false;element('source-status').textContent='Открыт свой клип. Можно включить волну или выбрать музыку в поиске.';}
  const track=queue.current;
  if(isTauri() && track && /^\d+$/.test(track.id)) void storage({type:'save_video',trackId:track.id,videoId:id}).then(()=>{element('storage-status').textContent='Клип добавлен в избранное для этой песни.';refreshVideoFavorites();void favoritesChanged(track.id);}).catch(()=>{element('storage-status').textContent='Не удалось сохранить ручной клип. Текущий выбор действует только до перезапуска.';});
  element<HTMLDialogElement>('video-dialog').close();
  void loadVideo(id);
});
async function loadVideo(id:string,resume=false,automatic=false,restore?:{position:number;record?:PlayRecord;recovery?:boolean}) {
  if(updatesInstalling())return;
  automatic ||= !!queue.current;
  playbackProgress.reset();
  preparationProgress.reset();
  if(restore?.record===activeRecord&&activeRecord){observeRecord(false);persistRecord(activeRecord,true);}else finishRecord('video_change');
  if(!restore?.recovery)cancelPlaybackRecovery();
  previousGesture.reset();
  element<HTMLButtonElement>('previous').disabled=false;
  const sourceGeneration=queue.generation, ordinal=queue.current?.ordinal;
  if(ordinal!==undefined) queue.resolve(ordinal,id,sourceGeneration);
  const selected=choices.get(sourceGeneration+':'+ordinal);if(selected)selected.index=selected.items.findIndex(candidate=>candidate.id===id);
  renderAlternatives();
  playIntent=resume&&!powerPaused;
  activeAutomatic=automatic;
  if(!restore){youtubeControls=false;element('player-options-status').textContent='';}
  document.querySelector('.screen')!.classList.toggle('interactive',youtubeControls);
  element('youtube-settings').setAttribute('aria-pressed',String(youtubeControls));
  element('youtube-settings').textContent=youtubeControls?'Скрыть панель YouTube':'Панель YouTube';
  element('video-quality').textContent='Качество: Авто';
  captionControls.reset();
  const trackAtLoad=queue.current;
  mediaTitle=trackAtLoad?.title??'YouTube · '+id;mediaArtist=trackAtLoad?.artist??'';
  if(!trackAtLoad){element('track-title').textContent=mediaTitle;element('track-artist').textContent='';element('source-name').textContent='Свой клип';}
  activeVideo={id:trackAtLoad?.id??'manual:'+id,title:mediaTitle,artist:mediaArtist,videoId:id};
  lastKnownPosition=restore?.position??0;
  refreshVideoFavorites();ensureAlternatives();
  mediaPlayback='stopped';publishMedia();
  const playEvent={playbackId:playbackId(),trackId:trackAtLoad?.id ?? 'manual:'+id,title:trackAtLoad?.title ?? 'YouTube · '+id,artist:trackAtLoad?.artist ?? '',videoId:id,waveRef:trackAtLoad?.waveRef};
  let record:PlayRecord=restore?.record??{event:playEvent,recorded:false,started:false,meter:new ListeningMeter(),source:trackAtLoad?.playbackSource??(trackAtLoad?(historySource?'smart_history':finiteSource?'catalogue':'my_wave'):'manual'),lastWrite:0};activeRecord=record;
  const current = ++generation;
  enabled(false);
  intentUI();
  const loadKey=queue.generation+':'+queue.current?.ordinal;
  if(loadKey!==currentLoadKey){currentLoadKey=loadKey;trackDeadline=Date.now()+24000;}
  loadStarted=Date.now();bufferingSince=0;
  playerReady = false;
  scenePlayback=-1;
  player?.destroy(); player = undefined;
  element('empty').hidden = false;
  report('Загрузка YouTube API…');
  try {
    await api();
    if (current !== generation) return;
    let ready = false;
    const timer = setTimeout(() => {
      if (current === generation && !ready) { ++generation; enabled(false); playerReady = false; player?.destroy(); player = undefined; report('Видео не подготовилось вовремя. Проверьте сеть и повторите загрузку.'); if(networkOffline||restore?.recovery)recoverPlayback();else if(automatic||document.fullscreenElement) tryAlternative(sourceGeneration,ordinal); }
    }, automatic?12000:20000);
    if (!document.getElementById('player')) { const mount = document.createElement('div'); mount.id = 'player'; document.querySelector('.screen')!.prepend(mount); }
    player = createPlayer('player', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 0, playsinline: 1, controls:youtubeControls?1:0,fs:0,disablekb:1,rel:0,iv_load_policy:3,cc_load_policy:1,origin: location.origin },
      events: {
        onReady: event => {
          if (current !== generation) return;
          playerReady = true;
          event.target.setVolume(volume.output);
          element('empty').hidden = true;
          report('Подготовка видео…');
          event.target.getIframe?.()?.setAttribute('tabindex',youtubeControls?'0':'-1');
          if(restore && restore.position>0)event.target.cueVideoById({videoId:id,startSeconds:restore.position});
          else event.target.cueVideoById(id);
        },
        onStateChange: event => {
          if (current !== generation) return;
          scenePlayback=event.data;
          document.dispatchEvent(new Event('scene-playback-state'));
          if(event.data!==1){observeRecord(false);persistRecord(record,true);}
          const states: Record<number, string> = { '-1': 'Видео загружено', 0: 'Видео завершено', 1: 'Воспроизведение', 2: 'Пауза', 3: 'Буферизация', 5: 'Готово · без autoplay' };
          intentUI();
          report(states[event.data] ?? `Состояние ${event.data}`);
          if (event.data === 5) { ready = true; clearTimeout(timer); enabled(true); captionControls.refresh(event.target);if(playIntent&&!powerPaused){if(networkOffline){holdPlayback();report('Нет сети · клип подготовлен, ждём подключения.');}else event.target.playVideo();} }
          if(event.data===1) {
            if(powerPaused||(!playIntent&&!youtubeControls)){event.target.pauseVideo();return;}
            if(trackAtLoad&&skipReasons.delete(sourceGeneration+':'+trackAtLoad.ordinal))renderQueue();
            if(record.endReason){record={event:{...record.event,playbackId:playbackId()},recorded:false,started:false,meter:new ListeningMeter(),source:record.source,lastWrite:0};activeRecord=record;}
            record.started=true;observeRecord(true);persistRecord(record,true);
            playIntent=true;cancelPlaybackRecovery();clearRetry();skipStreak=0;retryAttempt=0;bufferingSince=0;loadStarted=0;intentUI();
            if(trackAtLoad)lastPlayedVideos.set(trackAtLoad.id,id);
            if(trackAtLoad)unavailableHistoryTracks.delete(trackAtLoad.id);
            captionControls.refresh(event.target,true);
          }
          if(event.data===2){if(youtubeControls)playIntent=false;else if(playIntent&&!bufferingSince)bufferingSince=Date.now();intentUI();}
          if(event.data===3&&playIntent){if(!bufferingSince)bufferingSince=Date.now();if(networkOffline){holdPlayback();report('Нет сети · сохраняем трек и позицию, ждём подключения.');}}
          if(event.data===5||event.data===0)bufferingSince=0;
          if([0,1,2,5].includes(event.data)){mediaPlayback=event.data===1?'playing':event.data===0?'stopped':'paused';publishMedia();}
          if(event.data===0){finishRecord('natural');if(!powerPaused){if(networkOffline&&playIntent){holdPlayback(true);report('Клип завершён · ждём сеть перед следующим.');return;}if(repeatMode==='one')void repeatVideo(id,automatic);else if(queue.current)void advance(playIntent);}}
        },
        onError: event => { clearTimeout(timer); if (current === generation) { playerReady = false; mediaPlayback='stopped';publishMedia();enabled(false); if(networkOffline){holdPlayback();recoverPlayback();return;}if(restore?.recovery&&event.data===5){recoverPlayback();return;}report(`Ошибка YouTube ${event.data}. Проверьте доступность видео и разрешение на встраивание.`); if(isTauri()&&trackAtLoad&&/^\d+$/.test(trackAtLoad.id)&&[2,100,101,150].includes(event.data))void storage({type:'video_failed',trackId:trackAtLoad.id,videoId:id}).then(refreshVideoFavorites).catch(()=>{}); if(automatic||document.fullscreenElement) tryAlternative(sourceGeneration,ordinal); } },
        onApiChange:event=>{if(current===generation)captionControls.refresh(event.target);},
        onPlaybackQualityChange:event=>{if(current===generation)element('video-quality').textContent='Качество: '+qualityLabel(event.data);},
        onAutoplayBlocked: () => { if (current === generation) {report('YouTube заблокировал воспроизведение этого видео.');if(canSkip())tryAlternative(sourceGeneration,ordinal);} },
      },
    });
  } catch (error) { if (current === generation){report(error instanceof Error ? error.message : 'Ошибка загрузки');if(networkOffline||restore?.recovery){recoverPlayback();return;}if(canSkip())tryAlternative(sourceGeneration,ordinal);} }
}
element('play').onclick = () => systemControl('play');
element('pause').onclick = () => systemControl('pause');
function seek(delta: number) {if(!allowPlaybackChange())return;previousGesture.reset(); if(playerReady&&player)seekPlayer(Math.max(0,Math.min(player.getDuration(),player.getCurrentTime()+delta))); }
element('back').onclick = () => seek(-5);
element('forward').onclick = () => seek(5);
function updateVolume(){
  publishMedia();
  element<HTMLInputElement>('volume').value=String(volume.level);paintRange(element<HTMLInputElement>('volume'));element('mute').setAttribute('aria-pressed',String(volume.muted));setIconLabel(element('mute'),volume.muted?'muted':'volume',volume.muted?'Без звука':'Звук',true);
  if(playerReady)player?.setVolume(volume.output);
  try{localStorage.setItem(volumeKey,volume.serialize());}catch{element('storage-status').textContent='Громкость действует, но сохранить настройку не удалось.';}
}
element('volume').oninput=()=>{volume.set(Number(element<HTMLInputElement>('volume').value));updateVolume();};
element('mute').onclick=()=>{volume.toggleMute();updateVolume();};
function renderRepeat(){element('repeat').setAttribute('aria-pressed',String(repeatMode!=='off'));setIconLabel(element('repeat'),repeatMode==='one'?'repeat-one':'repeat',repeatMode==='one'?'Повтор: трек':repeatMode==='queue'?'Повтор: очередь':'Повтор: выкл.',true);}
element('repeat').onclick=()=>{repeatMode=repeatMode==='off'?'one':repeatMode==='one'&&finiteSource?'queue':'off';renderRepeat();};
function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
const seekInput = element<HTMLInputElement>('seek');
let dragging = false;
seekInput.oninput = () => {if(!allowPlaybackChange()){seekInput.value=String(player?.getCurrentTime()??0);return;} dragging = true; element('elapsed').textContent = clock(Number(seekInput.value)); seekInput.title = clock(Number(seekInput.value)); };
seekInput.onchange = () => {if(!allowPlaybackChange()){seekInput.value=String(player?.getCurrentTime()??0);dragging=false;return;} previousGesture.reset(); if(playerReady)seekPlayer(Number(seekInput.value)); dragging = false; };
const positionTimer = setInterval(() => {
  if (!playerReady || !player) { seekInput.disabled = true; return; }
  const duration = player.getDuration();
  const position = player.getCurrentTime();
  if(activeRecord?.started&&!activeRecord.endReason&&Number.isFinite(position)&&position>=0)crashRecoveryUI?.checkpoint({trackId:activeRecord.event.trackId,title:activeRecord.event.title,artist:activeRecord.event.artist,videoId:activeRecord.event.videoId,position});
  observeRecord();if(activeRecord)persistRecord(activeRecord);
  if(Number.isFinite(position)&&position>=0&&(position>0||mediaPlayback==='playing'))lastKnownPosition=position;
  if(Date.now()-lastMediaPublish>=2000)publishMedia();
  seekInput.disabled = duration <= 0;
  seekInput.max = String(duration);
  element('duration').textContent = clock(duration);
  if (!dragging) { seekInput.value = String(position); paintRange(seekInput); element('elapsed').textContent = clock(position); }
}, 500);
window.addEventListener('beforeunload', () => { finishRecord('shutdown');clearInterval(positionTimer); player?.destroy(); });

function stopPlayer(reason:EndReason='source_change') {
  playbackProgress.reset();
  preparationProgress.reset();
  finishRecord(reason);
  cancelPlaybackRecovery();
  element('video-alternatives').hidden=true;
  activeVideo=undefined;activeRecord=undefined;captionControls.reset();
  refreshVideoFavorites();
  intentUI();loadStarted=0;bufferingSince=0;
  mediaPlayback='stopped';publishMedia();
  previousGesture.reset();
  ++generation; playerReady = false; player?.destroy(); player = undefined; enabled(false);
  element('candidate-list').replaceChildren();
  element('empty').hidden = false; seekInput.disabled = true; seekInput.value = '0';
  element('elapsed').textContent = '0:00'; element('duration').textContent = '0:00';
}
function renderQueue() {
  document.dispatchEvent(new Event('track-artwork'));
  refreshFeedback();
  refreshVideoFavorites();
  element('track-title').textContent = queue.current?.title ?? 'Выберите музыку';
  element('track-artist').textContent = queue.current?.artist ?? '';
  const epoch=queue.generation,snapshot=queue.snapshot,currentIndex=snapshot.findIndex(track=>track.ordinal===queue.current?.ordinal);
  const validKeys=new Set(snapshot.map(track=>epoch+':'+track.ordinal));for(const key of skipReasons.keys())if(!validKeys.has(key))skipReasons.delete(key);
  const focused=(document.activeElement as HTMLElement|null)?.closest('#queue-list li')?.getAttribute('data-ordinal');
  element('queue-list').replaceChildren(...snapshot.map((track,index) => {
    const item=document.createElement('li');item.dataset.ordinal=String(track.ordinal);item.dataset.phase=index<currentIndex?'past':index===currentIndex?'current':'upcoming';
    const button=document.createElement('button');button.className='queue-play';setIconLabel(button,'play',track.title+' · '+track.artist);button.setAttribute('aria-label','Воспроизвести '+track.title);button.onclick=()=>jumpQueue(track.ordinal,epoch);item.append(button);
    bindPlaybackRow(item,button,{id:track.id,title:track.title+' · '+track.artist},()=>jumpQueue(track.ordinal,epoch),{iconOnly:false,queueKey:epoch+':'+track.ordinal});
    if (track.ordinal === queue.current?.ordinal) item.setAttribute('aria-current','true');
    const cause=skipReasons.get(epoch+':'+track.ordinal);if(cause)markSkipped(item,track.title+' · '+track.artist,cause);
    return item;
  }));
  if(focused!==null&&focused!==undefined)element('queue-list').querySelector<HTMLButtonElement>('[data-ordinal="'+CSS.escape(focused)+'"] button')?.focus({preventScroll:true});
  element<HTMLButtonElement>('queue-next').disabled = !queue.current;
  element<HTMLButtonElement>('previous').disabled = !queue.current && !playerReady;
  element<HTMLButtonElement>('find-video').disabled = !queue.current;
  updateQueueScroll();
}
let sourceWork:Promise<boolean>|undefined;
let startingSource=false;
let sourceNeedsFresh=false;
let currentStation='user:onyourwave';
let currentStationLabel='Все жанры';
let retryTimer:ReturnType<typeof setTimeout>|undefined;
let retryAttempt=0;
let skipStreak=0;
let currentLoadKey='',trackDeadline=0,loadStarted=0,bufferingSince=0;
function clearRetry(){clearTimeout(retryTimer);retryTimer=undefined;}
function deferWave(message:string,action:()=>void=()=>prepareAhead(),minimum=1000){
  if(!playIntent||powerPaused)return;
  if(retryTimer)return;
  const epoch=queue.generation,revision=sourceRevision;
  const delay=Math.max(minimum,Math.min(30000,1000*2**Math.min(retryAttempt++,5)));
  report(message+' · повтор через '+Math.ceil(delay/1000)+' с');
  retryTimer=setTimeout(()=>{retryTimer=undefined;if(playIntent&&!powerPaused&&epoch===queue.generation&&revision===sourceRevision)action();},delay);
}
function canSkip(){return playIntent&&!powerPaused&&!!queue.current;}
let skipQueued=false;
function skipUnavailable(message:string,technical=true){
  if(networkOffline){report('Нет сети · очередь сохранена, ждём подключения.');return;}
  if(skipQueued||retryTimer)return;
  if(technical&&queue.current){const key=queue.generation+':'+queue.current.ordinal;if(skipReasons.get(key)!==message){skipReasons.set(key,message);renderQueue();}}
  if(!canSkip()) {if(finiteSource)playIntent=false;intentUI();report(message+' · можно выбрать другой клип');element<HTMLButtonElement>('play').disabled=false;return;}
  if(historySource&&queue.current&&!excludedTracks.has(queue.current.id))unavailableHistoryTracks.add(queue.current.id);
  report(message+' · следующий трек');
  const epoch=queue.generation,track=queue.current;
  const next=()=>{if(!canSkip()||epoch!==queue.generation||track?.ordinal!==queue.current?.ordinal)return;if(track&&technical)skipReasons.set(epoch+':'+track.ordinal,message);void advance(playIntent);};
  ++skipStreak;
  if(skipStreak%12===0){deferWave('Ищем следующий доступный клип',next,5000);return;}
  skipQueued=true;
  queueMicrotask(()=>{skipQueued=false;next();});
}
function sourceFetch(fresh:boolean,autoplay=false):Promise<boolean>{
  if(!fresh&&historySource)return historyFetch(false);
  if(sourceWork)return sourceWork;
  if(!isTauri()){element('source-status').textContent='Подключите аккаунт в YCore Music для компьютера.';return Promise.resolve(false);}
  if(fresh){
    clearRetry();historyStarting=false;startingSource=true;sourceNeedsFresh=true;
    stopPlayer();queue.reset([...queue.snapshot]);choices.clear();bypassSaved.clear();
    finiteSource=false;historySource=false;activeCollection=undefined;playIntent=autoplay&&!powerPaused;
    element('source-more').textContent='Ещё рекомендации';
    ++sourceRevision;intentUI();
    currentStation=element<HTMLSelectElement>('station-select').value||'user:onyourwave';
    currentStationLabel=element<HTMLSelectElement>('station-select').selectedOptions[0]?.textContent??'Все жанры';
    if(repeatMode==='queue'){repeatMode='off';renderRepeat();}
  }
  const revision=sourceRevision,epoch=queue.generation;
  element<HTMLButtonElement>('source-start').disabled=true;element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Получение рекомендаций…';
  sourceWork=(async()=>{
    try{
      const tracks=await boundedRequest(invoke<Track[]>('source_fetch',{fresh,station:currentStation}),30000);
      if(revision!==sourceRevision||epoch!==queue.generation)return false;
      if(!Array.isArray(tracks)||!tracks.length)throw new Error('Empty recommendations');
      if(fresh){queue.reset(tracks);sourceNeedsFresh=false;choices.clear();bypassSaved.clear();element<HTMLInputElement>('url').value='';}
      else queue.append(tracks);
      renderQueue();
      const label=currentStationLabel;
      element('source-name').textContent=label==='Все жанры'?'Моя волна':'Моя волна · '+label;
      element('source-status').textContent='В очереди '+queue.ahead(20).length+' треков · клипы подбираются заранее';
      return true;
    }catch(error){
      if(revision!==sourceRevision||epoch!==queue.generation)return false;
      const text=String(error);
      const auth=/Authorization|token|credential|Credential/.test(text);
      element('source-status').textContent=auth?'Для «Моей волны» войдите в аккаунт: Настройки → Яндекс Музыка.':'Источник временно недоступен. Текущая очередь сохранена.';
      if(auth&&fresh){queue.reset([]);choices.clear();bypassSaved.clear();renderQueue();element('source-name').textContent='Моя волна · нужен вход';}
      if(!auth&&(fresh||(advancing&&!queue.hasNext))&&await historyFetch(true,playIntent,true))return true;
      if(revision!==sourceRevision||epoch!==queue.generation)return false;
      if(auth&&(fresh||!queue.current)){playIntent=false;report('Нужно подключить аккаунт Яндекса');}
      else if(playIntent){const continuation=sourceNeedsFresh?()=>void sourceFetch(true,playIntent):advancing?()=>void advance(playIntent):()=>void sourceFetch(false);deferWave('Ждём Яндекс Музыку',continuation,auth?60000:/Rate limited/.test(text)?10000:1000);}
      intentUI();
      return false;
    }finally{
      sourceWork=undefined;startingSource=false;
      element<HTMLButtonElement>('source-start').disabled=false;element<HTMLButtonElement>('source-more').disabled=!queue.current||finiteSource;
      if(!sourceNeedsFresh)prepareAhead();
    }
  })();
  return sourceWork;
}
element('source-start').onclick=()=>{if(!allowPlaybackChange())return;retryAttempt=0;powerPaused=false;void sourceFetch(true,true);};
element('source-more').onclick=()=>void sourceFetch(false);
function historyFetch(fresh:boolean,autoplay=playIntent,quiet=false):Promise<boolean>{
  if(historyWork)return historyWork;
  if(!isTauri()||(!fresh&&historyExhausted))return Promise.resolve(false);
  const epoch=queue.generation,revision=sourceRevision,requestedIntent=intentRevision;
  if(fresh&&autoplay){historyStarting=true;intentUI();}
  historyWork=(async()=>{
    try{
      const pool=await boundedRequest(invoke<SmartCandidate[]>('smart_history_fetch'),30000);
      if(epoch!==queue.generation||revision!==sourceRevision)return false;
      const tracks=historyBatch(Array.isArray(pool)?pool.filter(track=>!excludedTracks.has(track.id)&&!unavailableHistoryTracks.has(track.id)):[],fresh?queue.current?.id:queue.snapshot.at(-1)?.id);
      if(!tracks.length){historyExhausted=true;if(!quiet)report('В истории пока нет подходящих клипов.');else if(Array.isArray(pool))element('source-status').textContent+=' В истории пока нет подходящих клипов.';return false;}
      historyExhausted=false;
      if(fresh){
        const resume=autoplay&&(requestedIntent===intentRevision||playIntent)&&!powerPaused;
        stopPlayer();clearRetry();++sourceRevision;queue.reset(tracks);choices.clear();bypassSaved.clear();
        finiteSource=false;historySource=true;sourceNeedsFresh=false;activeCollection=undefined;playIntent=resume;
        if(repeatMode==='queue'){repeatMode='off';renderRepeat();}
      }else queue.append(tracks);
      renderQueue();intentUI();element('source-name').textContent='Умная история';element('source-more').textContent='Ещё из истории';
      element<HTMLButtonElement>('source-more').disabled=!!sourceWork;
      element('source-status').textContent='Клипы из вашей истории. Вернуться к рекомендациям можно кнопкой «Включить волну».';
      return true;
    }catch{if(epoch===queue.generation&&revision===sourceRevision){if(!quiet)report('Не удалось прочитать локальную историю.');if(historySource&&playIntent)deferWave('Ждём историю',advancing?()=>void advance(playIntent):()=>void historyFetch(false));}return false;}
    finally{historyWork=undefined;historyStarting=false;intentUI();if(historySource&&!startingSource)prepareAhead();}
  })();return historyWork;
}
element('history-smart').onclick=()=>{if(!allowPlaybackChange())return;powerPaused=false;unavailableHistoryTracks.clear();void historyFetch(true,true);};
element('queue-next').onclick=()=>void advance(playIntent,true);
element('find-video').onclick=()=>{
  if(!allowPlaybackChange())return;
  if(!queue.current)return;
  const track=queue.current,epoch=queue.generation,ordinal=track.ordinal;
  if(queue.generation!==epoch||queue.current?.ordinal!==ordinal)return;
  bypassSaved.add(epoch+':'+ordinal);choices.delete(epoch+':'+ordinal);queue.clearVideo(ordinal);stopPlayer();playIntent=false;prepareAhead();
};
function renderCandidates(items:Candidate[],epoch:number,ordinal:number){
  renderAlternatives(items,epoch,ordinal);
  element('candidate-list').replaceChildren(...items.map(candidate=>{
    const button=document.createElement('button');button.type='button';button.textContent=candidate.title+(candidate.byline?' · '+candidate.byline:'')+(candidate.views!=null?' · '+candidate.views.toLocaleString()+' просмотров':'')+(candidate.needsReview?' · проверить исполнителя':'');
    button.onclick=()=>{if(epoch!==queue.generation||queue.current?.ordinal!==ordinal)return;element<HTMLInputElement>('url').value=candidate.id;element<HTMLFormElement>('load').requestSubmit();};return button;
  }));
}
function renderAlternatives(items?:Candidate[],epoch=queue.generation,ordinal=queue.current?.ordinal){
  const section=element('video-alternatives'),container=element('alternative-list');
  const candidates=items??choices.get(epoch+':'+ordinal)?.items??[];
  section.hidden=!candidates.length||ordinal===undefined;
  container.replaceChildren(...candidates.slice(0,6).map(candidate=>{
    const button=document.createElement('button');button.className='alternative-video';button.type='button';button.setAttribute('aria-pressed',String(queue.current?.videoId===candidate.id));
    const image=document.createElement('img');image.src='https://i.ytimg.com/vi/'+candidate.id+'/mqdefault.jpg';image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';
    const body=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');title.textContent=candidate.title;
    const duration=candidate.durationSeconds==null?'длительность неизвестна':clock(candidate.durationSeconds);
    meta.textContent=(candidate.views==null?'просмотры неизвестны':candidate.views.toLocaleString('ru-RU')+' просмотров')+' · '+duration+(candidate.needsReview?' · проверить исполнителя':'');body.append(title,meta);button.append(image,body);
    button.onclick=()=>{
      if(!allowPlaybackChange())return;
      if(epoch!==queue.generation||ordinal!==queue.current?.ordinal)return;
      const track=queue.current;clearRetry();
      const entry=choices.get(epoch+':'+ordinal);if(entry)entry.index=entry.items.findIndex(item=>item.id===candidate.id);
      if(isTauri()&&track&&/^\d+$/.test(track.id))void storage({type:'save_video',trackId:track.id,videoId:candidate.id}).then(()=>{refreshVideoFavorites();void favoritesChanged(track.id);}).catch(()=>{element('storage-status').textContent='Этот выбор не удалось сохранить.';});
      void loadVideo(candidate.id,playIntent,true);
    };
    return button;
  }));
}
function favoriteCandidates(saved:SavedVideos,title:string,existing:Candidate[]=[]):Candidate[]{
  return saved.videos.filter(video=>!video.unavailable&&!saved.excludedVideoIds?.includes(video.videoId)).map(video=>({...existing.find(item=>item.id===video.videoId),id:video.videoId,title:existing.find(item=>item.id===video.videoId)?.title??title,score:1000,reason:video.videoId===saved.preferredVideoId?'Ваш предпочтительный клип':'Ваш избранный клип',saved:true,preferred:video.videoId===saved.preferredVideoId}));
}
async function favoritesChanged(trackId:string){
  invalidateVideoPolicy(trackId);
  unavailableHistoryTracks.delete(trackId);historyExhausted=false;
  const epoch=queue.generation;
  try{
    const saved=await savedVideos(trackId);if(epoch!==queue.generation)return;
    for(const track of queue.snapshot){if(track.id!==trackId)continue;
      const key=epoch+':'+track.ordinal,entry=choices.get(key),existing=entry?.items??[];
      const favorites=favoriteOrder(favoriteCandidates(saved,track.title,existing),lastPlayedVideos.get(track.id)),items=allowedVideos(trackId,[...favorites,...existing.filter(item=>!item.saved&&!favorites.some(saved=>saved.id===item.id))]);
      const active=track.ordinal===queue.current?.ordinal?activeVideo?.videoId:undefined;
      if(track.videoId&&videoExcluded(track.id,track.videoId))queue.clearVideo(track.ordinal);
      if(active&&videoExcluded(track.id,active))stopPlayer('video_change');
      if(!items.length){choices.delete(key);if(active)renderCandidates([],epoch,track.ordinal);continue;}
      choices.set(key,{items,index:Math.max(0,active?items.findIndex(item=>item.id===active):0),favoriteChosen:!!active,alternativesLoaded:false});
      if(track.ordinal===queue.current?.ordinal)renderCandidates(items,epoch,track.ordinal);
    }
    prepareAhead();
  }catch{element('favorite-status').textContent='Список клипов не удалось обновить.';}
}
async function repeatVideo(id:string,automatic:boolean){
  const track=queue.current,epoch=queue.generation,loadGeneration=generation;
  if(isTauri()&&track&&/^\d+$/.test(track.id)){
    try{
      const saved=await savedVideos(track.id);
      if(epoch!==queue.generation||loadGeneration!==generation||powerPaused)return;
      const key=epoch+':'+track.ordinal,existing=choices.get(key)?.items??[];
      const favorites=favoriteOrder(favoriteCandidates(saved,track.title,existing),lastPlayedVideos.get(track.id)??saved.lastVideoId);
      if(favorites.length){
        const items=allowedVideos(track.id,[...favorites,...existing.filter(item=>!item.saved&&!favorites.some(favorite=>favorite.id===item.id))]);
        choices.set(key,{items,index:0,favoriteChosen:true});
        void loadVideo(favorites[0].id,playIntent,true);return;
      }
      if(videoExcluded(track.id,id)){
        queue.clearVideo(track.ordinal);stopPlayer('video_change');choices.delete(key);prepareAhead();return;
      }
    }catch{/* Keep the current working video when local favorites cannot be read. */}
  }
  if(epoch===queue.generation&&loadGeneration===generation&&!powerPaused)void loadVideo(id,playIntent,automatic);
}
function ensureAlternatives(){
  if(!isTauri())return;
  const track=queue.current,epoch=queue.generation;if(!track)return;
  const key=epoch+':'+track.ordinal;
  let entry=choices.get(key);
  if(!entry&&track.videoId){entry={items:[{id:track.videoId,title:track.title,score:0,reason:'Текущее видео'}],index:0};choices.set(key,entry);}
  const work='alt:'+key;
  // Keep a slot available for the current track rather than filling all three
  // workers with optional alternative-video metadata.
  if(!entry||entry.alternativesLoaded||searching.size>=2||searching.has(work))return;
  entry.alternativesLoaded=true;searching.add(work);
  const captured=entry;
  void boundedRequest(invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist})).then(found=>{
    if(epoch!==queue.generation||choices.get(key)!==captured||!Array.isArray(found))return;
    const favorites=captured.items.filter(item=>item.saved||item.historical).map(saved=>{const metadata=found.find(item=>item.id===saved.id);return {...metadata,...saved,title:metadata?.title??saved.title,views:metadata?.views,durationSeconds:metadata?.durationSeconds};});
    captured.items=allowedVideos(track.id,[...favorites,...found.filter(item=>!favorites.some(saved=>saved.id===item.id))]);
    const active=queue.current?.ordinal===track.ordinal?activeVideo?.videoId:track.videoId;if(active)captured.index=captured.items.findIndex(item=>item.id===active);
    if(queue.current?.ordinal===track.ordinal)renderCandidates(captured.items,epoch,track.ordinal);
  }).catch(()=>{}).finally(()=>{searching.delete(work);prepareAhead();});
}
function tryAlternative(epoch:number,ordinal:number|undefined){
  queueMicrotask(()=>{
    if(epoch!==queue.generation||ordinal!==queue.current?.ordinal)return;
    if(networkOffline){holdPlayback();report('Нет сети · сохраняем трек и позицию, ждём подключения.');return;}
    finishRecord('error');
    queue.clearVideo(ordinal!);const key=epoch+':'+ordinal,entry=choices.get(key);
    if(entry){
      ++entry.index;
      while(entry.items[entry.index]?.needsReview&&canSkip())++entry.index;
      const candidate=entry.items[entry.index];
      if(candidate && (entry.index<3||!canSkip()) && (!canSkip()||Date.now()<trackDeadline)){
        if(candidate.needsReview){playIntent=false;stopPlayer();renderCandidates(entry.items,epoch,ordinal!);report('Выберите подходящий клип из списка.');}
        else void loadVideo(candidate.id,playIntent,true);
        return;
      }
      if((entry.items[0]?.saved||entry.items[0]?.historical)&&!bypassSaved.has(key)){bypassSaved.add(key);choices.delete(key);stopPlayer();prepareAhead();return;}
    }
    stopPlayer();skipUnavailable('YouTube не воспроизвёл доступные варианты клипа. Точная причина ограничения не подтверждена.');
  });
}
const searchErrors=new Map<string,number>();
const searchAttempts=new Map<string,number>();
const matchJobs=new Map<string,Promise<Candidate[]>>();
function boundedRequest<T>(job:Promise<T>,timeout=20000):Promise<T>{
  return new Promise((resolve,reject)=>{
    // Native metadata requests have a 15-second budget; allow IPC/storage overhead.
    const timer=setTimeout(()=>reject(new Error('Playback request timed out')),timeout);
    job.then(resolve,reject).finally(()=>clearTimeout(timer));
  });
}
function prepareAhead(){
  intentUI();
  if(!isTauri()||startingSource||sourceNeedsFresh||!queue.current||networkOffline)return;
  if(!activeVideo&&playIntent&&!retryTimer)report('Подбор клипа…');
  if(!finiteSource&&playIntent&&(excludedTracks.has(queue.current.id)||(historySource&&unavailableHistoryTracks.has(queue.current.id)))){skipUnavailable('Трек сейчас недоступен для этой подборки',!excludedTracks.has(queue.current.id));return;}
  const epoch=queue.generation;
  ensureAlternatives();
  for(const track of queue.ahead(finiteSource?3:8)){
    const key=epoch+':'+track.ordinal;
    if(track.videoId){if(track.ordinal===queue.current?.ordinal&&!activeVideo&&!advancing)void loadVideo(track.videoId,playIntent,true);continue;}
    const cached=choices.get(key);
    if(cached){
      if(track.ordinal!==queue.current?.ordinal)continue;
      if(!cached.favoriteChosen&&cached.items.some(item=>item.saved)){
        cached.items=[...favoriteOrder(cached.items.filter(item=>item.saved),lastPlayedVideos.get(track.id)),...cached.items.filter(item=>!item.saved)];cached.index=0;cached.favoriteChosen=true;
      }
      let candidate=cached.items[cached.index];
      if(canSkip()){while(candidate?.needsReview){++cached.index;candidate=cached.items[cached.index];}}
      if(candidate){
        renderCandidates(cached.items,epoch,track.ordinal);
        if(candidate.needsReview){element<HTMLButtonElement>('play').disabled=false;report('Исполнитель не подтверждён. В волне этот трек будет пропущен после Play.');}
        else void loadVideo(candidate.id,playIntent,true);
      }else skipUnavailable(cached.items.some(item=>item.needsReview)?'Не удалось уверенно сопоставить клип с треком.':'Подходящий клип не найден.');
      continue;
    }
    if(searchErrors.has(key)){
      if(track.ordinal===queue.current?.ordinal&&canSkip()){
        if((searchAttempts.get(key)??0)>=2)skipUnavailable('Не удалось подобрать клип: поиск видео недоступен.');
        else deferWave('Поиск видео временно недоступен',()=>{searchErrors.delete(key);prepareAhead();},3000);
      }
      continue;
    }
    if(searching.has(key)||searching.size>=3)continue;
    searching.add(key);
    const policyVersion=videoPolicyVersion(track.id),matchKey=track.id+'|'+track.title+'|'+track.artist+'|'+(track.historyVideoId??'')+'|'+policyVersion;
    let job=matchJobs.get(matchKey);
    if(!job){job=boundedRequest((async()=>{
      if(/^\d+$/.test(track.id)){
        try{const saved=await savedVideos(track.id);if(!lastPlayedVideos.has(track.id)&&saved.lastVideoId)lastPlayedVideos.set(track.id,saved.lastVideoId);const favorites=favoriteCandidates(saved,track.title);if(favorites.length&&!bypassSaved.has(key))return favorites;}catch{/* Retain the last known local exclusions if storage cannot be read. */}
      }
      if(track.historyVideoId&&!bypassSaved.has(key)&&!videoExcluded(track.id,track.historyVideoId))return [{id:track.historyVideoId,title:track.title,score:100,reason:'Клип из вашей истории',historical:true}];
      if(!track.title.trim()||!track.artist.trim())return [];
      return allowedVideos(track.id,await invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist}));
    })());matchJobs.set(matchKey,job);void job.finally(()=>matchJobs.delete(matchKey)).catch(()=>{});}
    void job.then(items=>{
      if(epoch!==queue.generation||policyVersion!==videoPolicyVersion(track.id))return;
      searchErrors.delete(key);searchAttempts.delete(key);
      choices.set(key,{items:Array.isArray(items)?items:[],index:0,alternativesLoaded:!items?.some(item=>item.saved||item.historical)});
    }).catch(()=>{if(epoch===queue.generation){searchErrors.set(key,Date.now());searchAttempts.set(key,(searchAttempts.get(key)??0)+1);}}).finally(()=>{
      searching.delete(key);
      if(epoch===queue.generation)prepareAhead();
      else if(queue.current)prepareAhead();
    });
  }
  if(!finiteSource&&playIntent&&queue.ahead(10).length<8&&!sourceWork&&!historyWork&&!retryTimer){if(historySource){if(!historyExhausted)void historyFetch(false);}else void sourceFetch(false);}
}
let advancing=false,advanceOwner=0,queueNavigation=0;
function cancelQueueAdvance(){++queueNavigation;++advanceOwner;advancing=false;clearRetry();}
function jumpQueue(ordinal:number,epoch:number){
  if(!allowPlaybackChange())return;
  if(startingSource||historyStarting){report('Очередь обновляется. Выберите трек после загрузки.');return;}
  if(epoch!==queue.generation)return;
  if(ordinal===queue.current?.ordinal){cancelQueueAdvance();systemControl('play');return;}
  if(!queue.select(ordinal,epoch))return;
  cancelQueueAdvance();sourceNeedsFresh=false;powerPaused=false;playIntent=true;
  stopPlayer('skip');renderQueue();element<HTMLInputElement>('url').value='';intentUI();
  if(queue.current?.videoId)void loadVideo(queue.current.videoId,true,!finiteSource);else prepareAhead();
}
async function advance(resume:boolean,explicit=false,reason?:EndReason){
  if(explicit&&!allowPlaybackChange())return;
  if(networkOffline&&!explicit){holdPlayback(true);report('Нет сети · очередь сохранена, ждём подключения.');return;}
  if(advancing||!queue.current||startingSource)return;
  advancing=true;previousGesture.reset();playIntent=resume&&!powerPaused;
  const epoch=queue.generation,navigation=queueNavigation,owner=++advanceOwner;
  let wrapped=false;
  try{
    if(!queue.hasNext&&finiteSource&&repeatMode==='queue'&&!activeCollection?.hasMore){queue.rewind();wrapped=true;}
    else if(!queue.hasNext){
      if(finiteSource){
        if(!activeCollection?.hasMore){finishRecord(reason??(explicit?'skip':'error'));playIntent=false;player?.pauseVideo();report('Конец выбранного списка.');return;}
        try{const context=activeCollection,page=await boundedRequest(collectionPage(context.entity,context.page+1),30000);if(epoch!==queue.generation)return;queue.append(page.tracks);activeCollection={...context,page:page.page,hasMore:page.hasMore};if(navigation!==queueNavigation)return;if(!page.tracks.length){if(repeatMode==='queue'){queue.rewind();wrapped=true;}else{playIntent=false;player?.pauseVideo();report('Больше треков в списке нет.');return;}}}
        catch{if(navigation!==queueNavigation||epoch!==queue.generation)return;deferWave('Не удалось загрузить следующую часть списка',()=>void advance(playIntent));return;}
      }else{
        const received=await (historySource?historyFetch(false):sourceFetch(false));
        if(epoch!==queue.generation||navigation!==queueNavigation)return;
        if(!received){if(historySource&&historyExhausted){playIntent=false;player?.pauseVideo();report('В истории больше нет подходящих клипов.');return;}deferWave('Ждём следующую подборку',()=>void advance(playIntent));return;}
      }
    }
    if(!wrapped&&!queue.next()){if(!finiteSource)deferWave('Ждём следующую подборку',()=>void advance(playIntent));else playIntent=false;return;}
    stopPlayer(reason??(explicit?'skip':'error'));element<HTMLButtonElement>('pause').disabled=!playIntent;element<HTMLInputElement>('url').value='';
    if(!finiteSource){queue.trimPast(50);const valid=new Set(queue.snapshot.map(track=>queue.generation+':'+track.ordinal));for(const key of choices.keys())if(!valid.has(key))choices.delete(key);for(const key of searchErrors.keys())if(!valid.has(key))searchErrors.delete(key);for(const key of searchAttempts.keys())if(!valid.has(key))searchAttempts.delete(key);}
    renderQueue();if(queue.current.videoId)void loadVideo(queue.current.videoId,playIntent);
    else prepareAhead();
  }finally{if(owner===advanceOwner){advancing=false;intentUI();if(playIntent&&!activeVideo)queueMicrotask(()=>prepareAhead());}}
}

let compact=false, topmost=false, changingWindow=false;
element('mini').onclick=async()=>{
  if(changingWindow) return;
  changingWindow=true;
  try {
    if(isTauri()) await invoke('window_mini',{compact:!compact});
    compact=!compact; document.body.classList.toggle('compact',compact);
    document.dispatchEvent(new Event('window-layout-change'));
    setIconLabel(element('mini'),'mini',compact?'Полный вид':'Миниплеер');
    element('mini').setAttribute('aria-pressed',String(compact));
  } catch { report('Не удалось изменить размер окна.'); }
  finally { changingWindow=false; }
};
element('topmost').onclick=async()=>{
  if(!isTauri()) {report('Поверх окон доступно только в desktop-версии.');return;}
  if(changingWindow) return;
  changingWindow=true;
  try {await invoke('window_topmost',{enabled:!topmost});topmost=!topmost;element('topmost').setAttribute('aria-pressed',String(topmost));}
  catch {report('Оконный менеджер не разрешил режим поверх окон.');}
  finally {changingWindow=false;}
};

if (isTauri()) void sourceFetch(true);

function enqueueHistory(entry:HistoryEntry,next:boolean){
  if(!allowPlaybackChange())return;
  const detached=!queue.current;
  if(detached){
    ++sourceRevision;finiteSource=true;historySource=false;activeCollection=undefined;
    queue.reset(activeVideo?[activeVideo]:[]);choices.clear();bypassSaved.clear();
    if(!activeVideo)playIntent=false;
  }
  const track:QueueInput={id:entry.trackId,title:entry.title,artist:entry.artist,videoId:entry.videoId,playbackSource:'history'};
  if(next)queue.insertNext([track]);else queue.append([track]);
  renderQueue();
  element<HTMLButtonElement>('source-more').disabled=finiteSource;
  element('history-status').textContent=next?'Добавлено следующим треком.':'Добавлено в конец очереди.';
  if(detached&&!activeVideo)void loadVideo(entry.videoId,false);
  else prepareAhead();
}
mountHistory(entry=>{
  if(!allowPlaybackChange())return;
  stopPlayer();queue.reset([{id:entry.trackId,title:entry.title,artist:entry.artist,playbackSource:'history'}]);finiteSource=true;historySource=false;activeCollection=undefined;++sourceRevision;choices.clear();bypassSaved.clear();renderQueue();element<HTMLButtonElement>('source-more').disabled=true;
  element('source-name').textContent='История';element('source-status').textContent='История · для возврата выберите новую сессию Моей волны.';
  powerPaused=false;void loadVideo(entry.videoId,true);
},enqueueHistory,()=>historyWriter);

const selectCatalogue:Parameters<typeof mountCatalogue>[0]=selection=>{
  if(!allowPlaybackChange())return;
  if(!selection.tracks.length)return;
  stopPlayer();++sourceRevision;queue.reset(selection.tracks);choices.clear();bypassSaved.clear();
  clearRetry();historyStarting=false;sourceNeedsFresh=false;finiteSource=true;historySource=false;activeCollection=selection.collection;powerPaused=false;playIntent=true;renderQueue();
  element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Яндекс Музыка · '+selection.title;element('source-name').textContent=selection.title;
  element<HTMLInputElement>('url').value='';prepareAhead();
};
const browseCatalogue=mountCatalogue(selectCatalogue);
mountDiscovery(selectCatalogue,entity=>{showPanel('search');browseCatalogue(entity,()=>showPanel('discovery'));});
mountLibrary(selectCatalogue);

element('previous').onclick=()=>{
  if(!allowPlaybackChange())return;
  cancelQueueAdvance();
  if(previousGesture.press(performance.now())==='restart'){
    if(playerReady)seekPlayer(0);
    return;
  }
  if(!queue.previous())return;
  stopPlayer();renderQueue();element<HTMLInputElement>('url').value='';
  if(queue.current?.videoId)void loadVideo(queue.current.videoId,playIntent);
  else prepareAhead();
};

function systemControl(action:string){
  if(updatesInstalling())return;
  if(action==='play'||action==='pause'){intentRevision++;playbackProgress.reset();preparationProgress.reset();}
  switch(action){
    case 'toggle':systemControl(playIntent?'pause':'play');break;
    case 'play':powerPaused=false;playIntent=true;cancelPlaybackRecovery(false);clearRetry();if(playbackRecovery){recoverPlayback(true);break;}if(!finiteSource&&queue.current&&excludedTracks.has(queue.current.id)){prepareAhead();break;}if(sourceNeedsFresh)void sourceFetch(true,true);else if(playerReady)player?.playVideo();else if(activeVideo?.videoId&&queue.current?.videoId)void loadVideo(activeVideo.videoId,true,activeAutomatic);else{element<HTMLButtonElement>('pause').disabled=false;prepareAhead();}break;
    case 'pause':historyStarting=false;playIntent=false;cancelPlaybackRecovery(false);clearRetry();player?.pauseVideo();if(queue.current)element<HTMLButtonElement>('play').disabled=false;break;
    case 'next':void advance(playIntent,true);break;
    case 'previous':element('previous').click();break;
  }
  intentUI();
}
function powerPause(resume:boolean){
  observeRecord(false);if(activeRecord)persistRecord(activeRecord,true);
  powerPaused=true;historyStarting=false;playIntent=false;cancelPlaybackRecovery(false);clearRetry();intentUI();
  if(!resume)suspendPosition=playerReady?player?.getCurrentTime():undefined;
  player?.pauseVideo();
  if(resume && suspendPosition!==undefined && playerReady)seekPlayer(suspendPosition);
  if(resume)suspendPosition=undefined;
  mediaPlayback='paused';publishMedia();
  report(resume?'После сна · пауза. Нажмите Play, чтобы продолжить.':'Переход в сон · пауза.');
}
if(isTauri()){
  void listen('power-monitor://suspend',()=>powerPause(false)).catch(()=>{});
  void listen('power-monitor://resume',()=>powerPause(true)).catch(()=>{});
  void listen<{action:string,value:number}>('encore-media',event=>{
    const {action,value}=event.payload;
    if(action==='seek')seek(value);
    else if(action==='position' && playerReady&&player&&allowPlaybackChange()){previousGesture.reset();seekPlayer(Math.max(0,Math.min(player.getDuration(),value)));}
    else if(action==='volume'){volume.set(Math.round(value*100));updateVolume();}
    else systemControl(action);
  }).catch(()=>{});
  publishMedia();
  void listen<string>('encore-control',event=>systemControl(event.payload)).catch(()=>{element('storage-status').textContent='Управление из трея пока недоступно.';});
  void invoke<{tray_available:boolean}>('desktop_status').then(status=>{
    if(status)element('storage-status').textContent=status.tray_available?'Крестик скрывает YCore Music в трей. Выход — через меню значка.':'Трей недоступен. Закрытие окна завершит приложение.';
  }).catch(()=>{});
}


// Local to this WebView: typing and native control keys keep their normal behavior.
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  if(event.target instanceof Element && event.target.closest('input,textarea,select,button,a,summary,[role="button"],[contenteditable]:not([contenteditable="false"]),dialog'))return;
  if(event.code==='Space'){
    if(!playerReady || event.repeat)return;
    event.preventDefault();systemControl('toggle');
  }else if(playerReady && (event.key==='ArrowLeft'||event.key==='ArrowRight')){
    event.preventDefault();seek(event.key==='ArrowLeft'?-5:5);
  }else if(event.key==='ArrowUp'||event.key==='ArrowDown'){
    event.preventDefault();volume.set(volume.level+(event.key==='ArrowUp'?5:-5));updateVolume();
  }else if(event.key==='F11'&&!event.repeat){
    event.preventDefault();void toggleFullscreen();
  }
});


element('youtube-settings').onclick=()=>{
  if(!allowPlaybackChange())return;
  if(!playerReady||!activeVideo?.videoId)return;
  if(windowLayout.layout()==='spectrum'){
    if(document.fullscreenElement)return;
    const select=element<HTMLSelectElement>('window-layout');select.value='video';select.dispatchEvent(new Event('change'));
  }
  const position=player?.getCurrentTime()??0,record=activeRecord;
  youtubeControls=!youtubeControls;
  element('player-options-status').textContent=youtubeControls?'Для ручного качества нужна шестерёнка YouTube. После скрытия панели выбранное качество может сброситься.':'';
  void loadVideo(activeVideo.videoId,playIntent,activeAutomatic,{position,record});
};
async function toggleFullscreen(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector<HTMLElement>('.workspace')!.requestFullscreen();}
  catch{element('player-options-status').textContent='Полноэкранный режим недоступен.';}
}
element('fullscreen').onclick=()=>void toggleFullscreen();
document.addEventListener('fullscreenchange',()=>{
  setIconLabel(element('fullscreen'),document.fullscreenElement?'shrink':'fullscreen',document.fullscreenElement?'Выйти из полного экрана':'На весь экран',true);
  element('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement));
});

function observeReaction(detail:{trackId:string;state:number;pending?:boolean},observed=false){
  if(!detail?.trackId||(observed&&pendingReactionStates.has(detail.trackId)))return;
  if(!observed){if(detail.pending)pendingReactionStates.set(detail.trackId,detail.state);else pendingReactionStates.delete(detail.trackId);}
  if(detail.state===-1)excludedTracks.add(detail.trackId);else{excludedTracks.delete(detail.trackId);if(!observed)unavailableHistoryTracks.delete(detail.trackId);}
  historyExhausted=false;if(!finiteSource)prepareAhead();
}
window.addEventListener('feedback-changed',event=>observeReaction((event as CustomEvent).detail));
window.addEventListener('feedback-observed',event=>observeReaction((event as CustomEvent).detail,true));
window.addEventListener('feedback-snapshot',event=>{
  const values=(event as CustomEvent<{excluded:string[]}>).detail.excluded;excludedTracks.clear();for(const id of values)excludedTracks.add(id);
  for(const [id,state] of pendingReactionStates){if(state===-1)excludedTracks.add(id);else excludedTracks.delete(id);}
  historyExhausted=false;if(!finiteSource)prepareAhead();
});
refreshFeedback=mountFeedback(()=>queue.current,()=>void advance(playIntent,true,'dislike'));
refreshVideoFavorites=mountVideoFavorites(()=>queue.current?{trackId:queue.current.id,videoId:activeVideo?.id===queue.current.id?activeVideo.videoId:undefined,key:queue.generation+':'+queue.current.ordinal}:undefined,id=>void loadVideo(id,playIntent,true),id=>void favoritesChanged(id),id=>choices.get(queue.generation+':'+queue.current?.ordinal)?.items.find(item=>item.id===id)?.title);
const updateAccountConnection=mountAuth(()=>window.location.reload());
mountDiagnostics(state=>{updateAccountConnection(state);if(state==='saved'||state==='connected')scheduleWaveSync();});
mountAutostart();
mountUpdates(()=>playIntent||historyStarting,()=>{powerPause(false);hideYouTubePanel();});
mountSleepTimer(()=>{powerPause(false);report('Таймер сна завершён · пауза. Нажмите Play, чтобы продолжить.');});
function hideYouTubePanel(){if(!youtubeControls)return;youtubeControls=false;element('youtube-settings').setAttribute('aria-pressed','false');element('youtube-settings').textContent='Панель YouTube';element('player-options-status').textContent='';document.querySelector('.screen')!.classList.remove('interactive');if(isTauri())void invoke('player_host_presentation',{interactive:false}).catch(()=>{});intentUI();}
mountPlaybackGuard(hideYouTubePanel);
mountShellNavigation();
mountSupport(()=>playIntent||historyStarting||updatesInstalling());
mountVisualControls();
const windowLayout=mountWindowLayout();
const mainSpectrum=mountMainSpectrum(document.querySelector<HTMLElement>('.screen')!,()=>windowLayout.layout(),()=>queue.current?.coverUrl);
document.addEventListener('window-layout-mode',event=>{
  if((event as CustomEvent<string>).detail==='spectrum'&&youtubeControls){
    // The real source is made transparent without reloading it. Returning to
    // video keeps its position and the sole player generation intact.
    youtubeControls=false;element('youtube-settings').setAttribute('aria-pressed','false');
    element('youtube-settings').textContent='Панель YouTube';element('player-options-status').textContent='';
    document.querySelector('.screen')!.classList.remove('interactive');
    if(isTauri())void invoke('player_host_presentation',{interactive:false}).catch(()=>{});
  }
});
void mountVideoMirror(document.querySelector<HTMLElement>('.screen')!,()=>[cueBrand.element,...document.querySelectorAll<HTMLDialogElement>('dialog[open]'),...(document.fullscreenElement&&document.querySelector('.workspace.hud-visible')?[document.querySelector<HTMLElement>('.player-hud')!]:[])],()=>!!element('empty').hidden&&!mainSpectrum.isActive());
document.addEventListener('player-host-panel-closed',()=>{if(youtubeControls)element('youtube-settings').click();});
mountScenes(()=>({generation,videoId:playerReady?activeVideo?.videoId??null:null,title:mediaTitle,artist:mediaArtist,position:playerReady?player?.getCurrentTime()??0:0,duration:playerReady?player?.getDuration()??0:0,playback:playerReady?scenePlayback:-1,coverUrl:queue.current?.coverUrl,locked:playbackLocked()||undefined}));
updateQueueScroll=mountQueueScroll({eligible:()=>!finiteSource&&!historySource&&!sourceNeedsFresh&&!startingSource&&!!queue.current,generation:()=>queue.generation,count:()=>queue.snapshot.length,ahead:()=>queue.ahead(501).length,load:()=>sourceFetch(false)});
mountFullscreenControls(document.querySelector<HTMLElement>('.workspace')!,document.querySelector<HTMLElement>('.player-hud')!);
crashRecoveryUI=mountCrashRecovery(snapshot=>{
 cancelQueueAdvance();stopPlayer();++sourceRevision;startingSource=false;sourceNeedsFresh=false;historyStarting=false;finiteSource=true;historySource=false;activeCollection=undefined;
 queue.reset([{id:snapshot.trackId,title:snapshot.title,artist:snapshot.artist,videoId:snapshot.videoId,playbackSource:'history'}]);choices.clear();bypassSaved.clear();renderQueue();
 element('source-name').textContent='Продолжение после сбоя';element('source-status').textContent='Восстановлен один клип. Для новой подборки включите «Мою волну».';element<HTMLButtonElement>('source-more').disabled=true;
 powerPaused=false;void loadVideo(snapshot.videoId,true,false,{position:snapshot.position});
});

const streamWatchdog=setInterval(()=>{
 if(!playIntent||powerPaused||networkOffline||playbackRetry){playbackProgress.reset();preparationProgress.reset();return;}
 if(preparationProgress.stalled(queue.current?.ordinal??NaN,performance.now(),!activeVideo&&!startingSource&&!sourceNeedsFresh&&!advancing&&canSkip())){
  preparationProgress.reset();clearRetry();skipUnavailable('Подбор клипа не завершился вовремя.');return;
 }
 if(playbackProgress.stalled(player?.getCurrentTime()??NaN,performance.now(),playerReady&&scenePlayback===1)){
  playbackProgress.reset();report('Видео не продвигается · пробуем другой клип.');
  if(canSkip())tryAlternative(queue.generation,queue.current?.ordinal);else recoverPlayback();
  return;
 }
 if(canSkip() && loadStarted && Date.now()-loadStarted>15000){loadStarted=0;tryAlternative(queue.generation,queue.current?.ordinal);return;}
 if(bufferingSince && Date.now()-bufferingSince>15000){bufferingSince=0;recoverPlayback();}
 if(!startingSource)prepareAhead();
},1000);
window.addEventListener('offline',()=>{networkOffline=true;cancelPlaybackRecovery(false);clearRetry();if(bufferingSince||(!playerReady&&activeVideo))holdPlayback();});
window.addEventListener('online',()=>{
  networkOffline=false;
  if(!playIntent||powerPaused)return;
  if(playbackRecovery){recoverPlayback(true);return;}
  if(!activeVideo){searchErrors.delete(queue.generation+':'+queue.current?.ordinal);prepareAhead();}
});
window.addEventListener('beforeunload',()=>{clearInterval(streamWatchdog);cancelPlaybackRecovery();clearRetry();});
if(isTauri())void invoke<{id:string,title:string}[]>('source_stations').then(stations=>{
 if(!Array.isArray(stations))return;const select=element<HTMLSelectElement>('station-select');
 for(const station of stations){const option=new Option(station.title,station.id);select.append(option);}
}).catch(()=>{});
