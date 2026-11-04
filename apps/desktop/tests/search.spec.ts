import {test,expect} from '@playwright/test';

test('new search blocks stale playback; clearing discards pending results and filters',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='catalogue_search'){
    if(args.query==='pending')await new Promise(resolve=>w.releaseSearch=resolve);
    return {artists:[],tracks:[{id:'1',title:args.query,artist:'Fixture'}],albums:[],playlists:[],page:0};
   }
  }};
 });
 await page.goto('/');
 const input=page.locator('#catalogue-query'),results=page.locator('#catalogue-results');
 await input.fill('first');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await expect(results.locator('strong')).toHaveText('first');
 const initialTitle=await page.locator('#track-title').textContent();
 await input.fill('pending');
 expect(await results.evaluate(el=>el.inert)).toBe(true);
 await expect(results).toHaveAttribute('inert','');
 const oldPlay=await results.locator('button').boundingBox();
 await page.mouse.click(oldPlay!.x+oldPlay!.width/2,oldPlay!.y+oldPlay!.height/2);
 await expect(page.locator('#track-title')).toHaveText(initialTitle!);
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseSearch)).toBe('function');
 await page.getByRole('button',{name:'Очистить поиск'}).click();
 await expect(input).toHaveValue('');await expect(input).toBeFocused();
 await expect(page.locator('#catalogue-filters')).toBeEmpty();await expect(results).toBeEmpty();
 await expect(results).not.toHaveAttribute('inert','');await expect(page.locator('#catalogue-more')).toBeHidden();
 await page.evaluate(()=>(window as any).releaseSearch());
 await expect(results).toBeEmpty();await expect(page.locator('#catalogue-filters')).toBeEmpty();
 await input.fill('fresh');await page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await expect(results.locator('strong')).toHaveText('fresh');await expect(results).not.toHaveAttribute('inert','');
 await input.fill('a');await expect(results).toBeEmpty();await expect(page.locator('#catalogue-filters')).toBeEmpty();
});


test('failed replacement identifies retained results and cannot paginate the wrong query',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.searchPages=[];
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='catalogue_search'){
    w.searchPages.push(args);
    if(args.query==='broken')throw new Error('offline');
    return {artists:[],tracks:[{id:'1',title:args.query,artist:'Fixture'}],albums:[],playlists:[],page:args.page};
   }
  }};
 });
 await page.goto('/');const input=page.locator('#catalogue-query');
 const submit=()=>page.locator('#catalogue-search').evaluate((form:HTMLFormElement)=>form.requestSubmit());
 await input.fill('first');await submit();await expect(page.locator('#catalogue-more')).toBeEnabled();
 await input.fill('broken');await submit();
 await expect(page.locator('#catalogue-status')).toContainText('предыдущие результаты для «first»');
 await expect(page.locator('#catalogue-results strong')).toHaveText('first');await expect(page.locator('#catalogue-more')).toBeDisabled();
 await input.fill('fresh');await submit();await expect(page.locator('#catalogue-results strong')).toHaveText('fresh');
 await expect(page.locator('#catalogue-more')).toBeEnabled();await page.locator('#catalogue-more').click();
 await expect(page.locator('#catalogue-results strong')).toHaveText(['fresh','fresh']);
 expect(await page.evaluate(()=>(window as any).searchPages.at(-1))).toEqual({query:'fresh',page:1});
});
