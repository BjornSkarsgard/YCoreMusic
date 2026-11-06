import {test,expect} from './fixtures';
import type {Page} from '@playwright/test';

async function setup(page:Page,options={initial:12,holdMore:false,failFirst:false,holdMatch:false}){
 await page.addInitScript(options=>{
  const w=window as any;w.isTauri=true;w.moreCalls=0;w.played=[];w.records=[];let next=options.initial+1;
  const tracks=(start:number,count:number)=>Array.from({length:count},(_,index)=>({id:String(start+index),title:'Song '+(start+index),artist:'Fixture'}));
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'){
    if(args.fresh)return tracks(1,options.initial);
    ++w.moreCalls;if(options.failFirst&&w.moreCalls===1)throw 'Network/TLS error';
    if(options.holdMore){options.holdMore=false;await new Promise(resolve=>w.releaseMore=resolve);}
    const value=tracks(next,20);next+=20;return value;
   }
   if(command==='search_videos'){
    if(options.holdMatch&&args.title==='Song 2'){options.holdMatch=false;await new Promise(resolve=>w.releaseMatch=resolve);}
    return [{id:args.title.replace('Song ','').padStart(11,'v'),title:args.title,score:100,reason:'fixture'}];
   }
   if(command==='storage_command'&&args.request.type==='record')w.records.push(args.request.event);
  }};
 },options);
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YT={Player:class{
 constructor(id,options){this.el=document.getElementById(id);this.options=options;window.activePlayer=this;setTimeout(()=>options.events.onReady({target:this}),0);}
 cueVideoById(value){this.id=typeof value==='string'?value:value.videoId;this.options.events.onStateChange({data:5,target:this});}
 setVolume(){}getDuration(){return 120;}getCurrentTime(){return 5;}seekTo(){}
 playVideo(){window.played.push(this.id);this.options.events.onStateChange({data:1,target:this});}pauseVideo(){this.options.events.onStateChange({data:2,target:this});}destroy(){this.el.remove();}
 }};window.onYouTubeIframeAPIReady();`}));
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await page.locator('[data-panel=queue]').click();
}
test('queue selection keeps previous rows, rejects late matches and continues after the selected track',async({page})=>{
 await setup(page,{initial:12,holdMore:false,failFirst:false,holdMatch:true});
 await page.locator('#queue-list li[data-ordinal="2"] button').click();await expect(page.locator('#track-title')).toHaveText('Song 3');
 await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('vvvvvvvvvv3');
 await page.evaluate(()=>(window as any).releaseMatch());await expect(page.locator('#queue-list li[aria-current=true]')).toHaveAttribute('data-ordinal','2');
 await expect(page.locator('#queue-list li[data-phase=past]')).toHaveCount(2);await expect(page.locator('#queue-list li')).toHaveCount(12);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onStateChange({data:0,target:w.activePlayer});});
 await expect(page.locator('#track-title')).toHaveText('Song 4');await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('vvvvvvvvvv4');
 await page.locator('#queue-list li[data-ordinal="0"] button').click();await expect(page.locator('#track-title')).toHaveText('Song 1');await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('vvvvvvvvvv1');
 expect(await page.evaluate(()=>(window as any).records.map((record:any)=>record.trackId))).toEqual(['3','4','1']);
 await expect(page.locator('#queue-list .track-skipped')).toHaveCount(0);
 await page.locator('#queue-next').click();await expect(page.locator('#track-title')).toHaveText('Song 2');
 await expect(page.locator('#queue-list .skip-reason')).toHaveCount(0);
});
test('jumping back defeats a pending Next while its new batch still appends to the same queue',async({page})=>{
 await setup(page,{initial:2,holdMore:true,failFirst:false,holdMatch:false});await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseMore)).toBe('function');
 await page.locator('#queue-list li[data-ordinal="1"] button').click();await expect(page.locator('#track-title')).toHaveText('Song 2');
 await page.locator('#queue-next').click();await page.locator('#queue-list li[data-ordinal="0"] button').click();await expect(page.locator('#track-title')).toHaveText('Song 1');
 await page.evaluate(()=>(window as any).releaseMore());await expect.poll(()=>page.locator('#queue-list li').count()).toBeGreaterThan(2);await expect(page.locator('#queue-list li[aria-current=true]')).toHaveAttribute('data-ordinal','0');
 await expect.poll(()=>page.evaluate(()=>(window as any).played.at(-1))).toBe('vvvvvvvvvv1');
});
test('scrolling near the bottom loads one batch without autoplay, cursor change or scroll reset',async({page})=>{
 await setup(page,{initial:30,holdMore:true,failFirst:false,holdMatch:false});const pane=page.locator('.panel-scroll');
 await pane.evaluate(element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll'));});await expect.poll(()=>page.evaluate(()=>(window as any).moreCalls)).toBe(1);
 await pane.evaluate(element=>{for(let n=0;n<10;n++)element.dispatchEvent(new Event('scroll'));});expect(await page.evaluate(()=>(window as any).moreCalls)).toBe(1);const before=await pane.evaluate(element=>element.scrollTop);
 await page.evaluate(()=>(window as any).releaseMore());await expect(page.locator('#queue-list li')).toHaveCount(50);expect(await pane.evaluate(element=>element.scrollTop)).toBe(before);await expect(page.locator('#queue-list li[aria-current=true]')).toHaveAttribute('data-ordinal','0');expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});
test('failed scroll loading offers retry without repeatedly requesting on every scroll event',async({page})=>{
 await setup(page,{initial:30,holdMore:false,failFirst:true,holdMatch:false});const pane=page.locator('.panel-scroll');await pane.evaluate(element=>{element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event('scroll'));});
 await expect(page.locator('#queue-load-more')).toBeVisible();await pane.evaluate(element=>{for(let n=0;n<10;n++)element.dispatchEvent(new Event('scroll'));});expect(await page.evaluate(()=>(window as any).moreCalls)).toBe(1);
 await page.locator('#queue-load-more').click();await expect(page.locator('#queue-list li')).toHaveCount(50);await expect(page.locator('#queue-load-more')).toBeHidden();expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('control layout keeps catalogue and queue visible without recreating or starting the player',async({page})=>{
 await setup(page,{initial:35,holdMore:false,failFirst:false,holdMatch:false});
 await page.evaluate(()=>{(window as any).originalPlayer=(window as any).activePlayer;});
 await page.locator('#window-layout').selectOption('controls');
 await expect(page.locator('.controls-content')).toBeVisible();await expect(page.locator('.controls-queue')).toBeVisible();
 await expect(page.locator('[data-pane=wave]')).toBeVisible();await expect(page.locator('#queue-list')).toBeVisible();
 await page.locator('[data-panel=search]').click();await expect(page.locator('[data-pane=search]')).toBeVisible();await expect(page.locator('#queue-list')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).activePlayer===(window as any).originalPlayer)).toBe(true);
 expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
 await page.locator('#queue-list li[data-ordinal="2"] button').click();await expect(page.locator('#track-title')).toHaveText('Song 3');
 await expect(page.locator('[data-pane=search]')).toBeVisible();
 await page.locator('#window-layout').selectOption('video');await expect(page.locator('.side-panel #queue-list')).toHaveCount(1);
 await page.locator('[data-panel=queue]').click();await expect(page.locator('#queue-list li[aria-current=true]')).toHaveAttribute('data-ordinal','2');
});

test('pinned queue scroll extends Wave independently of catalogue scroll and preserves cursor',async({page})=>{
 await setup(page,{initial:35,holdMore:true,failFirst:false,holdMatch:false});await page.locator('#window-layout').selectOption('controls');
 await page.locator('[data-panel=search]').click();const pane=page.locator('.controls-queue-scroll');
 await pane.evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
 await expect.poll(()=>page.evaluate(()=>(window as any).moreCalls)).toBe(1);
 const before=await pane.evaluate(el=>el.scrollTop);await page.evaluate(()=>(window as any).releaseMore());
 await expect(page.locator('#queue-list li')).toHaveCount(55);expect(await pane.evaluate(el=>el.scrollTop)).toBe(before);
 await expect(page.locator('#queue-list li[aria-current=true]')).toHaveAttribute('data-ordinal','0');expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
});

test('control layout persists without autoplay and fits the minimum desktop size',async({page})=>{
 await page.setViewportSize({width:800,height:650});await setup(page,{initial:35,holdMore:false,failFirst:false,holdMatch:false});
 await page.locator('#window-layout').selectOption('controls');await page.reload();await expect(page.locator('#window-layout')).toHaveValue('controls');
 await expect(page.locator('.controls-content')).toBeVisible();await expect(page.locator('#queue-list')).toBeVisible();
 const hud=(await page.locator('.player-hud').boundingBox())!,content=(await page.locator('.controls-content').boundingBox())!,rail=(await page.locator('.controls-queue').boundingBox())!;
 expect(hud.y+hud.height).toBeLessThanOrEqual(650);expect(content.y+content.height).toBeLessThanOrEqual(hud.y);expect(rail.x+rail.width).toBeLessThanOrEqual(800);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(800);expect(await page.evaluate(()=>(window as any).played)).toEqual([]);
 await page.screenshot({path:'../../.tools/controls-layout-800.png'});
});
