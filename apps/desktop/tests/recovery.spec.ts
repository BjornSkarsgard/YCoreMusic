import {test,expect,type Page} from './fixtures';
async function network(page:Page,offline:boolean){
 await page.context().setOffline(offline);await expect.poll(()=>page.evaluate(()=>(window as any).networkEvent)).toBe(offline?'offline':'online');
}
async function setup(page:Page){
 await page.clock.install();
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.records=[];w.cues=[];w.plays=[];w.players=[];w.holdCues=false;w.networkEvent='online';window.addEventListener('offline',()=>w.networkEvent='offline');window.addEventListener('online',()=>w.networkEvent='online');w.callbacks={};w.events={};let callback=0;
  w.__TAURI_INTERNALS__={transformCallback:(fn:any)=>{w.callbacks[++callback]=fn;return callback;},invoke:async(cmd:string,args:any)=>{
   if(cmd==='plugin:event|listen'){w.events[args.event]=w.callbacks[args.handler];return args.handler;}
   if(cmd==='catalogue_search')return {artists:[],albums:[],playlists:[],tracks:[{id:'100',title:'Selected',artist:'Fixture'}],page:0};
   if(cmd==='source_fetch')return 'ABCDEFGH'.split('').map((id,i)=>({id:String(i+1),title:id,artist:'Fixture'}));
   if(cmd==='smart_history_fetch')return [];
   if(cmd==='search_videos')return [{id:args.title==='B'?'Bbbbbbbbbbb':'Aaaaaaaaaaa',title:args.title,score:100,reason:'fixture'}];
   if(cmd==='storage_command'){
    if(args.request.type==='get_videos')return {videos:[],lastVideoId:null};
    if(args.request.type==='record')w.records.push(args.request.event.playbackId);
   }
  }};
 });
 await page.route('https://i.ytimg.com/**',route=>route.abort());
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YT={Player:class{
  constructor(id,options){this.options=options;this.position=0;this.el=document.createElement('iframe');this.el.id=id;document.getElementById(id).replaceWith(this.el);window.players.push(this);window.activePlayer=this;queueMicrotask(()=>options.events.onReady({target:this}));}
  emit(state){this.options.events.onStateChange({data:state,target:this});}
  cueVideoById(value){this.id=typeof value==='string'?value:value.videoId;this.position=typeof value==='string'?0:value.startSeconds;window.cues.push({id:this.id,position:this.position});if(!window.holdCues)this.emit(5);}
  getCurrentTime(){return this.position;}getDuration(){return 180;}getIframe(){return this.el;}
  playVideo(){window.plays.push(this.id);this.emit(1);}pauseVideo(){this.emit(2);}seekTo(value){this.position=value;}setVolume(){}destroy(){this.el.remove();}
 }};window.onYouTubeIframeAPIReady();` }));
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 await page.locator('#source-start').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.evaluate(()=>{(window as any).activePlayer.position=43;});await page.clock.fastForward(500);
}

test('15 minutes offline preserves the current clip, cursor, position and one history event',async({page})=>{
 await setup(page);const cues=await page.evaluate(()=>(window as any).cues.length);
 await network(page,true);await page.evaluate(()=>(window as any).activePlayer.emit(3));
 await page.clock.fastForward(15*60000);
 await expect(page.locator('#track-title')).toHaveText('A');expect(await page.evaluate(()=>(window as any).cues.length)).toBe(cues);
 await expect(page.locator('#status')).toContainText('Нет сети');
 await network(page,false);await page.clock.fastForward(1);
 await expect(page.locator('#status')).toHaveText('Воспроизведение');
 expect(await page.evaluate(()=>(window as any).cues.at(-1))).toEqual({id:'Aaaaaaaaaaa',position:43});
 expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);await expect(page.locator('iframe')).toHaveCount(1);
});

test('Pause while offline suppresses reconnect autoplay until explicit Play',async({page})=>{
 await setup(page);await network(page,true);await page.evaluate(()=>(window as any).activePlayer.emit(3));
 await page.locator('#pause').click();const plays=await page.evaluate(()=>(window as any).plays.length);
 await network(page,false);await page.clock.fastForward(60000);
 expect(await page.evaluate(()=>(window as any).plays.length)).toBe(plays);
 await page.locator('#play').click();await page.clock.fastForward(1);
 await expect(page.locator('#status')).toHaveText('Воспроизведение');
 expect(await page.evaluate(()=>(window as any).cues.at(-1))).toEqual({id:'Aaaaaaaaaaa',position:43});
 expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
});

test('buffering recovers the same video at its position and Pause cancels a scheduled retry',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).activePlayer.emit(3));
 await page.clock.fastForward(16000);await expect(page.locator('#status')).toContainText('Восстанавливаем');
 const cues=await page.evaluate(()=>(window as any).cues.length);await page.locator('#pause').click();await page.clock.fastForward(60000);
 expect(await page.evaluate(()=>(window as any).cues.length)).toBe(cues);
 await page.locator('#play').click();await page.clock.fastForward(1);
 expect(await page.evaluate(()=>(window as any).cues.at(-1))).toEqual({id:'Aaaaaaaaaaa',position:43});
 await expect(page.locator('#track-title')).toHaveText('A');expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
});

test('explicit Next cancels a pending repair and rejects callbacks from the old frame',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).activePlayer.emit(3));await page.clock.fastForward(16000);
 await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText('B');
 const cues=await page.evaluate(()=>(window as any).cues.length);await page.clock.fastForward(60000);
 await page.evaluate(()=>(window as any).players[1].emit(1));
 expect(await page.evaluate(()=>(window as any).cues.length)).toBe(cues);await expect(page.locator('#track-title')).toHaveText('B');await expect(page.locator('iframe')).toHaveCount(1);
});

test('offline end holds the cursor then continues, and repeat-one still repeats after reconnect',async({page})=>{
 await setup(page);await network(page,true);await page.evaluate(()=>(window as any).activePlayer.emit(0));
 await page.clock.fastForward(60000);await expect(page.locator('#track-title')).toHaveText('A');
 await network(page,false);await page.clock.fastForward(1);await expect(page.locator('#track-title')).toHaveText('B');
 await page.locator('#repeat').click();await network(page,true);await page.evaluate(()=>(window as any).activePlayer.emit(0));
 const plays=await page.evaluate(()=>(window as any).plays.length);await network(page,false);await page.clock.fastForward(1);
 await expect(page.locator('#track-title')).toHaveText('B');await expect.poll(()=>page.evaluate(()=>(window as any).plays.length)).toBe(plays+1);
});


test('sleep cancels a pending recovery and wake remains paused until Play',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).activePlayer.emit(3));await page.clock.fastForward(16000);
 const count=await page.evaluate(()=>(window as any).cues.length);
 await page.evaluate(()=>{const w=window as any;for(const event of ['power-monitor://suspend','power-monitor://resume'])w.events[event]({event,payload:null});});
 await page.clock.fastForward(60000);expect(await page.evaluate(()=>(window as any).cues.length)).toBe(count);
 await expect(page.locator('#status')).toContainText('После сна · пауза');
 await page.locator('#play').click();await page.clock.fastForward(1);
 await expect(page.locator('#status')).toHaveText('Воспроизведение');
 expect(await page.evaluate(()=>(window as any).cues.at(-1))).toEqual({id:'Aaaaaaaaaaa',position:43});
 expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
});

test('an unrecoverable final clip ends a finite collection instead of retrying forever',async({page})=>{
 await setup(page);await page.locator('#catalogue-query').fill('selected');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await page.locator('#catalogue-results .catalogue-track .track-play-action').click();await expect(page.locator('#track-title')).toHaveText('Selected');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 const records=await page.evaluate(()=>(window as any).records.length);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.position=43;w.holdCues=true;w.activePlayer.emit(3);});
 await page.clock.fastForward(16000);await page.clock.fastForward(2001);
 await page.clock.fastForward(21000);
 await expect(page.locator('#status')).toContainText('Конец выбранного списка');
 const cues=await page.evaluate(()=>(window as any).cues.length);await page.clock.fastForward(60000);
 expect(await page.evaluate(()=>(window as any).cues.length)).toBe(cues);
 expect(await page.evaluate(()=>(window as any).records.length)).toBe(records);
});
