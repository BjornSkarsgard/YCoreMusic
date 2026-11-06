import { test, expect } from './fixtures';

test('a missing clip is marked as a technical failure even before Play and is not a fabricated listening event',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.fakeRecords=[];w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'123',title:'No clip',artist:'Artist'}];
  if(cmd==='search_videos')return [];
  if(cmd==='storage_command'&&args.request.type==='record')w.fakeRecords.push(args.request.event);
 }};});
 await page.goto('/');await expect(page.locator('#status')).toContainText('можно выбрать другой клип');
 await page.locator('[data-panel=queue]').click();await expect(page.locator('#queue-list .track-skipped')).toHaveCount(1);
 await page.getByRole('button',{name:'Причина пропуска: No clip · Artist',exact:true}).click();
 await expect(page.locator('.skip-reason-message:popover-open')).toContainText('Подходящий клип не найден');
 expect(await page.evaluate(()=>(window as any).fakeRecords)).toEqual([]);
});

test('guest can search, browse public collections and play chart clips while personal features require login',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.guestPrivate=false;w.guestWrites=0;
  const tracks=[{id:'2',title:'Guest song',artist:'Fixture'},{id:'3',title:'Guest second',artist:'Fixture'}];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='diagnostics_status')return {version:'0.0.1',platform:'windows',architecture:'x86_64',storageAvailable:true,yandex:'missing'};
   if(command==='source_fetch'||command==='library_overview')throw 'No saved token. Connect Yandex Music in Settings.';
   if(command==='feedback_command'){if(args.request.type==='set')w.guestWrites++;throw 'No saved token';}
   if(command==='catalogue_search')return {artists:[{kind:'artist',id:'1',title:'Guest artist',subtitle:''}],albums:[{kind:'album',id:'3',title:'Guest album',subtitle:''}],playlists:[{kind:'playlist',id:'4',owner:'5',title:'Guest playlist',subtitle:''}],tracks,page:0};
   if(command==='catalogue_collection'){if(w.guestPrivate)throw 'Authorization denied';return {title:'Public collection',tracks,hasMore:false,page:0};}
   if(command==='discovery_fetch')return {title:'Guest chart',tracks,playlists:[],playlistsAvailable:false};
   if(command==='search_videos')return [{id:'Aaaaaaaaaaa',title:args.title,score:100,reason:'fixture'}];
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await page.locator('#account-welcome-later').click();
 await page.locator('#catalogue-query').fill('Guest');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await expect(page.locator('#catalogue-results h3')).toHaveText(['Исполнители','Треки','Альбомы','Плейлисты']);
 for(const title of ['Guest artist','Guest album','Guest playlist']){
  await page.locator('.catalogue-card').filter({hasText:title}).click();await expect(page.locator('#catalogue-collection .catalogue-track')).toHaveCount(2);expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);await page.locator('#catalogue-back').click();
 }
 await page.locator('.catalogue-card').filter({hasText:'Guest playlist'}).click();await page.locator('#catalogue-play-all').click();await expect.poll(()=>page.evaluate(()=>(window as any).played[0])).toBe('Aaaaaaaaaaa');
 await expect(page.locator('#like')).toBeDisabled();await expect(page.locator('#dislike')).toBeDisabled();
 await page.locator('[data-panel=discovery]').click();await expect(page.locator('#discovery-content .discovery-track')).toHaveCount(2);await expect(page.locator('#discovery-status')).toContainText('Публичные плейлисты');await page.getByRole('button',{name:'Включить чарт'}).click();await expect(page.locator('#source-name')).toHaveText('Guest chart');await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(2);await expect(page.locator('#player')).toHaveCount(1);
 await page.locator('[data-panel=library]').click();await expect(page.locator('#library-status')).toContainText('Поиск и чарт доступны без входа');expect(await page.evaluate(()=>(window as any).guestWrites)).toBe(0);
 await page.locator('[data-panel=search]').click();await page.locator('#catalogue-back').click();await page.evaluate(()=>(window as any).guestPrivate=true);await page.locator('.catalogue-card').filter({hasText:'Guest playlist'}).click();await expect(page.locator('#catalogue-status')).toContainText('нужен вход или доступ владельца');await expect(page.locator('#source-name')).toHaveText('Guest chart');
});

test('confirmed logout removes Wave and never substitutes local history for an authenticated source',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.smartCalls=0;
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   const connected=localStorage.getItem('fixture.loggedOut')!=='1';
   if(command==='diagnostics_status')return {version:'0.0.1',platform:'windows',architecture:'x86_64',storageAvailable:true,yandex:connected?'saved':'missing'};
   if(command==='source_fetch'){if(!connected)throw 'No saved token. Connect Yandex Music in Settings.';return [{id:'1',title:'Fixture Wave',artist:'Fixture'}];}
   if(command==='smart_history_fetch'){w.smartCalls++;return [{id:'90',title:'Fixture history',artist:'Fixture',historyVideoId:'Ccccccccccc',weight:1}];}
   if(command==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Fixture Wave',score:100,reason:'fixture'}];
   if(command==='auth_command'&&args.action==='disconnect'){localStorage.setItem('fixture.loggedOut','1');return 'idle';}
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await page.locator('#source-start').click();await expect.poll(()=>page.evaluate(()=>(window as any).played[0])).toBe('Aaaaaaaaaaa');
 await page.locator('[data-panel=settings]').click();await page.locator('#account-disconnect').click();const reloaded=page.waitForEvent('load');await page.locator('#account-disconnect-confirm').click();await reloaded;
 await expect(page.locator('#account-welcome')).toBeVisible();await page.locator('#account-welcome-later').click();await expect(page.locator('#source-name')).toHaveText('Моя волна · нужен вход');
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('#queue-list li')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).smartCalls)).toBe(0);
 await page.locator('#source-start').click();await expect(page.locator('#source-status')).toContainText('Настройки → Яндекс Музыка');expect(await page.evaluate(()=>(window as any).smartCalls)).toBe(0);await expect(page.locator('iframe')).toHaveCount(0);
 await page.locator('[data-panel=history]').click();await page.locator('#history-smart').click();await expect(page.locator('#source-name')).toHaveText('Умная история');await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Ccccccccccc');
});
async function videoEditor(page:import('@playwright/test').Page){if(!await page.locator('#video-dialog').evaluate((dialog:HTMLDialogElement)=>dialog.open))await page.locator('#edit-video').click();}
async function historyPanel(page:import('@playwright/test').Page){await page.locator('[data-panel=history]').click();}
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
  await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');
  await page.getByRole('button', { name: 'Подготовить' }).click();
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['cue:M7lc1UVf-VE']);
  await page.locator('#play').click();
  expect(await page.evaluate(() => (window as any).calls)).toContain('play');
  await videoEditor(page);await page.locator('#url').fill('dQw4w9WgXcQ');
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
  await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');
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
  await page.goto('/'); await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');
  await page.getByRole('button',{name:'Подготовить'}).click(); await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#play').click(); await page.locator('#mini').click();
  await expect(page.locator('body')).toHaveClass(/compact/);
  await expect(page.locator('#pause')).toBeVisible();
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
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await expect(page.locator('#track-title')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#track-title img')).toHaveCount(0);
  await page.locator('#source-more').click();
  await expect(page.locator('#source-status')).toContainText('Текущая очередь сохранена');
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await page.locator('#queue-next').click();
  await expect(page.locator('#track-title')).toHaveText('Track B');
  await expect(page.locator('#play')).toBeEnabled();
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

async function mockAutomaticPlayer(page: import('@playwright/test').Page, failFirst = false,failIds:string[]=[]) {
  await page.addInitScript(()=>{(window as any).played=[];(window as any).loaded=[];(window as any).seeks=[];});
  await page.route('https://www.youtube.com/iframe_api', route=>route.fulfill({contentType:'text/javascript',body:`
    window.loaded=[];window.played=[];window.seeks=[];window.YT={Player:class{
      constructor(id,options){this.el=document.getElementById(id);this.options=options;window.activePlayer=this;setTimeout(()=>options.events.onReady({target:this}),0);}
      cueVideoById(value){const id=typeof value==='string'?value:value.videoId;this.id=id;window.loaded.push(id);if((${failFirst} && id==='Aaaaaaaaaaa') || ${JSON.stringify(failIds)}.includes(id)){queueMicrotask(()=>this.options.events.onError({data:101}));}else this.options.events.onStateChange({data:5,target:this});}
      setVolume(){} seekTo(position){window.seeks.push(position);} getDuration(){return 120;} getCurrentTime(){return 5;}
      playVideo(){window.played.push(this.id);this.options.events.onStateChange({data:1,target:this});}
      pauseVideo(){this.options.events.onStateChange({data:2,target:this});}
      destroy(){this.el.remove();}
    }};window.onYouTubeIframeAPIReady();
  `}));
}
test('slow B cannot be overtaken by ready C after A ends; paused Next stays paused',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch') return ['A','B','C'].map(id=>({id,title:id,artist:'Fixture'}));
      if(cmd==='search_videos') {
        if(args.title==='B') await new Promise(resolve=>(window as any).releaseB=resolve);
        return [{id:args.title.repeat(1)+args.title.toLowerCase().repeat(10),title:args.title,artist:'Fixture',score:100,reason:'fixture'}];
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
  await page.locator('#play').click();
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect(page.locator('#track-title')).toHaveText('B');
  expect(await page.evaluate(()=>(window as any).loaded)).toEqual(['Aaaaaaaaaaa']);
  await page.evaluate(()=>(window as any).releaseB());
  await expect.poll(()=>page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
  await page.locator('#pause').click();await page.locator('#queue-next').click();
  await expect(page.locator('#track-title')).toHaveText('C');
  await expect.poll(()=>page.evaluate(()=>(window as any).loaded)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb','Ccccccccccc']);
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
});
test('embed rejection tries another candidate for the same track without autoplay',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
      if(cmd==='source_fetch')return [{id:'1',title:'A',artist:'Fixture'}];
      if(cmd==='search_videos')return ['Aaaaaaaaaaa','Bbbbbbbbbbb'].map(id=>({id,title:'A',artist:'Fixture',score:100,reason:'fixture'}));
    }};
  });
  await mockAutomaticPlayer(page,true);await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).loaded)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#track-title')).toHaveText('A');
  expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
});

test('Pause while next track is being resolved cancels automatic continuation',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return ['A','B'].map(id=>({id,title:id,artist:'Fixture'}));
      if(cmd==='search_videos'){
        if(args.title==='B')await new Promise(resolve=>(window as any).releaseB=resolve);
        return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,artist:'Fixture',score:100,reason:'fixture'}];
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect(page.locator('#track-title')).toHaveText('B');
  await expect(page.locator('#pause')).toBeEnabled();await page.locator('#pause').click();
  await page.evaluate(()=>(window as any).releaseB());
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
});

test('saved manual clip precedes search and pause/resume produces one history event',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;(window as any).records=[];(window as any).searches=0;(window as any).saved=[];
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return [{id:'123',title:'A',artist:'Fixture'}];
      if(cmd==='search_videos'){(window as any).searches++;return [];}
      if(cmd==='storage_command'){
        const request=args.request;
        if(request.type==='get_video')return 'Bbbbbbbbbbb';
        if(request.type==='record')(window as any).records.push(request.event);
        if(request.type==='save_video')(window as any).saved.push(request.videoId);
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).loaded[0])).toBe('Bbbbbbbbbbb');
  expect(await page.evaluate(()=>(window as any).records)).toEqual([]);
  await page.locator('#play').click();await page.locator('#pause').click();await page.locator('#play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
  await videoEditor(page);await page.locator('#url').fill('Ccccccccccc');await page.getByRole('button',{name:'Подготовить'}).click();
  expect(await page.evaluate(()=>(window as any).saved)).toEqual(['Ccccccccccc']);
});
test('history replay wins over late startup source and clearing requires confirmation',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;(window as any).cleared=0;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return new Promise(resolve=>(window as any).releaseSource=()=>resolve([{id:'123',title:'Late wave',artist:'Fixture'}]));
      if(cmd==='storage_command'){
        if(args.request.type==='history')return [{id:1,trackId:'321',title:'From history',artist:'Fixture',videoId:'Bbbbbbbbbbb',startedAt:'2026-11-03T10:00:00Z'}];
        if(args.request.type==='clear_history')(window as any).cleared++;
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');
  await historyPanel(page);await page.locator('#history-list').getByRole('button',{name:'Воспроизвести',exact:true}).click();
  await expect(page.locator('#track-title')).toHaveText('From history');
  await page.evaluate(()=>(window as any).releaseSource());
  await expect(page.locator('#source-start')).toBeEnabled();
  await expect(page.locator('#track-title')).toHaveText('From history');
  await page.locator('#history-clear').click();expect(await page.evaluate(()=>(window as any).cleared)).toBe(0);
  await page.locator('#clear-cancel').click();expect(await page.evaluate(()=>(window as any).cleared)).toBe(0);
  await page.locator('#history-clear').click();await page.locator('#clear-confirm').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).cleared)).toBe(1);
});

test('unavailable saved clip falls back to search without deleting the saved choice',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;(window as any).removed=0;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return [{id:'123',title:'A',artist:'Fixture'}];
      if(cmd==='storage_command'){
        if(args.request.type==='get_video')return 'Aaaaaaaaaaa';
        if(args.request.type==='remove_video')(window as any).removed++;
      }
      if(cmd==='search_videos')return [{id:'Bbbbbbbbbbb',title:'A',artist:'Fixture',score:100,reason:'fixture'}];
    }};
  });
  await mockAutomaticPlayer(page,true);await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>(window as any).loaded)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
  expect(await page.evaluate(()=>(window as any).removed)).toBe(0);
  expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
});

test('uncertain matches are offered for selection and never autoplay',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
      if(cmd==='source_fetch')return [{id:'123',title:'A',artist:'Fixture'}];
      if(cmd==='search_videos')return [{id:'Bbbbbbbbbbb',title:'A',byline:'Any channel',views:12345,score:40,reason:'review',needsReview:true}];
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');
  await expect(page.locator('#candidate-list button')).toHaveCount(1);
  await expect(page.locator('#play')).toBeEnabled();
  await videoEditor(page);await page.locator('#candidate-list button').click();await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
});

test('Yandex catalogue renders sections, browsing leaves playback alone, starting list preserves order',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;(window as any).catalogueCalls=[];
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return [{id:'999',title:'Current wave',artist:'Fixture'}];
      if(cmd==='search_videos')return [{id:'Bbbbbbbbbbb',title:args.title,byline:'Uploader',score:100,reason:'fixture'}];
      if(cmd==='catalogue_search')return {artists:[{kind:'artist',id:'1',title:'Rammstein',subtitle:'Исполнитель'}],tracks:[{id:'2',title:'Du hast',artist:'Rammstein'}],albums:[{kind:'album',id:'3',title:'Sehnsucht',subtitle:'Rammstein'}],playlists:[{kind:'playlist',id:'4',owner:'5',title:'Rammstein playlist',subtitle:''}],page:0};
      if(cmd==='catalogue_collection'){
        (window as any).catalogueCalls.push(args);
        return {title:'Playlist',tracks:[{id:'3',title:'Three',artist:'Rammstein'},{id:'1',title:'One',artist:'Rammstein'},{id:'3',title:'Three',artist:'Rammstein'}],page:0,hasMore:false};
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#catalogue-query').fill('рамштайн');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('#catalogue-results h3')).toHaveText(['Исполнители','Треки','Альбомы','Плейлисты']);
  await page.locator('.catalogue-card').filter({hasText:'Rammstein playlist'}).click();
  await expect(page.locator('#catalogue-collection .catalogue-track')).toHaveCount(3);
  await expect(page.locator('#track-title')).toHaveText('Current wave');
  expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
  await page.getByRole('button',{name:'Воспроизвести список'}).click();
  await expect(page.locator('#track-title')).toHaveText('Three');
  await expect(page.locator('#queue-list li')).toHaveText(['Three · Rammstein','One · Rammstein','Three · Rammstein']);
  expect(await page.evaluate(()=>(window as any).catalogueCalls[0])).toEqual({kind:'playlist',id:'4',owner:'5',page:0});
});
test('late Yandex search cannot replace a newer query',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return [];
      if(cmd==='catalogue_search'){
        if(args.query==='old')await new Promise(resolve=>(window as any).releaseOld=resolve);
        return {artists:[{kind:'artist',id:'1',title:args.query,subtitle:'Исполнитель'}],tracks:[],albums:[],playlists:[],page:0};
      }
    }};
  });
  await page.goto('/');await page.locator('#catalogue-query').fill('old');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseOld)).toBe('function');
  await page.locator('#catalogue-query').fill('new');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('.catalogue-card strong')).toHaveText('new');
  await page.evaluate(()=>(window as any).releaseOld());
  await expect(page.locator('.catalogue-card strong')).toHaveText('new');
  await page.locator('#catalogue-query').fill('');await expect(page.locator('.catalogue-card')).toHaveCount(0);
});

test('Previous double press preserves paused state and repeat-one keeps the current track',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return ['A','B'].map(id=>({id,title:id,artist:'Fixture'}));
      if(cmd==='search_videos')return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture'}];
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
  await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText('B');await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#pause').click();await page.locator('#previous').click();await expect(page.locator('#track-title')).toHaveText('B');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([0]);
  await page.locator('#previous').click();await expect(page.locator('#track-title')).toHaveText('A');await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
  await page.locator('#repeat').click();await page.locator('#play').click();
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect.poll(()=>page.evaluate(()=>(window as any).loaded.length)).toBe(4);
  await expect(page.locator('#track-title')).toHaveText('A');
  await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(4);
});
test('volume and mute survive reload without starting playback',async({page})=>{
  await page.goto('/');await page.locator('#volume').fill('37');await page.locator('#mute').click();
  await page.reload();await expect(page.locator('#volume')).toHaveValue('37');await expect(page.locator('#mute')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#play')).toBeDisabled();
  await page.locator('#mute').click();await expect(page.locator('#mute')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('encore.volume.v1')!))).toEqual({level:37,muted:false});
});

test('finite pagination finishes before queue repeat, paused wrapping stays paused and Wave disables queue repeat',async({page})=>{
  await page.addInitScript(()=>{
    (globalThis as any).isTauri=true;(window as any).waveCalls=0;(window as any).collectionPages=[];
    (window as any).__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch'){(window as any).waveCalls++;return [{id:'9',title:'Wave',artist:'Fixture'}];}
      if(cmd==='search_videos')return [{id:args.title[0]+args.title[0].toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture'}];
      if(cmd==='catalogue_search')return {artists:[],tracks:[],albums:[],playlists:[{kind:'playlist',id:'10',owner:'20',title:'Finite list',subtitle:''}],page:0};
      if(cmd==='catalogue_collection'){
        (window as any).collectionPages.push(args.page);
        return {title:'Finite list',tracks:[{id:String(args.page+1),title:args.page===0?'P':'Q',artist:'Fixture'}],page:args.page,hasMore:args.page===0};
      }
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.locator('#catalogue-query').fill('fixture');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await page.locator('.catalogue-card').click();await page.getByRole('button',{name:'Воспроизвести список'}).click();
  await expect(page.locator('#track-title')).toHaveText('P');await expect.poll(()=>page.evaluate(()=>(window as any).played.includes('Ppppppppppp'))).toBe(true);
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect(page.locator('#track-title')).toHaveText('Q');
  expect(await page.evaluate(()=>(window as any).collectionPages)).toEqual([0,1]);
  expect(await page.evaluate(()=>(window as any).waveCalls)).toBe(1);
  await expect(page.locator('#play')).toBeEnabled();
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect(page.locator('#status')).toHaveText('Конец выбранного списка.');
  await page.locator('#repeat').click();await page.locator('#repeat').click();await expect(page.locator('#repeat')).toHaveText('Повтор: очередь');
  await page.locator('#play').click();await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect(page.locator('#track-title')).toHaveText('P');await expect(page.locator('#play')).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>(window as any).played.filter((id:string)=>id==='Ppppppppppp').length)).toBe(2);
  expect(await page.evaluate(()=>(window as any).collectionPages)).toEqual([0,1]);
  await page.locator('#pause').click();
  for(const title of ['Q','P']){await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText(title);await expect(page.locator('#play')).toBeEnabled();}
  expect(await page.evaluate(()=>(window as any).played.filter((id:string)=>id==='Ppppppppppp').length)).toBe(2);
  await page.locator('[data-panel=wave]').click();await page.locator('#source-start').click();await expect(page.locator('#track-title')).toHaveText('Wave');await expect(page.locator('#repeat')).toHaveText('Повтор: выкл.');
  await page.locator('#repeat').click();await page.locator('#repeat').click();await expect(page.locator('#repeat')).toHaveText('Повтор: выкл.');
});


test('system controls share the player; wake cancels autoplay and rejects late PLAYING until explicit Play',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.isTauri=true;w.events={};w.callbacks={};w.sourceCalls=0;w.mediaUpdates=[];let next=0;
    w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++next]=callback;return next;},invoke:async(cmd:string,args:any)=>{
      if(cmd==='plugin:event|listen'){w.events[args.event]=w.callbacks[args.handler];return args.handler;}
      if(cmd==='source_fetch'){w.sourceCalls++;return [{id:'1',title:'Track A',artist:'Artist A'}];}
      if(cmd==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Track A',score:100,reason:'fixture'}];
      if(cmd==='media_update')w.mediaUpdates.push(args.update);
    }};
    w.emit=(event:string,payload:any)=>w.events[event]({event,payload});
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await page.evaluate(()=>(window as any).emit('encore-media',{action:'play',value:0}));
  await expect(page.locator('#status')).toHaveText('Воспроизведение');
  await page.evaluate(()=>(window as any).emit('power-monitor://suspend',null));
  await page.evaluate(()=>(window as any).emit('power-monitor://resume',null));
  await expect(page.locator('#status')).toContainText('После сна · пауза');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([5]);
  await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onStateChange({data:1,target:w.activePlayer});});
  await expect(page.locator('#status')).toHaveText('Пауза');
  expect(await page.evaluate(()=>(window as any).played)).toHaveLength(1);
  expect(await page.evaluate(()=>(window as any).sourceCalls)).toBe(1);
  await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
  const updates=await page.evaluate(()=>(window as any).mediaUpdates);
  expect(updates.at(-1).playback).toBe('playing');expect(updates.some((u:any)=>u.playback==='paused')).toBe(true);
});


test('history next and append preserve playing clip and saved video IDs while keeping source continuation',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.isTauri=true;w.more=0;
    w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch'){if(!args.fresh){w.more++;return [{id:'3',title:'C',artist:'Fixture'}];}return ['A','B'].map(id=>({id,title:id,artist:'Fixture'}));}
      if(cmd==='search_videos')return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture'}];
      if(cmd==='storage_command'&&args.request.type==='history')return [{trackId:'9',title:'History H',artist:'Fixture',videoId:'Hhhhhhhhhhh',startedAt:1}];
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
  await historyPanel(page);
  await page.locator('#history-list').getByRole('button',{name:'Следом',exact:true}).click();
  await page.locator('#history-list').getByRole('button',{name:'В конец',exact:true}).click();
  await expect(page.locator('#track-title')).toHaveText('A');
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
  const rows=await page.locator('#queue-list li').allTextContents();expect(rows.slice(0,3)).toEqual(['A · Fixture','History H · Fixture','B · Fixture']);expect(rows.at(-1)).toBe('History H · Fixture');
  for(const title of rows.slice(1).map(row=>row.split(' · ')[0])){await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText(title);await expect(page.locator('#play')).toBeEnabled();}
  expect((await page.evaluate(()=>(window as any).played)).slice(0,3)).toEqual(['Aaaaaaaaaaa','Hhhhhhhhhhh','Bbbbbbbbbbb']);
  expect(await page.evaluate(()=>(window as any).more)).toBeGreaterThanOrEqual(1);
});

test('history next retains a playing manual video when there is no source queue',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.isTauri=true;
    w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')throw 'No saved token. Run yandex-probe --save-token locally first.';
      if(cmd==='storage_command'&&args.request.type==='history')return [{trackId:'9',title:'History H',artist:'Fixture',videoId:'Hhhhhhhhhhh',startedAt:1}];
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
  await historyPanel(page);
  await page.locator('#history-list').getByRole('button',{name:'Следом',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE']);
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText('History H');await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE','Hhhhhhhhhhh']);
});


test('local Space and arrows control playback while search and link fields keep editing keys',async({page})=>{
  await mockAutomaticPlayer(page);await page.goto('/');await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('#play')).toBeEnabled();await page.locator('#track-title').click();
  await page.keyboard.press('Space');await expect(page.locator('#status')).toHaveText('Воспроизведение');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([10,0]);
  await page.keyboard.press('Space');await expect(page.locator('#status')).toHaveText('Пауза');
  await page.locator('#catalogue-query').fill('artist');await page.keyboard.press('Space');await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#catalogue-query')).toHaveValue('artist ');await expect(page.locator('#status')).toHaveText('Пауза');
  await videoEditor(page);await page.locator('#url').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([10,0]);
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE']);
});

test('custom controls suppress iframe input, captions use exposed options and settings reload preserves position/history',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.isTauri=true;w.records=[];
    w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')return [{id:'1',title:'Fixture',artist:'Artist'}];
      if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Fixture',score:100,reason:'fixture'}];
      if(cmd==='storage_command'&&args.request.type==='record')w.records.push(args.request.event);
    }};
  });
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
    window.players=[];window.played=[];window.cues=[];window.captionWrites=[];
    window.YT={Player:class {
      constructor(id,options){this.options=options;this.track={languageCode:'en',kind:'',name:''};this.frame=document.createElement('iframe');this.frame.id=id;this.frame.srcdoc='<p>Video fixture</p>';document.getElementById(id).replaceWith(this.frame);window.players.push(this);setTimeout(()=>options.events.onReady({target:this}),0);}
      getIframe(){return this.frame;}getCurrentTime(){return 42;}getDuration(){return 120;}setVolume(){}seekTo(){}
      cueVideoById(value){window.cues.push(value);this.options.events.onStateChange({data:5,target:this});this.options.events.onApiChange({target:this});}
      playVideo(){this.track={languageCode:'en',kind:'',name:''};window.played.push('play');this.options.events.onStateChange({data:1,target:this});}
      pauseVideo(){this.options.events.onStateChange({data:2,target:this});}destroy(){this.frame.remove();}
      loadModule(){} unloadModule(){this.track={};}
      getOptions(){return ['track','tracklist','fontSize','reload'];}
      getOption(module,option){if(option==='tracklist')return [{languageCode:'en',displayName:'English'},{languageCode:'ru',displayName:'Русский'}];return this.track;}
      setOption(module,option,value){window.captionWrites.push({option,value});if(option==='track')this.track=value;}
    }};window.onYouTubeIframeAPIReady();
  `}));
  await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#player')).toHaveCSS('pointer-events','none');await expect(page.locator('#player')).toHaveAttribute('tabindex','-1');
  expect(await page.evaluate(()=>(window as any).players[0].options.playerVars)).toMatchObject({controls:0,fs:0,disablekb:1});
  await expect(page.locator('#captions')).toBeEnabled();await expect(page.locator('#captions')).toHaveValue('off');
  await page.locator('#play').click();await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).players[0].track)).toEqual({});
  await page.locator('#captions').selectOption({label:'Русский'});await page.locator('#caption-size').selectOption('1');
  expect(await page.evaluate(()=>(window as any).players[0].track.languageCode)).toBe('ru');
  await page.locator('#youtube-settings').click();await expect(page.locator('#youtube-settings')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#player')).toHaveCSS('pointer-events','auto');
  expect(await page.evaluate(()=>(window as any).players.at(-1).options.playerVars.controls)).toBe(1);
  expect(await page.evaluate(()=>(window as any).cues.at(-1))).toEqual({videoId:'M7lc1UVf-VE',startSeconds:42});
  expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).players.at(-1).track.languageCode)).toBe('ru');
  await page.locator('#pause').click();await page.locator('#youtube-settings').click();await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#player')).toHaveCSS('pointer-events','none');expect(await page.evaluate(()=>(window as any).played.length)).toBe(2);
  expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
  await page.evaluate(()=>{const w=window as any;w.players[0].options.events.onPlaybackQualityChange({data:'hd2160',target:w.players[0]});});
  await expect(page.locator('#video-quality')).toHaveText('Качество: Авто');
  await page.evaluate(()=>{const w=window as any;w.players.at(-1).options.events.onPlaybackQualityChange({data:'hd720',target:w.players.at(-1)});});
  await expect(page.locator('#video-quality')).toHaveText('Качество: 720p');
});

test('Wave skips missing, uncertain and rejected clips, refills ahead and continues unattended',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.batches=0;w.searchActive=0;w.searchMax=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'){w.batches++;return (args.fresh?['A','B','C','D']:['E','F','G','H','I']).map(id=>({id,title:id,artist:'Fixture'}));}
   if(cmd==='search_videos'){
    w.searchMax=Math.max(w.searchMax,++w.searchActive);await new Promise(r=>setTimeout(r,15));--w.searchActive;
    if(args.title==='A')return [];
    return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture',needsReview:args.title==='B'}];
   }
  }};
 });
 await mockAutomaticPlayer(page,false,['Ccccccccccc']);await page.goto('/');
 await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
 await page.locator('#source-start').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).played?.[0])).toBe('Ddddddddddd');
 await expect(page.locator('#auto-skip-notices')).toHaveCount(0);
 await page.locator('[data-panel=queue]').click();
 await expect(page.locator('#queue-list .track-skipped')).toHaveCount(3);
 const plays=await page.evaluate(()=>(window as any).played.length);
 for(const [title,reason] of [['A','Подходящий клип не найден'],['B','Не удалось уверенно сопоставить'],['C','YouTube не воспроизвёл']]){
  await page.getByRole('button',{name:'Причина пропуска: '+title+' · Fixture',exact:true}).click();
  await expect(page.locator('.skip-reason-message:popover-open')).toContainText(reason);await page.keyboard.press('Escape');
 }
 expect(await page.evaluate(()=>(window as any).played.length)).toBe(plays);
 await page.screenshot({path:'../../.tools/auto-skip-reasons.png'});
 await expect(page.locator('#video-dialog')).not.toBeVisible();
 expect(await page.evaluate(()=>(window as any).searchMax)).toBeLessThanOrEqual(3);
 expect(await page.evaluate(()=>(window as any).batches)).toBeGreaterThanOrEqual(3);
 await page.locator('#fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 for(let count=0;count<18;count++){
  const before=await page.evaluate(()=>(window as any).played.length);
  await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));
  await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBeGreaterThan(before);
 }
 expect(await page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 const played=await page.evaluate(()=>(window as any).played);expect(played).not.toContain('Aaaaaaaaaaa');expect(played).not.toContain('Bbbbbbbbbbb');expect(played).not.toContain('Ccccccccccc');
 await page.mouse.move(100,100);await page.locator('#pause').click();const count=played.length;await page.waitForTimeout(100);expect(await page.evaluate(()=>(window as any).played.length)).toBe(count);
});

test('skip reason popovers render metadata as text and cannot trigger the playback row',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const module=await import(new URL('/src/skip-notices.ts',location.href).href);
  const row=document.createElement('div');document.body.append(row);row.onclick=()=>{(window as any).rowPlayed=true;};
  module.markSkipped(row,'<img src=x onerror=alert(1)>','No matching video');
 });
 await page.getByRole('button',{name:'Причина пропуска: <img src=x onerror=alert(1)>',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
 const message=page.locator('.skip-reason-message:popover-open');await expect(message).toContainText('<img src=x onerror=alert(1)>');await expect(message.locator('img')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).rowPlayed)).toBeUndefined();
});

test('Wave retries metadata outages with backoff and Pause cancels automatic recovery',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.working=false;w.searchCount=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch')return ['A','B','C','D','E','F','G','H'].map(id=>({id,title:id,artist:'Fixture'}));
   if(cmd==='search_videos'){w.searchCount++;if(!w.working)throw 'Network error';return [{id:'M7lc1UVf-VE',title:'fixture',score:100,reason:'fixture'}];}
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await page.locator('#source-start').click();
 await expect(page.locator('#status')).toContainText('повтор через');
 await page.locator('#pause').click();const searches=await page.evaluate(()=>(window as any).searchCount);
 await page.clock.fastForward(60000);expect(await page.evaluate(()=>(window as any).searchCount)).toBe(searches);expect(await page.evaluate(()=>(window as any).played??[])).toEqual([]);
 await page.evaluate(()=>(window as any).working=true);await page.locator('#play').click();await page.clock.fastForward(4000);
 await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(1);
});

test('video and transport stay visible while searching and scrolling; genre Wave uses selected server seed',async({page})=>{
 await page.setViewportSize({width:1200,height:820});
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.seeds=[];
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_stations')return [{id:'genre:metal',title:'Метал'}];
   if(cmd==='source_fetch'){w.seeds.push(args.station);return [{id:'1',title:'Wave',artist:'Fixture'}];}
   if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Fixture',score:100,reason:'fixture'}];
   if(cmd==='catalogue_search')return {artists:[{kind:'artist',id:'1',title:'Rammstein',subtitle:'Исполнитель'}],tracks:Array.from({length:50},(_,i)=>({id:String(i),title:'Track '+i,artist:'Rammstein'})),albums:[],playlists:[],page:0};
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#station-select option')).toHaveCount(2);
 await page.locator('#station-select').selectOption('genre:metal');await page.locator('#source-start').click();await expect(page.locator('#source-name')).toHaveText('Моя волна · Метал');
 expect(await page.evaluate(()=>(window as any).seeds)).toContain('genre:metal');
 await page.locator('#catalogue-query').fill('рамштайн');await expect(page.locator('.catalogue-track')).toHaveCount(50);
 const before=await page.locator('.screen').boundingBox();await page.locator('.panel-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 expect(await page.locator('.screen').boundingBox()).toEqual(before);const transport=await page.locator('.controls').boundingBox();expect(transport!.y+transport!.height).toBeLessThanOrEqual(820);expect(await page.evaluate(()=>window.scrollY)).toBe(0);
 await page.screenshot({path:'../../.tools/redesign.png'});
});

test('Wave leaves a cued clip that never starts and keeps fullscreen during recovery',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch')return ['A','B','C','D','E','F','G','H'].map(id=>({id,title:id,artist:'Fixture'}));
   if(cmd==='search_videos')return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture'}];
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 // Freeze every current candidate at CUED; the watchdog must advance to B.
 await page.evaluate(()=>{const w=window as any;w.YT.Player.prototype.playVideo=function(){};});
 await page.locator('#source-start').click();await expect(page.locator('#track-title')).toHaveText('A');
 await page.locator('#fullscreen').click();await page.clock.fastForward(17000);
 await expect(page.locator('#track-title')).toHaveText('B');expect(await page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await page.mouse.move(100,100);await page.locator('#pause').click();
});

test('fullscreen controls overlay the video, wake on motion, stay while used and hide after idle',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')return [{id:'1',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Current',score:100,reason:'fixture'}];
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 const controls=await page.locator('.controls').boundingBox(),transport=await page.locator('.transport').boundingBox();
 expect(Math.abs(controls!.x+controls!.width/2-transport!.x-transport!.width/2)).toBeLessThan(1);
 const src=await page.locator('#player').getAttribute('src');await page.locator('#fullscreen').click();
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await expect(page.locator('.player-hud')).toHaveCSS('opacity','0');
 const video=await page.locator('.screen').boundingBox();expect(video!.x).toBe(0);expect(video!.y).toBe(0);
 await page.mouse.move(100,100);await page.evaluate(()=>document.dispatchEvent(new Event('fullscreenchange')));await page.clock.fastForward(200);await expect(page.locator('.player-hud')).toHaveCSS('opacity','1');
 expect(await page.locator('.screen').boundingBox()).toEqual(video);
 await page.clock.fastForward(4000);await expect(page.locator('.player-hud')).toHaveCSS('opacity','0');
 await page.mouse.move(120,100);await page.clock.fastForward(200);await page.locator('#play').hover();
 await page.clock.fastForward(5000);await expect(page.locator('.player-hud')).toHaveCSS('opacity','1');
 await page.screenshot({path:'../../.tools/fullscreen-controls.png'});
 await page.mouse.move(150,100);await page.clock.fastForward(4000);await expect(page.locator('.player-hud')).toHaveCSS('opacity','0');
 await page.evaluate(()=>document.exitFullscreen());await expect(page.locator('.player-hud')).toHaveCSS('opacity','1');
 expect(await page.locator('#player').getAttribute('src')).toBe(src);
});

test('catalogue detail has back navigation and ignores a late collection after returning',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')return [];
  if(cmd==='catalogue_search')return {artists:[{kind:'artist',id:'1',title:'Artist',subtitle:'Исполнитель'}],tracks:[],albums:[],playlists:[],page:0};
  if(cmd==='catalogue_collection'){await new Promise(resolve=>w.releaseCollection=resolve);return {title:'Artist',tracks:[{id:'1',title:'Late',artist:'Artist'}],page:0,hasMore:false};}
 }};});
 await page.goto('/');await page.locator('#catalogue-query').fill('Artist');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await page.locator('#catalogue-filters button').filter({hasText:/^Альбомы$/}).click();
 await expect(page.locator('#catalogue-results')).toContainText('пока нет результатов');
 await page.locator('#catalogue-filters button').filter({hasText:/^Всё$/}).click();
 await page.locator('.catalogue-card').click();await expect(page.locator('#catalogue-results')).toBeHidden();await expect(page.locator('#catalogue-back')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseCollection)).toBe('function');
 await page.locator('#catalogue-back').click();await page.evaluate(()=>(window as any).releaseCollection());
 await expect(page.locator('#catalogue-collection')).toBeHidden();await expect(page.locator('.catalogue-card')).toBeVisible();await expect(page.locator('#catalogue-query')).toHaveValue('Artist');
});

test('personal library browses playlists and paginated likes without replacing playback',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.libraryCalls=[];w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'99',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Current',score:100,reason:'fixture'}];
  if(cmd==='library_overview')return {playlists:[{kind:'playlist',id:'7',owner:'8',title:'My playlist',subtitle:'2 трека'}],liked_count:101};
  if(cmd==='discovery_fetch')return {title:'Chart',tracks:[{id:'1',title:'Liked 0',artist:'Fixture'}],playlists:[]};
  if(cmd==='catalogue_search')return {tracks:[{id:'1',title:'Liked 0',artist:'Fixture'}],artists:[],albums:[],playlists:[],page:0};
  if(cmd==='storage_command'&&args.request.type==='history')return [{id:1,trackId:'1',title:'Liked 0',artist:'Fixture',videoId:'M7lc1UVf-VE',startedAt:'2026-11-06T00:00:00Z'}];
  if(cmd==='catalogue_collection'){w.libraryCalls.push(args);return {title:'Likes',tracks:[{id:String(args.page+1),title:'Liked '+args.page,artist:'Fixture'}],page:args.page,hasMore:args.kind==='likes'&&args.page===0};}
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('[data-panel=library]').click();
 await page.locator('.library-playlist').click();await expect(page.locator('#library-content .catalogue-track')).toHaveCount(1);await expect(page.locator('#track-title')).toHaveText('Current');
 await page.locator('#library-content').getByRole('button',{name:'Моя музыка'}).click();await page.locator('#library-likes').click();await page.getByRole('button',{name:'Ещё песни',exact:true}).click();
 await expect(page.locator('#library-content .catalogue-track')).toHaveCount(2);expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
 await page.locator('#library-play-all').click();await expect(page.locator('#queue-list li')).toHaveText(['Liked 0 · Fixture','Liked 1 · Fixture']);
 expect(await page.evaluate(()=>(window as any).libraryCalls.map((c:any)=>c.kind))).toEqual(['playlist','likes','likes']);
 const libraryRow=page.locator('#library-content .catalogue-track').first();await expect(libraryRow).toHaveClass(/track-playing/);await expect(libraryRow.locator('.icon-pause')).toBeVisible();
 await page.evaluate(()=>(window as any).listPlayer=(window as any).activePlayer);
 await libraryRow.locator('button').click();await expect(page.locator('#status')).toHaveText('Пауза');await expect(libraryRow.locator('.icon-play')).toBeVisible();
 await libraryRow.locator('button').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.locator('[data-panel=discovery]').click();const chart=page.locator('.discovery-track').first();await expect(chart).toHaveClass(/track-playing/);await chart.locator('button').click();await expect(page.locator('#status')).toHaveText('Пауза');
 await page.locator('#play').click();await expect(chart.locator('.icon-pause')).toBeVisible();
 await page.locator('[data-panel=search]').click();await page.locator('#catalogue-query').fill('Liked');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 const search=page.locator('#catalogue-results .catalogue-track').first();await expect(search).toHaveClass(/track-playing/);await search.locator('button').click();await expect(page.locator('#status')).toHaveText('Пауза');
 await page.locator('[data-panel=history]').click();const history=page.locator('#history-list li').first();await expect(history).toHaveClass(/track-current/);await history.getByRole('button',{name:'Воспроизвести',exact:true}).click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.locator('[data-panel=queue]').click();const current=page.locator('#queue-list li[aria-current=true]');await expect(current.locator('.icon-pause')).toBeVisible();await current.locator('.queue-play').click();await expect(page.locator('#status')).toHaveText('Пауза');
 expect(await page.evaluate(()=>(window as any).activePlayer===(window as any).listPlayer)).toBe(true);
 await expect(current.locator('.queue-play')).toHaveCSS('justify-content','flex-start');
});

test('likes persist optimistically, dislike advances and Undo restores the old reaction without rewinding',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.offline=true;w.feedback={};w.reactions=[];w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return ['1','2','3','4','5'].map(id=>({id,title:'Track '+id,artist:'Fixture'}));
  if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Clip',score:100,reason:'fixture'}];
  if(cmd==='feedback_command'){
   const r=args.request;if(r.type==='sync'){if(w.offline)throw 'Offline';return {pending:0};}
   if(r.type==='get')return w.feedback[r.trackId]??{trackId:r.trackId,state:0,revision:1,pending:false};
   if(r.type==='set'){w.reactions.push(r);const previous=w.feedback[r.trackId]??{revision:1};return w.feedback[r.trackId]={trackId:r.trackId,state:r.state,revision:previous.revision+1,pending:true};}
  }
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#like')).toBeEnabled();await page.locator('#like').click();await expect(page.locator('#like')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#feedback-notice')).toContainText('сохранена');await expect(page.locator('#dislike')).toBeEnabled();await page.locator('#dislike').click();
 await expect(page.locator('#track-title')).toHaveText('Track 2');await page.locator('#feedback-undo').click();await expect(page.locator('#feedback-notice')).toContainText('отменён');
 await expect(page.locator('#track-title')).toHaveText('Track 2');expect(await page.evaluate(()=>(window as any).feedback['1'].state)).toBe(1);
 await page.evaluate(()=>{(window as any).offline=false;window.dispatchEvent(new Event('online'));});await page.clock.fastForward(2000);
 await expect.poll(()=>page.evaluate(()=>(window as any).reactions.length)).toBe(3);
});

test('alternative video cards show previews, views and durations and keep the same track playing',async({page})=>{
 await page.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"/>'}));
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.saved=[];w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'123',title:'Song',artist:'Artist'}];
  if(cmd==='search_videos')return [{id:'Lllllllllll',title:'Artist Song Live',views:2000000,durationSeconds:300,score:100,reason:'fixture'},{id:'Ooooooooooo',title:'Artist Song Official Video',views:1000000,durationSeconds:245,score:100,reason:'fixture'}];
  if(cmd==='storage_command'&&args.request.type==='save_video')w.saved.push(args.request.videoId);
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
 const card=page.locator('.alternative-video').filter({hasText:'Official Video'});await expect(card.locator('img')).toHaveAttribute('src','https://i.ytimg.com/vi/Ooooooooooo/mqdefault.jpg');await expect(card).toContainText('4:05');await expect(card).toContainText('1 000 000 просмотров');
 await card.click();await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Ooooooooooo');await expect(page.locator('#track-title')).toHaveText('Song');await expect(page.locator('#queue-list li[aria-current=true]')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).saved)).toEqual(['Ooooooooooo']);await page.locator('#pause').click();await page.locator('.alternative-video').filter({hasText:'Live'}).click();await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).played.at(-1))).toBe('Ooooooooooo');
});

test('discovery preserves chart order, browsing is inert and refresh requests live data again',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.discoveries=0;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')return [{id:'9',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'M7lc1UVf-VE',title:'Clip',score:100,reason:'fixture'}];
  if(cmd==='discovery_fetch'){w.discoveries++;return {title:'Current chart',tracks:[{id:'3',title:'Top',artist:'A'},{id:'1',title:'Second',artist:'B'}],playlists:[{kind:'playlist',id:'7',owner:'8',title:'Popular collection',subtitle:''}]};}
  if(cmd==='catalogue_collection')return {title:'Popular collection',tracks:[{id:'4',title:'Collection track',artist:'A'}],page:0,hasMore:false};
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('[data-panel=discovery]').click();await expect(page.locator('.chart-position')).toHaveText(['1','2']);await expect(page.locator('#track-title')).toHaveText('Current');
 await page.locator('#discovery-content .catalogue-card').click();await expect(page.locator('#catalogue-collection .catalogue-track')).toHaveCount(1);await page.locator('#catalogue-back').click();await expect(page.locator('#discovery-content')).toBeVisible();
 await page.locator('#discovery-refresh').click();await expect.poll(()=>page.evaluate(()=>(window as any).discoveries)).toBe(2);
 await page.getByRole('button',{name:'Включить чарт'}).click();await expect(page.locator('#queue-list li')).toHaveText(['Top · A','Second · B']);
});

test('local volume arrows clamp and persist; F11 uses the same fullscreen player and ignores editing fields',async({page})=>{
 await page.addInitScript(()=>localStorage.removeItem('encore.volume.v1'));
 await mockAutomaticPlayer(page);await page.goto('/');await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());await expect(page.locator('#play')).toBeEnabled();
 await page.locator('#track-title').click();await page.keyboard.press('ArrowUp');await expect(page.locator('#volume')).toHaveValue('55');await page.keyboard.press('ArrowDown');await expect(page.locator('#volume')).toHaveValue('50');
 for(let count=0;count<12;count++)await page.keyboard.press('ArrowDown');await expect(page.locator('#volume')).toHaveValue('0');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('encore.volume.v1')!).level)).toBe(0);
 const src=await page.locator('#player').getAttribute('src');await page.keyboard.press('F11');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.keyboard.press('F11');await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
 expect(await page.locator('#player').getAttribute('src')).toBe(src);
 await page.locator('#catalogue-query').fill('artist');await page.keyboard.press('ArrowUp');await page.keyboard.press('F11');await expect(page.locator('#volume')).toHaveValue('0');expect(await page.evaluate(()=>!!document.fullscreenElement)).toBe(false);expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('favorite replay alternates videos, deletion keeps playback and Pause cancels late repeat autoplay',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.favorites=['Aaaaaaaaaaa','Bbbbbbbbbbb'];w.lastFavorite='Aaaaaaaaaaa';w.holdFavorite=false;w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'123',title:'Same song',artist:'Fixture'}];
  if(cmd==='search_videos')return [];
  if(cmd==='storage_command'){
   const r=args.request;
   if(r.type==='get_videos'){if(w.holdFavorite){w.holdFavorite=false;await new Promise(resolve=>w.releaseFavorite=resolve);}return {videos:w.favorites.map((videoId:string)=>({videoId,unavailable:false})),lastVideoId:w.lastFavorite};}
   if(r.type==='record')w.lastFavorite=r.event.videoId;
   if(r.type==='remove_favorite')w.favorites=w.favorites.filter((id:string)=>id!==r.videoId);
  }
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).loaded.at(-1))).toBe('Bbbbbbbbbbb');
 await page.locator('#repeat').click();await page.locator('#play').click();
 for(let count=0;count<6;count++){const before=await page.evaluate(()=>(window as any).played.at(-1));await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).not.toBe(before);}
 const playing=await page.evaluate(()=>(window as any).played.at(-1));await videoEditor(page);await page.getByRole('button',{name:'Удалить избранный клип '+playing,exact:true}).click();await expect(page.locator('#favorite-list .favorite-row')).toHaveCount(1);await page.locator('#close-video-dialog').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 const count=await page.evaluate(()=>(window as any).played.length);
 await page.evaluate(()=>{const w=window as any;w.holdFavorite=true;w.activePlayer.options.events.onStateChange({data:0});});await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseFavorite)).toBe('function');await page.locator('#pause').click();await page.evaluate(()=>(window as any).releaseFavorite());await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).played.length)).toBe(count);await expect(page.locator('#track-title')).toHaveText('Same song');
});

test('preferred clip repeats explicitly, exclusion replaces only the video and can be undone without Yandex dislike',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.favorites=['Aaaaaaaaaaa','Bbbbbbbbbbb'];w.preferred=null;w.excluded=[];w.lastFavorite='Bbbbbbbbbbb';w.feedbackWrites=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch')return [{id:'123',title:'Same song',artist:'Fixture'}];
   if(command==='search_videos')return ['Aaaaaaaaaaa','Bbbbbbbbbbb'].map(id=>({id,title:id,score:100,reason:'fixture'}));
   if(command==='feedback_command'&&args.request?.type==='set')w.feedbackWrites.push(args.request);
   if(command==='storage_command'){const r=args.request;
    if(r.type==='get_videos')return {videos:w.favorites.map((videoId:string)=>({videoId,unavailable:false})),lastVideoId:w.lastFavorite,preferredVideoId:w.preferred,excludedVideoIds:[...w.excluded]};
    if(r.type==='record')w.lastFavorite=r.event.videoId;
    if(r.type==='prefer_video')w.preferred=r.videoId;
    if(r.type==='exclude_video'){w.excluded=r.excluded?[...w.excluded,r.videoId]:w.excluded.filter((id:string)=>id!==r.videoId);if(r.excluded&&w.preferred===r.videoId)w.preferred=null;}
   }
  }};
 });
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).loaded.at(-1))).toBe('Aaaaaaaaaaa');
 await videoEditor(page);await page.locator('#prefer-video').click();await expect(page.locator('#prefer-video')).toHaveAttribute('aria-pressed','true');await page.locator('#close-video-dialog').click();
 await page.locator('#repeat').click();await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 const count=await page.evaluate(()=>(window as any).played.length);await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBeGreaterThan(count);expect(await page.evaluate(()=>(window as any).played.at(-1))).toBe('Aaaaaaaaaaa');
 await videoEditor(page);await page.locator('#exclude-video').click();await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Bbbbbbbbbbb');await expect(page.locator('#track-title')).toHaveText('Same song');
 await expect(page.locator('#excluded-clips')).toBeVisible();await page.locator('#excluded-clips summary').click();await page.getByRole('button',{name:'Вернуть в подбор Aaaaaaaaaaa',exact:true}).click();await expect(page.locator('#excluded-clips')).not.toBeVisible();
 expect(await page.evaluate(()=>(window as any).excluded)).toEqual([]);expect(await page.evaluate(()=>(window as any).feedbackWrites)).toEqual([]);expect(await page.evaluate(()=>(window as any).preferred)).toBe(null);
 await page.locator('#prefer-video').click();await expect(page.locator('#prefer-video')).toHaveAttribute('aria-pressed','true');await page.locator('#prefer-video').click();await expect(page.locator('#prefer-video')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#status')).toHaveText('Воспроизведение');
});

test('excluded videos are filtered from history, automatic matching and alternative cards',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='source_fetch')return [{id:'123',title:'Song',artist:'Fixture',historyVideoId:'Aaaaaaaaaaa'}];
  if(command==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Excluded live',score:100,reason:'fixture'},{id:'Bbbbbbbbbbb',title:'Allowed official',score:90,reason:'fixture'}];
  if(command==='storage_command'&&args.request.type==='get_videos')return {videos:[],lastVideoId:null,preferredVideoId:null,excludedVideoIds:['Aaaaaaaaaaa']};
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).loaded)).toEqual(['Bbbbbbbbbbb']);
 await expect(page.locator('#alternative-list')).toContainText('Allowed official');await expect(page.locator('#alternative-list')).not.toContainText('Excluded live');
});

test('unavailable favorite is retained and another saved clip is tried before automatic search',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.failedVideos=[];w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'123',title:'Same song',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'Ccccccccccc',title:'Automatic fallback',score:100,reason:'fixture'}];
  if(cmd==='storage_command'){
   const r=args.request;if(r.type==='get_videos')return {videos:['Aaaaaaaaaaa','Bbbbbbbbbbb'].map(videoId=>({videoId,unavailable:w.failedVideos.includes(videoId)})),lastVideoId:'Aaaaaaaaaaa'};
   if(r.type==='video_failed')w.failedVideos.push(r.videoId);
  }
 }};});
 await mockAutomaticPlayer(page,false,['Bbbbbbbbbbb']);await page.goto('/');await expect.poll(()=>page.evaluate(()=>(window as any).loaded.at(-1))).toBe('Aaaaaaaaaaa');
 expect(await page.evaluate(()=>(window as any).failedVideos)).toContain('Bbbbbbbbbbb');await videoEditor(page);await expect(page.locator('#favorite-list .favorite-row')).toHaveCount(2);await expect(page.locator('#favorite-list')).toContainText('недоступен');expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('fullscreen keeps the close-panel controls accessible while the interactive YouTube frame captures the pointer',async({page})=>{
 await page.clock.install();await mockAutomaticPlayer(page);await page.goto('/');await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());await expect(page.locator('#play')).toBeEnabled();
 await page.locator('#fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.mouse.move(100,100);await page.locator('#youtube-settings').click();await expect(page.locator('.screen')).toHaveClass(/interactive/);
 await page.mouse.move(150,100);await page.clock.fastForward(5000);await expect(page.locator('.player-hud')).toHaveCSS('opacity','1');await expect(page.locator('#youtube-settings')).toHaveText('Скрыть панель YouTube');
 await page.locator('#youtube-settings').click();await expect(page.locator('.screen')).not.toHaveClass(/interactive/);await page.mouse.move(180,100);await page.clock.fastForward(4000);await expect(page.locator('.player-hud')).toHaveCSS('opacity','0');
});

test('Wave drains its ordered buffer before Smart History and stays there after Yandex recovers',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.recovered=false;w.sourceCalls=0;w.smartCalls=0;w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch'){w.sourceCalls++;if(!args.fresh&&!w.recovered)throw 'Network/TLS error';return [{id:'1',title:'A',artist:'Fixture'},{id:'2',title:'B',artist:'Fixture'}];}
  if(cmd==='smart_history_fetch'){w.smartCalls++;return [{id:'90',title:'History C',artist:'Fixture',historyVideoId:'Ccccccccccc',weight:1},{id:'91',title:'History D',artist:'Fixture',historyVideoId:'Ddddddddddd',weight:1}];}
  if(cmd==='search_videos')return [{id:args.title==='B'?'Bbbbbbbbbbb':'Aaaaaaaaaaa',title:args.title,score:100,reason:'fixture'}];
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('#source-start').click();await expect.poll(()=>page.evaluate(()=>(window as any).played[0])).toBe('Aaaaaaaaaaa');
 await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Bbbbbbbbbbb');await expect(page.locator('#source-name')).toHaveText('Моя волна');expect(await page.evaluate(()=>(window as any).smartCalls)).toBe(0);
 await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect(page.locator('#source-name')).toHaveText('Умная история');await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(3);
 const calls=await page.evaluate(()=>(window as any).sourceCalls);await page.evaluate(()=>(window as any).recovered=true);
 for(let count=0;count<10;count++){const before=await page.evaluate(()=>(window as any).played.length);await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(before+1);}
 expect(await page.evaluate(()=>(window as any).sourceCalls)).toBe(calls);expect(await page.evaluate(()=>(window as any).smartCalls)).toBeGreaterThan(1);
 await page.locator('#source-start').click();await expect(page.locator('#source-name')).toHaveText('Моя волна');
});

test('offline startup prepares known history clips without autoplay or metadata search dependency',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')throw 'Network/TLS error';
  if(cmd==='smart_history_fetch')return [{id:'90',title:'Known clip',artist:'Fixture',historyVideoId:'Ccccccccccc',weight:1}];
  if(cmd==='search_videos')throw 'Metadata unavailable';
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#source-name')).toHaveText('Умная история');await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).played)).toEqual([]);expect(await page.evaluate(()=>(window as any).loaded.at(-1))).toBe('Ccccccccccc');
 await page.locator('#play').click();await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Ccccccccccc');
});

test('Pause during a pending Smart History start prevents its late autoplay',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')return [{id:'1',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Current',score:100,reason:'fixture'}];
  if(cmd==='smart_history_fetch'){await new Promise(resolve=>w.releaseSmart=resolve);return [{id:'90',title:'Known clip',artist:'Fixture',historyVideoId:'Ccccccccccc',weight:1}];}
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await historyPanel(page);await page.locator('#history-smart').click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseSmart)).toBe('function');await page.locator('#pause').click();await page.evaluate(()=>(window as any).releaseSmart());
 await expect(page.locator('#source-name')).toHaveText('Умная история');await expect.poll(()=>page.evaluate(()=>(window as any).loaded.at(-1))).toBe('Ccccccccccc');expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('empty Smart History reports absence and does not invent tracks or start the old cue',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')return [{id:'1',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Current',score:100,reason:'fixture'}];
  if(cmd==='smart_history_fetch')return [];
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await historyPanel(page);await page.locator('#history-smart').click();await expect(page.locator('#status')).toContainText('нет подходящих клипов');await expect(page.locator('#track-title')).toHaveText('Current');expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('Smart History skips an unavailable unsearchable old clip and keeps the remaining stream unattended',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;Math.random=()=>0;w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
  if(cmd==='source_fetch')throw 'Network error';
  if(cmd==='smart_history_fetch')return [{id:'manual:Aaaaaaaaaaa',title:'Old bad clip',artist:'',historyVideoId:'Aaaaaaaaaaa',weight:1},{id:'manual:Ccccccccccc',title:'Good old clip',artist:'',historyVideoId:'Ccccccccccc',weight:1}];
  if(cmd==='search_videos')throw 'Invalid search metadata';
 }};});
 await mockAutomaticPlayer(page,false,['Aaaaaaaaaaa']);await page.goto('/');await expect(page.locator('#source-name')).toHaveText('Умная история');await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('Ccccccccccc');
 for(let count=0;count<10;count++){const before=await page.evaluate(()=>(window as any).played.length);await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBe(before+1);}
 expect(await page.evaluate(()=>(window as any).played.every((id:string)=>id==='Ccccccccccc'))).toBe(true);
});

test('feedback generations reject an old read after a newer saved like',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.currentState=0;w.currentGeneration=1;w.staleOnce=false;w.oldRead=false;w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')return [{id:'1',title:'Current',artist:'Fixture'}];
  if(cmd==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Current',score:100,reason:'fixture'}];
  if(cmd==='feedback_command'){
   const r=args.request;if(r.type==='set'){w.currentState=r.state;w.currentGeneration++;w.staleOnce=true;return {trackId:r.trackId,state:r.state,revision:2,pending:true,generation:w.currentGeneration};}
   if(r.type==='sync')return {pending:0};
   if(r.type==='get'){if(w.staleOnce){w.staleOnce=false;w.oldRead=true;return {trackId:r.trackId,state:0,revision:1,pending:false,generation:1,excludedTrackIds:[]};}return {trackId:r.trackId,state:w.currentState,revision:w.currentGeneration,pending:false,generation:w.currentGeneration,excludedTrackIds:[]};}
  }
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#like')).toBeEnabled();await page.locator('#like').click();await expect.poll(()=>page.evaluate(()=>(window as any).oldRead)).toBe(true);await expect(page.locator('#like')).toHaveAttribute('aria-pressed','true');
});

test('Smart History honors a local dislike in its prepared buffer and accepts a later remote removal',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;Math.random=()=>0;w.generation=1;w.serverExcluded=[];w.reactionStates={};w.pending=false;w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
  if(cmd==='source_fetch')throw 'Network error';
  if(cmd==='smart_history_fetch')return ['90','91','92'].map((id,index)=>({id,title:'History '+id,artist:'Fixture',historyVideoId:['Aaaaaaaaaaa','Bbbbbbbbbbb','Ccccccccccc'][index],weight:1}));
  if(cmd==='search_videos')return [];
  if(cmd==='feedback_command'){
   const r=args.request;if(r.type==='set'){w.reactionStates[r.trackId]=r.state;w.pending=true;w.generation++;return {trackId:r.trackId,state:r.state,revision:w.generation,pending:true,generation:w.generation};}
   if(r.type==='sync'){if(w.pending){w.serverExcluded=Object.keys(w.reactionStates).filter(id=>w.reactionStates[id]===-1);w.pending=false;w.generation++;}return {pending:0};}
   if(r.type==='get')return {trackId:r.trackId,state:w.serverExcluded.includes(r.trackId)?-1:0,revision:w.generation,pending:w.pending,generation:w.generation,...(!w.pending?{excludedTrackIds:w.serverExcluded}: {})};
  }
 }};});
 await mockAutomaticPlayer(page);await page.goto('/');await expect(page.locator('#source-name')).toHaveText('Умная история');await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();await expect(page.locator('#dislike')).toBeEnabled();await page.locator('#dislike').click();
 for(let count=0;count<10;count++){const before=await page.evaluate(()=>(window as any).played.length);await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBeGreaterThan(before);}
 expect(await page.evaluate(()=>(window as any).played.filter((id:string)=>id==='Aaaaaaaaaaa').length)).toBe(1);
 await page.evaluate(()=>{const w=window as any;w.serverExcluded=[];w.reactionStates['90']=0;w.generation++;window.dispatchEvent(new Event('online'));});
 await expect.poll(()=>page.evaluate(()=>(window as any).serverExcluded.length)).toBe(0);
 let returned=false;
 for(let count=0;count<24&&!returned;count++){const before=await page.evaluate(()=>(window as any).played.length);await page.evaluate(()=>(window as any).activePlayer.options.events.onStateChange({data:0}));await expect.poll(()=>page.evaluate(()=>(window as any).played.length)).toBeGreaterThan(before);returned=await page.evaluate(()=>(window as any).played.at(-1)==='Aaaaaaaaaaa');}
 expect(returned).toBe(true);
});

test('Space on a history period disclosure toggles the disclosure without pausing music',async({page})=>{
 await mockAutomaticPlayer(page);await page.goto('/');await videoEditor(page);await page.locator('#url').fill('M7lc1UVf-VE');await page.getByRole('button',{name:'Подготовить',exact:true}).click();
 await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.locator('[data-panel=history]').click();await page.locator('#history-period-summary').focus();await page.keyboard.press('Space');
 await expect(page.locator('#history-period')).toHaveAttribute('open','');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.keyboard.press('Enter');await expect(page.locator('#history-period')).not.toHaveAttribute('open','');await expect(page.locator('#status')).toHaveText('Воспроизведение');
});
