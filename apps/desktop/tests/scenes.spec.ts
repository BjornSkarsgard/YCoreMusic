import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.handlers={};w.callbacks={};w.controls=[];w.mirrors=[];let id=0;
  w.send=(snapshot:any)=>w.handlers['scene-snapshot']({payload:{snapshot,visible:true}});
  w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.handlers[args.event]=w.callbacks[args.handler];return ++id;}
   if(command==='scene_snapshot')return null;
   if(command==='player_host_status')return {supported:true,epoch:0};
   if(command==='player_host_mirror'){w.mirrors.push(args.surface);return;}
   if(command==='scene_control'){w.controls.push(args.action);return {fullscreen:args.action.type==='fullscreen',topmost:args.action.type==='topmost'};}
  }};
 });
 await page.route('https://www.youtube.com/**',route=>route.abort());
 await page.goto('/scene.html');await expect(page.locator('body')).toHaveClass(/native-player-host/);
});
const snapshot=(revision=1,generation=1,videoId:string|null='Aaaaaaaaaaa',playback=1,position=10)=>({revision,generation,videoId,title:generation===1?'First':'Second',artist:'Fixture',position,duration:120,playback});

test('video window only mirrors the existing engine without loading YouTube or creating a player',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot());await expect(page.locator('#scene-title')).toHaveText('First');
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.some((surface:any)=>surface.visible))).toBe(true);
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('script[src*=youtube]')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([]);
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
