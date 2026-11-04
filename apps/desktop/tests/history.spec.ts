import {test,expect} from './fixtures';

test('history loads earlier repeated plays without changing playback and resets pagination for search',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.historyCalls=[];w.failEarlier=true;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='storage_command'&&args.request.type==='history'){
    const {query,beforeId}=args.request;w.historyCalls.push(args.request);
    if(query==='pending')await new Promise(resolve=>w.releaseHistory=resolve);
    if(beforeId&&w.failEarlier){w.failEarlier=false;throw Error('read failed');}
    const count=query?1:beforeId?5:100;
    return Array.from({length:count},(_,i)=>({id:beforeId?beforeId-i-1:205-i,trackId:'123',title:query||'Repeated song',artist:'Fixture',videoId:'M7lc1UVf-VE',startedAt:'2026-11-04T10:00:00Z'}));
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=history]').click();
 const rows=page.locator('#history-list li'),more=page.locator('#history-more');
 await expect(rows).toHaveCount(100);await expect(more).toBeVisible();
 const title=await page.locator('#track-title').textContent();
 await more.click();await expect(page.locator('#history-status')).toContainText('Не удалось прочитать');
 await expect(rows).toHaveCount(100);await expect(more).toBeEnabled();await more.click();
 await expect(rows).toHaveCount(105);await expect(more).toBeHidden();
 expect(await page.evaluate(()=>(window as any).historyCalls.at(-1))).toEqual({type:'history',query:'',beforeId:106});
 await expect(page.locator('#track-title')).toHaveText(title!);
 await page.locator('#history-query').fill('pending');expect(await page.locator('#history-list').evaluate(el=>el.inert)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseHistory)).toBe('function');
 await page.locator('#history-query').fill('new');await expect(rows).toHaveCount(1);await expect(rows.locator('strong')).toHaveText('new');
 await page.evaluate(()=>(window as any).releaseHistory());await expect(rows.locator('strong')).toHaveText('new');
 expect(await page.evaluate(()=>(window as any).historyCalls.at(-1))).toEqual({type:'history',query:'new',beforeId:null});
 await expect(page.locator('#track-title')).toHaveText(title!);
});

test('clearing history rejects a late read and blocks duplicate deletion',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.historyClears=0;w.historyReads=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='storage_command'){
    if(args.request.type==='history'){
     if(++w.historyReads===1){await new Promise(resolve=>w.releaseHistory=resolve);return [{id:1,trackId:'123',title:'Old play',artist:'Fixture',videoId:'M7lc1UVf-VE',startedAt:'2026-11-04T10:00:00Z'}];}
     return [];
    }
    if(args.request.type==='clear_history'){w.historyClears++;await new Promise(resolve=>w.releaseClear=resolve);}
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=history]').click();await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseHistory)).toBe('function');
 await page.locator('#history-clear').click();await page.locator('#clear-confirm').click();
 await expect(page.locator('#clear-confirm')).toBeDisabled();await expect(page.locator('#history-query')).toBeDisabled();
 await page.locator('#clear-confirm').evaluate((button:HTMLButtonElement)=>button.click());
 expect(await page.evaluate(()=>(window as any).historyClears)).toBe(1);
 await page.evaluate(()=>(window as any).releaseClear());await expect(page.locator('#clear-dialog')).not.toBeVisible();
 await page.evaluate(()=>(window as any).releaseHistory());await expect(page.locator('#history-list')).toBeEmpty();
 await expect(page.locator('#history-query')).toBeEnabled();await expect(page.locator('#history-status')).toHaveText('История пока пуста.');
});

test('failed deletion stays in its dialog, preserves history and allows retry',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.cleared=false;w.clearAttempts=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='storage_command'){
    if(args.request.type==='history')return w.cleared?[]:[{id:1,trackId:'123',title:'Retained',artist:'Fixture',videoId:'M7lc1UVf-VE',startedAt:'2026-11-04T10:00:00Z'}];
    if(args.request.type==='clear_history'){if(++w.clearAttempts===1)throw Error('database busy');w.cleared=true;}
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=history]').click();await expect(page.locator('#history-list li')).toHaveCount(1);
 await page.locator('#history-clear').click();await page.locator('#clear-confirm').click();
 await expect(page.locator('#clear-dialog')).toBeVisible();await expect(page.locator('#clear-status')).toContainText('Существующие записи сохранены');
 await expect(page.locator('#clear-confirm')).toBeEnabled();await expect(page.locator('#history-list strong')).toHaveText('Retained');
 await page.locator('#clear-confirm').click();await expect(page.locator('#clear-dialog')).not.toBeVisible();await expect(page.locator('#history-list')).toBeEmpty();
 expect(await page.evaluate(()=>(window as any).clearAttempts)).toBe(2);
});
