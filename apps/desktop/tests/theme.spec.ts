import {test,expect} from './fixtures';

test('Premium Neon Dark tokens and focus/selected/disabled states stay consistent without changing the grid',async({page})=>{
 await page.setViewportSize({width:1200,height:820});await page.goto('/');
 const tokens=await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return ['bg','panel','surface','accent','accent-secondary','pink','cyan','text','text-secondary'].map(name=>style.getPropertyValue('--color-'+name).trim().toUpperCase());});
 expect(tokens).toEqual(['#0B0B14','#141225','#1F143A','#6D28FF','#A855FF','#FF4FD8','#00E5FF','#E6E8FF','#A3A6C2']);
 await expect(page.locator('.app-layout')).toHaveCSS('grid-template-columns','76px 774px 350px');
 await expect(page.locator('#play')).toBeDisabled();await expect(page.locator('#play')).toHaveCSS('opacity','0.42');await expect(page.locator('#dislike svg')).toHaveCount(1);
 await page.locator('[data-panel=search]').focus();await expect(page.locator('[data-panel=search]')).toHaveCSS('outline-color','rgb(0, 229, 255)');
 await page.locator('[data-panel=search]').click();await expect(page.locator('[data-panel=search]')).toHaveAttribute('aria-pressed','true');
 expect(await page.locator('[data-panel=search] svg').evaluate(el=>getComputedStyle(el).stroke)).toContain('ycore-icon-accent');
 const before=await page.locator('#source-start').evaluate(el=>getComputedStyle(el).filter);await page.locator('[data-panel=wave]').click();await page.locator('#source-start').hover();await expect.poll(()=>page.locator('#source-start').evaluate(el=>getComputedStyle(el).filter)).not.toBe(before);
 await page.screenshot({path:'../../.tools/ycore-theme-wave.png'});
});

test('search, library, history, settings and dialogs keep working at desktop and minimum sizes',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;localStorage.setItem('ycore.loginPrompt.dismissed.v1','1');
  const tracks=Array.from({length:24},(_,i)=>({id:String(i+1),title:['Sonne','Du hast','Deutschland'][i%3],artist:'Rammstein'}));
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch')return tracks;
   if(command==='search_videos')return [{id:'Aaaaaaaaaaa',title:'Rammstein · Official Video',views:138000000,durationSeconds:245,score:100,reason:'fixture'}];
   if(command==='catalogue_search')return {artists:[{kind:'artist',id:'1',title:'Rammstein',subtitle:'Исполнитель'}],tracks:tracks.slice(0,5),albums:[{kind:'album',id:'2',title:'Mutter',subtitle:'Альбом'}],playlists:[{kind:'playlist',id:'3',owner:'4',title:'Тяжёлая музыка',subtitle:'Плейлист'}],page:0};
   if(command==='discovery_fetch')return {title:'Чарт',tracks,playlists:[]};
   if(command==='library_overview')return {liked_count:7,playlists:[{kind:'playlist',id:'3',owner:'4',title:'Вечерний плейлист',subtitle:'Подборка'}]};
   if(command==='storage_command'){if(args.request.type==='status')return {available:true,testMode:true};if(args.request.type==='history')return [];}
   if(command==='diagnostics_status')return {version:'0.0.1',platform:'windows',architecture:'x64',storageAvailable:true,yandex:'missing'};
   if(command==='autostart_status')return {enabled:false,canChange:false};
   if(command==='auth_command')return 'idle';
   if(command==='feedback_command')return {pending:0,excludedTrackIds:[]};
   if(command==='scene_window')return {enabled:false,visible:false,topmost:false};
   if(command==='monitor_list')return [{id:'monitor-fixture',name:'Основной экран',stable:true,primary:true,width:2560,height:1440,scaleFactor:1.25,refreshHz:144}];
  }};
 });
 await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({contentType:'text/javascript',body:`window.YT={Player:class{constructor(id,options){this.el=document.getElementById(id);this.options=options;setTimeout(()=>options.events.onReady({target:this}),0);}cueVideoById(){this.options.events.onStateChange({target:this,data:5});}destroy(){this.el.remove();}setVolume(){}getDuration(){return 245;}getCurrentTime(){return 0;}}};window.onYouTubeIframeAPIReady();`}));
 await page.setViewportSize({width:1200,height:820});await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
 await page.locator('#catalogue-query').fill('рамштайн');await expect(page.locator('.catalogue-track')).toHaveCount(5);await page.screenshot({path:'../../.tools/ycore-theme-search.png'});
 for(const section of ['library','history','settings','queue']){await page.locator(`[data-panel=${section}]`).click();await expect(page.locator(`[data-pane=${section}]`)).toBeVisible();await page.screenshot({path:`../../.tools/ycore-theme-${section}.png`});}
 await page.locator('[data-panel=settings]').click();
 for(const width of [1200,800]){
  await page.setViewportSize({width,height:820});
  for(const id of ['account-settings','autostart-settings','sleep-timer-settings','diagnostics','updates-settings']){
   const gaps=await page.locator('#'+id).evaluate(element=>{const rects=[...element.children].map(child=>child.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);return rects.slice(1).map((rect,index)=>rect.top-rects[index].bottom);});
   for(const gap of gaps)expect(gap,id+' spacing').toBeGreaterThanOrEqual(11.5);
  }
  const actionRects=await page.locator('.account-actions>button:visible').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for(let i=1;i<actionRects.length;i++){const a=actionRects[i-1],b=actionRects[i];expect(Math.max(b.left-a.right,b.top-a.bottom),'account buttons spacing').toBeGreaterThanOrEqual(8);}
  expect(await page.locator('.panel-scroll').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
 }
 await page.setViewportSize({width:1200,height:820});
 await page.locator('#edit-video').click();await expect(page.locator('#video-dialog')).toBeVisible();await page.screenshot({path:'../../.tools/ycore-theme-dialog.png'});await page.locator('#close-video-dialog').click();
 await page.locator('#window-layout').selectOption('controls');await page.locator('[data-panel=search]').click();await expect(page.locator('#queue-list')).toBeVisible();await page.screenshot({path:'../../.tools/ycore-theme-controls.png'});
 await page.setViewportSize({width:800,height:650});await expect(page.locator('#play')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(800);await page.screenshot({path:'../../.tools/ycore-theme-minimum.png'});
});
