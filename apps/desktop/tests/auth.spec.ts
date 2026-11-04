import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.authCalls=[];w.authState='waiting';w.authFailure=false;w.authHold=false;
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
   if(command==='auth_command'){
    w.authCalls.push(args.action);if(w.authFailure)throw Error('native worker unavailable');
    if(args.action==='begin')return 'waiting';
    if(args.action==='cancel')return 'cancelled';
    if(args.action==='disconnect')return w.authState==='test_mode'?'test_mode':'idle';
    if(w.authHold)return new Promise(resolve=>w.authResolve=resolve);
    return w.authState;
   }
  }};
 });
 await page.goto('/');await page.locator('[data-panel=settings]').click();
});
test('login sends only actions, polls native status and retries denied access without starting playback',async({page})=>{
 await expect(page.locator('#account-connect')).toBeEnabled();
 await page.locator('#account-connect').click();await expect(page.locator('#account-cancel')).toBeVisible();await expect(page.locator('#account-connect')).toBeDisabled();
 await page.evaluate(()=>(window as any).authState='denied');await expect(page.locator('#account-status')).toContainText('Прежнее подключение сохранено');await expect(page.locator('#account-connect')).toBeEnabled();
 await page.evaluate(()=>(window as any).authState='network_error');await page.locator('#account-connect').click();await expect(page.locator('#account-status')).toContainText('нет связи');
 expect(await page.evaluate(()=>(window as any).authCalls)).toEqual(['begin','status','begin','status']);
 await expect(page.locator('iframe')).toHaveCount(0);
});
test('cancel defeats late status response and keeps current connection',async({page})=>{
 await page.evaluate(()=>(window as any).authHold=true);await page.locator('#account-connect').click();
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).authResolve)).toBe('function');
 await page.locator('#account-cancel').click();await expect(page.locator('#account-status')).toContainText('Вход отменён');
 await page.evaluate(()=>(window as any).authResolve('connected'));await page.waitForTimeout(150);await expect(page.locator('#account-status')).toContainText('Вход отменён');await expect(page.locator('#account-connect')).toBeEnabled();
});
test('disconnect needs confirmation and shows native refusal without removing history',async({page})=>{
 await page.locator('#account-disconnect').click();await expect(page.locator('#account-disconnect-dialog')).toBeVisible();expect(await page.evaluate(()=>(window as any).authCalls)).toEqual([]);
 await page.getByRole('button',{name:'Оставить подключение'}).click();await expect(page.locator('#account-disconnect-dialog')).not.toBeVisible();
 await page.evaluate(()=>(window as any).authState='test_mode');await page.locator('#account-disconnect').click();await page.locator('#account-disconnect-confirm').click();await expect(page.locator('#account-status')).toContainText('тестовом запуске');
 expect(await page.evaluate(()=>(window as any).authCalls)).toEqual(['disconnect']);
});
test('login worker failure allows retry without changing the account',async({page})=>{
 await page.evaluate(()=>(window as any).authFailure=true);await page.locator('#account-connect').click();await expect(page.locator('#account-status')).toContainText('Не удалось');await expect(page.locator('#account-connect')).toBeEnabled();
 await page.evaluate(()=>(window as any).authFailure=false);await page.locator('#account-connect').click();await page.locator('#account-cancel').click();await expect(page.locator('#account-status')).toContainText('Вход отменён');
});
test('successful native login refreshes the app without autoplay',async({page})=>{
 await page.evaluate(()=>(window as any).authState='connected');
 const refreshed=page.waitForEvent('load');await page.locator('#account-connect').click();await refreshed;
 await expect(page.locator('[data-pane=wave]')).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
});
