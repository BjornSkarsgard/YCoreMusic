import {readFile} from 'node:fs/promises';
import {expect, test} from '@playwright/test';

test('mobile lyrics replace the queue and follow the current track', async ({page}) => {
  const path = '/remote/p/' + 'a'.repeat(64) + '/';
  const assets = new URL('../src-tauri/remote/', import.meta.url);
  let ordinal = 1;
  let supported = false;
  let releaseFirst!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.setViewportSize({width: 360, height: 740});
  await page.route('**' + path + '**', async route => {
    const resource = new URL(route.request().url()).pathname.slice(path.length);
    if (resource === 'api/session') return route.fulfill({status: 204});
    if (resource === 'api/state') return route.fulfill({json: {
      title: 'Трек ' + ordinal, artist: 'Исполнитель', playing: true,
      position: 30, duration: 180, volume: 50, repeat: 'off', clips: [],
      lyrics_supported: supported, queue_generation: 1,
      queue: [{ordinal, title: 'Трек ' + ordinal, artist: 'Исполнитель', current: true}],
    }});
    if (resource === 'api/lyrics') {
      const request = route.request().postDataJSON();
      expect(request).toEqual({generation: 1, ordinal: request.ordinal});
      if (request.ordinal === 1) await first;
      return route.fulfill({json: {text: 'Строка ' + request.ordinal, source: 'LRCLIB'}});
    }
    const types = {'': 'text/html', 'remote.js': 'text/javascript', 'remote.css': 'text/css'};
    const contentType = types[resource as keyof typeof types];
    if (!contentType) return route.fulfill({status: 404});
    return route.fulfill({contentType, body: await readFile(new URL(resource || 'index.html', assets))});
  });
  await page.goto(path);
  const lyrics = page.getByRole('button', {name: 'Текст песни', includeHidden: true});
  await expect(page.getByRole('button', {name: 'Пауза'})).toBeVisible();
  await expect(lyrics).toBeHidden();
  await page.getByRole('button', {name: 'Позже'}).click();
  supported = true;
  try {
    await lyrics.click();
    await expect(page.getByText('Ищем текст…')).toBeVisible();
    ordinal = 2;
    await expect(page.getByText('Строка 2')).toBeVisible();
    releaseFirst();
    await expect(page.getByText('Источник: LRCLIB')).toBeVisible();
    await expect(page.getByRole('button', {name: 'Пауза'})).toBeInViewport();
    await expect(page.getByText('Строка 1')).toHaveCount(0);
    await page.getByRole('button', {name: 'Закрыть панель'}).click();
    await expect(page.getByRole('heading', {name: 'Очередь'})).toBeVisible();
  } finally {
    releaseFirst();
  }
});
