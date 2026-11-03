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

async function mockAutomaticPlayer(page: import('@playwright/test').Page, failFirst = false) {
  await page.route('https://www.youtube.com/iframe_api', route=>route.fulfill({contentType:'text/javascript',body:`
    window.loaded=[];window.played=[];window.seeks=[];window.YT={Player:class{
      constructor(id,options){this.el=document.getElementById(id);this.options=options;window.activePlayer=this;setTimeout(()=>options.events.onReady({target:this}),0);}
      cueVideoById(id){this.id=id;window.loaded.push(id);if(${failFirst} && id==='Aaaaaaaaaaa'){queueMicrotask(()=>this.options.events.onError({data:101}));}else this.options.events.onStateChange({data:5,target:this});}
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
  expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
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
  expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
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
  expect(await page.evaluate(()=>(window as any).searches)).toBe(0);
  expect(await page.evaluate(()=>(window as any).records)).toEqual([]);
  await page.locator('#play').click();await page.locator('#pause').click();await page.locator('#play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
  await page.locator('#url').fill('Ccccccccccc');await page.getByRole('button',{name:'Подготовить'}).click();
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
  await page.locator('#history-panel summary').click();await page.locator('#history-list').getByRole('button',{name:'Воспроизвести',exact:true}).click();
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
  expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
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
  await expect(page.locator('#play')).toBeDisabled();
  await page.locator('#candidate-list button').click();await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
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
  expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
  await page.getByRole('button',{name:'▶ Воспроизвести список'}).click();
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
  await page.locator('.catalogue-card').click();await page.getByRole('button',{name:'▶ Воспроизвести список'}).click();
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
  await page.locator('#source-start').click();await expect(page.locator('#track-title')).toHaveText('Wave');await expect(page.locator('#repeat')).toHaveText('Повтор: выкл.');
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
  await page.locator('#history-panel').evaluate((item:HTMLDetailsElement)=>item.open=true);
  await page.locator('#history-list').getByRole('button',{name:'Следом',exact:true}).click();
  await page.locator('#history-list').getByRole('button',{name:'В конец',exact:true}).click();
  await expect(page.locator('#track-title')).toHaveText('A');
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
  await expect(page.locator('#queue-list li')).toHaveText(['A · Fixture','History H · Fixture','B · Fixture','History H · Fixture']);
  for(const title of ['History H','B','History H','C']){await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText(title);await expect(page.locator('#play')).toBeEnabled();}
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa','Hhhhhhhhhhh','Bbbbbbbbbbb','Hhhhhhhhhhh','Ccccccccccc']);
  expect(await page.evaluate(()=>(window as any).more)).toBe(1);
});

test('history next retains a playing manual video when there is no source queue',async({page})=>{
  await page.addInitScript(()=>{
    const w=window as any;w.isTauri=true;
    w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
      if(cmd==='source_fetch')throw 'No saved token. Run yandex-probe --save-token locally first.';
      if(cmd==='storage_command'&&args.request.type==='history')return [{trackId:'9',title:'History H',artist:'Fixture',videoId:'Hhhhhhhhhhh',startedAt:1}];
    }};
  });
  await mockAutomaticPlayer(page);await page.goto('/');await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('#play')).toBeEnabled();await page.locator('#play').click();
  await page.locator('#history-panel').evaluate((item:HTMLDetailsElement)=>item.open=true);
  await page.locator('#history-list').getByRole('button',{name:'Следом',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE']);
  await expect(page.locator('#queue-list li')).toHaveCount(2);
  await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText('History H');await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE','Hhhhhhhhhhh']);
});


test('local Space and arrows control playback while search and link fields keep editing keys',async({page})=>{
  await mockAutomaticPlayer(page);await page.goto('/');await page.locator('#url').fill('M7lc1UVf-VE');await page.locator('#load').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await expect(page.locator('#play')).toBeEnabled();await page.locator('h1').click();
  await page.keyboard.press('Space');await expect(page.locator('#status')).toHaveText('Воспроизведение');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([10,0]);
  await page.keyboard.press('Space');await expect(page.locator('#status')).toHaveText('Пауза');
  await page.locator('#catalogue-query').fill('artist');await page.keyboard.press('Space');await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#catalogue-query')).toHaveValue('artist ');await expect(page.locator('#status')).toHaveText('Пауза');
  await page.locator('#url').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>(window as any).seeks)).toEqual([10,0]);
  expect(await page.evaluate(()=>(window as any).played)).toEqual(['M7lc1UVf-VE']);
});
