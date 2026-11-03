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

test('compact presentation preserves the same player and explicit play state', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({contentType:'text/javascript', body:`
    window.calls=[]; window.YT={Player:class{
      constructor(id,options){this.options=options;setTimeout(()=>options.events.onReady({target:this}),0);}
      cueVideoById(){this.options.events.onStateChange({data:5});}
      setVolume(){} getDuration(){return 120;} getCurrentTime(){return 30;}
      playVideo(){window.calls.push('play');} destroy(){window.calls.push('destroy');}
    }};window.onYouTubeIframeAPIReady();
  `}));
  await page.goto('/'); await page.locator('#url').fill('M7lc1UVf-VE');
  await page.getByRole('button',{name:'Подготовить'}).click(); await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#play').click(); await page.locator('#mini').click();
  await expect(page.locator('body')).toHaveClass('compact');
  await expect(page.locator('#play')).toBeVisible();
  await page.locator('#mini').click();
  expect(await page.evaluate(()=>(window as any).calls)).toEqual(['play']);
});

test('source metadata stays text, failed prefetch preserves queue, mini invokes native window commands', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).isTauri=true;
    (window as any).commands=[];
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      (window as any).commands.push({cmd,args});
      if(cmd==='source_fetch') {
        if(!args.fresh) throw 'Network/TLS error';
        return [{id:'1',title:'<img src=x onerror=alert(1)>',artist:'Artist A'},{id:'2',title:'Track B',artist:'Artist B'}];
      }
    }};
  });
  await page.goto('/');
  await page.locator('#source-start').click();
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await expect(page.locator('#track-title')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#track-title img')).toHaveCount(0);
  await page.locator('#source-more').click();
  await expect(page.locator('#source-status')).toContainText('Текущая очередь сохранена');
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await page.locator('#queue-next').click();
  await expect(page.locator('#track-title')).toHaveText('Track B');
  await expect(page.locator('#play')).toBeDisabled();
  await page.locator('#mini').click(); await page.locator('#topmost').click();
  const commands=await page.evaluate(()=>(window as any).commands);
  expect(commands).toContainEqual({cmd:'window_mini',args:{compact:true}});
  expect(commands).toContainEqual({cmd:'window_topmost',args:{enabled:true}});
});

test('compact controls remain visible in a wide short window', async ({ page }) => {
  await page.setViewportSize({width:900,height:420});
  await page.goto('/'); await page.locator('#mini').click();
  const bounds=await page.locator('.timeline').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(420);
  await expect(page.locator('#mini')).toBeVisible();
});
