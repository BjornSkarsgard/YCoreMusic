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
