import {test,expect} from './fixtures';
test.use({timezoneId:'America/New_York'});
test('history period uses inclusive local calendar days across DST, resets pagination and rejects stale periods',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.requests=[];w.hold=false;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='storage_command'&&args.request.type==='history'){
    const request=args.request;w.requests.push(request);
    if(w.hold){w.hold=false;await new Promise(resolve=>w.releasePeriod=resolve);}
    return Array.from({length:request.beforeId?5:100},(_,i)=>({id:request.beforeId?request.beforeId-i-1:205-i,trackId:'123',title:'Period '+(request.until??'all'),artist:'Fixture',videoId:'M7lc1UVf-VE',startedAt:'2026-11-01T10:00:00Z'}));
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=history]').click();const rows=page.locator('#history-list li');await expect(rows).toHaveCount(100);
 await page.locator('#history-period-summary').click();await page.locator('#history-from').fill('2026-11-01');await page.locator('#history-until').fill('2026-11-01');
 const start=Date.parse('2026-11-01T04:00:00Z')/1000,end=Date.parse('2026-11-02T05:00:00Z')/1000;
 await expect.poll(()=>page.evaluate(()=>(window as any).requests.at(-1))).toEqual({type:'history',query:'',beforeId:null,from:start,until:end});
 await page.locator('#history-more').click();await expect(rows).toHaveCount(105);
 expect(await page.evaluate(()=>(window as any).requests.at(-1))).toEqual({type:'history',query:'',beforeId:106,from:start,until:end});
 await page.evaluate(()=>(window as any).hold=true);await page.locator('#history-until').fill('2026-11-02');
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releasePeriod)).toBe('function');
 await page.locator('#history-until').fill('2026-11-03');await expect(rows).toHaveCount(100);
 const lastEnd=Date.parse('2026-11-04T05:00:00Z')/1000;
 await expect(rows.first().locator('strong')).toHaveText('Period '+lastEnd);
 await page.evaluate(()=>(window as any).releasePeriod());await expect(rows.first().locator('strong')).toHaveText('Period '+lastEnd);
 await page.locator('#history-period-clear').click();await expect(page.locator('#history-from')).toHaveValue('');await expect(page.locator('#history-until')).toHaveValue('');
 await expect.poll(()=>page.evaluate(()=>(window as any).requests.at(-1))).toEqual({type:'history',query:'',beforeId:null});
 await page.locator('#history-from').fill('2026-11-05');const count=await page.evaluate(()=>(window as any).requests.length);
 await page.locator('#history-until').fill('2026-11-02');await expect(page.locator('#history-status')).toContainText('не позже конца');
 expect(await page.evaluate(()=>(window as any).requests.length)).toBe(count);await expect(page.locator('#history-more')).toBeDisabled();
 await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
});
