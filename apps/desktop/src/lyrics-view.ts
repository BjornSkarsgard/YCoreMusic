import {invoke} from '@tauri-apps/api/core';

export type Lyrics = {
  text: string;
  source: 'Яндекс Музыка' | 'LRCLIB' | 'lyrics.ovh' | 'LrcAPI' | 'Pesni.net' | 'KuGou';
  originalArtist?: string;
};
type Content =
  | {status: 'empty' | 'loading' | 'missing' | 'error'}
  | {status: 'ready'; lyrics: Lyrics};
export type LyricsState = {title: string; artist: string} & Content;
export type LyricsSnapshot = LyricsState & {revision: number};

export const lyricsMarkup = `
  <h2 class="lyrics-title" hidden></h2>
  <p class="lyrics-artist" hidden></p>
  <p class="lyrics-status" role="status"></p>
  <p class="lyrics-source" hidden></p>
  <p class="lyrics-original" aria-live="polite" hidden></p>
  <div class="lyrics-translate-actions" hidden>
    <button class="lyrics-translate" type="button">Перевести на русский</button>
    <p class="lyrics-translate-status" role="status"></p>
  </div>
  <div class="lyrics-text" hidden></div>
`;

const messages = {
  empty: 'Выберите песню с указанным исполнителем.',
  loading: 'Ищем текст песни…',
  missing: 'Текст этой песни не найден.',
  error: 'Не удалось загрузить текст песни.',
};

export function mountLyricsView(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>('.lyrics-title')!;
  const artist = root.querySelector<HTMLElement>('.lyrics-artist')!;
  const status = root.querySelector<HTMLElement>('.lyrics-status')!;
  const source = root.querySelector<HTMLElement>('.lyrics-source')!;
  const original = root.querySelector<HTMLElement>('.lyrics-original')!;
  const translateActions = root.querySelector<HTMLElement>('.lyrics-translate-actions')!;
  const translateButton = root.querySelector<HTMLButtonElement>('.lyrics-translate')!;
  const translateStatus = root.querySelector<HTMLElement>('.lyrics-translate-status')!;
  const text = root.querySelector<HTMLElement>('.lyrics-text')!;
  let lyrics: Lyrics | undefined;
  let translated: string | undefined;
  let showingTranslation = false;
  let translating = false;
  let translationRun = 0;

  function paintText() {
    translateActions.hidden = !lyrics;
    translateButton.disabled = translating;
    translateButton.textContent = translating ? 'Переводим…'
      : showingTranslation ? 'Показать оригинал' : 'Перевести на русский';
    text.textContent = (showingTranslation ? translated : lyrics?.text) ?? '';
  }

  translateButton.onclick = async () => {
    if (!lyrics || translating) return;
    if (translated !== undefined) {
      showingTranslation = !showingTranslation;
      translateStatus.textContent = showingTranslation ? 'Машинный перевод · Google Переводчик' : '';
      paintText();
      return;
    }
    const run = ++translationRun;
    translating = true;
    translateStatus.textContent = '';
    paintText();
    try {
      const result = await invoke<string>('lyrics_translate', {text: lyrics.text});
      if (run !== translationRun) return;
      translated = result;
      showingTranslation = true;
      translateStatus.textContent = 'Машинный перевод · Google Переводчик';
    } catch {
      if (run === translationRun) translateStatus.textContent = 'Не удалось перевести текст. Попробуйте ещё раз.';
    } finally {
      if (run === translationRun) {
        translating = false;
        paintText();
      }
    }
  };
  return (snapshot: LyricsSnapshot) => {
    const nextLyrics = snapshot.status === 'ready' ? snapshot.lyrics : undefined;
    if (nextLyrics !== lyrics) {
      ++translationRun;
      lyrics = nextLyrics;
      translated = undefined;
      showingTranslation = translating = false;
      translateStatus.textContent = '';
    }
    title.textContent = snapshot.title;
    artist.textContent = snapshot.artist;
    title.hidden = !snapshot.title;
    artist.hidden = !snapshot.artist;
    status.textContent = snapshot.status === 'ready' ? '' : messages[snapshot.status];
    paintText();
    source.textContent = snapshot.status === 'ready' ? 'Источник: ' + snapshot.lyrics.source : '';
    const originalArtist = snapshot.status === 'ready' && snapshot.lyrics.originalArtist;
    original.hidden = !originalArtist;
    original.textContent = originalArtist ? `Текст ремикса не найден. Показан текст оригинала · ${originalArtist}` : '';
    text.hidden = source.hidden = snapshot.status !== 'ready';
  };
}

