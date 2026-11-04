import {test,expect} from './fixtures';

test('late initial window status cannot disable a newly opened scene; open and off coalesce while pending',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.windowCalls=[];w.published=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
   if(command==='scene_publish'){w.published.push(args.snapshot);return;}
   if(command==='scene_window'){
    w.windowCalls.push(args.action);
    if(args.action==='status')return new Promise(resolve=>w.initialStatus=resolve);
    return new Promise(resolve=>w.windowResolve=resolve);
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=settings]').click();
 await page.locator('#scene-open').click();await expect(page.locator('#scene-open')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('scene-open')!.click();(window as any).windowResolve({enabled:true,visible:true,topmost:false});});
 await expect(page.locator('#scene-off')).toBeEnabled();
 await page.evaluate(()=>(window as any).initialStatus({enabled:false,visible:false,topmost:false}));
 await expect(page.locator('#scene-off')).toBeEnabled();await expect.poll(()=>page.evaluate(()=>(window as any).published.length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).windowCalls)).toEqual(['status','open']);
 await page.locator('#scene-off').click();await expect(page.locator('#scene-open')).toBeDisabled();
 await page.evaluate(()=>(window as any).windowResolve({enabled:false,visible:false,topmost:false}));await expect(page.locator('#scene-open')).toBeEnabled();await expect(page.locator('#scene-off')).toBeDisabled();
 const count=await page.evaluate(()=>(window as any).published.length);await page.waitForTimeout(650);expect(await page.evaluate(()=>(window as any).published.length)).toBe(count);
 expect(await page.evaluate(()=>(window as any).windowCalls)).toEqual(['status','open','off']);
});

test('monitor selection is explicit and a missing display remains selected instead of moving to another screen',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.displayCalls=0;w.selectedDisplays=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
   if(command==='monitor_list'){++w.displayCalls;return w.disconnected?[]:[{id:'monitor-tv',name:'TV',stable:true,primary:false,width:3840,height:2160,scaleFactor:2,refreshHz:60}];}
   if(command==='scene_window'){
    if(args.action==='open'){w.selectedDisplays.push(args.monitorId);if(w.disconnected)throw Error('Selected display is disconnected');return {enabled:true,visible:true,topmost:false};}
    return {enabled:false,visible:false,topmost:false};
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=settings]').click();await expect(page.locator('#scene-monitor option')).toHaveCount(2);
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual([]);
 await page.locator('#scene-monitor').selectOption('monitor-tv');await page.locator('#scene-open').click();await expect(page.locator('#scene-off')).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual(['monitor-tv']);
 await page.evaluate(()=>(window as any).disconnected=true);await page.locator('#monitor-refresh').click();await expect(page.locator('#monitor-status')).toContainText('Экран отключён');
 await expect(page.locator('#scene-monitor')).toHaveValue('monitor-tv');await page.locator('#scene-open').click();await expect(page.locator('#scene-window-status')).toContainText('Не удалось');
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual(['monitor-tv','monitor-tv']);
});
