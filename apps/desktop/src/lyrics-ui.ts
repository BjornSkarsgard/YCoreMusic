import {invoke, isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {mountLyricsView, type Lyrics, type LyricsSnapshot, type LyricsState} from './lyrics-view';
import {showPanel} from './shell';

type Track = {id: string; title: string; artist: string};

export function mountLyrics(getTrack: () => Track | undefined) {
  const pane = document.querySelector<HTMLElement>('[data-pane=lyrics]')!;
  const scroll = pane.parentElement!;
  const open = pane.querySelector<HTMLButtonElement>('#lyrics-popout')!;
  const retry = pane.querySelector<HTMLButtonElement>('#lyrics-retry')!;
  const windowStatus = pane.querySelector<HTMLElement>('#lyrics-window-status')!;
  const draw = mountLyricsView(pane);
  const cache = new Map<string, Lyrics | null>();
  const pending = new Set<string>();
  let selected = '';
  let panel = 'wave';
  let detached = false;
  let detaching = false;
  let detachAttempt = 0;
  let listening: Promise<unknown> | undefined;
  let snapshot: LyricsSnapshot = {revision: 0, title: '', artist: '', status: 'empty'};
  const panelVisible = () => !pane.hidden && !document.body.matches('.panel-collapsed, .compact');
  const visible = () => panelVisible() || detached || detaching;

  function render() {
    draw(snapshot);
    retry.hidden = snapshot.status !== 'error' && snapshot.status !== 'missing';
  }

  function update(next: LyricsState) {
    snapshot = {...next, revision: Math.max(Date.now(), snapshot.revision + 1)};
    render();
    if (detached || detaching) void invoke('lyrics_publish', {snapshot}).catch(() => {});
  }

  function refresh(force = false) {
    if (!visible()) return;
    const track = getTrack();
    const title = track?.title.trim() ?? '';
    const artist = track?.artist.trim() ?? '';
    const key = title && artist ? JSON.stringify([track?.id, title, artist]) : '';
    if (selected !== key || force || snapshot.revision === 0) {
      selected = key;
      if (panelVisible()) scroll.scrollTop = 0;
      const cached = cache.get(key);
      if (cached) update({title, artist, status: 'ready', lyrics: cached});
      else update({title, artist, status: !key ? 'empty' : cached === null ? 'missing' : 'loading'});
    }
    if (snapshot.status !== 'loading' || pending.has(key) || pending.size >= 2) return;
    pending.add(key);
    void invoke<Lyrics | null>('lyrics_search', {trackId: track?.id, title, artist}).then(lyrics => {
      if (cache.size >= 40) cache.delete(cache.keys().next().value!);
      cache.set(key, lyrics);
      if (key !== selected) return;
      if (lyrics) update({title, artist, status: 'ready', lyrics});
      else update({title, artist, status: 'missing'});
    }).catch(() => {
      if (key === selected) update({title, artist, status: 'error'});
    }).finally(() => {
      pending.delete(key);
      refresh();
    });
  }

  document.addEventListener('main-panel-change', event => {
    const name = (event as CustomEvent<string>).detail;
    if (name && name !== 'lyrics') panel = name;
    if (panelVisible()) {
      windowStatus.textContent = '';
      render();
    }
    refresh();
  });
  document.addEventListener('window-layout-change', () => refresh());
  retry.onclick = () => {
    cache.delete(selected);
    refresh(true);
  };
  open.disabled = !isTauri();
  open.onclick = async () => {
    if (detaching) return;
    const attempt = ++detachAttempt;
    open.disabled = detaching = true;
    windowStatus.textContent = '';
    try {
      listening ??= listen('lyrics-window-closed', () => {
        detached = detaching = false;
        ++detachAttempt;
        open.disabled = false;
      }, {target: {kind: 'WebviewWindow', label: 'main'}}).catch(error => {
        listening = undefined;
        throw error;
      });
      await listening;
      await invoke('lyrics_open', {snapshot});
      if (attempt !== detachAttempt) return;
      detached = true;
      if (panelVisible()) showPanel(panel);
    } catch {
      windowStatus.textContent = 'Не удалось открыть отдельное окно.';
    } finally {
      if (attempt === detachAttempt) open.disabled = detaching = false;
    }
  };
  return refresh;
}
