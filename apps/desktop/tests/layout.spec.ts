import {test,expect} from './fixtures';

test('right panel fills the released alternatives space and shrinks again when videos return',async({page})=>{
 await page.setViewportSize({width:1200,height:820});
 await page.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"/>'}));
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch')return [{id:'1',title:'Initial',artist:'Fixture'}];
   if(cmd==='discovery_fetch')return {title:'Чарт',tracks:Array.from({length:200},(_,i)=>({id:String(i+10),title:'Song '+i,artist:'Fixture'})),playlists:[]};
   if(cmd==='search_videos'){
    if(args.title!=='Initial')await new Promise(resolve=>w.releaseLayoutMatch=resolve);
    return [{id:'Aaaaaaaaaaa',title:args.title,views:100,durationSeconds:120,score:100,reason:'fixture'},{id:'Bbbbbbbbbbb',title:'Alternative',views:50,durationSeconds:180,score:100,reason:'fixture'}];
   }
  }};
 });
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`
 window.YT={Player:class {
  constructor(id,options){this.el=document.getElementById(id);this.options=options;setTimeout(()=>options.events.onReady({target:this}),0);}
  cueVideoById(){this.options.events.onStateChange({data:5,target:this});}
  playVideo(){this.options.events.onStateChange({data:1,target:this});}
  pauseVideo(){this.options.events.onStateChange({data:2,target:this});}
  destroy(){this.el.remove();}setVolume(){}getDuration(){return 120;}getCurrentTime(){return 5;}
 }};window.onYouTubeIframeAPIReady();` }));
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();await expect(page.locator('.alternative-video')).toHaveCount(2);
 // A short title used to centre the entire button contents, shifting its thumbnail.
 for(const width of [1200,900]){
  await page.setViewportSize({width,height:820});
  const lefts=await page.locator('.alternative-video').evaluateAll(rows=>rows.map(row=>row.querySelector('img')!.getBoundingClientRect().left-row.getBoundingClientRect().left));
  expect(lefts[0]).toBeCloseTo(7,0);expect(lefts[1]).toBeCloseTo(lefts[0],1);
 }
 await page.setViewportSize({width:1200,height:820});
 await page.locator('[data-panel=discovery]').click();await expect(page.locator('.discovery-track')).toHaveCount(200);
 await expect(page.locator('[data-panel=discovery]')).toHaveText('Чарт');await expect(page.locator('#panel-title')).toHaveText('Чарт');
 await expect(page.locator('#discovery h2')).toHaveCount(0);await expect(page.locator('#discovery-refresh')).toBeVisible();
 await expect(page.locator('#discovery-content h3')).toHaveText(['Для вас','Новые релизы','Подборки Яндекс Музыки']);
 expect(await page.locator('#discovery-content').evaluate(element=>element.querySelector('.discovery-track')!.getBoundingClientRect().top-element.querySelector('#discovery-play-all')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(12);
 const pane=page.locator('.panel-scroll');await pane.evaluate(el=>el.scrollTop=el.scrollHeight);
 const scrollbar=await pane.evaluate(el=>getComputedStyle(el).scrollbarColor);
 await expect(page.locator('#video-alternatives')).toHaveCSS('scrollbar-color',scrollbar);
 const height=(await pane.boundingBox())!.height,scroll=await pane.evaluate(el=>el.scrollTop),slot=(await page.locator('#video-alternatives').boundingBox())!.height;
 await page.locator('.discovery-track .track-play-action').last().click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseLayoutMatch)).toBe('function');
 await expect(page.locator('#video-alternatives')).toHaveAttribute('hidden','');
 expect((await pane.boundingBox())!.height).toBeCloseTo(height+slot,0);await expect(page.locator('#video-alternatives')).toBeHidden();
 expect(await pane.evaluate(el=>el.scrollTop)).toBeLessThanOrEqual(scroll);
 await page.evaluate(()=>(window as any).releaseLayoutMatch());await expect(page.locator('#video-alternatives')).not.toHaveAttribute('hidden','');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 expect((await pane.boundingBox())!.height).toBe(height);
 await page.locator('#window-layout').selectOption('controls');
 const rail=page.locator('.controls-queue-scroll'),before=(await rail.boundingBox())!.height,alternativeHeight=(await page.locator('#video-alternatives').boundingBox())!.height;
 await expect(rail).toHaveCSS('scrollbar-color',scrollbar);
 await page.locator('#video-alternatives').evaluate(el=>el.hidden=true);
 expect((await rail.boundingBox())!.height).toBeCloseTo(before+alternativeHeight,0);
});
