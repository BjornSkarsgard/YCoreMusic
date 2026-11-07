import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.handlers={};w.callbacks={};w.loads=[];w.commands=[];w.mirrors=[];w.records=[];w.analysisWatches=[];w.presentations=[];let id=0,epoch=0,sequence=0;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  const cache={position:0,duration:120,playback:-1,quality:'hd1080',captionOptions:[],captionTracks:[],iframeCount:1};
  w.sleepTimer={remainingSeconds:0,active:false,expired:false,revision:0};
  w.startupUpdate=sessionStorage.getItem('startup-update-fixture');
  w.updateState={phase:w.startupUpdate?'idle':'disabled',notes:'',downloaded:0};w.updateCalls=[];
  w.updatePublished=!!w.startupUpdate;
  w.packet=(kind:string,overrides:any={})=>w.handlers['player-host-event']?.({payload:{epoch,sequence:++sequence,kind,cache:{...cache},...overrides}});
  w.__TAURI_INTERNALS__={transformCallback:(callback:any)=>{w.callbacks[++id]=callback;return id;},invoke:async(command:string,args:any)=>{
   if(command==='updates_command'){
    w.updateCalls.push(args.action);
    if(args.action==='check'){
     if(w.startupUpdate==='held')await new Promise(resolve=>w.releaseStartupCheck=resolve);
     w.updateState={phase:w.updateCheckFailure?'error':w.updatePublished?'available':'unpublished',version:w.updatePublished?'0.0.2':null,notes:'<img src=x onerror="window.updateXss=true">',downloaded:0,error:w.updateCheckFailure?'check_failed':null};
    }
    if(args.action==='download')w.updateState={...w.updateState,phase:w.updateBadSignature?'error':'ready',error:w.updateBadSignature?'download_or_signature_failed':null,downloaded:100,total:100};
    if(args.action==='install'){if(w.holdUpdateInstall)return new Promise(resolve=>w.finishUpdateInstall=resolve);w.updateState={...w.updateState,phase:'error',error:'install_failed'};}
    return {...w.updateState};
   }
   if(command==='sleep_timer'){
    const action=args.request;if(action.type==='start')w.sleepTimer={remainingSeconds:action.seconds,active:true,expired:false,revision:w.sleepTimer.revision+1};
    if(action.type==='cancel')w.sleepTimer={remainingSeconds:0,active:false,expired:false,revision:w.sleepTimer.revision+1};
    return {...w.sleepTimer};
   }
   if(command==='monitor_current')return {refreshHz:w.monitorHz??null};
   if(command==='crash_recovery'){
    (w.recoveryRequests??=[]).push(args.request);
    if(args.request.type==='read')return JSON.parse(sessionStorage.getItem('testResume')??'null');
    if(args.request.type==='discard')sessionStorage.removeItem('testResume');
    return null;
   }
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
   if(command==='analysis_watch'){w.analysisWatches.push(args.active);return;}
   if(command==='player_host_presentation'){w.presentations.push(args);return;}
   if(command==='storage_command'&&args.request.type==='record')w.records.push(args.request.event);
  }};
 });
 await page.route('https://www.youtube.com/**',route=>route.abort());
 await page.goto('/');await expect(page.locator('#play')).toBeEnabled();
});

test('startup offers an update after other dialogs and remembers postponement across launches',async({page})=>{
 await page.evaluate(()=>{
  sessionStorage.setItem('startup-update-fixture','held');
  localStorage.setItem('ycore.updateCheck.v1',String(Date.now()));
 });
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseStartupCheck)).toBe('function');
 await page.evaluate(()=>{
  const dialog=document.createElement('dialog');dialog.id='other-startup-dialog';
  document.body.append(dialog);dialog.showModal();(window as any).releaseStartupCheck();
 });
 await expect(page.locator('#updates-summary')).toHaveText('Доступна версия 0.0.2.');
 await expect(page.locator('#updates-dialog')).toBeHidden();
 await page.locator('#other-startup-dialog').evaluate((dialog:HTMLDialogElement)=>dialog.close());
 await expect(page.locator('#updates-dialog')).toBeVisible();
 await page.locator('#updates-later').click();
 await page.evaluate(()=>sessionStorage.setItem('startup-update-fixture','available'));
 await page.reload();
 await expect(page.locator('#updates-summary')).toHaveText('Доступна версия 0.0.2.');
 await expect(page.locator('#updates-dialog')).toBeHidden();
 expect(await page.evaluate(()=>(window as any).updateCalls)).toContain('check');
 expect(await page.evaluate(()=>(window as any).updateCalls)).not.toContain('download');
 await page.locator('[data-panel=settings]').click();await page.locator('#updates-details').click();
 await expect(page.locator('#updates-dialog')).toBeVisible();
});

test('updates distinguish an absent release and a failed check, render notes safely and persist deferral',async({page})=>{
 await page.evaluate(()=>{const w=window as any;w.updateState={phase:'idle',notes:'',downloaded:0};w.handlers['updates-status']({payload:w.updateState});});
 await page.locator('[data-panel=settings]').click();await page.locator('#updates-check').click();await expect(page.locator('#updates-summary')).toContainText('пока не опубликованы');
 await page.evaluate(()=>(window as any).updateCheckFailure=true);await page.locator('#updates-check').click();await expect(page.locator('#updates-summary')).toContainText('Не удалось проверить');await expect(page.locator('#updates-check')).toBeEnabled();
 await page.evaluate(()=>{const w=window as any;w.updateCheckFailure=false;w.updatePublished=true;});await page.locator('#updates-check').click();await expect(page.locator('[data-panel=settings]')).toHaveClass(/has-update/);
 await page.locator('#updates-details').click();await expect(page.locator('#updates-notes')).toContainText('<img');expect(await page.evaluate(()=>(window as any).updateXss)).toBeUndefined();
 await page.locator('#updates-later').click();await expect(page.locator('#updates-dialog')).not.toBeVisible();await expect(page.locator('[data-panel=settings]')).not.toHaveClass(/has-update/);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ycore.updateDeferred.v1')!).version)).toBe('0.0.2');
 expect(await page.evaluate(()=>(window as any).updateCalls.filter((action:string)=>action==='download'||action==='install'))).toEqual([]);
});

test('an invalid update stays uninstalled; verified download allows installation only after explicit Pause',async({page})=>{
 await page.locator('#play').click();const loads=await page.evaluate(()=>(window as any).loads.length);
 await page.evaluate(()=>{const w=window as any;w.updateState={phase:'idle',notes:'',downloaded:0};w.updatePublished=true;w.updateBadSignature=true;w.handlers['updates-status']({payload:w.updateState});});
 await page.locator('[data-panel=settings]').click();await page.locator('#updates-check').click();await page.locator('#updates-details').click();await page.locator('#updates-download').click();
 await expect(page.locator('#updates-status')).toContainText('подтвердить подлинность');await expect(page.locator('#updates-install')).toBeHidden();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.evaluate(()=>(window as any).updateBadSignature=false);await page.locator('#updates-download').click();await expect(page.locator('#updates-install')).toBeDisabled();await expect(page.locator('#updates-pause-hint')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).updateCalls.includes('install'))).toBe(false);
 await page.locator('#updates-close').click();await page.locator('#pause').click();await page.locator('#updates-details').click();await expect(page.locator('#updates-install')).toBeEnabled();await page.locator('#updates-install').click();
 await expect(page.locator('#updates-status')).toContainText('Текущая версия сохранена');expect(await page.evaluate(()=>(window as any).updateCalls.filter((action:string)=>action==='install').length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
});

test('an older update snapshot cannot reopen playback while installation is pending',async({page})=>{
 await page.evaluate(()=>{const w=window as any;w.holdUpdateInstall=true;w.updateState={phase:'ready',revision:20,version:'0.0.2',notes:'Fixture',downloaded:100};w.handlers['updates-status']({payload:w.updateState});});
 await page.locator('[data-panel=settings]').click();await page.locator('#updates-details').click();await page.locator('#updates-install').click();
 await page.evaluate(()=>{const w=window as any;w.handlers['updates-status']({payload:{...w.updateState,revision:20}});});
 await expect(page.locator('#updates-status')).toContainText('Устанавливаем');await expect(page.locator('#updates-install')).toBeDisabled();
 await page.locator('#updates-close').click();await page.locator('#play').click();expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='play'))).toBe(false);
 await page.evaluate(()=>{const w=window as any;w.finishUpdateInstall({...w.updateState,phase:'error',revision:22,error:'install_failed'});});
 await expect(page.locator('#updates-summary')).toContainText('Текущая версия сохранена');await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
});

test('sleep timer starts, replaces, cancels, expires once and allows explicit Play afterwards',async({page})=>{
 await page.locator('#play').click();const loads=await page.evaluate(()=>(window as any).loads.length);
 await page.locator('#sleep-timer-open').click();await page.locator('#sleep-timer-minutes').fill('0');await page.locator('#sleep-timer-start').click();await expect(page.locator('#sleep-timer-status')).toContainText('от 1 до 720');
 await page.locator('#sleep-timer-minutes').fill('15');await page.locator('#sleep-timer-start').click();await expect(page.locator('#sleep-timer-open')).toContainText('15:00');
 await page.locator('#sleep-timer-minutes').fill('30');await page.locator('#sleep-timer-start').click();await expect(page.locator('#sleep-timer-open')).toContainText('30:00');
 await page.locator('#sleep-timer-cancel').click();await expect(page.locator('#sleep-timer-open')).toContainText('Таймер сна');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.locator('#sleep-timer-start').click();await page.locator('#sleep-timer-close').click();
 await page.evaluate(()=>{const w=window as any;w.sleepTimer={...w.sleepTimer,remainingSeconds:0,active:false,expired:true};w.handlers['sleep-timer-expired']({payload:{revision:w.sleepTimer.revision-1}});});
 await expect(page.locator('#status')).toHaveText(/Пауза|Таймер сна завершён/);await expect(page.locator('#sleep-timer-status')).toContainText('Таймер завершён');
 await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.waitForTimeout(1200);await expect(page.locator('#status')).toHaveText('Воспроизведение');
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);
});

test('playback guard blocks manual navigation, seek and clip changes while pause, volume and natural progression work',async({page})=>{
 await page.locator('#play').click();const loads=await page.evaluate(()=>(window as any).loads.length);
 await page.locator('#playback-lock').click();await expect(page.locator('#playback-lock')).toHaveAttribute('aria-pressed','true');
 await page.locator('#queue-next').click();await page.locator('#previous').click();await page.locator('#forward').click();
 await page.locator('#queue-list li').nth(1).locator('.queue-play').evaluate((button:HTMLButtonElement)=>button.click());
 await page.locator('#source-start').evaluate((button:HTMLButtonElement)=>button.click());
 await page.evaluate(()=>{const w=window as any;w.handlers['ycore-control']?.({payload:'next'});w.handlers['ycore-media']?.({payload:{action:'position',value:50}});const seek=document.getElementById('seek') as HTMLInputElement;seek.value='50';seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('change'));const button=document.getElementById('dislike') as HTMLButtonElement;button.disabled=false;button.addEventListener('click',()=>w.dislikeActivated=true);button.click();(document.getElementById('url') as HTMLInputElement).value='Ccccccccccc';(document.getElementById('load') as HTMLFormElement).requestSubmit();});
 await page.locator('#youtube-settings').click();await expect(page.locator('#track-title')).toHaveText('First');
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='seek'))).toBe(false);expect(await page.evaluate(()=>(window as any).dislikeActivated)).toBeUndefined();
 await page.locator('#pause').click();await expect(page.locator('#status')).toHaveText('Пауза');await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await page.locator('#volume').evaluate((input:HTMLInputElement)=>{input.value='35';input.dispatchEvent(new Event('input'));});expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='volume'&&x.command.level===35))).toBe(true);
 await page.evaluate(()=>(window as any).packet('state',{cache:{playback:0,position:120,duration:120,quality:'default',captionOptions:[],captionTracks:[],iframeCount:1}}));
 await expect(page.locator('#track-title')).toHaveText('Second');await expect(page.locator('#playback-lock')).toHaveAttribute('aria-pressed','true');
 await page.locator('#playback-lock').click();await page.locator('#forward').click();await expect.poll(()=>page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='seek'&&x.command.position===5))).toBe(true);
});

test('crash recovery is inert until confirmation and resumes one clip at its position without old Wave references',async({page})=>{
 await page.evaluate(()=>sessionStorage.setItem('testResume',JSON.stringify({trackId:'123',title:'Recovered song',artist:'Artist',videoId:'Ccccccccccc',position:37})));
 await page.reload();await expect(page.locator('#crash-recovery')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='play'))).toBe(false);
 await page.locator('#crash-recovery-resume').click();await expect(page.locator('#track-title')).toHaveText('Recovered song');
 await expect.poll(()=>page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='cue'&&x.command.position===37))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryRequests.some((r:any)=>r.type==='save'&&r.snapshot.position===37))).toBe(true);
 await expect(page.locator('#crash-recovery')).not.toBeVisible();
 expect(await page.evaluate(()=>(window as any).records.at(-1)?.waveRef)).toBeUndefined();
});

test('declining crash recovery leaves startup paused and does not reload the recovered video',async({page})=>{
 await page.evaluate(()=>sessionStorage.setItem('testResume',JSON.stringify({trackId:'123',title:'Old song',artist:'Artist',videoId:'Ccccccccccc',position:37})));
 await page.reload();await expect(page.locator('#crash-recovery')).toBeVisible();await page.locator('#crash-recovery-discard').click();
 await expect(page.locator('#crash-recovery')).not.toBeVisible();expect(await page.evaluate(()=>(window as any).loads.some((x:any)=>x.videoId==='Ccccccccccc'))).toBe(false);
 expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='play'))).toBe(false);
});

test('main Spectrum uses the shared analysis, persists its own settings, and never reloads the player',async({page})=>{
 await page.locator('#window-layout').selectOption('spectrum');
 const canvas=page.locator('.screen .spectrum-canvas');await expect(canvas).toBeVisible();
 await expect(page.locator('#main-spectrum-options')).toBeVisible();await expect(page.locator('#player')).toHaveCSS('display','none');
 await expect.poll(()=>page.evaluate(()=>(window as any).analysisWatches.at(-1))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(false);
 const silent=await canvas.screenshot();
 await page.evaluate(()=>{const w=window as any;const emit=()=>w.handlers['audio-analysis']({payload:{available:true,bands:Array(48).fill(.2)}});emit();w.spectrumTimer=setInterval(emit,40);});
 await page.waitForTimeout(160);expect((await canvas.screenshot()).equals(silent)).toBe(false);await page.evaluate(()=>clearInterval((window as any).spectrumTimer));
 const loads=await page.evaluate(()=>(window as any).loads.length);
 await page.locator('#main-spectrum-fps').selectOption('30');await page.locator('#main-spectrum-quality').selectOption('low');
 expect(await page.evaluate(()=>localStorage.getItem('ycore.mainSpectrum.v1'))).toBe('{"fps":30,"quality":"low"}');
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);
 await page.locator('#window-layout').selectOption('video');await expect(canvas).toBeHidden();await expect(page.locator('#main-spectrum-options')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).analysisWatches.at(-1))).toBe(false);
 await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(true);
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);await expect(page.locator('iframe')).toHaveCount(0);
});

test('main visualizer offers high-refresh FPS and preserves the chosen cap when moved to a slower display',async({page})=>{
 await page.evaluate(()=>(window as any).monitorHz=240);await page.locator('#window-layout').selectOption('spectrum');
 await expect(page.locator('#main-spectrum-fps option[value="240"]')).toHaveCount(1);await page.locator('#main-spectrum-fps').selectOption('240');await page.locator('#main-spectrum-quality').selectOption('ultra');
 const loads=await page.evaluate(()=>(window as any).loads.length);await page.evaluate(()=>(window as any).monitorHz=60);
 await expect(page.locator('#main-spectrum-fps option[value="240"]')).toContainText('сохранено',{timeout:7000});await expect(page.locator('#main-spectrum-fps option[value="180"]')).toHaveCount(0);
 await expect(page.locator('#main-spectrum-fps')).toHaveValue('240');await expect(page.locator('#main-spectrum-quality')).toHaveValue('ultra');expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);
 await page.reload();await expect(page.locator('#main-spectrum-fps')).toHaveValue('240');await expect(page.locator('#main-spectrum-quality')).toHaveValue('ultra');
});

test('changing from YouTube controls to Spectrum hides the source without another load',async({page})=>{
 await page.locator('#youtube-settings').click();await expect.poll(()=>page.evaluate(()=>(window as any).loads.length)).toBe(2);
 await page.locator('#window-layout').selectOption('spectrum');
 await expect.poll(()=>page.evaluate(()=>(window as any).presentations)).toContainEqual({interactive:false});
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(2);
 await page.locator('#youtube-settings').click();
 await expect(page.locator('#window-layout')).toHaveValue('video');
 await expect(page.locator('.screen .spectrum-canvas')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>(window as any).loads.length)).toBe(3);
});

test('main visualizer type persists without loading a second player',async({page})=>{
 await page.locator('#window-layout').selectOption('spectrum');const loads=await page.evaluate(()=>(window as any).loads.length);
 for(const preset of ['ambient','liquid','particles']){await page.locator('#main-visualizer-preset').selectOption(preset);await expect(page.locator('.spectrum-canvas')).toHaveAttribute('data-preset',preset);}
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);
 await page.reload();await expect(page.locator('#main-visualizer-preset')).toHaveValue('particles');await expect(page.locator('.spectrum-canvas')).toHaveAttribute('data-preset','particles');
 expect(await page.evaluate(()=>(window as any).commands.some((x:any)=>x.command.type==='play'))).toBe(false);
});

test('native host bridge keeps the controller iframe-free and forwards the existing transport without autoplay',async({page})=>{
 // The source engine composites the logo; no black rectangular destination cutout.
 await expect(page.locator('.cue-brand')).toBeHidden();
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.locator('script[src*=youtube]')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).commands.some((value:any)=>value.command.type==='play'))).toBe(false);
 await page.locator('#play').click();await expect(page.locator('#status')).toHaveText('Воспроизведение');await expect.poll(()=>page.evaluate(()=>(window as any).records.length)).toBe(1);
 await expect(page.locator('.cue-brand')).toBeHidden();
 await page.locator('#forward').click();await expect.poll(()=>page.evaluate(()=>(window as any).commands.some((value:any)=>value.command.type==='seek'&&value.command.position===5))).toBe(true);
 const loads=await page.evaluate(()=>(window as any).loads.length);await page.locator('#window-layout').selectOption('controls');
 expect(await page.evaluate(()=>(window as any).loads.length)).toBe(loads);await expect.poll(()=>page.evaluate(()=>(window as any).mirrors.at(-1)?.visible)).toBe(false);
 await page.locator('#pause').click();await expect(page.locator('#status')).toHaveText('Пауза');
});

test('system media Play/Pause, Next and Previous control the sole engine and preserve pause',async({page})=>{
 const media=async(action:string)=>page.evaluate(action=>(window as any).handlers['ycore-media']({payload:{action,value:0}}),action);
 await media('play');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await expect(page.locator('#track-title')).toHaveText('First');
 await media('toggle');await expect(page.locator('#status')).toHaveText('Пауза');
 await media('toggle');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await media('next');await expect(page.locator('#track-title')).toHaveText('Second');
 await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await media('pause');await expect(page.locator('#status')).toHaveText('Пауза');
 const plays=await page.evaluate(()=>(window as any).commands.filter((value:any)=>value.command.type==='play').length);
 await media('previous');await expect.poll(()=>page.evaluate(()=>(window as any).commands.at(-1)?.command)).toEqual({type:'seek',position:0});
 await media('previous');await expect(page.locator('#track-title')).toHaveText('First');
 await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
 expect(await page.evaluate(()=>(window as any).commands.filter((value:any)=>value.command.type==='play').length)).toBe(plays);
 await media('play');await expect(page.locator('#status')).toHaveText('Воспроизведение');
 await expect(page.locator('iframe')).toHaveCount(0);
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

test('the styled picker has no open focus ring and stays above the fullscreen video mirror',async({page})=>{
 const layout=page.locator('#window-layout');
 await page.locator('#screens').focus();await page.keyboard.press('Tab');
 await expect(layout).toBeFocused();await expect(layout).toHaveCSS('outline-style','solid');
 await layout.click();await expect(page.locator('#window-layout:open')).toBeVisible();
 await expect(layout).toHaveCSS('outline-style','none');await expect(layout).toHaveCSS('box-shadow','none');
 await page.screenshot({path:'../../.tools/ycore-dropdown-preview.png'});
 await page.getByRole('option',{name:'Клип и списки',exact:true}).click();
 await expect(page.locator('#window-layout:open')).toHaveCount(0);

 await page.evaluate(()=>{(window as any).packet('tick',{cache:{position:0,duration:120,playback:5,quality:'hd1080',captionOptions:['fontSize','tracklist','track'],captionTracks:[{languageCode:'en',kind:'',name:'',displayName:'English'}],iframeCount:1}});});
 await expect(page.locator('#captions')).toBeEnabled();
 await page.locator('#fullscreen').click();
 await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await page.mouse.move(250,250);
 await page.locator('#captions').click();
 await expect(page.locator('#captions:open')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>{
  const row=document.querySelector('#captions option:focus')?.getBoundingClientRect();
  const surface=(window as any).mirrors.at(-1);
  return !!row&&surface?.visible&&surface.holes.some((hole:any)=>hole.x<=row.left&&hole.y<=row.top&&hole.x+hole.width>=row.right-1&&hole.y+hole.height>=row.bottom-1);
 })).toBe(true);
 await page.getByRole('option',{name:'English',exact:true}).click();
 await expect(page.locator('#captions:open')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).commands.some((item:any)=>item.command.type==='caption_track'&&item.command.languageCode==='en'))).toBe(true);
});

test('caption metadata arriving after Ready enables the selector and forwards language and font size',async({page})=>{
 await page.evaluate(()=>{(window as any).packet('tick',{cache:{position:0,duration:120,playback:5,quality:'hd1080',captionOptions:['fontSize','tracklist','track'],captionTracks:[{languageCode:'en',kind:'',name:'',displayName:'English'}],iframeCount:1}});});
 await expect(page.locator('#captions')).toBeEnabled();await page.locator('#captions').selectOption({label:'English'});await page.locator('#caption-size').selectOption('1');
 const commands=await page.evaluate(()=>(window as any).commands.map((value:any)=>value.command));
 expect(commands).toContainEqual({type:'caption_track',languageCode:'en',kind:'',name:''});expect(commands).toContainEqual({type:'caption_size',size:1});
 await page.locator('#captions').selectOption('off');expect(await page.evaluate(()=>(window as any).commands.at(-2).command.type)).toBe('unload_captions');
});
