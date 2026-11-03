import './style.css';
import { videoId } from './video-id';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { PlaybackQueue, type Track } from './queue';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand">encore<span>●</span></a><div class="window-actions"><button id="mini" aria-pressed="false">Миниплеер</button><button id="topmost" aria-pressed="false">Поверх окон</button><span class="badge">ЭТАП 0 · ЛАБОРАТОРИЯ</span></div></header>
<main><section class="intro"><p class="eyebrow">МУЗЫКА ПОЛУЧАЕТ ЭКРАН</p><h1>Ещё одну.</h1><p>Первый шаг к вашему музыкальному телеканалу.<br>Проверяем воспроизведение, прежде чем строить эфир.</p></section>
<section class="source-panel"><div class="source-actions"><button id="source-start">Моя волна · новая сессия</button><button id="source-more" disabled>Ещё рекомендации</button><button id="find-video" disabled>Подобрать заново</button><button id="queue-next" disabled>Следующий трек</button></div><p id="source-status" role="status">Яндекс доступен в desktop-версии после локального подключения аккаунта.</p><h2 id="track-title">Ручная проверка видео</h2><p id="track-artist"></p><details><summary>Очередь</summary><ol id="queue-list"></ol></details></section><section class="workspace"><div class="screen"><div id="player"></div><div id="empty"><span>▶</span><h2>Начнём с одного клипа</h2><p>Вставьте YouTube-ссылку. Музыка начнётся только по Play.</p></div></div>
<form id="load"><label for="url">YouTube-ссылка или ID</label><div class="input-row"><input id="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" required><button>Подготовить</button></div></form>
<div class="controls"><button id="play" disabled>▶ Play</button><button id="pause" disabled>Ⅱ Пауза</button><button id="back" disabled>−5 с</button><button id="forward" disabled>+5 с</button><label>Громкость <input id="volume" type="range" min="0" max="100" value="50"></label></div>
<div class="timeline"><output id="elapsed">0:00</output><input id="seek" aria-label="Позиция видео" type="range" min="0" max="0" value="0" step="1" disabled><output id="duration">0:00</output></div><p id="status" role="status" aria-live="polite">Ожидание ссылки · без autoplay</p></section>
<aside><div><span class="dot"></span> Одна сцена · один плеер</div><p>Прототип использует системный аудиовыход. Выбор устройства и аудиоанализ ещё не реализованы. Автоподбор экспериментальный; при несовпадении замените ссылку вручную.</p><details><summary>Журнал проверки</summary><pre id="log"></pre></details></aside></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const queue = new PlaybackQueue();
let player: YT.Player | undefined;
let generation = 0;
let playerReady = false;
let apiPromise: Promise<void> | undefined;
let playIntent=false;
interface Candidate {id:string;title:string;artist:string;score:number;reason:string}
const choices=new Map<string,{items:Candidate[];index:number}>();
const searching=new Set<string>();
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
  void loadVideo(id);
});
async function loadVideo(id:string,resume=false,automatic=false) {
  const sourceGeneration=queue.generation, ordinal=queue.current?.ordinal;
  if(ordinal!==undefined) queue.resolve(ordinal,id,sourceGeneration);
  playIntent=resume;
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
          event.target.setVolume(Number(element<HTMLInputElement>('volume').value));
          element('empty').hidden = true;
          report('Подготовка видео…');
          event.target.cueVideoById(id);
        },
        onStateChange: event => {
          if (current !== generation) return;
          const states: Record<number, string> = { '-1': 'Видео загружено', 0: 'Видео завершено', 1: 'Воспроизведение', 2: 'Пауза', 3: 'Буферизация', 5: 'Готово · без autoplay' };
          report(states[event.data] ?? `Состояние ${event.data}`);
          if (event.data === 5) { ready = true; clearTimeout(timer); enabled(true); if(resume && playIntent) event.target.playVideo(); }
          if(event.data===1) playIntent=true;
          if(event.data===2) playIntent=false;
          if(event.data===0 && queue.current) void advance(playIntent);
        },
        onError: event => { clearTimeout(timer); if (current === generation) { playerReady = false; enabled(false); report(`Ошибка YouTube ${event.data}. Проверьте доступность видео и разрешение на встраивание.`); if(automatic) tryAlternative(sourceGeneration,ordinal); } },
        onAutoplayBlocked: () => { if (current === generation) report('Webview заблокировал Play. Попробуйте кнопку в самом видео.'); },
      },
    });
  } catch (error) { if (current === generation) report(error instanceof Error ? error.message : 'Ошибка загрузки'); }
}
element('play').onclick = () => {playIntent=true;player?.playVideo();};
element('pause').onclick = () => {playIntent=false;player?.pauseVideo();};
function seek(delta: number) { if (player) player.seekTo(Math.max(0, Math.min(player.getDuration(), player.getCurrentTime() + delta)), true); }
element('back').onclick = () => seek(-5);
element('forward').onclick = () => seek(5);
element('volume').oninput = () => player?.setVolume(Number(element<HTMLInputElement>('volume').value));
function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
const seekInput = element<HTMLInputElement>('seek');
let dragging = false;
seekInput.oninput = () => { dragging = true; element('elapsed').textContent = clock(Number(seekInput.value)); seekInput.title = clock(Number(seekInput.value)); };
seekInput.onchange = () => { if (playerReady) player?.seekTo(Number(seekInput.value), true); dragging = false; };
const positionTimer = setInterval(() => {
  if (!playerReady || !player) { seekInput.disabled = true; return; }
  const duration = player.getDuration();
  const position = player.getCurrentTime();
  seekInput.disabled = duration <= 0;
  seekInput.max = String(duration);
  element('duration').textContent = clock(duration);
  if (!dragging) { seekInput.value = String(position); element('elapsed').textContent = clock(position); }
}, 500);
window.addEventListener('beforeunload', () => { clearInterval(positionTimer); player?.destroy(); });

function stopPlayer() {
  ++generation; playerReady = false; player?.destroy(); player = undefined; enabled(false);
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
  element<HTMLButtonElement>('find-video').disabled = !queue.current;
}
let fetching = false;
async function sourceFetch(fresh: boolean) {
  if (fetching) return;
  if (!isTauri()) { element('source-status').textContent = 'Откройте Encore desktop: браузерный режим не имеет доступа к аккаунту.'; return; }
  fetching=true;
  element<HTMLButtonElement>('source-start').disabled=true;
  element<HTMLButtonElement>('source-more').disabled=true;
  element('source-status').textContent='Получение рекомендаций…';
  try {
    const tracks=await invoke<Track[]>('source_fetch',{fresh});
    if (fresh) { stopPlayer(); queue.reset(tracks); choices.clear(); element<HTMLInputElement>('url').value=''; }
    else queue.append(tracks);
    renderQueue();
    element('source-status').textContent='Получено ' + tracks.length + ' треков. Порядок сохранён. Подготавливаем клипы…';
    if (fresh) {playIntent=false;report('Новая сессия · без autoplay');}
    prepareAhead();
    return true;
  } catch (error) {
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
    element<HTMLButtonElement>('source-more').disabled=!queue.current;
  }
}
element('source-start').onclick=()=>void sourceFetch(true);
element('source-more').onclick=()=>void sourceFetch(false);
element('queue-next').onclick=()=>void advance(playIntent);
element('find-video').onclick=()=>{
  if(!queue.current)return;
  choices.delete(queue.generation+':'+queue.current.ordinal);
  queue.clearVideo(queue.current.ordinal);
  stopPlayer();playIntent=false;prepareAhead();
};

function tryAlternative(epoch:number,ordinal:number|undefined) {
  queueMicrotask(()=>{
    if(epoch!==queue.generation || ordinal!==queue.current?.ordinal) return;
    const entry=choices.get(epoch+':'+ordinal);
    if(entry && ++entry.index<entry.items.length) {
      const next=entry.items[entry.index];
      report('Пробуем другой клип той же композиции…');
      void loadVideo(next.id,playIntent,true);
    } else {playIntent=false;report('Клипы недоступны. Задайте ссылку вручную; трек остаётся текущим.');}
  });
}
function prepareAhead() {
  if(!isTauri() || !queue.current) return;
  const epoch=queue.generation;
  for(const track of queue.snapshot.slice(queue.current.ordinal,queue.current.ordinal+3)) {
    const key=epoch+':'+track.ordinal;
    if(track.videoId) continue;
    const cached=choices.get(key);
    if(cached) {
      if(track.ordinal===queue.current?.ordinal) {
        const candidate=cached.items[cached.index];
        if(candidate) void loadVideo(candidate.id,playIntent,true);
        else {playIntent=false;report('Уверенного совпадения нет. Вставьте ссылку вручную; порядок очереди сохранён.');}
      }
      continue;
    }
    if(searching.has(key)) continue;
    searching.add(key);
    if(track.ordinal===queue.current.ordinal) report('Ищем клип для текущего трека…');
    void invoke<Candidate[]>('search_videos',{title:track.title,artist:track.artist}).then(items=>{
      if(epoch!==queue.generation) return;
      if(!Array.isArray(items)) items=[];
      choices.set(key,{items,index:0});
      const current=queue.current;
      if(current?.ordinal!==track.ordinal || current.videoId) return;
      if(!items.length) {playIntent=false;report('Уверенного совпадения нет. Вставьте ссылку вручную; порядок очереди сохранён.');return;}
      element('source-status').textContent=items[0].reason+' · '+items[0].title+' — '+items[0].artist;
      void loadVideo(items[0].id,playIntent,true);
    }).catch(()=>{
      if(epoch===queue.generation && track.ordinal===queue.current?.ordinal && !queue.current.videoId) {playIntent=false;report('Поиск временно недоступен. Повторите или задайте ссылку вручную.');}
    }).finally(()=>searching.delete(key));
  }
}
let advancing=false;
async function advance(resume:boolean) {
  if(advancing || !queue.current) return;
  advancing=true; playIntent=resume;
  const epoch=queue.generation;
  try {
    if(queue.current.ordinal+1>=queue.snapshot.length) {
      const received=await sourceFetch(false);
      if(!received || epoch!==queue.generation) {playIntent=false;return;}
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
