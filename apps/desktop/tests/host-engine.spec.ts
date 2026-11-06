import {test,expect} from './fixtures';

test('sole engine cues without autoplay, destroys the old iframe before replacement and ignores stale commands',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.handlers={};w.callbacks={};w.packets=[];w.plays=[];w.livePlayers=0;w.peakPlayers=0;let id=0;
  w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.handlers[args.event]=w.callbacks[args.handler];return ++id;}
   if(command==='player_host_ready')return {epoch:1,controls:false};
   if(command==='player_host_event')w.packets.push(args.packet);
  }};
 });
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`window.YT={Player:class{
 constructor(id,options){this.options=options;this.state=-1;this.position=0;this.el=document.createElement('iframe');this.el.id=id;document.getElementById(id).replaceWith(this.el);window.livePlayers++;window.peakPlayers=Math.max(window.peakPlayers,window.livePlayers);setTimeout(()=>options.events.onReady({target:this}),0);}
 cueVideoById(value){this.id=value.videoId;this.position=value.startSeconds;this.state=5;this.options.events.onStateChange({target:this,data:5});}getCurrentTime(){return this.position;}getDuration(){return 120;}getPlayerState(){return this.state;}getPlaybackQuality(){return 'hd1080';}
 playVideo(){window.plays.push(this.id);this.state=1;this.options.events.onStateChange({target:this,data:1});}pauseVideo(){this.state=2;this.options.events.onStateChange({target:this,data:2});}setVolume(){}seekTo(value){this.position=value;}destroy(){window.livePlayers--;this.el.remove();}
 }};window.onYouTubeIframeAPIReady();`}));
 await page.goto('/player-host.html');await expect.poll(()=>page.evaluate(()=>(window as any).packets.some((packet:any)=>packet.kind==='ready'&&packet.epoch===1))).toBe(true);
 expect(await page.evaluate(()=>(window as any).plays)).toEqual([]);
 await page.evaluate(()=>{const w=window as any;w.handlers['player-host-command']({payload:{epoch:1,command:{type:'cue',videoId:'Aaaaaaaaaaa',position:5}}});});
 await expect(page.locator('iframe')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).plays)).toEqual([]);
 await page.evaluate(()=>{const w=window as any;w.handlers['player-host-command']({payload:{epoch:1,command:{type:'play'}}});w.handlers['player-host-load']({payload:{epoch:2,controls:false}});});
 await expect.poll(()=>page.evaluate(()=>(window as any).packets.some((packet:any)=>packet.kind==='ready'&&packet.epoch===2))).toBe(true);
 await page.evaluate(()=>{const w=window as any;w.handlers['player-host-command']({payload:{epoch:1,command:{type:'destroy'}}});w.handlers['player-host-command']({payload:{epoch:1,command:{type:'play'}}});});
 await expect(page.locator('iframe')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).peakPlayers)).toBe(1);expect(await page.evaluate(()=>(window as any).plays)).toEqual(['Aaaaaaaaaaa']);
});
