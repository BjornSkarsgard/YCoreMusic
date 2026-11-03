import './style.css';
import { videoId } from './video-id';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import { PlaybackQueue, type Track, type QueueInput } from './queue';
import { storage, type HistoryEntry } from './storage';
import {mountCatalogue,collectionPage,type CollectionContext} from './catalogue-ui';
import {PreviousGesture,VolumeState} from './playback-controls';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand">encore<span>●</span></a><div class="window-actions"><button id="mini" aria-pressed="false">Миниплеер</button><button id="topmost" aria-pressed="false">Поверх окон</button><span class="badge">ЭТАП 0 · ЛАБОРАТОРИЯ</span></div></header>
<main><section class="intro"><p class="eyebrow">МУЗЫКА ПОЛУЧАЕТ ЭКРАН</p><h1>Ещё одну.</h1><p>Первый шаг к вашему музыкальному телеканалу.<br>Проверяем воспроизведение, прежде чем строить эфир.</p></section>
<details class="catalogue-panel" open><summary>Поиск в Яндекс Музыке</summary><section id="catalogue"></section></details><section class="source-panel"><div class="source-actions"><button id="source-start">Моя волна · новая сессия</button><button id="source-more" disabled>Ещё рекомендации</button><button id="find-video" disabled>Подобрать заново</button></div><p id="source-status" role="status">Яндекс доступен в desktop-версии после локального подключения аккаунта.</p><h2 id="track-title">Ручная проверка видео</h2><p id="track-artist"></p><details><summary>Очередь</summary><ol id="queue-list"></ol></details></section><p id="storage-status" role="status"></p><section class="workspace"><div class="screen"><div id="player"></div><div id="empty"><span>▶</span><h2>Начнём с одного клипа</h2><p>Вставьте YouTube-ссылку. Музыка начнётся только по Play.</p></div></div>
<form id="load"><label for="url">YouTube-ссылка или ID</label><div class="input-row"><input id="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" required><button>Подготовить</button></div></form>
<div class="controls"><button id="previous" aria-label="Предыдущий трек" title="В начало; повторно за 3 секунды — предыдущий трек" disabled>⏮</button><button id="play" disabled>▶ Play</button><button id="pause" disabled>Ⅱ Пауза</button><button id="queue-next" aria-label="Следующий трек" disabled>⏭</button><button id="repeat" aria-pressed="false">Повтор: выкл.</button><button id="mute" aria-pressed="false">Звук</button><button id="back" disabled>−5 с</button><button id="forward" disabled>+5 с</button><label>Громкость <input id="volume" type="range" min="0" max="100" value="50"></label></div>
<div class="timeline"><output id="elapsed">0:00</output><input id="seek" aria-label="Позиция видео" type="range" min="0" max="0" value="0" step="1" disabled><output id="duration">0:00</output></div><div id="candidate-list" aria-label="Найденные клипы"></div><p id="status" role="status" aria-live="polite">Ожидание ссылки · без autoplay</p></section>
<aside><div><span class="dot"></span> Одна сцена · один плеер</div><p>Прототип использует системный аудиовыход. Аудиовыходом управляет ОС. Анализ звука ещё не реализован. Автоподбор экспериментальный; при несовпадении замените ссылку вручную.</p><details id="history-panel"><summary>История прослушивания</summary><div class="history-actions"><input id="history-query" aria-label="Поиск в истории" placeholder="Название или исполнитель"><button id="history-refresh">Обновить</button><button id="history-clear">Очистить историю</button></div><p id="history-status" role="status"></p><ol id="history-list"></ol></details><dialog id="clear-dialog"><p>Удалить всю историю прослушивания? Ручные ссылки сохранятся.</p><button id="clear-cancel">Отмена</button><button id="clear-confirm">Удалить историю</button></dialog><details><summary>Журнал проверки</summary><pre id="log"></pre></details></aside></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queue = new PlaybackQueue();
let player: YT.Player | undefined;
let generation = 0;
let playerReady = false;
let activeVideo:QueueInput|undefined;
let apiPromise: Promise<void> | undefined;
let playIntent=false;
let powerPaused=false;
let suspendPosition:number|undefined;
let mediaRevision=Date.now()*1000;
let mediaPlayback:'stopped'|'paused'|'playing'='stopped';
let mediaTitle='Encore',mediaArtist='';
let lastMediaPublish=0;
function publishMedia(){
  if(!isTauri())return;
  lastMediaPublish=Date.now();
  void invoke('media_update',{update:{revision:++mediaRevision,title:mediaTitle,artist:mediaArtist,playback:mediaPlayback,position:playerReady?player?.getCurrentTime()??0:0,duration:playerReady?player?.getDuration()??0:0,volume:volume.output/100}}).catch(()=>{});
}
let finiteSource=false;
let activeCollection:CollectionContext|undefined;
interface Candidate {id:string;title:string;byline?:string;artist?:string;score:number;views?:number;reason:string;saved?:boolean;needsReview?:boolean}
const choices=new Map<string,{items:Candidate[];index:number}>();
const searching=new Set<string>();
const bypassSaved=new Set<string>();
let sourceRevision=0;
const previousGesture=new PreviousGesture();
const volumeKey='encore.volume.v1';
let volume:VolumeState;
try{volume=VolumeState.restore(localStorage.getItem(volumeKey));}catch{volume=new VolumeState();}
element<HTMLInputElement>('volume').value=String(volume.level);
element('mute').setAttribute('aria-pressed',String(volume.muted));
element('mute').textContent=volume.muted?'Без звука':'Звук';
let repeatOne=false;
function report(message: string) {
  element('status').textContent = message;
  const log = element('log');
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 6000);
}
function enabled(value: boolean) {
  for (const id of ['play', 'pause', 'back', 'forward']) element<HTMLButtonElement>(id).disabled = !value;
}
function api(): Promise<void> {
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
  const id=videoId(element<HTMLInputElement>('url').value);
  if(!id){report('Нужна HTTPS-ссылка YouTube или video ID из 11 символов.');return;}
  const track=queue.current;
  if(isTauri() && track && /^\d+$/.test(track.id)) void storage({type:'save_video',trackId:track.id,videoId:id}).then(()=>{element('storage-status').textContent='Ручной клип сохранён для этого трека.';}).catch(()=>{element('storage-status').textContent='Не удалось сохранить ручной клип. Текущий выбор действует только до перезапуска.';});
  void loadVideo(id);
});
async function loadVideo(id:string,resume=false,automatic=false) {
  previousGesture.reset();
  element<HTMLButtonElement>('previous').disabled=false;
  const sourceGeneration=queue.generation, ordinal=queue.current?.ordinal;
  if(ordinal!==undefined) queue.resolve(ordinal,id,sourceGeneration);
  playIntent=resume;
  const trackAtLoad=queue.current;
  mediaTitle=trackAtLoad?.title??'YouTube · '+id;mediaArtist=trackAtLoad?.artist??'';
  activeVideo={id:trackAtLoad?.id??'manual:'+id,title:mediaTitle,artist:mediaArtist,videoId:id};
  mediaPlayback='stopped';publishMedia();
  const playEvent={playbackId:Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join(''),trackId:trackAtLoad?.id ?? 'manual:'+id,title:trackAtLoad?.title ?? 'YouTube · '+id,artist:trackAtLoad?.artist ?? '',videoId:id};
  let recorded=false,recordPending=false;
  const current = ++generation;
  enabled(false);
  if(resume) element<HTMLButtonElement>('pause').disabled=false;
  playerReady = false;
  player?.destroy(); player = undefined;
  element('empty').hidden = false;
  report('Загрузка YouTube API…');
  try {
    await api();
    if (current !== generation) return;
    let ready = false;
    const timer = setTimeout(() => {
      if (current === generation && !ready) { ++generation; enabled(false); playerReady = false; player?.destroy(); player = undefined; report('Видео не подготовилось за 20 секунд. Проверьте сеть и повторите загрузку.'); if(automatic) tryAlternative(sourceGeneration,ordinal); }
    }, 20000);
    if (!document.getElementById('player')) { const mount = document.createElement('div'); mount.id = 'player'; document.querySelector('.screen')!.prepend(mount); }
    player = new YT.Player('player', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 0, playsinline: 1, origin: location.origin },
      events: {
        onReady: event => {
          if (current !== generation) return;
          playerReady = true;
          event.target.setVolume(volume.output);
          element('empty').hidden = true;
          report('Подготовка видео…');
          event.target.cueVideoById(id);
        },
        onStateChange: event => {
          if (current !== generation) return;
          const states: Record<number, string> = { '-1': 'Видео загружено', 0: 'Видео завершено', 1: 'Воспроизведение', 2: 'Пауза', 3: 'Буферизация', 5: 'Готово · без autoplay' };
          report(states[event.data] ?? `Состояние ${event.data}`);
          if (event.data === 5) { ready = true; clearTimeout(timer); enabled(true); if(playIntent) event.target.playVideo(); }
          if(event.data===1) {
            if(powerPaused){playIntent=false;event.target.pauseVideo();return;}
            playIntent=true;
            if(isTauri() && !recorded && !recordPending) {
              recordPending=true;
              void storage({type:'record',event:playEvent}).then(()=>{recorded=true;}).catch(()=>{element('storage-status').textContent='Не удалось записать прослушивание в историю.';}).finally(()=>{recordPending=false;});
            }
          }
          if(event.data===2) playIntent=false;
          if([0,1,2,5].includes(event.data)){mediaPlayback=event.data===1?'playing':event.data===0?'stopped':'paused';publishMedia();}
          if(event.data===0 && !powerPaused){if(repeatOne)void loadVideo(id,playIntent,automatic);else if(queue.current)void advance(playIntent);}
        },
        onError: event => { clearTimeout(timer); if (current === generation) { playerReady = false; mediaPlayback='stopped';publishMedia();enabled(false); report(`Ошибка YouTube ${event.data}. Проверьте доступность видео и разрешение на встраивание.`); if(automatic) tryAlternative(sourceGeneration,ordinal); } },
        onAutoplayBlocked: () => { if (current === generation) report('Webview заблокировал Play. Попробуйте кнопку в самом видео.'); },
      },
    });
  } catch (error) { if (current === generation) report(error instanceof Error ? error.message : 'Ошибка загрузки'); }
}
element('play').onclick = () => {powerPaused=false;playIntent=true;player?.playVideo();};
element('pause').onclick = () => {playIntent=false;player?.pauseVideo();};
function seek(delta: number) { previousGesture.reset(); if (player) player.seekTo(Math.max(0, Math.min(player.getDuration(), player.getCurrentTime() + delta)), true); }
element('back').onclick = () => seek(-5);
element('forward').onclick = () => seek(5);
function updateVolume(){
  publishMedia();
  element<HTMLInputElement>('volume').value=String(volume.level);element('mute').setAttribute('aria-pressed',String(volume.muted));element('mute').textContent=volume.muted?'Без звука':'Звук';
  if(playerReady)player?.setVolume(volume.output);
  try{localStorage.setItem(volumeKey,volume.serialize());}catch{element('storage-status').textContent='Громкость действует, но сохранить настройку не удалось.';}
}
element('volume').oninput=()=>{volume.set(Number(element<HTMLInputElement>('volume').value));updateVolume();};
element('mute').onclick=()=>{volume.toggleMute();updateVolume();};
element('repeat').onclick=()=>{repeatOne=!repeatOne;element('repeat').setAttribute('aria-pressed',String(repeatOne));element('repeat').textContent=repeatOne?'Повтор: трек':'Повтор: выкл.';};
function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
const seekInput = element<HTMLInputElement>('seek');
let dragging = false;
seekInput.oninput = () => { dragging = true; element('elapsed').textContent = clock(Number(seekInput.value)); seekInput.title = clock(Number(seekInput.value)); };
seekInput.onchange = () => { previousGesture.reset(); if (playerReady) player?.seekTo(Number(seekInput.value), true); dragging = false; };
const positionTimer = setInterval(() => {
  if (!playerReady || !player) { seekInput.disabled = true; return; }
  const duration = player.getDuration();
  const position = player.getCurrentTime();
  if(Date.now()-lastMediaPublish>=2000)publishMedia();
  seekInput.disabled = duration <= 0;
  seekInput.max = String(duration);
  element('duration').textContent = clock(duration);
  if (!dragging) { seekInput.value = String(position); element('elapsed').textContent = clock(position); }
}, 500);
window.addEventListener('beforeunload', () => { clearInterval(positionTimer); player?.destroy(); });

function stopPlayer() {
  activeVideo=undefined;
  mediaPlayback='stopped';publishMedia();
  previousGesture.reset();
  ++generation; playerReady = false; player?.destroy(); player = undefined; enabled(false);
  element('candidate-list').replaceChildren();
  element('empty').hidden = false; seekInput.disabled = true; seekInput.value = '0';
  element('elapsed').textContent = '0:00'; element('duration').textContent = '0:00';
}
function renderQueue() {
  element('track-title').textContent = queue.current?.title ?? 'Ручная проверка видео';
  element('track-artist').textContent = queue.current?.artist ?? '';
  element('queue-list').replaceChildren(...queue.snapshot.map(track => {
    const item=document.createElement('li'); item.textContent = track.title + ' · ' + track.artist;
    if (track.ordinal === queue.current?.ordinal) item.setAttribute('aria-current','true');
    return item;
  }));
  element<HTMLButtonElement>('queue-next').disabled = !queue.current;
  element<HTMLButtonElement>('previous').disabled = !queue.current && !playerReady;
  element<HTMLButtonElement>('find-video').disabled = !queue.current;
}
let fetching = false;
async function sourceFetch(fresh: boolean) {
  if (fetching) return;
  if (!isTauri()) { element('source-status').textContent = 'Откройте Encore desktop: браузерный режим не имеет доступа к аккаунту.'; return; }
  fetching=true;
  const requestRevision=++sourceRevision;
  element<HTMLButtonElement>('source-start').disabled=true;
  element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Получение рекомендаций…';
  try {
    const tracks=await invoke<Track[]>('source_fetch',{fresh});
    if(requestRevision!==sourceRevision)return false;
    if (fresh) { stopPlayer(); queue.reset(tracks); finiteSource=false; activeCollection=undefined; choices.clear(); bypassSaved.clear(); element<HTMLInputElement>('url').value=''; }
    else queue.append(tracks);
    renderQueue();
    element('source-status').textContent='Получено ' + tracks.length + ' треков. Порядок сохранён. Подготавливаем клипы…';
    if (fresh) {playIntent=false;report('Новая сессия · без autoplay');}
    prepareAhead();
    return true;
  } catch (error) {
    if(requestRevision!==sourceRevision)return false;
    const known: Record<string,string> = {
      'No saved token. Run yandex-probe --save-token locally first.':'Сначала подключите аккаунт: yandex-probe --save-token в локальном терминале.',
      'Authorization denied':'Срок доступа истёк или доступ отклонён. Подключите аккаунт заново.',
      'Network/TLS error':'Не удалось связаться с Яндексом. Текущая очередь сохранена.',
      'Credential store locked or unavailable':'Системное хранилище недоступно или заблокировано.',
      'Identical batch returned; queue unchanged':'Сервер повторил порцию. Очередь сохранена, повторите позже.',
    };
    element('source-status').textContent=known[String(error)] ?? 'Не удалось получить рекомендации. Очередь сохранена.';
  } finally {
    fetching=false; element<HTMLButtonElement>('source-start').disabled=false;
    element<HTMLButtonElement>('source-more').disabled=!queue.current || finiteSource;
  }
}
element('source-start').onclick=()=>void sourceFetch(true);
element('source-more').onclick=()=>void sourceFetch(false);
element('queue-next').onclick=()=>void advance(playIntent);
element('find-video').onclick=()=>{
  if(!queue.current)return;
  const track=queue.current;
  if(isTauri() && /^\d+$/.test(track.id)) {
    const epoch=queue.generation,ordinal=track.ordinal;
    void storage({type:'remove_video',trackId:track.id}).then(()=>{if(queue.generation===epoch && queue.current?.ordinal===ordinal)resetMatching();}).catch(()=>{element('storage-status').textContent='Не удалось сбросить сохранённый клип.';});
    return;
  }
  resetMatching();
};
function resetMatching(){
  if(!queue.current)return;
  choices.delete(queue.generation+':'+queue.current.ordinal);
  queue.clearVideo(queue.current.ordinal);
  stopPlayer();playIntent=false;prepareAhead();
}

function renderCandidates(items:Candidate[],epoch:number,ordinal:number){
  element('candidate-list').replaceChildren(...items.map(candidate=>{
    const button=document.createElement('button');button.type='button';
    button.textContent=candidate.title+(candidate.byline?' · '+candidate.byline:'')+(candidate.views!==undefined?' · '+candidate.views.toLocaleString()+' просмотров':'')+(candidate.needsReview?' · проверить исполнителя':'');
    button.onclick=()=>{
      if(epoch!==queue.generation || queue.current?.ordinal!==ordinal)return;
      element<HTMLInputElement>('url').value=candidate.id;
      element<HTMLFormElement>('load').requestSubmit();
    };
    return button;
  }));
}

function tryAlternative(epoch:number,ordinal:number|undefined) {
  queueMicrotask(()=>{
    if(epoch!==queue.generation || ordinal!==queue.current?.ordinal) return;
    const entry=choices.get(epoch+':'+ordinal);
    if(entry && ++entry.index<entry.items.length) {
      const next=entry.items[entry.index];
      report('Пробуем другой клип той же композиции…');
      if(next.needsReview){stopPlayer();playIntent=false;renderCandidates(entry.items,epoch,ordinal!);report('Исполнитель в видео не подтверждён. Выберите подходящий клип из списка.');}
      else void loadVideo(next.id,playIntent,true);
    } else if(entry?.items[0]?.saved && ordinal!==undefined) {
      const key=epoch+':'+ordinal;bypassSaved.add(key);choices.delete(key);queue.clearVideo(ordinal);stopPlayer();prepareAhead();
    } else {playIntent=false;report('Клипы недоступны. Задайте ссылку вручную; трек остаётся текущим.');}
  });
}
function prepareAhead() {
  if(!isTauri() || !queue.current) return;
  const epoch=queue.generation;
  for(const track of queue.ahead()) {
    const key=epoch+':'+track.ordinal;
    if(track.videoId) continue;
    const cached=choices.get(key);
    if(cached) {
      if(track.ordinal===queue.current?.ordinal) {
        const candidate=cached.items[cached.index];
        if(candidate){renderCandidates(cached.items,epoch,track.ordinal);if(candidate.needsReview){playIntent=false;report('Выберите подходящий клип из списка.');}else void loadVideo(candidate.id,playIntent,true);}
        else {playIntent=false;report('Уверенного совпадения нет. Вставьте ссылку вручную; порядок очереди сохранён.');}
      }
      continue;
    }
    if(searching.has(key)) continue;
    searching.add(key);
    if(track.ordinal===queue.current.ordinal) report('Ищем клип для текущего трека…');
    void (async()=>{
      if(/^\d+$/.test(track.id) && !bypassSaved.has(key)) {
        try {const saved=await storage<string|null>({type:'get_video',trackId:track.id});if(saved)return [{id:saved,title:track.title,artist:track.artist,score:1000,reason:'Ваш сохранённый клип',saved:true}];}
        catch {element('storage-status').textContent='Сохранённые клипы недоступны. Используется временный автоподбор.';}
      }
      return invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist});
    })().then(items=>{
      if(epoch!==queue.generation) return;
      if(!Array.isArray(items)) items=[];
      choices.set(key,{items,index:0});
      const current=queue.current;
      if(current?.ordinal!==track.ordinal || current.videoId) return;
      if(!items.length) {playIntent=false;report('Уверенного совпадения нет. Вставьте ссылку вручную; порядок очереди сохранён.');return;}
      renderCandidates(items,epoch,track.ordinal);
      element('source-status').textContent=items[0].reason+' · '+items[0].title;
      if(items[0].needsReview){playIntent=false;report('Найдены клипы, но исполнитель не подтверждён. Выберите из списка или задайте ссылку.');return;}
      void loadVideo(items[0].id,playIntent,true);
    }).catch(()=>{
      if(epoch===queue.generation && track.ordinal===queue.current?.ordinal && !queue.current.videoId) {playIntent=false;report('Поиск временно недоступен. Повторите или задайте ссылку вручную.');}
    }).finally(()=>searching.delete(key));
  }
}
let advancing=false;
async function advance(resume:boolean) {
  if(advancing || !queue.current) return;
  advancing=true; previousGesture.reset(); playIntent=resume;
  const epoch=queue.generation;
  try {
    if(!queue.hasNext) {
      if(finiteSource){
        if(!activeCollection?.hasMore){playIntent=false;report('Конец выбранного списка.');return;}
        try{
          const context=activeCollection;
          const page=await collectionPage(context.entity,context.page+1);
          if(epoch!==queue.generation)return;
          queue.append(page.tracks);activeCollection={...context,page:page.page,hasMore:page.hasMore};
          if(!page.tracks.length){playIntent=false;report('Больше треков в списке нет.');return;}
        }catch{if(epoch!==queue.generation)return;playIntent=false;report('Не удалось загрузить следующую часть списка. Очередь сохранена.');return;}
      }else {
      const received=await sourceFetch(false);
      if(epoch!==queue.generation)return;
      if(!received){playIntent=false;return;}
      }
    }
    if(!queue.next()) {playIntent=false;return;}
    stopPlayer(); renderQueue();
    element<HTMLButtonElement>('pause').disabled=!playIntent; element<HTMLInputElement>('url').value='';
    if(queue.current.videoId) void loadVideo(queue.current.videoId,playIntent);
    else {report('Подготовка следующего трека…');prepareAhead();}
  } finally {advancing=false;}
}

let compact=false, topmost=false, changingWindow=false;
element('mini').onclick=async()=>{
  if(changingWindow) return;
  changingWindow=true;
  try {
    if(isTauri()) await invoke('window_mini',{compact:!compact});
    compact=!compact; document.body.classList.toggle('compact',compact);
    element('mini').textContent=compact?'Полный вид':'Миниплеер';
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
  const detached=!queue.current;
  if(detached){
    ++sourceRevision;finiteSource=true;activeCollection=undefined;
    queue.reset(activeVideo?[activeVideo]:[]);choices.clear();bypassSaved.clear();
    if(!activeVideo)playIntent=false;
  }
  const track={id:entry.trackId,title:entry.title,artist:entry.artist,videoId:entry.videoId};
  if(next)queue.insertNext([track]);else queue.append([track]);
  renderQueue();
  element<HTMLButtonElement>('source-more').disabled=finiteSource;
  element('history-status').textContent=next?'Добавлено следующим треком.':'Добавлено в конец очереди.';
  if(detached&&!activeVideo)void loadVideo(entry.videoId,false);
  else prepareAhead();
}
let historyRevision=0;
async function refreshHistory(){
 const revision=++historyRevision;
 if(!isTauri()){element('history-status').textContent='История доступна в desktop-версии.';return;}
 try {
   const entries=await storage<HistoryEntry[]>({type:'history',query:element<HTMLInputElement>('history-query').value});
   if(revision!==historyRevision)return;
   if(!Array.isArray(entries))return;
   element('history-list').replaceChildren(...entries.map(entry=>{
     const item=document.createElement('li'),title=document.createElement('span'),button=document.createElement('button');
     title.textContent=entry.title+' · '+entry.artist+' · '+new Date(entry.startedAt).toLocaleString();
     button.textContent='Воспроизвести';button.onclick=()=>{
       stopPlayer();queue.reset([{id:entry.trackId,title:entry.title,artist:entry.artist}]);finiteSource=true;activeCollection=undefined;++sourceRevision;choices.clear();bypassSaved.clear();renderQueue();element<HTMLButtonElement>('source-more').disabled=true;
       element('source-status').textContent='История · для возврата выберите новую сессию Моей волны.';
       powerPaused=false;void loadVideo(entry.videoId,true);
     };
     const next=document.createElement('button'),append=document.createElement('button');
     next.textContent='Следом';next.onclick=()=>enqueueHistory(entry,true);
     append.textContent='В конец';append.onclick=()=>enqueueHistory(entry,false);
     item.append(title,button,next,append);return item;
   }));
   element('history-status').textContent=entries.length?'Последние '+entries.length+' записей':'История пока пуста.';
 }catch {element('history-status').textContent='Не удалось прочитать историю. Существующая база не удалялась.';}
}
let historyTimer:ReturnType<typeof setTimeout>|undefined;
element('history-query').oninput=()=>{clearTimeout(historyTimer);historyTimer=setTimeout(()=>void refreshHistory(),200);};
element('history-refresh').onclick=()=>void refreshHistory();
element('history-panel').ontoggle=()=>{if(element<HTMLDetailsElement>('history-panel').open)void refreshHistory();};
element('history-clear').onclick=()=>element<HTMLDialogElement>('clear-dialog').showModal();
element('clear-cancel').onclick=()=>element<HTMLDialogElement>('clear-dialog').close();
element('clear-confirm').onclick=async()=>{
 try {await storage({type:'clear_history'});element<HTMLDialogElement>('clear-dialog').close();await refreshHistory();}
 catch {element('history-status').textContent='Не удалось очистить историю.';}
};

mountCatalogue(selection=>{
  if(!selection.tracks.length)return;
  stopPlayer();++sourceRevision;queue.reset(selection.tracks);choices.clear();bypassSaved.clear();
  finiteSource=true;activeCollection=selection.collection;powerPaused=false;playIntent=true;renderQueue();
  element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Яндекс Музыка · '+selection.title;
  element<HTMLInputElement>('url').value='';prepareAhead();
});

element('previous').onclick=()=>{
  if(previousGesture.press(performance.now())==='restart'){
    if(playerReady)player?.seekTo(0,true);
    return;
  }
  if(!queue.previous())return;
  stopPlayer();renderQueue();element<HTMLInputElement>('url').value='';
  if(queue.current?.videoId)void loadVideo(queue.current.videoId,playIntent);
  else prepareAhead();
};

function systemControl(action:string){
  switch(action){
    case 'toggle': if(playIntent){playIntent=false;player?.pauseVideo();}else{powerPaused=false;playIntent=true;if(playerReady)player?.playVideo();}break;
    case 'play':powerPaused=false;playIntent=true;if(playerReady)player?.playVideo();break;
    case 'pause':playIntent=false;player?.pauseVideo();break;
    case 'next':void advance(playIntent);break;
    case 'previous':element('previous').click();break;
  }
}
function powerPause(resume:boolean){
  powerPaused=true;playIntent=false;
  if(!resume)suspendPosition=playerReady?player?.getCurrentTime():undefined;
  player?.pauseVideo();
  if(resume && suspendPosition!==undefined && playerReady)player?.seekTo(suspendPosition,true);
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
    else if(action==='position' && playerReady){previousGesture.reset();player?.seekTo(Math.max(0,Math.min(player.getDuration(),value)),true);}
    else if(action==='volume'){volume.set(Math.round(value*100));updateVolume();}
    else systemControl(action);
  }).catch(()=>{});
  publishMedia();
  void listen<string>('encore-control',event=>systemControl(event.payload)).catch(()=>{element('storage-status').textContent='Управление из трея пока недоступно.';});
  void invoke<{tray_available:boolean}>('desktop_status').then(status=>{
    if(status)element('storage-status').textContent=status.tray_available?'Крестик скрывает Encore в трей. Выход — через меню значка.':'Трей недоступен. Закрытие окна завершит приложение.';
  }).catch(()=>{});
}
