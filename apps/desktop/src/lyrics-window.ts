import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {lyricsMarkup, mountLyricsView, type LyricsSnapshot} from './lyrics-view';
import {paintRange} from './visual-controls';
import './lyrics.css';

const root = document.querySelector<HTMLElement>('#detached-lyrics')!;
root.innerHTML = lyricsMarkup;
const draw = mountLyricsView(root);
const fontSize = document.querySelector<HTMLInputElement>('#lyrics-font-size')!;
const fontValue = document.querySelector<HTMLOutputElement>('#lyrics-font-value')!;
const fontPreference = 'ycore.lyrics.fontSize.v1';

try {
  const saved = localStorage.getItem(fontPreference);
  if (saved !== null && Number.isFinite(Number(saved))) fontSize.value = saved;
} catch { /* Keep the default if storage is unavailable. */ }

function applyFontSize() {
  const value = fontSize.value + ' px';
  root.style.setProperty('--lyrics-font-size', fontSize.value + 'px');
  fontValue.value = value;
  fontSize.setAttribute('aria-valuetext', value);
  paintRange(fontSize);
}

fontSize.addEventListener('input', applyFontSize);
fontSize.addEventListener('change', () => {
  try {
    localStorage.setItem(fontPreference, fontSize.value);
  } catch { /* The setting still applies to this window. */ }
});
applyFontSize();

let revision = -1;
function render(snapshot: LyricsSnapshot) {
  if (snapshot.revision <= revision) return;
  if (root.querySelector('.lyrics-title')?.textContent !== snapshot.title ||
      root.querySelector('.lyrics-artist')?.textContent !== snapshot.artist) {
    window.scrollTo(0, 0);
  }
  revision = snapshot.revision;
  draw(snapshot);
}

async function connect() {
  await listen<LyricsSnapshot>('lyrics-state', event => render(event.payload), {
    target: {kind: 'WebviewWindow', label: 'lyrics'},
  });
  const snapshot = await invoke<LyricsSnapshot | null>('lyrics_snapshot');
  if (snapshot) render(snapshot);
}
void connect().catch(() => {
  if (revision === -1) draw({revision: 0, title: '', artist: '', status: 'error'});
});
