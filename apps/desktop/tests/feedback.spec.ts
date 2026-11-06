import {test,expect} from './fixtures';
for(const failed of [false,true])test('known reactions stay usable during a remote refresh; local '+(failed?'failure rolls back':'save wins'),async({page})=>{
 await page.clock.install();
 await page.addInitScript(({failed})=>{
  const w=window as any;w.isTauri=true;w.reactionState=0;w.reactionGeneration=1;w.holdRead=false;w.setCalls=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch')return [{id:'1',title:'Current',artist:'Fixture'}];
   if(cmd==='smart_history_fetch'||cmd==='search_videos')return [];
   if(cmd==='feedback_command'){
    const r=args.request;
    if(r.type==='sync')return {pending:0};
    if(r.type==='get'){
     const value={trackId:r.trackId,state:w.reactionState,revision:w.reactionGeneration,pending:false,generation:w.reactionGeneration};
     if(w.holdRead){w.holdRead=false;await new Promise(resolve=>w.releaseRead=resolve);}return value;
    }
    if(r.type==='set'){w.setCalls++;if(failed)throw Error('store unavailable');w.reactionState=r.state;w.reactionGeneration++;return {trackId:r.trackId,state:r.state,revision:w.reactionGeneration,pending:true,generation:w.reactionGeneration};}
   }
  }};
 },{failed});
 await page.goto('/');const like=page.locator('#like');await expect(like).toBeEnabled();
 await page.evaluate(()=>{(window as any).holdRead=true;window.dispatchEvent(new Event('online'));});
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseRead)).toBe('function');await expect(like).toBeEnabled();
 await like.click();await expect.poll(()=>page.evaluate(()=>(window as any).setCalls)).toBe(1);
 await expect(like).toHaveAttribute('aria-pressed',String(!failed));await expect(like).toBeEnabled();
 if(failed)await expect(page.locator('#feedback-notice')).toContainText('Не удалось сохранить');
 await page.evaluate(()=>(window as any).releaseRead());await expect(like).toHaveAttribute('aria-pressed',String(!failed));await expect(like).toBeEnabled();
});
test('returning to YCore Music refreshes external likes without writes and coalesces rapid focus events',async({page})=>{
 await page.clock.install();
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.externalState=0;w.externalGeneration=1;w.syncCalls=0;w.reactionWrites=0;
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch')return [{id:'1',title:'Fixture',artist:'Fixture'}];
   if(command==='smart_history_fetch'||command==='search_videos')return [];
   if(command==='feedback_command'){
    if(args.request.type==='sync'){w.syncCalls++;return {pending:0};}
    if(args.request.type==='set')w.reactionWrites++;
    return {trackId:'1',state:w.externalState,revision:w.externalGeneration,pending:false,generation:w.externalGeneration};
   }
  }};
 });
 await page.goto('/');await expect(page.locator('#like')).toHaveAttribute('aria-pressed','false');await page.clock.fastForward(1200);
 await page.evaluate(()=>{const w=window as any;w.syncCalls=0;w.externalState=1;w.externalGeneration++;for(let n=0;n<10;n++)window.dispatchEvent(new Event('focus'));});await page.clock.fastForward(500);await expect(page.locator('#like')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>(window as any).syncCalls)).toBe(1);
 await page.evaluate(()=>{const w=window as any;w.externalState=0;w.externalGeneration++;for(let n=0;n<10;n++)window.dispatchEvent(new Event('focus'));});await page.clock.fastForward(3500);await expect(page.locator('#like')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>(window as any).syncCalls)).toBe(2);expect(await page.evaluate(()=>(window as any).reactionWrites)).toBe(0);
});
