import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.handlers={};w.callbacks={};w.controls=[];w.volumes=[];w.cues=[];w.played=[];w.mutes=0;w.players=[];let id=0;
  w.send=(snapshot:any,visible=true)=>w.handlers['scene-snapshot']({payload:{snapshot,visible}});
  w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.handlers[args.event]=w.callbacks[args.handler];return ++id;}
   if(command==='scene_snapshot')return null;
   if(command==='scene_control'){w.controls.push(args.action);return {fullscreen:args.action.type==='fullscreen',topmost:args.action.type==='topmost'};}
  }};
 });
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`window.YT={Player:class{
 constructor(id,options){this.el=document.getElementById(id);this.options=options;this.position=0;this.state=-1;window.players.push(this);window.activePlayer=this;setTimeout(()=>options.events.onReady({target:this}),0);}
 cueVideoById(value){this.position=value.startSeconds;this.id=value.videoId;window.cues.push(this.id);this.state=5;this.options.events.onStateChange({data:5,target:this});}
 mute(){window.mutes++;}setVolume(value){window.volumes.push(value);}getCurrentTime(){return this.position;}getPlayerState(){return this.state;}
 seekTo(value){this.position=value;}playVideo(){this.state=1;window.played.push(this.id);this.options.events.onStateChange({data:1,target:this});}pauseVideo(){this.state=2;this.options.events.onStateChange({data:2,target:this});}destroy(){this.el.remove();this.destroyed=true;}
 }};window.onYouTubeIframeAPIReady();`}));
 await page.goto('/scene.html');await expect.poll(()=>page.evaluate(()=>typeof (window as any).handlers['scene-hidden'])).toBe('function');
});
const snapshot=(revision=1,generation=1,videoId:string|null='Aaaaaaaaaaa',playback=1,position=10)=>({revision,generation,videoId,title:'First',artist:'Fixture',position,duration:120,playback});

test('scene follows the master timeline muted and never advances the queue on ENDED',async({page})=>{
 expect(await page.evaluate(()=>(window as any).players.length)).toBe(0);
 await page.evaluate(value=>(window as any).send(value),snapshot());await expect.poll(()=>page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
 expect(await page.evaluate(()=>(window as any).volumes.every((value:number)=>value===0))).toBe(true);expect(await page.evaluate(()=>(window as any).mutes)).toBeGreaterThan(0);
 await page.evaluate(value=>(window as any).send(value),snapshot(2,1,'Aaaaaaaaaaa',2,35));
 expect(await page.evaluate(()=>(window as any).activePlayer.position)).toBe(35);expect(await page.evaluate(()=>(window as any).activePlayer.state)).toBe(2);
 await page.evaluate(()=>{const w=window as any;w.activePlayer.options.events.onStateChange({data:0,target:w.activePlayer});});
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([]);
 await page.evaluate(value=>(window as any).send(value),snapshot(3,2,'Bbbbbbbbbbb',5,0));await expect.poll(()=>page.evaluate(()=>(window as any).cues)).toEqual(['Aaaaaaaaaaa','Bbbbbbbbbbb']);
 expect(await page.evaluate(()=>(window as any).played)).toEqual(['Aaaaaaaaaaa']);
});

test('stale snapshots cannot replace a newer clip; hiding destroys the follower and restoring stays paused',async({page})=>{
 await page.evaluate(value=>(window as any).send(value),snapshot(2,2,'Bbbbbbbbbbb',2,20));await expect.poll(()=>page.evaluate(()=>(window as any).cues.length)).toBe(1);
 await page.evaluate(value=>(window as any).send(value),snapshot(1,1));expect(await page.evaluate(()=>(window as any).cues)).toEqual(['Bbbbbbbbbbb']);
 await page.evaluate(()=>(window as any).handlers['scene-hidden']({payload:null}));expect(await page.evaluate(()=>(window as any).activePlayer.destroyed)).toBe(true);
 await page.evaluate(value=>(window as any).send(value),snapshot(3,2,'Bbbbbbbbbbb',2,20));await expect.poll(()=>page.evaluate(()=>(window as any).cues.length)).toBe(2);
 expect(await page.evaluate(()=>(window as any).played)).toEqual([]);expect(await page.evaluate(()=>(window as any).volumes.every((value:number)=>value===0))).toBe(true);
});

test('scene controls forward commands and fullscreen HUD hides after mouse inactivity',async({page})=>{
 await page.mouse.move(300,200);await expect(page.locator('#scene-controls')).toHaveCSS('opacity','1');
 await page.locator('[data-control=toggle]').click();await page.locator('[data-control=fullscreen]').click();
 await expect(page.locator('[data-control=fullscreen]')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(value=>(window as any).send(value),snapshot());await expect(page.locator('#scene-seek')).toBeEnabled();
 await page.locator('#scene-seek').evaluate((input:HTMLInputElement)=>{input.value='50';input.dispatchEvent(new Event('change'));});
 expect(await page.evaluate(()=>(window as any).controls)).toEqual([{type:'toggle'},{type:'fullscreen'},{type:'seek',position:50}]);
 await page.mouse.move(10,10);await expect(page.locator('#scene-controls')).toHaveCSS('opacity','0',{timeout:5000});
});
