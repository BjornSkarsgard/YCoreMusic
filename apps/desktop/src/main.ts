import {mountDiscovery} from './discovery-ui';
import {mountVideoFavorites} from './favorite-ui';
import {savedVideos} from './favorite-store';
import {favoriteOrder,type SavedVideos} from './video-favorites';
import {mountFeedback} from './feedback-ui';
import './style.css';
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
let refreshFeedback=()=>{};
let refreshVideoFavorites=()=>{};
const lastPlayedVideos=new Map<string,string>();
let player: YT.Player | undefined;
let generation = 0;
let playerReady = false;
let activeVideo:QueueInput|undefined;
interface PlayRecord {event:{playbackId:string;trackId:string;title:string;artist:string;videoId:string};recorded:boolean;pending:boolean}
let activeRecord:PlayRecord|undefined;
let activeAutomatic=false;
let youtubeControls=false;
const captionControls=new CaptionControls(element<HTMLSelectElement>('captions'),element<HTMLSelectElement>('caption-size'),element('player-options-status'));
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
interface Candidate {id:string;title:string;byline?:string;artist?:string;score:number;views?:number;durationSeconds?:number;reason:string;saved?:boolean;needsReview?:boolean}
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
element('mute').textContent=volume.muted?'Без звука':'Звук';
let repeatMode:'off'|'one'|'queue'='off';
function report(message: string) {
  element('status').textContent = message;
  const log = element('log');
  log.textContent = `${new Date().toLocaleTimeString()} ${message}\n${log.textContent}`.slice(0, 6000);
}
function intentUI(){document.body.classList.toggle('is-playing',playIntent);element<HTMLButtonElement>('pause').disabled=!playIntent;}
function enabled(value: boolean) {
  for (const id of ['play', 'pause', 'back', 'forward','youtube-settings']) element<HTMLButtonElement>(id).disabled = !value;
  if(playIntent)element<HTMLButtonElement>('pause').disabled=false;
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
  clearRetry();sourceNeedsFresh=false;++sourceRevision;
  if(!queue.current)finiteSource=true;
  const track=queue.current;
  if(isTauri() && track && /^\d+$/.test(track.id)) void storage({type:'save_video',trackId:track.id,videoId:id}).then(()=>{element('storage-status').textContent='Клип добавлен в избранное для этой песни.';refreshVideoFavorites();void favoritesChanged(track.id);}).catch(()=>{element('storage-status').textContent='Не удалось сохранить ручной клип. Текущий выбор действует только до перезапуска.';});
  element<HTMLDialogElement>('video-dialog').close();
  void loadVideo(id);
});
async function loadVideo(id:string,resume=false,automatic=false,restore?:{position:number;record?:PlayRecord}) {
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
  activeVideo={id:trackAtLoad?.id??'manual:'+id,title:mediaTitle,artist:mediaArtist,videoId:id};
  refreshVideoFavorites();ensureAlternatives();
  mediaPlayback='stopped';publishMedia();
  const playEvent={playbackId:Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join(''),trackId:trackAtLoad?.id ?? 'manual:'+id,title:trackAtLoad?.title ?? 'YouTube · '+id,artist:trackAtLoad?.artist ?? '',videoId:id};
  const record=restore?.record??{event:playEvent,recorded:false,pending:false};activeRecord=record;
  const current = ++generation;
  enabled(false);
  intentUI();
  const loadKey=queue.generation+':'+queue.current?.ordinal;
  if(loadKey!==currentLoadKey){currentLoadKey=loadKey;trackDeadline=Date.now()+24000;}
  loadStarted=Date.now();bufferingSince=0;
  playerReady = false;
  player?.destroy(); player = undefined;
  element('empty').hidden = false;
  report('Загрузка YouTube API…');
  try {
    await api();
    if (current !== generation) return;
    let ready = false;
    const timer = setTimeout(() => {
      if (current === generation && !ready) { ++generation; enabled(false); playerReady = false; player?.destroy(); player = undefined; report('Видео не подготовилось вовремя. Проверьте сеть и повторите загрузку.'); if(automatic||document.fullscreenElement) tryAlternative(sourceGeneration,ordinal); }
    }, automatic?12000:20000);
    if (!document.getElementById('player')) { const mount = document.createElement('div'); mount.id = 'player'; document.querySelector('.screen')!.prepend(mount); }
    player = new YT.Player('player', {
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
          const states: Record<number, string> = { '-1': 'Видео загружено', 0: 'Видео завершено', 1: 'Воспроизведение', 2: 'Пауза', 3: 'Буферизация', 5: 'Готово · без autoplay' };
          intentUI();
          report(states[event.data] ?? `Состояние ${event.data}`);
          if (event.data === 5) { ready = true; clearTimeout(timer); enabled(true); captionControls.refresh(event.target);if(playIntent&&!powerPaused) event.target.playVideo(); }
          if(event.data===1) {
            if(powerPaused||(!playIntent&&!youtubeControls)){event.target.pauseVideo();return;}
            playIntent=true;clearRetry();skipStreak=0;retryAttempt=0;bufferingSince=0;loadStarted=0;intentUI();
            if(trackAtLoad)lastPlayedVideos.set(trackAtLoad.id,id);
            captionControls.refresh(event.target,true);
            if(isTauri() && !record.recorded && !record.pending) {
              record.pending=true;
              void storage({type:'record',event:record.event}).then(()=>{record.recorded=true;}).catch(()=>{element('storage-status').textContent='Не удалось записать прослушивание в историю.';}).finally(()=>{record.pending=false;});
            }
          }
          if(event.data===2){if(youtubeControls)playIntent=false;else if(playIntent&&!bufferingSince)bufferingSince=Date.now();intentUI();}
          if(event.data===3&&playIntent&&!bufferingSince)bufferingSince=Date.now();
          if(event.data===5||event.data===0)bufferingSince=0;
          if([0,1,2,5].includes(event.data)){mediaPlayback=event.data===1?'playing':event.data===0?'stopped':'paused';publishMedia();}
          if(event.data===0 && !powerPaused){if(repeatMode==='one')void repeatVideo(id,automatic);else if(queue.current)void advance(playIntent);}
        },
        onError: event => { clearTimeout(timer); if (current === generation) { playerReady = false; mediaPlayback='stopped';publishMedia();enabled(false); report(`Ошибка YouTube ${event.data}. Проверьте доступность видео и разрешение на встраивание.`); if(isTauri()&&trackAtLoad&&/^\d+$/.test(trackAtLoad.id)&&[2,100,101,150].includes(event.data))void storage({type:'video_failed',trackId:trackAtLoad.id,videoId:id}).then(refreshVideoFavorites).catch(()=>{}); if(automatic||document.fullscreenElement) tryAlternative(sourceGeneration,ordinal); } },
        onApiChange:event=>{if(current===generation)captionControls.refresh(event.target);},
        onPlaybackQualityChange:event=>{if(current===generation)element('video-quality').textContent='Качество: '+qualityLabel(event.data);},
        onAutoplayBlocked: () => { if (current === generation) report('YouTube заблокировал Play. Откройте панель YouTube и нажмите Play на видео.'); },
      },
    });
  } catch (error) { if (current === generation){report(error instanceof Error ? error.message : 'Ошибка загрузки');if(automatic&&playIntent)deferWave('Ждём YouTube',()=>void loadVideo(id,playIntent,true),5000);} }
}
element('play').onclick = () => systemControl('play');
element('pause').onclick = () => systemControl('pause');
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
function renderRepeat(){element('repeat').setAttribute('aria-pressed',String(repeatMode!=='off'));element('repeat').textContent=repeatMode==='one'?'Повтор: трек':repeatMode==='queue'?'Повтор: очередь':'Повтор: выкл.';}
element('repeat').onclick=()=>{repeatMode=repeatMode==='off'?'one':repeatMode==='one'&&finiteSource?'queue':'off';renderRepeat();};
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
  refreshFeedback();
  refreshVideoFavorites();
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
  if(!playIntent||powerPaused||finiteSource)return;
  if(retryTimer)return;
  const epoch=queue.generation,revision=sourceRevision;
  const delay=Math.max(minimum,Math.min(30000,1000*2**Math.min(retryAttempt++,5)));
  report(message+' · повтор через '+Math.ceil(delay/1000)+' с');
  retryTimer=setTimeout(()=>{retryTimer=undefined;if(playIntent&&!powerPaused&&!finiteSource&&epoch===queue.generation&&revision===sourceRevision)action();},delay);
}
function canSkip(){return playIntent&&!powerPaused&&(!finiteSource||!!document.fullscreenElement);}
let skipQueued=false;
function skipUnavailable(message:string){
  if(skipQueued||(!finiteSource&&retryTimer))return;
  if(!canSkip()) {if(finiteSource)playIntent=false;intentUI();report(message+' · можно выбрать другой клип');element<HTMLButtonElement>('play').disabled=false;return;}
  report(message+' · следующий трек');
  ++skipStreak;
  if(skipStreak%12===0&&!finiteSource){deferWave('Ищем следующую подборку',()=>void advance(playIntent),5000);return;}
  const epoch=queue.generation,ordinal=queue.current?.ordinal;skipQueued=true;
  queueMicrotask(()=>{skipQueued=false;if(canSkip()&&epoch===queue.generation&&ordinal===queue.current?.ordinal)void advance(playIntent);});
}
function sourceFetch(fresh:boolean,autoplay=false):Promise<boolean>{
  if(sourceWork)return sourceWork;
  if(!isTauri()){element('source-status').textContent='Подключите аккаунт в Encore для компьютера.';return Promise.resolve(false);}
  if(fresh){
    clearRetry();startingSource=true;sourceNeedsFresh=true;
    stopPlayer();queue.reset([...queue.snapshot]);choices.clear();bypassSaved.clear();
    finiteSource=false;activeCollection=undefined;playIntent=autoplay&&!powerPaused;
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
      const tracks=await invoke<Track[]>('source_fetch',{fresh,station:currentStation});
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
      element('source-status').textContent=auth?'Переподключите аккаунт Яндекса в локальном терминале.':'Источник временно недоступен. Текущая очередь сохранена.';
      if(auth){playIntent=false;report('Нужно подключить аккаунт Яндекса');}
      else if(playIntent){const continuation=sourceNeedsFresh?()=>void sourceFetch(true,playIntent):advancing?()=>void advance(playIntent):()=>void sourceFetch(false);deferWave('Ждём Яндекс Музыку',continuation,/Rate limited/.test(text)?10000:1000);}
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
element('source-start').onclick=()=>{retryAttempt=0;powerPaused=false;void sourceFetch(true,true);};
element('source-more').onclick=()=>void sourceFetch(false);
element('queue-next').onclick=()=>void advance(playIntent);
element('find-video').onclick=()=>{
  if(!queue.current)return;
  const track=queue.current,epoch=queue.generation,ordinal=track.ordinal;
  if(queue.generation!==epoch||queue.current?.ordinal!==ordinal)return;
  bypassSaved.add(epoch+':'+ordinal);choices.delete(epoch+':'+ordinal);queue.clearVideo(ordinal);stopPlayer();playIntent=false;prepareAhead();
};
function renderCandidates(items:Candidate[],epoch:number,ordinal:number){
  renderAlternatives(items,epoch,ordinal);
  element('candidate-list').replaceChildren(...items.map(candidate=>{
    const button=document.createElement('button');button.type='button';button.textContent=candidate.title+(candidate.byline?' · '+candidate.byline:'')+(candidate.views!==undefined?' · '+candidate.views.toLocaleString()+' просмотров':'')+(candidate.needsReview?' · проверить исполнителя':'');
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
    const duration=candidate.durationSeconds===undefined?'длительность неизвестна':clock(candidate.durationSeconds);
    meta.textContent=(candidate.views===undefined?'просмотры неизвестны':candidate.views.toLocaleString('ru-RU')+' просмотров')+' · '+duration+(candidate.needsReview?' · проверить исполнителя':'');body.append(title,meta);button.append(image,body);
    button.onclick=()=>{
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
  return saved.videos.filter(video=>!video.unavailable).map(video=>({...existing.find(item=>item.id===video.videoId),id:video.videoId,title:existing.find(item=>item.id===video.videoId)?.title??title,score:1000,reason:'Ваш избранный клип',saved:true}));
}
async function favoritesChanged(trackId:string){
  const epoch=queue.generation;
  try{
    const saved=await savedVideos(trackId);if(epoch!==queue.generation)return;
    for(const track of queue.snapshot){if(track.id!==trackId)continue;
      const key=epoch+':'+track.ordinal,entry=choices.get(key),existing=entry?.items??[];
      const favorites=favoriteCandidates(saved,track.title,existing),items=[...favorites,...existing.filter(item=>!item.saved&&!favorites.some(saved=>saved.id===item.id))];
      const active=track.ordinal===queue.current?.ordinal?activeVideo?.videoId:undefined;
      if(!items.length){choices.delete(key);if(active)renderCandidates([],epoch,track.ordinal);continue;}
      choices.set(key,{items,index:active?items.findIndex(item=>item.id===active):0,favoriteChosen:!!active,alternativesLoaded:false});
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
        const items=[...favorites,...existing.filter(item=>!item.saved&&!favorites.some(favorite=>favorite.id===item.id))];
        choices.set(key,{items,index:0,favoriteChosen:true});
        void loadVideo(favorites[0].id,playIntent,true);return;
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
  if(!entry||entry.alternativesLoaded||searching.size>=3||searching.has(work))return;
  entry.alternativesLoaded=true;searching.add(work);
  const captured=entry;
  void invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist}).then(found=>{
    if(epoch!==queue.generation||choices.get(key)!==captured||!Array.isArray(found))return;
    const favorites=captured.items.filter(item=>item.saved).map(saved=>{const metadata=found.find(item=>item.id===saved.id);return {...metadata,...saved,title:metadata?.title??saved.title,views:metadata?.views,durationSeconds:metadata?.durationSeconds};});
    captured.items=[...favorites,...found.filter(item=>!favorites.some(saved=>saved.id===item.id))];
    const active=queue.current?.ordinal===track.ordinal?activeVideo?.videoId:track.videoId;if(active)captured.index=captured.items.findIndex(item=>item.id===active);
    if(queue.current?.ordinal===track.ordinal)renderCandidates(captured.items,epoch,track.ordinal);
  }).catch(()=>{}).finally(()=>{searching.delete(work);prepareAhead();});
}
function tryAlternative(epoch:number,ordinal:number|undefined){
  queueMicrotask(()=>{
    if(epoch!==queue.generation||ordinal!==queue.current?.ordinal)return;
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
      if(entry.items[0]?.saved&&!bypassSaved.has(key)){bypassSaved.add(key);choices.delete(key);stopPlayer();prepareAhead();return;}
    }
    stopPlayer();skipUnavailable('Клипы недоступны');
  });
}
const searchErrors=new Map<string,number>();
const matchJobs=new Map<string,Promise<Candidate[]>>();
function prepareAhead(){
  intentUI();
  if(!isTauri()||startingSource||sourceNeedsFresh||!queue.current)return;
  const epoch=queue.generation;
  ensureAlternatives();
  for(const track of queue.ahead(finiteSource?3:8)){
    const key=epoch+':'+track.ordinal;
    if(track.videoId)continue;
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
      }else skipUnavailable('Подходящий клип не найден');
      continue;
    }
    if(searchErrors.has(key)){
      if(track.ordinal===queue.current?.ordinal&&playIntent)deferWave('Поиск видео временно недоступен',()=>{searchErrors.delete(key);prepareAhead();},3000);
      continue;
    }
    if(searching.has(key)||searching.size>=3)continue;
    searching.add(key);
    const matchKey=track.id+'|'+track.title+'|'+track.artist;
    let job=matchJobs.get(matchKey);
    if(!job){job=(async()=>{
      if(/^\d+$/.test(track.id)&&!bypassSaved.has(key)){
        try{const saved=await savedVideos(track.id);if(!lastPlayedVideos.has(track.id)&&saved.lastVideoId)lastPlayedVideos.set(track.id,saved.lastVideoId);const favorites=favoriteCandidates(saved,track.title);if(favorites.length)return favorites;}catch{/* Match without a saved override. */}
      }
      return invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist});
    })();matchJobs.set(matchKey,job);void job.finally(()=>matchJobs.delete(matchKey)).catch(()=>{});}
    void job.then(items=>{
      if(epoch!==queue.generation)return;
      choices.set(key,{items:Array.isArray(items)?items:[],index:0,alternativesLoaded:!items?.some(item=>item.saved)});
    }).catch(()=>{if(epoch===queue.generation)searchErrors.set(key,Date.now());}).finally(()=>{
      searching.delete(key);
      if(epoch===queue.generation)prepareAhead();
      else if(queue.current)prepareAhead();
    });
  }
  if(!finiteSource&&playIntent&&queue.ahead(10).length<8&&!sourceWork&&!retryTimer)void sourceFetch(false);
}
let advancing=false;
async function advance(resume:boolean){
  if(advancing||!queue.current||startingSource)return;
  advancing=true;previousGesture.reset();playIntent=resume&&!powerPaused;
  const epoch=queue.generation;
  let wrapped=false;
  try{
    if(!queue.hasNext&&finiteSource&&repeatMode==='queue'&&!activeCollection?.hasMore){queue.rewind();wrapped=true;}
    else if(!queue.hasNext){
      if(finiteSource){
        if(!activeCollection?.hasMore){playIntent=false;player?.pauseVideo();report('Конец выбранного списка.');return;}
        try{const context=activeCollection,page=await collectionPage(context.entity,context.page+1);if(epoch!==queue.generation)return;queue.append(page.tracks);activeCollection={...context,page:page.page,hasMore:page.hasMore};if(!page.tracks.length){if(repeatMode==='queue'){queue.rewind();wrapped=true;}else{playIntent=false;player?.pauseVideo();report('Больше треков в списке нет.');return;}}}
        catch{playIntent=false;report('Не удалось загрузить следующую часть списка. Очередь сохранена.');return;}
      }else{
        const received=await sourceFetch(false);
        if(epoch!==queue.generation)return;
        if(!received){deferWave('Ждём следующую подборку',()=>void advance(playIntent));return;}
      }
    }
    if(!wrapped&&!queue.next()){if(!finiteSource)deferWave('Ждём следующую подборку',()=>void advance(playIntent));else playIntent=false;return;}
    stopPlayer();renderQueue();element<HTMLButtonElement>('pause').disabled=!playIntent;element<HTMLInputElement>('url').value='';
    if(!finiteSource){queue.trimPast(50);const valid=new Set(queue.snapshot.map(track=>queue.generation+':'+track.ordinal));for(const key of choices.keys())if(!valid.has(key))choices.delete(key);for(const key of searchErrors.keys())if(!valid.has(key))searchErrors.delete(key);}
    if(queue.current.videoId)void loadVideo(queue.current.videoId,playIntent);
    else prepareAhead();
  }finally{advancing=false;intentUI();}
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
       element('source-name').textContent='История';element('source-status').textContent='История · для возврата выберите новую сессию Моей волны.';
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

const selectCatalogue:Parameters<typeof mountCatalogue>[0]=selection=>{
  if(!selection.tracks.length)return;
  stopPlayer();++sourceRevision;queue.reset(selection.tracks);choices.clear();bypassSaved.clear();
  clearRetry();sourceNeedsFresh=false;finiteSource=true;activeCollection=selection.collection;powerPaused=false;playIntent=true;renderQueue();
  element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Яндекс Музыка · '+selection.title;element('source-name').textContent=selection.title;
  element<HTMLInputElement>('url').value='';prepareAhead();
};
const browseCatalogue=mountCatalogue(selectCatalogue);
mountDiscovery(selectCatalogue,entity=>{showPanel('search');browseCatalogue(entity,()=>showPanel('discovery'));});
mountLibrary(selectCatalogue);

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
    case 'toggle':systemControl(playIntent?'pause':'play');break;
    case 'play':powerPaused=false;playIntent=true;clearRetry();if(sourceNeedsFresh)void sourceFetch(true,true);else if(playerReady)player?.playVideo();else if(activeVideo?.videoId&&queue.current?.videoId)void loadVideo(activeVideo.videoId,true,activeAutomatic);else{element<HTMLButtonElement>('pause').disabled=false;prepareAhead();}break;
    case 'pause':playIntent=false;clearRetry();player?.pauseVideo();if(queue.current)element<HTMLButtonElement>('play').disabled=false;break;
    case 'next':void advance(playIntent);break;
    case 'previous':element('previous').click();break;
  }
  intentUI();
}
function powerPause(resume:boolean){
  powerPaused=true;playIntent=false;clearRetry();intentUI();
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


// Local to this WebView: typing and native control keys keep their normal behavior.
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  if(event.target instanceof Element && event.target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),dialog'))return;
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
  if(!playerReady||!activeVideo?.videoId)return;
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
  element('fullscreen').textContent=document.fullscreenElement?'Выйти из полного экрана':'На весь экран';
  element('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement));
});

refreshFeedback=mountFeedback(()=>queue.current,()=>void advance(playIntent));
refreshVideoFavorites=mountVideoFavorites(()=>queue.current&&activeVideo?.id===queue.current.id?{trackId:queue.current.id,videoId:activeVideo.videoId,key:queue.generation+':'+queue.current.ordinal}:undefined,id=>void loadVideo(id,playIntent,true),id=>void favoritesChanged(id),id=>choices.get(queue.generation+':'+queue.current?.ordinal)?.items.find(item=>item.id===id)?.title);
mountShellNavigation();
mountFullscreenControls(document.querySelector<HTMLElement>('.workspace')!,document.querySelector<HTMLElement>('.player-hud')!);

const streamWatchdog=setInterval(()=>{
 if(!playIntent||powerPaused||!activeVideo)return;
 if(canSkip() && playerReady && loadStarted && Date.now()-loadStarted>15000){loadStarted=0;tryAlternative(queue.generation,queue.current?.ordinal);return;}
 if(bufferingSince && Date.now()-bufferingSince>45000){bufferingSince=0;tryAlternative(queue.generation,queue.current?.ordinal);}
 if(!finiteSource&&!startingSource)prepareAhead();
},1000);
window.addEventListener('beforeunload',()=>{clearInterval(streamWatchdog);clearRetry();});
if(isTauri())void invoke<{id:string,title:string}[]>('source_stations').then(stations=>{
 if(!Array.isArray(stations))return;const select=element<HTMLSelectElement>('station-select');
 for(const station of stations){const option=new Option(station.title,station.id);select.append(option);}
}).catch(()=>{});
