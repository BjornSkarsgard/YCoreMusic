import {test,expect} from './fixtures';

test('diagnostics checks Yandex only on request, separates connection failures and retains usable retry',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.healthCalls=[];w.health='connected';w.failHealth=false;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='diagnostics_status'){
    w.healthCalls.push(args.checkYandex);if(w.failHealth)throw Error('worker unavailable');
    return {version:'0.0.1',platform:'windows',architecture:'x86_64',storageAvailable:true,yandex:args.checkYandex?w.health:'saved'};
   }
  }};
 });
 await page.goto('/');expect(await page.evaluate(()=>(window as any).healthCalls)).toEqual([]);
 await page.locator('[data-panel=settings]').click();await expect(page.locator('#diagnostics-yandex')).toContainText('Доступ ещё не проверен');
 expect(await page.evaluate(()=>(window as any).healthCalls)).toEqual([false]);
 await page.locator('#diagnostics-check').click();await expect(page.locator('#diagnostics-yandex')).toHaveText('Подключение работает.');
 for(const [state,message] of [['authorization_denied','отклонил доступ'],['network_unavailable','Нет связи'],['rate_limited','просит подождать']]){
  await page.evaluate(state=>(window as any).health=state,state);await page.locator('#diagnostics-check').click();await expect(page.locator('#diagnostics-yandex')).toContainText(message);
 }
 await page.evaluate(()=>(window as any).failHealth=true);await page.locator('#diagnostics-check').click();await expect(page.locator('#diagnostics-status')).toContainText('Не удалось проверить');await expect(page.locator('#diagnostics-check')).toBeEnabled();
 await page.evaluate(()=>{const w=window as any;w.failHealth=false;w.health='connected';});await page.locator('#diagnostics-check').click();await expect(page.locator('#diagnostics-yandex')).toHaveText('Подключение работает.');
 await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
});
