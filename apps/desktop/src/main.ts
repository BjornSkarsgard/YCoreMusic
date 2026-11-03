import './style.css';
import { videoId } from './video-id';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header><a class="brand">encore<span>●</span></a><span class="badge">ЭТАП 0 · ЛАБОРАТОРИЯ</span></header>
<main><section class="intro"><p class="eyebrow">МУЗЫКА ПОЛУЧАЕТ ЭКРАН</p><h1>Ещё одну.</h1><p>Первый шаг к вашему музыкальному телеканалу.<br>Проверяем воспроизведение, прежде чем строить эфир.</p></section>
<section class="workspace"><div class="screen"><div id="player"></div><div id="empty"><span>▶</span><h2>Начнём с одного клипа</h2><p>Вставьте YouTube-ссылку. Музыка начнётся только по Play.</p></div></div>
<form id="load"><label for="url">YouTube-ссылка или ID</label><div class="input-row"><input id="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" required><button>Подготовить</button></div></form>
<div class="controls"><button id="play" disabled>▶ Play</button><button id="pause" disabled>Ⅱ Пауза</button><button id="back" disabled>−5 с</button><button id="forward" disabled>+5 с</button><label>Громкость <input id="volume" type="range" min="0" max="100" value="50"></label></div>
<div class="timeline"><output id="elapsed">0:00</output><input id="seek" aria-label="Позиция видео" type="range" min="0" max="0" value="0" step="1" disabled><output id="duration">0:00</output></div><p id="status" role="status" aria-live="polite">Ожидание ссылки · без autoplay</p></section>
<aside><div><span class="dot"></span> Одна сцена · один плеер</div><p>Прототип использует системный аудиовыход. Выбор устройства, Яндекс и аудиоанализ ещё не реализованы.</p><details><summary>Журнал проверки</summary><pre id="log"></pre></details></aside></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let player: YT.Player | undefined;
let generation = 0;
let playerReady = false;
let apiPromise: Promise<void> | undefined;
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
element<HTMLFormElement>('load').addEventListener('submit', async event => {
  event.preventDefault();
  const id = videoId(element<HTMLInputElement>('url').value);
  if (!id) { report('Нужна HTTPS-ссылка YouTube или video ID из 11 символов.'); return; }
  const current = ++generation;
  enabled(false);
  playerReady = false;
  player?.destroy(); player = undefined;
  element('empty').hidden = false;
  report('Загрузка YouTube API…');
  try {
    await api();
    if (current !== generation) return;
    let ready = false;
    const timer = setTimeout(() => {
      if (current === generation && !ready) { ++generation; enabled(false); playerReady = false; player?.destroy(); player = undefined; report('Видео не подготовилось за 20 секунд. Проверьте сеть и повторите загрузку.'); }
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
          event.target.cueVideoById(id);
          element('empty').hidden = true;
          report('Подготовка видео…');
        },
        onStateChange: event => {
          if (current !== generation) return;
          const states: Record<number, string> = { '-1': 'Видео загружено', 0: 'Видео завершено', 1: 'Воспроизведение', 2: 'Пауза', 3: 'Буферизация', 5: 'Готово · без autoplay' };
          if (event.data === 5) { ready = true; clearTimeout(timer); enabled(true); }
          report(states[event.data] ?? `Состояние ${event.data}`);
        },
        onError: event => { clearTimeout(timer); if (current === generation) { playerReady = false; enabled(false); report(`Ошибка YouTube ${event.data}. Проверьте доступность видео и разрешение на встраивание.`); } },
        onAutoplayBlocked: () => { if (current === generation) report('Webview заблокировал Play. Попробуйте кнопку в самом видео.'); },
      },
    });
  } catch (error) { if (current === generation) report(error instanceof Error ? error.message : 'Ошибка загрузки'); }
});
element('play').onclick = () => player?.playVideo();
element('pause').onclick = () => player?.pauseVideo();
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
