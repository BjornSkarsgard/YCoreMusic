import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.handlers={};w.callbacks={};w.loads=[];w.commands=[];w.mirrors=[];w.records=[];let id=0,epoch=0,sequence=0;
  const cache={position:0,duration:120,playback:-1,quality:'hd1080',captionOptions:[],captionTracks:[],iframeCount:1};
  w.packet=(kind:string,overrides:any={})=>w.handlers['player-host-event']?.({payload:{epoch,sequence:++sequence,kind,cache:{...cache},...overrides}});
  w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.handlers[args.event]=w.callbacks[args.handler];return ++id;}
   if(command==='player_host_status')return {supported:true,epoch};
   if(command==='source_fetch')return [{id:'1',title:'First',artist:'Fixture'},{id:'2',title:'Second',artist:'Fixture'}];
   if(command==='search_videos')return [{id:args.title==='First'?'Aaaaaaaaaaa':'Bbbbbbbbbbb',title:args.title,score:100,reason:'fixture'}];
   if(command==='player_host_load'){epoch=args.options.epoch;sequence=0;w.loads.push(args.options);queueMicrotask(()=>w.packet('ready'));}
   if(command==='player_host_command'){
    w.commands.push(args);if(args.epoch!==epoch)return;
    const action=args.command;
    if(action.type==='cue'){cache.position=action.position;cache.playback=5;w.packet('state');}
    if(action.type==='play'){cache.playback=1;w.packet('state');}
    if(action.type==='pause'){cache.playback=2;w.packet('state');}
    if(action.type==='seek'){cache.position=action.position;w.packet('tick');}
   }
   if(command==='player_host_mirror')w.mirrors.push(args.surface);
   if(command==='storage_command'&&args.request.type==='record')w.records.push(args.request.event);
  }};
 });
 await page.route('https://www.youtube.com/**',route=>route.abort());
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
});

test('native host bridge keeps the controller iframe-free and forwards the existing transport without autoplay',async({page})=>{
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('script[src*=youtube]')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).commands.some((value:any)=>value.command.type==='play'))).toBe(false);
 await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
 await page.locator('#forward').click();await expect.poll(()=>page.evaluate(()=>(window as any).commands.some((value:any)=>value.command.type==='seek'&&value.command.position===5))).toBe(true);
 const loads=await page.evaluate(()=>(window as any).loads.length);await page.locator('#window-layout').selectOption('controls');
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(false);
 await page.locator('#pause').click();await expect(page.locator('#status')).toHaveText('Пауза');
});

test('old engine generations and reordered packets cannot finish or pause a newer selected track',async({page})=>{
 const old=await page.evaluate(()=>(window as any).loads[0].epoch);
 await page.locator('#play').click();await page.locator('[data-panel=queue]').click();await page.locator('#queue-list li[data-ordinal="1"] button').click();
 await expect(page.locator('#track-title')).toHaveText('Second');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.evaluate(epoch=>{const w=window as any;w.packet('state',{epoch,sequence:999,cache:{position:120,duration:120,playback:0,quality:'default',captionOptions:[],captionTracks:[],iframeCount:1}});w.packet('state',{sequence:0,cache:{position:5,duration:120,playback:2,quality:'default',captionOptions:[],captionTracks:[],iframeCount:1}});},old);
 await expect(page.locator('#track-title')).toHaveText('Second');await expect(page.locator('#status')).toHaveText('Воспроизведение');await expect(page.locator('iframe')).toHaveCount(0);
});

test('actual end of the current engine advances the shared queue exactly once',async({page})=>{
 await page.locator('#play').click();const old=await page.evaluate(()=>(window as any).loads.at(-1).epoch);
 await page.evaluate(()=>{(window as any).packet('state',{cache:{position:120,duration:120,playback:0,quality:'hd1080',captionOptions:[],captionTracks:[],iframeCount:1}});});
 await expect(page.locator('#track-title')).toHaveText('Second');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.evaluate(epoch=>(window as any).packet('state',{epoch,sequence:999,cache:{position:120,duration:120,playback:0,quality:'hd1080',captionOptions:[],captionTracks:[],iframeCount:1}}),old);
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(2);await expect(page.locator('#track-title')).toHaveText('Second');
});

test('caption metadata arriving after Ready enables the selector and forwards language and font size',async({page})=>{
 await page.evaluate(()=>{(window as any).packet('tick',{cache:{position:0,duration:120,playback:5,quality:'hd1080',captionOptions:['fontSize','tracklist','track'],captionTracks:[{languageCode:'en',kind:'',name:'',displayName:'English'}],iframeCount:1}});});
 await expect(page.locator('#captions')).toBeEnabled();await page.locator('#captions').selectOption({label:'English'});await page.locator('#caption-size').selectOption('1');
 const commands=await page.evaluate(()=>(window as any).commands.map((value:any)=>value.command));
 expect(commands).toContainEqual({type:'caption_track',languageCode:'en',kind:'',name:''});expect(commands).toContainEqual({type:'caption_size',size:1});
 await page.locator('#captions').selectOption('off');expect(await page.evaluate(()=>(window as any).commands.at(-2).command.type)).toBe('unload_captions');
});
