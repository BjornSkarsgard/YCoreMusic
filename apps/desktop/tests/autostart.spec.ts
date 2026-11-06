import {test,expect} from './fixtures';

test('autostart is only changed on explicit input, blocks duplicate writes and verifies OS state',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.autoEnabled=false;w.autoReads=0;w.autoWrites=[];
  w.__TAURI_INTERNALS__={invoke:async(cmd:string,args:any)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='autostart_status'){w.autoReads++;return {enabled:w.autoEnabled,canChange:true};}
   if(cmd==='autostart_set'){
    w.autoWrites.push(args.enabled);
    if(!args.enabled)throw Error('OS rejected setting');
    await new Promise(resolve=>w.releaseAutostart=resolve);w.autoEnabled=args.enabled;return {enabled:w.autoEnabled,canChange:true};
   }
  }};
 });
 await page.goto('/');expect(await page.evaluate(()=>(window as any).autoReads)).toBe(0);
 await page.locator('[data-panel=settings]').click();const checkbox=page.locator('#autostart-enabled');
 await expect(checkbox).toBeEnabled();await expect(checkbox).not.toBeChecked();expect(await page.evaluate(()=>(window as any).autoWrites)).toEqual([]);
 await checkbox.check();await expect(checkbox).toBeDisabled();await expect(page.locator('#autostart-status')).toContainText('Сохраняем');
 await checkbox.evaluate((element:HTMLInputElement)=>element.dispatchEvent(new Event('change')));
 expect(await page.evaluate(()=>(window as any).autoWrites)).toEqual([true]);
 await page.evaluate(()=>(window as any).releaseAutostart());await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked();
 await checkbox.click();await expect(page.locator('#autostart-status')).toContainText('Не удалось подтвердить');await expect(checkbox).toBeChecked();
 await page.evaluate(()=>(window as any).autoEnabled=false);await page.locator('#autostart-refresh').click();await expect(checkbox).not.toBeChecked();
 await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
});

test('failed autostart reads can be retried and read-only test state never submits a change',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.autoWorking=false;w.autoWrites=0;
  w.__TAURI_INTERNALS__={invoke:async(cmd:string)=>{
   if(cmd==='source_fetch'||cmd==='smart_history_fetch')return [];
   if(cmd==='autostart_status'){if(!w.autoWorking)throw Error('read failed');return {enabled:false,canChange:false};}
   if(cmd==='autostart_set')w.autoWrites++;
  }};
 });
 await page.goto('/');await page.locator('[data-panel=settings]').click();
 await expect(page.locator('#autostart-status')).toContainText('Не удалось прочитать');await expect(page.locator('#autostart-enabled')).toBeDisabled();
 await page.evaluate(()=>(window as any).autoWorking=true);await page.locator('#autostart-refresh').click();
 await expect(page.locator('#autostart-status')).toContainText('недоступно в этом запуске');await expect(page.locator('#autostart-enabled')).toBeDisabled();
 await page.locator('#autostart-enabled').evaluate((element:HTMLInputElement)=>{element.checked=true;element.dispatchEvent(new Event('change'));});
 expect(await page.evaluate(()=>(window as any).autoWrites)).toBe(0);await expect(page.locator('#autostart-enabled')).not.toBeChecked();
});
