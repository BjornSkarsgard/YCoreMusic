import {test, expect} from './fixtures';

test('lyrics load on demand, replace the sidebar, and ignore late results while detached', async ({page}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.requests = [];
    w.results = {};
    w.updates = [];
    w.handlers = {};
    const callbacks: Function[] = [];
    w.__TAURI_INTERNALS__ = {
      transformCallback: (fn: Function) => callbacks.push(fn) - 1,
      invoke: async (command: string, args: any) => {
        if (command === 'plugin:event|listen') {
          w.handlers[args.event] = callbacks[args.handler];
          return args.handler;
        }
        if (command === 'source_fetch') return [
          {id: '1', title: 'First song', artist: 'Fixture'},
          {id: '2', title: 'Second song', artist: 'Fixture'},
          {id: '3', title: 'Third song', artist: 'Fixture'},
        ];
        if (command === 'search_videos') return [];
        if (command === 'lyrics_search') {
          w.requests.push(args.title);
          return new Promise(resolve => w.results[args.title] = resolve);
        }
        if (command === 'lyrics_open' || command === 'lyrics_publish') w.updates.push(args.snapshot);
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('#track-title')).toHaveText('First song');
  expect(await page.evaluate(() => (window as any).requests)).toEqual([]);
  const alternatives = page.locator('#video-alternatives');
  await alternatives.evaluate(el => el.hidden = false);
  await expect(alternatives).toBeVisible();

  const lyrics = page.locator('#lyrics-pane');
  await page.getByRole('button', {name: 'Текст песни', exact: true}).click();
  await expect(lyrics.locator('.lyrics-status')).toHaveText('Ищем текст песни…');
  await expect(alternatives).toBeHidden();
  await expect(page.locator('.screen')).toBeVisible();
  await lyrics.getByRole('button', {name: 'В отдельное окно'}).click();
  await expect(lyrics).toBeHidden();
  await expect(page.locator('[data-pane=wave]')).toBeVisible();

  await page.locator('#queue-next').click();
  await expect(page.locator('#track-title')).toHaveText('Second song');
  await expect.poll(() => page.evaluate(() => (window as any).updates.at(-1)?.title)).toBe('Second song');
  await page.evaluate(() => (window as any).results['Second song']({source: 'lyrics.ovh', text: '<em>Second verse</em>', originalArtist: 'Original artist'}));
  await expect.poll(() => page.evaluate(() => (window as any).updates.at(-1)?.status)).toBe('ready');
  await page.evaluate(() => (window as any).results['First song']({source: 'Pesni.net', text: 'Stale text'}));

  await page.getByRole('button', {name: 'Текст песни', exact: true}).click();
  await expect(lyrics.locator('.lyrics-text')).toHaveText('<em>Second verse</em>');
  await expect(lyrics.locator('.lyrics-text em')).toHaveCount(0);
  await expect(lyrics.locator('.lyrics-source')).toHaveText('Источник: lyrics.ovh');
  await expect(lyrics.locator('.lyrics-original')).toHaveText('Текст ремикса не найден. Показан текст оригинала · Original artist');
  await page.locator('#toggle-panel').click();
  await page.evaluate(() => (window as any).handlers['lyrics-window-closed']({}));
  await page.locator('#queue-next').click();
  await expect(page.locator('#track-title')).toHaveText('Third song');
  expect(await page.evaluate(() => (window as any).requests)).toEqual(['First song', 'Second song']);
});

test('detached lyrics keep the newest event if the initial snapshot arrives late', async ({page}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.translations = [];
    w.__TAURI_INTERNALS__ = {
      transformCallback: (fn: Function) => {w.receive = fn; return 1;},
      invoke: async (command: string, args: {text?: string}) => {
        if (command === 'plugin:event|listen') return 1;
        if (command === 'lyrics_snapshot') return new Promise(resolve => w.resolveInitial = resolve);
        if (command === 'lyrics_translate') {
          w.translations.push(args.text);
          return 'Первая строка\nВторая строка';
        }
      },
    };
  });
  await page.goto('/lyrics.html');
  await page.evaluate(() => {
    const w = window as any;
    w.receive({payload: {revision: 2, title: 'Current song', artist: 'Fixture', status: 'ready', lyrics: {source: 'LRCLIB', text: 'First line\nSecond line', originalArtist: 'Original artist'}}});
    w.resolveInitial({revision: 1, title: 'Previous song', artist: 'Fixture', status: 'missing'});
  });
  await expect(page.getByRole('heading')).toHaveText('Current song');
  const text = page.locator('.lyrics-text');
  await expect(text).toHaveText('First line\nSecond line', {useInnerText: true});
  await expect(text).toHaveCSS('text-align', 'center');
  await expect(text).toHaveCSS('font-size', '32px');
  await expect(page.locator('.lyrics-original')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).translations)).toEqual([]);
  await page.getByRole('button', {name: 'Перевести на русский'}).click();
  await expect(text).toHaveText('Первая строка\nВторая строка', {useInnerText: true});
  await page.getByRole('button', {name: 'Показать оригинал'}).click();
  await expect(text).toHaveText('First line\nSecond line', {useInnerText: true});
  await page.getByRole('button', {name: 'Перевести на русский'}).click();
  await expect(text).toHaveText('Первая строка\nВторая строка', {useInnerText: true});
  expect(await page.evaluate(() => (window as any).translations)).toEqual(['First line\nSecond line']);
  await page.evaluate(() => (window as any).receive({payload: {
    revision: 3, title: 'Next song', artist: 'Fixture', status: 'ready', lyrics: {source: 'LRCLIB', text: 'Exact lyrics'},
  }}));
  await expect(page.locator('.lyrics-original')).toBeHidden();
  await expect(text).toHaveText('Exact lyrics');

  const size = page.getByRole('slider', {name: 'Размер текста'});
  await size.focus();
  await size.press('End');
  await expect(text).toHaveCSS('font-size', '64px');
  await page.reload();
  await expect(size).toHaveValue('64');
  await expect(text).toHaveCSS('font-size', '64px');
});
