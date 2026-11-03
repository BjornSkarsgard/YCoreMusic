import { test, expect } from '@playwright/test';
test('startup is inert; loading cues, explicit Play plays; replacement removes old player', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('youtube')) requests.push(request.url()); });
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: `
    window.calls = [];
    window.YT = { Player: class {
      constructor(id, options) {
        this.el = document.getElementById(id);
        this.el.dataset.testPlayer = 'true';
        this.options = options;
        setTimeout(() => options.events.onReady({target:this}), 0);
      }
      getDuration() { return 120; }
      getCurrentTime() { return 0; }
      seekTo() {}
      setVolume() {}
      cueVideoById(id) { window.calls.push('cue:' + id); this.options.events.onStateChange({data:5}); }
      playVideo() { window.calls.push('play'); }
      pauseVideo() { window.calls.push('pause'); }
      destroy() { window.calls.push('destroy'); this.el.remove(); }
    }};
    window.onYouTubeIframeAPIReady();
  ` }));
  await page.goto('/');
  await expect(page.locator('#play')).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.locator('#url').fill('M7lc1UVf-VE');
  await page.getByRole('button', { name: 'Подготовить' }).click();
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['cue:M7lc1UVf-VE']);
  await page.locator('#play').click();
  expect(await page.evaluate(() => (window as any).calls)).toContain('play');
  await page.locator('#url').fill('dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Подготовить' }).click();
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['cue:M7lc1UVf-VE', 'play', 'destroy', 'cue:dQw4w9WgXcQ']);
  await expect(page.locator('[data-test-player]')).toHaveCount(1);
});

test('cue timeout cannot be revived by a late callback', async ({ page }) => {
  await page.clock.install();
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({contentType:'text/javascript', body:`
    window.YT = { Player: class {
      constructor(id, options) { this.el=document.getElementById(id); this.options=options; window.lateState=()=>options.events.onStateChange({data:5}); setTimeout(()=>options.events.onReady({target:this}),0); }
      cueVideoById() {} setVolume() {} getDuration() {return 0;} getCurrentTime() {return 0;} destroy() {this.el.remove();}
    }}; window.onYouTubeIframeAPIReady();
  `}));
  await page.goto('/');
  await page.locator('#url').fill('M7lc1UVf-VE');
  await page.getByRole('button', {name:'Подготовить'}).click();
  await expect(page.locator('#status')).toHaveText('Подготовка видео…');
  await page.clock.fastForward(21000);
  await expect(page.locator('#status')).toContainText('Видео не подготовилось');
  await page.evaluate(()=>(window as any).lateState());
  await expect(page.locator('#play')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Видео не подготовилось');
});
