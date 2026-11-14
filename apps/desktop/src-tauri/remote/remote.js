const get = id => document.getElementById(id);
function readPairCode() {
  const code = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (location.hash) history.replaceState(null, '', location.pathname);
  return code;
}
let pairCode = readPairCode();
const pairingKey = 'ycore-remote-computer';
const computerPath = /^\/remote\/p\/[a-f0-9]{64}\/$/;
let apiBase = computerPath.test(location.pathname) ? location.pathname : null;
try {
  if (apiBase && pairCode) localStorage.setItem(pairingKey, apiBase);
  else {
    const saved = localStorage.getItem(pairingKey);
    if (computerPath.test(saved || '')) apiBase = saved;
  }
} catch { /* The current connection works without browser storage. */ }
let connectionRevision = 0;

let playback;
let reconnect;
let connecting = false;
let needsSession = true;
let queueKey = '';
let clipsKey = '';
let lyricsKey = '';
let stationsKey = '';
let previousStation;
let online = false;
let panel = '';
let searchTimer;
let lookupRevision = 0;
const seek = get('seek');
const volume = get('volume');

function post(path, data, timeout=8000) {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
}

function apiUrl(path) {
  if (!apiBase) throw Error('pair_required');
  return new URL(path, location.origin + apiBase).href;
}

function time(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const paths = {
  "menu": "M4 6h16M4 12h16M4 18h16",
  "search": "M20 20l-4.5-4.5M17.5 10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  "close": "M6 6l12 12M18 6L6 18",
  "lyrics": "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6",
  "play": "M7 4l14 8-14 8z",
  "pause": "M8 5v14M16 5v14",
  "previous": "M5 5v14M19 5l-11 7 11 7z",
  "next": "M19 5v14M5 5l11 7-11 7z",
  "repeat": "M17 2l4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3",
  "repeat-one": "M17 2l4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3M10 10l2-1v6M10 15h4",
  "volume": "M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14",
  "muted": "M3 9h4l5-4v14l-5-4H3zM17 9l5 6M22 9l-5 6",
  "heart": "M20.5 4.6a5.5 5.5 0 0 0-8 0l-.5.5-.5-.5a5.5 5.5 0 0 0-8 7.6L12 21l8.5-8.8a5.5 5.5 0 0 0 0-7.6Z",
  "dislike": "M7 3v12H3V3zM7 4h10a3 3 0 0 1 3 3l-1 5a3 3 0 0 1-3 3h-3l1 5c-2 2-3-1-4-3l-3-3",
  "star": "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"
};

function setIcon(element, name, label) {
  if (element.dataset.drawnIcon !== name) {
    element.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
    element.dataset.drawnIcon = name;
  }
  if (label) {
    element.setAttribute('aria-label', label);
    element.title = label;
  }
}
for (const element of document.querySelectorAll('[data-icon]')) {
  const name = element.dataset.icon;
  setIcon(element, {down:'dislike',sound:'volume'}[name] || name, element.getAttribute('aria-label'));
}

function paint(value) {
  playback = value;
  get('player').hidden = false;
  get('pair').hidden = true;
  get('title').textContent = value.title || 'Выберите музыку';
  get('artist').textContent = value.artist;
  get('source').textContent = value.music?.source || '';
  get('elapsed').textContent = time(value.position);
  get('duration').textContent = time(value.duration);
  setIcon(get('toggle'), value.playing?'pause':'play', value.playing?'Пауза':'Воспроизвести');
  const repeat = get('repeat');
  setIcon(repeat, value.repeat==='one'?'repeat-one':'repeat', value.repeat==='one'?'Повтор трека':value.repeat==='queue'?'Повтор очереди':'Повтор выключен');
  repeat.setAttribute('aria-pressed', String(value.repeat==='one'||value.repeat==='queue'));
  const muted = value.music?.muted === true;
  setIcon(get('mute'),muted?'muted':'volume',muted?'Включить звук':'Выключить звук');
  get('mute').setAttribute('aria-pressed',String(muted));
  seek.max = String(Math.max(1, value.duration));
  if (document.activeElement !== seek) seek.value = String(value.position);
  if (document.activeElement !== volume) volume.value = String(value.volume);
  paintQueue(value);
  if (panel==='clips') paintClips();
  paintStations(value.music);
  get('wave-status').textContent = value.music?.wave_status || '';
  get('clips').hidden = !value.clips?.length;
  get('more-queue').hidden = !value.music?.more;
  get('undo-dislike').hidden = !value.music?.undo_key;
  setOnline(true);
  if (panel==='lyrics') paintLyrics();
  offerInstall();
}

function makeButton(label, action, className='') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.onclick = action;
  return button;
}

function makeRows(entries, onSelect) {
  const list = document.createElement('ol');
  list.className = 'rows';
  for (const [index, entry] of entries.entries()) {
    const item = document.createElement('li');
    const button = makeButton('', () => onSelect(entry,index), 'row');
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = entry.title;
    text.append(title);
    if (entry.artist) {
      const subtitle = document.createElement('small');
      subtitle.textContent = entry.artist;
      text.append(subtitle);
    }
    button.append(text);
    if (entry.current) button.setAttribute('aria-current','true');
    item.append(button);
    list.append(item);
  }
  return list;
}

function paintQueue(value) {
  const key = JSON.stringify([value.queue_generation,value.queue]);
  if (key === queueKey) return;
  const newQueue = !queueKey || get('queue').dataset.generation !== String(value.queue_generation);
  queueKey = key;
  get('queue').dataset.generation = value.queue_generation;
  const rows = makeRows(value.queue, entry => void send({type:'queue',generation:value.queue_generation,ordinal:entry.ordinal}));
  get('queue').replaceChildren(...rows.children);
  get('empty-queue').hidden = !!value.queue.length;
  if (newQueue) get('queue-panel').scrollTop = 0;
}

function paintStations(music) {
  if (!music) return;
  const key = JSON.stringify(music.stations);
  const select = get('station');
  if (key !== stationsKey) {
    const previous = select.value;
    select.replaceChildren(...music.stations.map(station => new Option(station.title,station.id)));
    select.value = music.stations.some(station=>station.id===previous)?previous:music.station;
    stationsKey = key;
  }
  if (music.station !== previousStation) select.value = music.station;
  previousStation = music.station;
}

const reactionButtons = {like:'like',dislike:'dislike',clip:'clip-like'};
const reactionField = {like:'track_like',dislike:'track_dislike',clip:'clip_like'};
function setOnline(connected) {
  online = connected;
  const music = playback?.music;
  for (const button of document.querySelectorAll('.transport button')) button.disabled = !connected;
  seek.disabled = !connected || !playback?.duration;
  volume.disabled = !connected;
  get('query').disabled = !connected;
  get('wave').disabled = !connected || !music || music.wave_busy;
  get('station').disabled = !connected || !music || music.wave_busy;
  get('chart').disabled = get('library').disabled = !connected || !music;
  get('history').disabled = !connected;
  get('clips').disabled = !connected;
  get('lyrics').hidden = playback?.lyrics_supported !== true;
  get('lyrics').disabled = !connected;
  for (const card of get('results').querySelectorAll('.alternative-video')) card.disabled = !connected;
  get('more-queue').disabled = !connected;
  get('undo-dislike').disabled = !connected;
  for (const [target,id] of Object.entries(reactionButtons)) {
    const state = music?.[reactionField[target]];
    get(id).disabled = !connected || typeof state !== 'boolean';
    get(id).setAttribute('aria-pressed', String(state === true));
  }
}

function setPanel(next) {
  ++lookupRevision;
  clearTimeout(searchTimer);
  panel = next;
  lyricsKey = '';
  get('lyrics').setAttribute('aria-expanded',String(panel==='lyrics'));
  get('menu').hidden = panel !== 'menu';
  get('browse').hidden = !panel || panel === 'menu';
  get('queue-panel').inert = !!panel;
  get('close-panel').hidden = !panel;
  get('menu-toggle').setAttribute('aria-expanded',String(panel==='menu'));
  get('results').replaceChildren();
  get('results-status').textContent = '';
  get('browse').scrollTop = 0;
}

function showInstall() {
  get('install').showModal();
}

const installKey = 'ycore-remote-install';
let installEvent;
let installOffered = false;
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
function installHint() {
  get('install-now').hidden = !installEvent;
  get('install-help').textContent = installEvent
    ? 'Добавьте YCore Music на главный экран, чтобы открывать пульт одним нажатием.'
    : ios
      ? 'В Safari нажмите «Поделиться», затем «На экран Домой» и «Добавить».'
      : 'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».';
}
function offerInstall() {
  get('show-install').hidden = installed();
  if (installOffered || installed()) return;
  installOffered = true;
  try {
    if (localStorage.getItem(installKey) || localStorage.getItem('remote-install:' + location.pathname)) return;
    localStorage.setItem(installKey,'1');
  } catch { /* Storage can be unavailable in private browsing. */ }
  installHint();
  showInstall();
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
  installHint();
});
window.addEventListener('appinstalled', () => {
  installEvent = undefined;
  get('show-install').hidden = true;
  if (get('install').open) get('install').close();
});
get('install-later').onclick = () => get('install').close();
get('install-now').onclick = async () => {
  const event = installEvent;
  if (!event) return;
  installEvent = undefined;
  get('install').close();
  try { await event.prompt(); } catch { /* The browser can withdraw the prompt. */ }
  installHint();
};
get('show-install').onclick = () => { installHint(); showInstall(); };

function showPair(message) {
  get('connection').textContent = 'Телефон не подключён';
  document.body.classList.remove('connected');
  if (get('install').open) get('install').close();
  get('player').hidden = true;
  get('pair').hidden = false;
  get('pair-hint').textContent = message;
}

function disconnected(message='Связь потеряна. Проверьте интернет на телефоне и ПК. Переподключаемся…') {
  setOnline(false);
  ++lookupRevision;
  lyricsKey = '';
  if (get('player').hidden) {
    showPair(message);
    return;
  }
  if (panel && panel!=='menu') get('results-status').textContent = message;
  const notice=get('player-notice');
  notice.textContent=message;
  notice.hidden=false;
  get('reconnect-actions').hidden=false;
  get('connection').textContent = notice.textContent;
}

async function connect() {
  if (connecting) return;
  if (!apiBase) {
    showPair('Отсканируйте QR-код из настроек YCore на компьютере.');
    return;
  }
  connecting = true;
  const revision = connectionRevision;
  clearTimeout(reconnect);
  let delay = 1500;
  try {
    if (pairCode) {
      const code = pairCode;
      const response = await post('./api/pair', {code});
      if (revision !== connectionRevision || pairCode !== code) return;
      if (response.status !== 204 && response.status !== 409) {
        if (response.status === 503) throw Error('computer_offline');
        if (response.status >= 500 || response.status === 429) throw Error('offline');
        pairCode = null;
        showPair('QR-код уже использован или устарел. Откройте новый код на компьютере.');
        delay = 0;
        return;
      }
      pairCode = null;
      needsSession = response.status !== 204;
      try { localStorage.setItem(pairingKey,apiBase); } catch { /* Keep the current connection. */ }
    }
    if (needsSession) {
      const response = await post('./api/session', {});
      if (revision !== connectionRevision) return;
      if (response.status === 401) {
        showPair('Откройте «Пульт» в настройках на компьютере и отсканируйте QR-код.');
        delay = 0;
        return;
      }
      if (response.status === 503) throw Error('computer_offline');
      if (!response.ok) throw Error('offline');
      needsSession = false;
    }
    const response = await fetch(apiUrl('./api/state'), {cache:'no-store', signal:AbortSignal.timeout(8000)});
    if (revision !== connectionRevision) return;
    if (response.status === 401) {
      showPair('Откройте «Пульт» в настройках на компьютере и отсканируйте QR-код.');
      delay = 0;
      return;
    }
    if (response.status === 503) throw Error('computer_offline');
    if (!response.ok) throw Error('offline');
    const state = await response.json();
    if (revision !== connectionRevision) return;
    paint(state);
    document.body.classList.add('connected');
    get('player-notice').hidden=true;
    get('reconnect-actions').hidden=true;
    get('connection').textContent = 'Компьютер подключён';
  } catch (error) {
    if (revision !== connectionRevision) return;
    needsSession = true;
    disconnected(error.message==='computer_offline'
      ? 'Нет связи с приложением на ПК. Откройте YCore и включите «Настройки → Пульт → Подключить телефон».'
      : undefined);
    delay = 2500;
  } finally {
    connecting = false;
    if (delay && !document.hidden && navigator.onLine) reconnect = setTimeout(connect, delay);
  }
}

async function send(action) {
  if (!online) return false;
  const status = get('command-status');
  status.hidden = true;
  const revision = connectionRevision;
  try {
    const response = await post('./api/command', {id:crypto.randomUUID(),action});
    if (revision !== connectionRevision) return false;
    if (response.status === 401) { void connect(); return false; }
    if (!response.ok) throw Error('command');
    return true;
  } catch {
    if (revision !== connectionRevision) return false;
    status.textContent = 'Не удалось выполнить команду. Откройте список заново или повторите попытку.';
    status.hidden = false;
    return false;
  }
}

async function playResult(ticket,index) {
  if (await send({type:'play_result',ticket,index})) {
    setPanel('');
    get('query').blur();
  }
}

function renderMusic(result, request, back) {
  const results = get('results');
  const next = () => void loadMusic({...request,page:(request.page||0)+1},back,true);
  const actionBar = document.createElement('div');
  actionBar.className = 'browse-actions';
  if (back) actionBar.append(makeButton('Назад',back));
  if (result.list?.rows.length) {
    actionBar.append(makeButton(request.type==='chart'?'Включить чарт':'Воспроизвести список', () => void playResult(result.list.ticket,0),'primary'));
  }
  if (!results.childElementCount && actionBar.childElementCount) results.append(actionBar);
  if (result.list?.rows.length) {
    results.append(makeRows(result.list.rows, (_,index) => void playResult(result.list.ticket,index)));
  }
  for (const group of result.groups) {
    if (group.label) {
      const title = document.createElement('h2');
      title.textContent = group.label;
      results.append(title);
    }
    results.append(makeRows(group.rows, entry => {
      if (entry.browse) {
        get('query').blur();
        void loadMusic({type:'collection',ticket:entry.ticket,page:0},() => void loadMusic(request,back));
      } else void playResult(entry.ticket);
    }));
  }
  if (result.has_more) {
    const more = makeButton('Загрузить ещё',next);
    more.id = 'browse-more';
    results.append(more);
  }
}

async function loadMusic(request,back,append=false) {
  if (!online) return;
  if (!append) {
    setPanel(request.type);
    get('browse-title').textContent = {search:'Поиск',library:'Моя музыка',chart:'Чарт',collection:'Подборка'}[request.type];
  }
  const revision = ++lookupRevision;
  const status = get('results-status');
  status.textContent = 'Загрузка…';
  const more = get('browse-more');
  if (more) more.disabled = true;
  try {
    const legacy = request.type==='search' && !playback.music;
    const response = await post(legacy?'./api/search':'./api/music',legacy?{query:request.query}:request,20_000);
    if (revision!==lookupRevision) return;
    if (response.status===401) { void connect(); return; }
    if (response.status===403) {
      status.textContent='Для этого списка нужен доступ к Яндекс Музыке. Войти можно на ПК в настройках YCore.';
      return;
    }
    if (!response.ok) throw Error('music');
    const data = await response.json();
    if (revision!==lookupRevision) return;
    const result = legacy?{title:'Поиск',groups:data.length?[{label:'Треки',rows:data}]:[],has_more:false}:data;
    if (!append && request.type==='collection') get('browse-title').textContent = result.title;
    more?.remove();
    renderMusic(result,request,back);
    const found = result.groups.length || result.list?.rows.length;
    status.textContent = found?'':append?'Больше результатов нет.':'Ничего не найдено.';
  } catch {
    if (revision===lookupRevision) status.textContent='Не удалось загрузить список. Повторите попытку.';
  } finally {
    if (more) more.disabled = false;
  }
}

async function showHistory() {
  setPanel('history');
  get('browse-title').textContent = 'История';
  const revision = lookupRevision;
  const status = get('results-status');
  status.textContent='Загрузка…';
  try {
    const response = await fetch(apiUrl('./api/history'),{signal:AbortSignal.timeout(8000)});
    if (revision!==lookupRevision) return;
    if (!response.ok) throw Error('history');
    const entries = await response.json();
    if (revision!==lookupRevision) return;
    get('results').append(makeRows(entries, entry => void playResult(entry.ticket)));
    status.textContent = entries.length?'':'История пока пуста.';
  } catch {
    if (revision===lookupRevision) status.textContent='Не удалось загрузить историю.';
  }
}

function showClips() {
  setPanel('clips');
  get('browse-title').textContent = 'Другие видео';
  clipsKey = '';
  paintClips();
}

function paintClips() {
  const {queue_generation:generation,queue,clips}=playback;
  const current = queue.find(entry=>entry.current);
  const key = JSON.stringify([generation,current?.ordinal,clips]);
  if (key===clipsKey) return;
  clipsKey = key;
  const results = get('results');
  results.replaceChildren();
  get('results-status').textContent = current && clips.length ? '' : 'Для текущего трека пока нет других видео.';
  if (!current) return;
  for (const clip of clips) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(clip.id)) continue;
    const card = makeButton('', async () => {
      if (await send({type:'clip',generation,ordinal:current.ordinal,id:clip.id}) && panel==='clips') setPanel('');
    }, 'alternative-video');
    card.setAttribute('aria-pressed',String(clip.current));
    card.disabled = !online;

    const image = document.createElement('img');
    image.src = 'https://i.ytimg.com/vi/' + clip.id + '/mqdefault.jpg';
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    const body = document.createElement('span');
    const title = document.createElement('strong');
    const meta = document.createElement('small');
    title.textContent = clip.title;
    const views = clip.views == null ? 'просмотры неизвестны' : clip.views.toLocaleString('ru-RU') + ' просмотров';
    const duration = clip.durationSeconds == null ? 'длительность неизвестна' : time(clip.durationSeconds);
    meta.textContent = views + ' · ' + duration + (clip.needsReview ? ' · проверить исполнителя' : '');
    body.append(title,meta);
    card.append(image,body);
    results.append(card);
  }
}

function showSearch() {
  if (panel==='search') return;
  setPanel('search');
  get('browse-title').textContent = 'Поиск';
  get('results-status').textContent = 'Введите исполнителя, трек, альбом или плейлист.';
}
function search() {
  clearTimeout(searchTimer);
  const query=get('query').value.trim();
  if (query.length>=2) void loadMusic({type:'search',query,page:0});
}

async function paintLyrics(force=false) {
  const generation = playback?.queue_generation;
  const track = playback?.queue.find(entry=>entry.current);
  const key = JSON.stringify([generation,track?.ordinal,track?.title,track?.artist]);
  if (!force && key===lyricsKey) return;
  lyricsKey = key;
  const revision = ++lookupRevision;
  const results = get('results');
  const status = get('results-status');
  results.replaceChildren();
  get('browse').scrollTop = 0;
  get('browse-title').textContent = 'Текст песни';
  if (!track) {
    status.textContent = 'Выберите трек.';
    return;
  }
  const title = document.createElement('h2');
  title.textContent = track.title;
  const artist = document.createElement('small');
  artist.className = 'lyrics-credit';
  artist.textContent = track.artist;
  results.append(title,artist);
  status.textContent = 'Ищем текст…';
  try {
    const response = await post('./api/lyrics',{generation,ordinal:track.ordinal},30_000);
    if (revision!==lookupRevision) return;
    if (response.status===409) {
      status.textContent = 'Текущий трек изменился. Повторите запрос.';
      results.append(makeButton('Повторить',()=>void paintLyrics(true)));
      return;
    }
    if (!response.ok) throw Error('lyrics');
    const lyrics = await response.json();
    if (revision!==lookupRevision) return;
    status.textContent = lyrics ? '' : 'Текст песни не найден.';
    if (!lyrics) return;
    const credit = document.createElement('small');
    credit.className = 'lyrics-credit';
    credit.textContent = `Источник: ${lyrics.source}`;
    results.append(credit);
    if (lyrics.originalArtist) {
      const badge = document.createElement('small');
      badge.className = 'lyrics-credit';
      badge.textContent = `Текст ремикса не найден. Показан текст оригинала (${lyrics.originalArtist}).`;
      results.append(badge);
    }
    const body = document.createElement('p');
    body.className = 'song-lyrics';
    body.textContent = lyrics.text;
    results.append(body);
  } catch {
    if (revision!==lookupRevision) return;
    status.textContent = 'Не удалось загрузить текст.';
    results.append(makeButton('Повторить',()=>void paintLyrics(true)));
  }
}

get('menu-toggle').onclick = () => { get('query').blur(); setPanel(panel==='menu'?'':'menu'); };
get('close-panel').onclick = () => { setPanel(''); get('query').blur(); };
get('query').onfocus = () => {
  if (panel!=='search') {
    showSearch();
    search();
  }
};
get('query').oninput = () => {
  ++lookupRevision;
  showSearch();
  get('results').replaceChildren();
  get('results-status').textContent = get('query').value.trim().length>=2?'Поиск…':'Введите хотя бы два символа.';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search,420);
};
get('search-form').onsubmit = event => { event.preventDefault(); search(); get('query').blur(); };
get('chart').onclick = () => void loadMusic({type:'chart'});
get('library').onclick = () => void loadMusic({type:'library'});
get('history').onclick = () => void showHistory();
get('clips').onclick = showClips;
get('lyrics').onclick = () => {
  get('query').blur();
  setPanel(panel==='lyrics'?'':'lyrics');
  if (panel==='lyrics') void paintLyrics();
};
get('undo-dislike').onclick = () => void send({type:'undo_dislike',key:playback.music.undo_key});
get('wave').onclick = async () => {
  get('wave').disabled = true;
  if (await send({type:'wave',station:get('station').value})) void connect();
  else setOnline(online);
};
for (const button of document.querySelectorAll('[data-command]')) button.onclick = () => void send({type:button.dataset.command});
for (const [target,id] of Object.entries(reactionButtons)) {
  get(id).onclick = () => {
    const current = playback.queue.find(entry=>entry.current);
    if (!current) return;
    const active = !playback.music[reactionField[target]];
    void send({type:'reaction',target,active,generation:playback.queue_generation,ordinal:current.ordinal,
      video_id:target==='clip'?playback.music.video_id:undefined});
  };
}
get('toggle').onclick = () => void send({type:playback?.playing?'pause':'play'});
seek.oninput = () => { get('elapsed').textContent = time(Number(seek.value)); };
seek.onchange = () => { void send({type:'seek',seconds:Number(seek.value)}); seek.blur(); };
volume.onchange = () => { void send({type:'volume',level:Number(volume.value)}); volume.blur(); };
document.addEventListener('keydown', event => {
  if (event.key==='Escape' && panel && !get('install').open) { setPanel(''); get('query').blur(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    needsSession = true;
    clearTimeout(reconnect);
  }
  else void connect();
});
window.addEventListener('online', () => void connect());
for (const id of ['pair-retry','retry-connection']) {
  get(id).onclick = () => {
    needsSession = true;
    clearTimeout(reconnect);
    void connect();
  };
}
window.addEventListener('offline', () => { needsSession = true; clearTimeout(reconnect); disconnected(); });
window.addEventListener('hashchange', () => {
  const code = readPairCode();
  if (code) {
    pairCode = code;
    void connect();
  }
});
window.addEventListener('remote-qr-scanned', event => {
  const {path,code} = event.detail || {};
  if (!computerPath.test(path || '') || !/^[a-f0-9]{64}$/.test(code || '')) return;
  ++connectionRevision;
  apiBase = path;
  pairCode = code;
  needsSession = true;
  playback = undefined;
  queueKey = clipsKey = stationsKey = '';
  previousStation = undefined;
  setPanel('');
  setOnline(false);
  get('queue').replaceChildren();
  get('title').textContent = 'Подключаемся к компьютеру…';
  get('artist').textContent = '';
  clearTimeout(reconnect);
  void connect();
});
if ('serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('./worker.js').catch(()=>{});
}
void connect();
