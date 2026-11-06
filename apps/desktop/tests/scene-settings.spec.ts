import {test,expect} from './fixtures';

test('native scene restore starts publishing without reopening screen settings',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.nativeScenes=[];w.published=[];w.callbacks={};w.listeners={};let next=0;
  w.__TAURI_INTERNALS__={transformCallback:(callback:unknown)=>{w.callbacks[++next]=callback;return next;},invoke:async(command:string,args:any)=>{
   if(command==='plugin:event|listen'){w.listeners[args.event]=w.callbacks[args.handler];return 1;}
   if(command==='scene_windows')return w.nativeScenes;
   if(command==='scene_publish'){w.published.push(args.snapshot);return;}
   if(command==='monitor_list')return [{id:'monitor-tv',name:'TV',stable:true,width:1920,height:1080,refreshHz:60}];
   if(command==='platform_capabilities')return {videoMirrors:true,audioAnalysis:true};
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
  }};
 });
 await page.goto('/');await expect.poll(()=>page.evaluate(()=>!!(window as any).listeners['scene-windows-changed'])).toBe(true);
 expect(await page.evaluate(()=>(window as any).published.length)).toBe(0);
 await page.evaluate(()=>{const w=window as any;w.nativeScenes=[{screenId:'monitor-tv',enabled:true,visible:true,topmost:false}];w.listeners['scene-windows-changed']({payload:null});});
 await expect.poll(()=>page.evaluate(()=>(window as any).published.length)).toBeGreaterThan(0);
 await page.evaluate(()=>{const w=window as any;w.nativeScenes=[];w.listeners['scene-windows-changed']({payload:null});});
 await page.waitForTimeout(150);const count=await page.evaluate(()=>(window as any).published.length);
 await page.waitForTimeout(650);expect(await page.evaluate(()=>(window as any).published.length)).toBe(count);
});

test('a platform without mirror/audio adapters keeps playback usable and does not offer unsupported windows',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;localStorage.setItem('encore.mainLayout.v1','spectrum');
  w.__TAURI_INTERNALS__={invoke:async(command:string)=>{
   if(command==='platform_capabilities')return {videoMirrors:false,audioAnalysis:false};
   if(command==='monitor_list')return [{id:'a',name:'A',stable:true,width:1920,height:1080,refreshHz:60}];
   if(command==='scene_windows'||command==='source_fetch'||command==='smart_history_fetch')return [];
  }};
 });
 await page.goto('/');await expect(page.locator('#window-layout')).toHaveValue('video');
 await expect(page.locator('#window-layout option[value=spectrum]')).toHaveJSProperty('disabled',true);
 expect(await page.evaluate(()=>localStorage.getItem('encore.mainLayout.v1'))).toBe('spectrum');
 await page.locator('#window-layout').selectOption('controls');await expect(page.locator('body')).toHaveClass(/controls-layout/);
 await page.locator('#screens').click();await page.locator('#scene-monitor').selectOption('a');
 await expect(page.locator('#scene-video-choice')).toBeDisabled();await expect(page.locator('#scene-visualizer-choice')).toBeDisabled();await expect(page.locator('#scene-open')).toBeDisabled();
 await expect(page.locator('.scene-limit')).toContainText('Клип и управление работают в основном окне');
});

test('a build with video mirrors but no analysis keeps video available and disables only visualizers',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;
  w.__TAURI_INTERNALS__={invoke:async(command:string)=>{
   if(command==='platform_capabilities')return {videoMirrors:true,audioAnalysis:false};
   if(command==='monitor_list')return [{id:'a',name:'A',stable:true,width:1920,height:1080,refreshHz:60}];
   if(command==='scene_windows'||command==='source_fetch'||command==='smart_history_fetch')return [];
  }};
 });
 await page.goto('/');await page.locator('#screens').click();await page.locator('#scene-monitor').selectOption('a');
 await expect(page.locator('#scene-video-choice')).toBeEnabled();await expect(page.locator('#scene-open')).toBeEnabled();await expect(page.locator('#scene-visualizer-choice')).toBeDisabled();
 await expect(page.locator('#visualizer-unavailable')).toContainText('Можно показывать клип');
});

test('visualizer settings belong to the selected monitor and explicit FPS respects its refresh rate',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.scenes={};w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='source_fetch'||command==='smart_history_fetch')return [];
  if(command==='monitor_list')return [{id:'a',name:'A',stable:true,width:1920,height:1080,refreshHz:60},{id:'b',name:'B',stable:true,width:1920,height:1080,refreshHz:144}];
  if(command==='scene_windows')return Object.values(w.scenes);
  if(command==='scene_window'){return w.scenes[args.monitorId]={enabled:true,visible:true,screenId:args.monitorId,options:args.options};}
 }};});
 await page.goto('/');await page.locator('#screens').click();await page.locator('#scene-monitor').selectOption('a');await page.locator('#scene-visualizer-choice').click();
 await expect(page.locator('#visualizer-options')).toBeVisible();expect(await page.locator('#visualizer-fps option').allTextContents()).toEqual(['Частота экрана','30 кадров/с','60 кадров/с']);
 await page.locator('#visualizer-preset').selectOption('liquid');
 await page.locator('#visualizer-fps').selectOption('30');await page.locator('#visualizer-quality').selectOption('low');await page.locator('#scene-open').click();await expect(page.locator('#scene-open')).toBeEnabled();
 await page.locator('#scene-monitor').selectOption('b');await expect(page.locator('#scene-video-choice')).toHaveAttribute('aria-pressed','true');await page.locator('#scene-visualizer-choice').click();await page.locator('#visualizer-fps').selectOption('144');await page.locator('#scene-open').click();await expect(page.locator('#scene-open')).toBeEnabled();
 await page.locator('#scene-monitor').selectOption('a');await expect(page.locator('#scene-visualizer-choice')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#visualizer-fps')).toHaveValue('30');await expect(page.locator('#visualizer-quality')).toHaveValue('low');
 expect(await page.evaluate(()=>(window as any).scenes.b.options)).toEqual({content:'visualizer',fps:144,quality:'high'});
 await expect(page.locator('#visualizer-preset')).toHaveValue('liquid');expect(await page.evaluate(()=>(window as any).scenes.a.options.preset)).toBe('liquid');
});

test('late initial window status cannot disable a newly opened scene; open and off coalesce while pending',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.windowCalls=[];w.published=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
   if(command==='monitor_list')return [{id:'monitor-tv',name:'TV',stable:true,width:3840,height:2160}];
   if(command==='scene_publish'){w.published.push(args.snapshot);return;}
   if(command==='scene_windows'){w.windowCalls.push('list');return new Promise(resolve=>w.initialStatus=resolve);}
   if(command==='scene_window'){
    w.windowCalls.push(args.action);
    if(args.action==='status')return new Promise(resolve=>w.initialStatus=resolve);
    return new Promise(resolve=>w.windowResolve=resolve);
   }
  }};
 });
 await page.goto('/');await page.getByRole('button',{name:'Экраны и телевизор',exact:true}).click();await page.locator('#scene-monitor').selectOption('monitor-tv');
 await page.locator('#scene-open').click();await expect(page.locator('#scene-open')).toBeDisabled();
 await page.evaluate(()=>{document.getElementById('scene-open')!.click();(window as any).windowResolve({enabled:true,visible:true,topmost:false});});
 await expect(page.locator('#scene-off')).toBeEnabled();
 await page.evaluate(()=>(window as any).initialStatus([]));
 await expect(page.locator('#scene-off')).toBeEnabled();await expect.poll(()=>page.evaluate(()=>(window as any).published.length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>(window as any).windowCalls)).toEqual(['list','open']);
 await page.locator('#scene-off').click();await expect(page.locator('#scene-open')).toBeDisabled();
 await page.evaluate(()=>(window as any).windowResolve({enabled:false,visible:false,topmost:false}));await expect(page.locator('#scene-open')).toBeEnabled();await expect(page.locator('#scene-off')).toBeDisabled();
 const count=await page.evaluate(()=>(window as any).published.length);await page.waitForTimeout(650);expect(await page.evaluate(()=>(window as any).published.length)).toBe(count);
 expect(await page.evaluate(()=>(window as any).windowCalls)).toEqual(['list','open','off']);
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
 await page.goto('/');await page.getByRole('button',{name:'Экраны и телевизор',exact:true}).click();await expect(page.locator('#scene-monitor option')).toHaveCount(2);
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual([]);
 await page.locator('#scene-monitor').selectOption('monitor-tv');await page.locator('#scene-open').click();await expect(page.locator('#scene-off')).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual(['monitor-tv']);
 await page.evaluate(()=>(window as any).disconnected=true);await page.locator('#monitor-refresh').click();await expect(page.locator('#monitor-status')).toContainText('Экран отключён');
 await expect(page.locator('#scene-monitor')).toHaveValue('monitor-tv');await expect(page.locator('#scene-open')).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).selectedDisplays)).toEqual(['monitor-tv']);
});

test('screens are discoverable without settings, require an explicit screen and restore focus without changing playback',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.sceneActions=[];w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='source_fetch'||command==='smart_history_fetch')return [];
  if(command==='monitor_list'){if(w.failDisplays)throw Error('offline');return [{id:'tv',name:'TV <script>',stable:true,width:3840,height:2160,refreshHz:60}];}
  if(command==='scene_window'){w.sceneActions.push(args.action);return {enabled:false,visible:false};}
 }};});
 await page.setViewportSize({width:800,height:650});await page.goto('/');
 const trigger=page.getByRole('button',{name:'Экраны и телевизор',exact:true});await expect(trigger).toBeVisible();await trigger.click();
 await expect(page.getByRole('dialog',{name:'Экраны и телевизор'})).toBeVisible();await expect(page.locator('#scene-open')).toBeDisabled();
 await page.locator('#scene-monitor').selectOption('tv');await expect(page.locator('#scene-open')).toBeEnabled();await expect(page.getByRole('button',{name:/Визуализатор/})).toBeEnabled();
 await page.screenshot({path:'../../.tools/ycore-screens-800.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(800);
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();await expect(page.locator('#scene-monitor')).toHaveValue('tv');
 await page.evaluate(()=>(window as any).failDisplays=true);await page.locator('#monitor-refresh').click();await expect(page.locator('#monitor-status')).toContainText('Не удалось');await expect(page.locator('#scene-open')).toBeDisabled();
 await page.evaluate(()=>(window as any).failDisplays=false);await page.locator('#monitor-refresh').click();await expect(page.locator('#scene-open')).toBeEnabled();
 await page.locator('#screens-controls').evaluate((button:HTMLButtonElement)=>button.click());await expect(page.locator('#screens-dialog')).not.toBeVisible();await expect(page.locator('#window-layout')).toHaveValue('controls');
 expect(await page.evaluate(()=>(window as any).sceneActions)).toEqual([]);
 await page.locator('[data-panel=settings]').click();await page.getByRole('button',{name:'Настроить экраны'}).click();await expect(page.locator('#screens-dialog')).toBeVisible();
});

test('opening another monitor keeps the first clip enabled and Off only targets the selected monitor',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.sceneActions=[];w.scenePublishes=0;w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='source_fetch'||command==='smart_history_fetch'||command==='scene_windows')return [];
  if(command==='monitor_list')return ['a','b'].map(id=>({id,name:'Экран '+id,stable:true,width:1920,height:1080}));
  if(command==='scene_publish'){w.scenePublishes++;return;}
  if(command==='scene_window'){w.sceneActions.push(args);return {enabled:args.action==='open',visible:true,screenId:args.monitorId};}
 }};});
 await page.goto('/');await page.locator('#screens').click();
 await page.locator('#scene-monitor').selectOption('a');await page.locator('#scene-open').click();await expect(page.locator('#scene-off')).toBeEnabled();
 await page.locator('#scene-monitor').selectOption('b');await expect(page.locator('#scene-off')).toBeDisabled();await page.locator('#scene-open').click();await expect(page.locator('#scene-off')).toBeEnabled();
 await page.locator('#scene-off').click();await expect(page.locator('#scene-off')).toBeDisabled();await page.locator('#scene-monitor').selectOption('a');await expect(page.locator('#scene-off')).toBeEnabled();
 await expect(page.locator('#scene-open')).toHaveText('Показать окно снова');
 const count=await page.evaluate(()=>(window as any).scenePublishes);await expect.poll(()=>page.evaluate(()=>(window as any).scenePublishes)).toBeGreaterThan(count);
 expect(await page.evaluate(()=>(window as any).sceneActions)).toEqual([{action:'open',monitorId:'a',options:{content:'video',fps:0,quality:'high'}},{action:'open',monitorId:'b',options:{content:'video',fps:0,quality:'high'}},{action:'off',monitorId:'b'}]);
});

test('a saved disconnected screen can be switched off and persistence errors remain visible',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
  if(command==='source_fetch'||command==='smart_history_fetch')return [];
  if(command==='monitor_list')return [{id:'main',name:'Main',stable:true,width:1920,height:1080}];
  if(command==='scene_windows')return w.sceneOff?[]:[{enabled:true,visible:false,screenId:'missing',detached:true}];
  if(command==='scene_layout_status')return {persistenceError:true,waiting:1};
  if(command==='scene_window'){w.sceneOff=args.monitorId==='missing'&&args.action==='off';return {enabled:false,visible:false};}
 }};});
 await page.goto('/');await page.locator('#screens').click();await page.locator('#scene-monitor').selectOption('missing');
 await expect(page.locator('#scene-open')).toBeDisabled();await expect(page.locator('#scene-off')).toBeEnabled();await expect(page.locator('#scene-window-status')).toContainText('Экран отключён');
 await expect(page.locator('#scene-layout-status')).toContainText('Не удалось сохранить');await page.locator('#scene-off').click();await expect(page.locator('#scene-off')).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).sceneOff)).toBe(true);expect(errors).toEqual([]);
});
