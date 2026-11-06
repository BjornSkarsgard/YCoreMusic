import {test,expect,type Page} from './fixtures';

async function setup(page:Page,source:'wave'|'playlist',failure:string){
 await page.clock.install();
 await page.addInitScript(({failure})=>{
  const w=window as any;w.isTauri=true;w.failure=failure;w.played=[];w.players=[];w.calls={};w.records=[];
  const tracks=['A','B','C','D','E'].map(title=>({id:title,title,artist:'Fixture'}));
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch')return tracks;
   if(cmd==='catalogue_search')return {artists:[],albums:[],playlists:[{kind:'playlist',id:'1',owner:'2',title:'Test list',subtitle:''}],tracks:[],page:0};
   if(cmd==='catalogue_collection')return {title:'Test list',tracks,hasMore:false,page:0};
   if(cmd==='search_videos'){
    w.calls[args.title]=(w.calls[args.title]??0)+1;
    if(args.title==='B'&&failure==='missing')return [];
    if(args.title==='B'&&failure==='search-error')throw new Error('Temporary search failure');
    if(args.title==='B'&&failure==='search-hang')return new Promise(resolve=>w.releaseB=()=>resolve([{id:'Bbbbbbbbbbb',title:'B',score:100}]));
    return [{id:args.title+args.title.toLowerCase().repeat(10),title:args.title,score:100,reason:'fixture'}];
   }
   if(cmd==='storage_command'&&args.request.type==='record')w.records.push(args.request.event);
  }};
 },{failure});
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YT={Player:class{
  constructor(id,options){this.el=document.getElementById(id);this.options=options;window.activePlayer=this;window.players.push(this);setTimeout(()=>options.events.onReady({target:this}),0);}
  emit(state){this.options.events.onStateChange({data:state,target:this});}
  cueVideoById(value){this.id=typeof value==='string'?value:value.videoId;
   if(this.id==='Bbbbbbbbbbb'&&window.failure==='unready')return;
   if(this.id==='Bbbbbbbbbbb'&&window.failure==='embed'){queueMicrotask(()=>this.options.events.onError({data:150}));return;}
   this.emit(5);
  }
  playVideo(){if(this.id==='Bbbbbbbbbbb'&&window.failure==='blocked'){this.options.events.onAutoplayBlocked();return;}this.startedAt=performance.now();window.played.push(this.id);this.emit(1);if(this.id==='Bbbbbbbbbbb'&&window.failure==='heartbeat-stall')this.heartbeat=setInterval(()=>this.emit(1),1000);}
  pauseVideo(){this.emit(2);}setVolume(){}getDuration(){return 180;}getCurrentTime(){if(this.id==='Bbbbbbbbbbb'&&['false-playing','heartbeat-stall'].includes(window.failure))return 0;return this.startedAt===undefined?0:5+(performance.now()-this.startedAt)/1000;}seekTo(){}destroy(){clearInterval(this.heartbeat);this.el.remove();}
 }};window.onYouTubeIframeAPIReady();` }));
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 if(source==='playlist'){
  await page.locator('#catalogue-query').fill('test');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
  await page.locator('.catalogue-card').click();await page.locator('#catalogue-play-all').click();
 }else await page.locator('#play').click();
 await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await expect.poll(()=>page.evaluate(()=>(window as any).calls.B??0)).toBeGreaterThan(0);
}

for(const source of ['wave','playlist'] as const){
 for(const failure of ['missing','embed','unready','blocked','search-error','search-hang','false-playing','heartbeat-stall']){
  test(`${source} automatically leaves ${failure} after a natural end without fullscreen or manual Next`,async({page})=>{
   await setup(page,source,failure);
   await page.evaluate(()=>(window as any).activePlayer.emit(0));
   if(failure==='search-hang')await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
   if(failure==='unready')await page.clock.runFor(13000);
   if(failure==='search-error')await page.clock.runFor(6000);
   if(failure==='search-hang')await page.clock.runFor(46000);
   if(['false-playing','heartbeat-stall'].includes(failure))await page.clock.runFor(18000);
   await expect(page.locator('#track-title')).toHaveText('C');
   await expect(page.locator('#status')).toHaveText('Воспроизведение');
   expect(await page.evaluate(()=>(window as any).played)).toEqual(['false-playing','heartbeat-stall'].includes(failure)?['Aaaaaaaaaaa','Bbbbbbbbbbb','Ccccccccccc']:['Aaaaaaaaaaa','Ccccccccccc']);
   if(failure==='search-hang'){
    await page.evaluate(()=>(window as any).releaseB());await page.clock.runFor(10);
    await expect(page.locator('#track-title')).toHaveText('C');
   }
   await page.locator('[data-panel=queue]').click();await expect(page.locator('#queue-list .track-skipped')).toHaveCount(1);
   expect(await page.evaluate(()=>(window as any).records.map((entry:any)=>entry.trackId))).toEqual(['false-playing','heartbeat-stall'].includes(failure)?['A','B','C']:['A','C']);
  });
 }
}

test('Pause cancels an unavailable clip transition and a finite playlist still ends normally',async({page})=>{
 await setup(page,'playlist','unready');
 await page.evaluate(()=>(window as any).activePlayer.emit(0));await expect(page.locator('#track-title')).toHaveText('B');
 await page.locator('#pause').click();await page.clock.runFor(30000);
 await expect(page.locator('#track-title')).toHaveText('B');
 expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
 await page.locator('#play').click();await page.clock.runFor(17000);await expect(page.locator('#track-title')).toHaveText('C');
 for(const next of ['D','E']){await page.evaluate(()=>(window as any).activePlayer.emit(0));await expect(page.locator('#track-title')).toHaveText(next);}
 await page.evaluate(()=>(window as any).activePlayer.emit(0));await expect(page.locator('#status')).toContainText('Конец выбранного списка');
 await page.clock.runFor(30000);expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa','Ccccccccccc','Ddddddddddd','Eeeeeeeeeee']);
});
