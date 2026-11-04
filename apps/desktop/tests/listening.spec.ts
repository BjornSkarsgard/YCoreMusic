import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.position=0;w.records=[];w.progress=[];w.feedbackWrites=[];w.waveCalls=0;w.waveSyncFail=false;
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch')return [{id:'1',title:'First',artist:'Fixture',waveRef:localStorage.getItem('fixture.waveRef')==='1'?'wave-one':undefined},{id:'2',title:'Second',artist:'Fixture',waveRef:localStorage.getItem('fixture.waveRef')==='1'?'wave-two':undefined}];
   if(command==='wave_sync'){w.waveCalls++;if(w.waveSyncFail)throw 'Network/TLS error';return {pending:0,disabled:false,sent:2};}
   if(command==='search_videos')return [{id:args.title==='First'?'Aaaaaaaaaaa':'Bbbbbbbbbbb',title:args.title,score:100,reason:'fixture'}];
   if(command==='storage_command'){if(args.request.type==='record')w.records.push(args.request.event);if(args.request.type==='progress')w.progress.push(args.request.event);}
   if(command==='feedback_command'){
    if(args.request.type==='sync')return {pending:0};
    if(args.request.type==='set')w.feedbackWrites.push(args.request);
    return {trackId:args.request.trackId,state:args.request.state??0,revision:1,pending:false,generation:1};
   }
  }};
 });
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YT={Player:class{
  constructor(id,options){this.el=document.getElementById(id);this.options=options;window.activePlayer=this;setTimeout(()=>options.events.onReady({target:this}),0);}
  cueVideoById(value){this.id=typeof value==='string'?value:value.videoId;window.position=typeof value==='string'?0:value.startSeconds||0;this.options.events.onStateChange({data:5,target:this});}
  setVolume(){}getDuration(){return 120;}getCurrentTime(){return window.position;}seekTo(value){window.position=value;}
  playVideo(){this.options.events.onStateChange({data:1,target:this});}pauseVideo(){this.options.events.onStateChange({data:2,target:this});}destroy(){this.el.remove();}
 }};window.onYouTubeIframeAPIReady();`}));
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).records.length)).toBe(0);
 await page.locator('#source-start').click();await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
});
test('real listening excludes paused time, seek and buffering; panel recovery keeps one event and Next finalizes it',async({page})=>{
 await page.evaluate(()=>(window as any).position=5);await page.clock.fastForward(5000);await page.locator('#pause').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).progress.at(-1).listenedMs)).toBe(5000);
 await page.clock.fastForward(30000);
 await page.locator('#seek').evaluate((input:HTMLInputElement)=>{input.value='90';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));});
 await page.locator('#play').click();await page.evaluate(()=>(window as any).position=92);await page.clock.fastForward(2000);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onStateChange({data:3,target:w.activePlayer});});await page.clock.fastForward(5000);
 await page.locator('#youtube-settings').click();await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
 await page.evaluate(()=>(window as any).position=93);await page.clock.fastForward(1000);await page.locator('#queue-next').click();
 const first=await page.evaluate(()=>{const w=window as any;return w.progress.filter((p:any)=>p.playbackId===w.records[0].playbackId).at(-1);});
 expect(first).toMatchObject({listenedMs:8000,durationMs:120000,source:'my_wave',endReason:'skip'});await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(2);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onStateChange({data:0,target:w.activePlayer});});
 await expect.poll(()=>page.evaluate(()=>{const w=window as any;return w.progress.some((p:any)=>p.playbackId===w.records[1].playbackId&&p.endReason==='natural');})).toBe(true);
});
test('dislike and technical failures have different history reasons',async({page})=>{
 await expect(page.locator('#dislike')).toBeEnabled();await page.locator('#dislike').click();
 await expect.poll(()=>page.evaluate(()=>{const w=window as any;return w.progress.some((p:any)=>p.playbackId===w.records[0].playbackId&&p.endReason==='dislike');})).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(2);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onError({data:101,target:w.activePlayer});});
 await expect.poll(()=>page.evaluate(()=>{const w=window as any;return w.progress.some((p:any)=>p.playbackId===w.records[1].playbackId&&p.endReason==='error');})).toBe(true);
 expect(await page.evaluate(()=>(window as any).feedbackWrites.length)).toBe(1);
});
test('Wave metadata is not reported on cue, survives into progress and retries delivery without stopping playback',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('fixture.waveRef','1'));await page.reload();await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).waveCalls)).toBe(0);expect(await page.evaluate(()=>(window as any).records.length)).toBe(0);
 await page.locator('#source-start').click();await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);await page.clock.fastForward(500);await expect.poll(()=>page.evaluate(()=>(window as any).waveCalls)).toBe(1);
 await expect(page.locator('#wave-sync-status')).toContainText('отправлены');expect(await page.evaluate(()=>(window as any).progress[0].waveRef)).toBe('wave-one');
 await page.evaluate(()=>{const w=window as any;w.waveSyncFail=true;w.position=2;});await page.clock.fastForward(2000);await page.locator('#pause').click();await page.clock.fastForward(500);await expect(page.locator('#wave-sync-status')).toContainText('сохранено на устройстве');
 await page.evaluate(()=>(window as any).waveSyncFail=false);await page.clock.fastForward(2500);await expect(page.locator('#wave-sync-status')).toContainText('отправлены');await expect(page.locator('#play')).toBeEnabled();expect(await page.evaluate(()=>(window as any).records.length)).toBe(1);
});
