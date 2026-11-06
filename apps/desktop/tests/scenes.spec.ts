import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.handlers={};w.callbacks={};w.controls=[];w.mirrors=[];let id=0;
  w.send=(snapshot:any,visible=true)=>w.handlers['scene-snapshot']({payload:{snapshot,visible}});
  w.spectrumFrames=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=(callback:FrameRequestCallback)=>raf(time=>{if(callback.name==='draw')w.spectrumFrames++;callback(time);});
  w.subscriptions={};w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'video-scene-test'}},transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.subscriptions[args.event]=args.target;w.handlers[args.event]=w.callbacks[args.handler];return ++id;}
   if(command==='scene_snapshot')return null;
   if(command==='scene_options')return {content:'video',fps:0,quality:'high'};
   if(command==='analysis_watch'){w.watching=args.active;return;}
   if(command==='player_host_status')return {supported:true,epoch:0};
   if(command==='player_host_mirror'){w.mirrors.push(args.surface);return;}
   if(command==='scene_control'){w.controls.push(args.action);return {fullscreen:args.action.type==='fullscreen',topmost:args.action.type==='topmost'};}
  }};
 });
 await page.route('https://www.youtube.com/**',route=>route.abort());
 await page.goto('/scene.html');await expect(page.locator('body')).toHaveClass(/native-player-host/);
});

test('Spectrum uses real supplied bands, disables the video mirror, and stops rendering when hidden',async({page})=>{
 expect(await page.evaluate(()=>Object.fromEntries(['scene-snapshot','scene-options','audio-analysis','scene-hidden'].map(name=>[name,(window as any).subscriptions[name]])))).toEqual(Object.fromEntries(['scene-snapshot','scene-options','audio-analysis','scene-hidden'].map(name=>[name,{kind:'WebviewWindow',label:'video-scene-test'}])));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(value=>{const w=window as any;w.send(value);w.handlers['scene-options']({payload:{content:'visualizer',fps:30,quality:'medium'}});},snapshot());
 const canvas=page.locator('.spectrum-canvas');await expect(canvas).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).watching)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(false);
 await page.waitForTimeout(100);const silent=await canvas.screenshot({path:'../../.tools/spectrum-test-silent.png'});
 await page.evaluate(()=>{const w=window as any;const send=()=>w.handlers['audio-analysis']({payload:{available:true,bands:Array(48).fill(.2)}});send();w.audioTimer=setInterval(send,50);});
 await page.waitForTimeout(200);const active=await canvas.screenshot({path:'../../.tools/spectrum-test-active.png'});expect(errors).toEqual([]);expect(active.equals(silent),JSON.stringify(await page.evaluate(()=>{const canvas=document.querySelector('canvas')!;const gl=canvas.getContext('webgl');return {frames:(window as any).spectrumFrames,renderer:canvas.dataset.renderer,size:[canvas.width,canvas.height],hidden:document.hidden,error:gl?.getError()};}))).toBe(false);
 await page.evaluate(()=>clearInterval((window as any).audioTimer));
 await page.evaluate(value=>(window as any).send(value,false),snapshot(2));await page.waitForTimeout(50);
 const frames=await page.evaluate(()=>(window as any).spectrumFrames);await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as any).spectrumFrames)).toBe(frames);
 await expect.poll(()=>page.evaluate(()=>(window as any).watching)).toBe(false);
 await page.evaluate(value=>(window as any).send(value,true),snapshot(3));await expect.poll(()=>page.evaluate(()=>(window as any).spectrumFrames)).toBeGreaterThan(frames);
 await page.evaluate(()=>{(window as any).handlers['scene-options']({payload:{content:'video',fps:30,quality:'medium'}});});await expect(canvas).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(true);await expect(page.locator('iframe')).toHaveCount(0);
});

test('a lost graphics context falls back to Canvas2D without playback commands',async({page})=>{
 await page.evaluate(()=>{const w=window as any;w.handlers['scene-options']({payload:{content:'visualizer',fps:60,quality:'high'}});const canvas=document.querySelector('canvas')!;if(canvas.dataset.renderer==='webgl')canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));});
 await expect(page.locator('.spectrum-canvas')).toHaveAttribute('data-renderer','canvas2d');
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([]);
});

for(const preset of ['ambient','liquid','particles'])test(preset+' reacts to bands, has a Canvas fallback, and never creates another player',async({page})=>{
 await page.evaluate(({value,preset})=>{const w=window as any;w.send(value);w.handlers['scene-options']({payload:{content:'visualizer',fps:60,quality:'medium',preset}});}, {value:snapshot(),preset});
 const canvas=page.locator('.spectrum-canvas');await expect(canvas).toHaveAttribute('data-preset',preset);await expect(canvas).toHaveAttribute('data-renderer','webgl');
 const silent=await canvas.screenshot();
 await page.evaluate(()=>{const w=window as any;const send=()=>w.handlers['audio-analysis']({payload:{available:true,bands:Array(48).fill(.2)}});send();w.visualTimer=setInterval(send,40);});
 await page.waitForTimeout(250);const active=await canvas.screenshot({path:'../../.tools/visualizer-'+preset+'.png'});expect(active.equals(silent)).toBe(false);
 if(preset==='ambient')await expect(page.locator('.visualizer-artwork')).toBeVisible();else await expect(page.locator('.visualizer-artwork')).toBeHidden();
 await page.evaluate(()=>document.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
 await expect(page.locator('.spectrum-canvas')).toHaveAttribute('data-renderer','canvas2d');
 await page.waitForTimeout(100);const fallback=await page.locator('.spectrum-canvas').screenshot();
 await page.evaluate(()=>{clearInterval((window as any).visualTimer);(window as any).handlers['audio-analysis']({payload:{available:true,bands:Array(48).fill(0)}});});
 await page.waitForTimeout(1100);expect((await page.locator('.spectrum-canvas').screenshot()).equals(fallback)).toBe(false);
 await expect(page.locator('iframe')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).controls)).toEqual([]);
});
const snapshot=(revision=1,generation=1,videoId:string|null='Aaaaaaaaaaa',playback=1,position=10)=>({revision,generation,videoId,title:generation===1?'First':'Second',artist:'Fixture',position,duration:120,playback});

test('video window only mirrors the existing engine without loading YouTube or creating a player',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot());await expect(page.locator('#scene-title')).toHaveText('First');
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.some((surface:any)=>surface.visible))).toBe(true);
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('script[src*=youtube]')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([]);
});

test('scene covers the cued YouTube center with YCore and clears the cover on buffering or playing',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot(1,1,'Aaaaaaaaaaa',5));await expect(page.locator('.cue-brand')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.holes.length)).toBe(2);
 await page.evaluate(value=>(window as any).send(value),snapshot(2,1,'Aaaaaaaaaaa',3));await expect(page.locator('.cue-brand')).toBeHidden();
 await page.evaluate(value=>(window as any).send(value),snapshot(3,1,'Aaaaaaaaaaa',1));await expect(page.locator('.cue-brand')).toBeHidden();
});

test('locked external scene disables seek and navigation but keeps Pause and window controls',async({page})=>{
 await page.evaluate(value=>(window as any).send({...value,locked:true}),snapshot());
 await expect(page.locator('[data-control=next]')).toBeDisabled();await expect(page.locator('[data-control=previous]')).toBeDisabled();await expect(page.locator('#scene-seek')).toBeDisabled();
 await expect(page.locator('#scene-toggle')).toBeEnabled();await expect(page.locator('[data-control=fullscreen]')).toBeEnabled();
 await page.evaluate(value=>(window as any).send({...value,locked:false}),snapshot(2));await expect(page.locator('[data-control=next]')).toBeEnabled();await expect(page.locator('#scene-seek')).toBeEnabled();
});
test('stale metadata cannot replace a new clip and timeline updates do not interrupt dragging',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot(2,2,'Bbbbbbbbbbb',2,20));await expect(page.locator('#scene-title')).toHaveText('Second');
 await page.evaluate(value=>(window as any).send(value),snapshot(1,1));await expect(page.locator('#scene-title')).toHaveText('Second');
 await page.locator('#scene-seek').evaluate((input:HTMLInputElement)=>{input.value='50';input.dispatchEvent(new Event('input'));});
 await page.evaluate(value=>(window as any).send(value),snapshot(3,2,'Bbbbbbbbbbb',2,21));await expect(page.locator('#scene-seek')).toHaveValue('50');
 await page.locator('#scene-seek').dispatchEvent('change');expect(await page.evaluate(()=>(window as any).controls)).toEqual([{type:'seek',position:50}]);await expect(page.locator('iframe')).toHaveCount(0);
});
test('scene HUD remains uncovered by the mirror and hides after mouse inactivity',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot());await page.mouse.move(300,200);await expect(page.locator('#scene-controls')).toHaveCSS('opacity','1');
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.holes.length)).toBe(2);
 await page.locator('[data-control=toggle]').click();await page.locator('[data-control=fullscreen]').click();await expect(page.locator('[data-control=fullscreen]')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([{type:'toggle'},{type:'fullscreen'}]);
 await page.mouse.move(10,10);await expect(page.locator('#scene-controls')).toHaveCSS('opacity','0',{timeout:5000});
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.holes.length)).toBe(1);
});
